import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { asClosure, valueFloat, valueInteger } from '../../machine/ts/machine/cpu/value';
import { IO_SYS_TIME_MS } from '../../machine/ts/spec/bmsx/io';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { createTestSystemCpu, linkTestSystemBlua32 } from '../helpers/blua32';
import { BASE_FIRMWARE_MODULES } from '../helpers/firmware_modules';
import { materializeCpuCompletionValues, parseLuaChunk, runCompletionClosure } from '../helpers/cpu_test_harness';

const sources = ['os', 'math', 'math/trig', 'math/trig/reduce', 'string', 'string/base', 'string/mapped',
	'string/pattern', 'string/format', 'number/format', 'string/pack', 'string/float/decode',
	'string/float/encode', 'table'].map(path => {
	const source = readFileSync(`machine/bios/${path}.lua`, 'utf8');
	return { path, source };
});
const modules = [...sources, ...BASE_FIRMWARE_MODULES, { path: 'tty/console', source: 'return {write=function() end, end_line=function() end}' }]
	.map(module => ({ ...module, chunk: parseLuaChunk(module.source, module.path) }));
const source = `require('base')
local os<const> = require('os')
function sample()
 local clock = os.clock()
 local seconds = os.time()
 local date = os.date('*t')
 return clock, seconds, date.year, date.month, date.day, date.hour, date.min, date.sec
end`;

for (const optLevel of [0, 3] as const) test(`BIOS samples the unsigned millisecond port once per call across rollover (O${optLevel})`, () => {
	const program = compileLuaChunkToProgram(parseLuaChunk(source), modules, { entrySource: source, programDomain: 'system', optLevel });
	const image = linkTestSystemBlua32(program);
	for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) {
		const { cpu, memory } = createTestSystemCpu(image, backend);
		cpu.installBootPrimitives();
		assert.equal(cpu.runUntilDepth(0, 1_000_000), RunResult.Halted);
		const sample = asClosure(cpu.getGlobalByKey(cpu.stringPool.find('sample')!), cpu.gc);
		let reads = 0, word = 0;
		memory.mapIoRead(IO_SYS_TIME_MS, memory, () => { ++reads; return word; });
		for (word of [0, 999, 1000, 16777217, 0x7fffffff, 0x80000000, 0x80000080, 0x80000081, 0x80000180, 4294966999, 4294967000, 0xffffffff, 0]) {
			reads = 0;
			runCompletionClosure(cpu, sample, []);
			const date = new Date(word);
			assert.deepEqual(materializeCpuCompletionValues(cpu), [valueFloat(Math.fround(word) / 1000),
				valueInteger(Math.trunc(word / 1000)), ...[date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(),
					date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()].map(valueInteger)], `word ${word.toString(16)}`);
			assert.equal(reads, 3);
		}
	}
});

const epochs = [-2147483648, -2147483647, -86401, -86400, -1, 0, 1, 86400, 951782400, 2147483646, 2147483647];
let state = 0x8123ac10;
for (let index = 0; index < 64; ++index) {
	state = (Math.imul(state, 1664525) + 1013904223) | 0;
	epochs.push(state);
}
// UTC supplies an independent Gregorian oracle. Carry exact multiples of an
// era, a year and a day between fields without changing the represented instant.
const calendarRows = epochs.map((stamp, i) => {
	const d = new Date(stamp * 1000), year = d.getUTCFullYear(), month = d.getUTCMonth() + 1;
	const day = d.getUTCDate(), h = d.getUTCHours(), m = d.getUTCMinutes(), s = d.getUTCSeconds();
	const direction = (i & 1) === 0 ? 1 : -1;
	const eras = 12000 * direction, years = 173000000 * direction, days = 60000000 * direction;
	return `{0x${(stamp >>> 0).toString(16)},${year},${month},${day},${h},${m},${s},${d.getUTCDay() + 1},
		{year=${year + 400 * eras + years},month=${month - 12 * years},day=${day - 146097 * eras - days},
		 hour=${h + 24 * days},min=${m + 10000000},sec=${s - 600000000}}}`;
});
const calendar = `require('base')
local os<const> = require('os')
local math<const> = require('math')
local rows<const> = {${calendarRows.join(',')}}
for i = 1, #rows do
 local r<const> = rows[i]
 local d<const> = r[9]
 if os.time(d) ~= r[1] then return -i end
 local raw<const> = os.date('*t', r[1])
 if os.time(raw) ~= r[1] then return -i end
 for _, fields in ipairs({d, raw}) do
  if fields.year ~= r[2] or fields.month ~= r[3] or fields.day ~= r[4] or fields.hour ~= r[5]
   or fields.min ~= r[6] or fields.sec ~= r[7] or fields.wday ~= r[8] then return -i end
 end
end
for _, d in ipairs({{year=2038,month=1,day=19,hour=3,min=14,sec=8}, {year=1901,month=12,day=13,hour=20,min=45,sec=51},
 {year=0x7fffffff,month=0x7fffffff,day=1}, {year=0x80000000,month=0x80000000,day=1}}) do
 local ok, why = pcall(os.time, d)
 if ok or why ~= 'time is out-of-bound' or d.yday ~= nil then return -100 end
end
local bad, why = pcall(os.date,'*t',2147483648.0)
if bad or why ~= 'time is out-of-bound' then return -101 end
bad, why = pcall(os.date,'*t',false)
if bad or why ~= 'time is not an integer' then return -102 end
local high = os.difftime(0x7fffffff,0x80000000)
local low = os.difftime(0x80000000,0x7fffffff)
if high ~= 0x1p32 or low ~= -0x1p32 or math.type(high) ~= 'float' or math.type(low) ~= 'float' then return -103 end
if os.difftime(2147483647,2147483646) ~= 1 then return -104 end
return #rows`;

for (const optLevel of [0, 3] as const) test(`BIOS civil seconds: exact signed endpoints, normalization and whole-second difference (O${optLevel})`, () => {
	const image = linkTestSystemBlua32(compileLuaChunkToProgram(parseLuaChunk(calendar), modules,
		{ entrySource: calendar, programDomain: 'system', optLevel }));
	const budget = 20_000_000;
	for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) {
		const { cpu } = createTestSystemCpu(image, backend);
		cpu.installBootPrimitives();
		assert.equal(cpu.runUntilDepth(0, budget), RunResult.Halted);
		assert.deepEqual(materializeCpuCompletionValues(cpu), [valueInteger(epochs.length)]);
		if (backend === CpuExecutionBackend.Interpreter && process.env.BMSX_CPU32_RUNNER) {
			assert.equal(execFileSync(process.env.BMSX_CPU32_RUNNER, ['--execute-rom', '--boot-primitives', String(budget)],
				{ input: image.romBytes, encoding: 'utf8' }), `budget ${cpu.instructionBudgetRemaining} fault 0\n3 ${epochs.length.toString(16)}\n`);
		}
	}
});
