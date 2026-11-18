import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { asClosure, valueFloat, valueInteger } from '../../machine/ts/machine/cpu/value';
import { IO_SYS_TIME_MS } from '../../machine/ts/spec/bmsx/io';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { createTestSystemCpu, linkTestSystemBlua32 } from '../helpers/blua32';
import { BASE_FIRMWARE_MODULES } from '../helpers/firmware_modules';
import { materializeCpuCompletionValues, parseLuaChunk, runCompletionClosure } from './cpu_test_harness';

const sources = ['os', 'math', 'math/trig', 'math/trig/reduce', 'string', 'string/base', 'string/utf8',
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
