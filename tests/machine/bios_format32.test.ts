import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import * as v from '../../machine/ts/machine/cpu/value';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { createTestSystemCpu, linkTestSystemBlua32 } from '../helpers/blua32';
import { FORMAT32_CASES, FORMAT32_MODULES, FORMAT32_ROM_SOURCE, formatFloat32 } from '../helpers/format32';
import { materializeCpuCompletionValues, parseLuaChunk } from '../helpers/cpu_test_harness';

const sources = FORMAT32_MODULES.map(path => ({ path, source: readFileSync(`machine/bios/${path}.lua`, 'utf8') }));
sources.push({ path: 'tty/console', source: 'return {write=function() end, end_line=function() end}' },
	{ path: 'test/boot', source: "require('base'); return {pcall=__bmsx_pcall,error=__bmsx_error}" });
const modules = sources.map(m => ({ ...m, chunk: parseLuaChunk(m.source, m.path) }));

test('rational formatter reference includes exact halves, signed zero and decimal carry', () => {
	assert.equal(formatFloat32(0x3fa00000, 'f', 1), '1.3');
	assert.equal(formatFloat32(0xbfa00000, 'f', 1), '-1.3');
	assert.equal(formatFloat32(0x80000000, 'f', 3), '-0.000');
	assert.equal(formatFloat32(0x4479e000, 'g', 3), '1e+03'); // 999.5
	assert.equal(formatFloat32(0x47c35000, 'g', 6), '100000');
});

for (const optLevel of [0, 3] as const) for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) {
	test(`BIOS format O${optLevel} ${backend}: all finite exponents, exact decimal references, raw words and fields`, () => {
		const program = compileLuaChunkToProgram(parseLuaChunk(FORMAT32_ROM_SOURCE), modules,
			{ entrySource: FORMAT32_ROM_SOURCE, optLevel, programDomain: 'system' });
		const image = linkTestSystemBlua32(program);
		const { cpu } = createTestSystemCpu(image, backend);
		cpu.installBootPrimitives();
		const budget = 500_000_000;
		assert.equal(cpu.runUntilDepth(0, budget), RunResult.Halted);
		assert.equal(cpu.readLuaFaultReasonWord(), 0);
		const results = materializeCpuCompletionValues(cpu);
		assert.equal(results[0], v.valueBool(true), v.valueTag(results[1]) === v.ValueTag.String ? cpu.stringPool.toString(v.asStringId(results[1])) : 'protected corpus failed');
		assert.equal(results.length, 6);
		assert.equal(results[2], v.valueInteger(FORMAT32_CASES.length));
		assert.equal(results[3], v.valueInteger(17));
		assert.equal(cpu.stringPool.toString(v.asStringId(results[4])), '0xffffffff/-2147483648');
		assert.equal(cpu.stringPool.toString(v.asStringId(results[5])), formatFloat32(1, 'f', 149));
		if (backend === CpuExecutionBackend.Interpreter && process.env.BMSX_CPU32_RUNNER) {
			const expected = [`budget ${cpu.instructionBudgetRemaining} fault 0`, ...results.map(value =>
				v.valueTag(value) === v.ValueTag.String ? `S ${cpu.stringPool.toString(v.asStringId(value))}` :
				`${v.valueTag(value).toString(16)} ${v.valuePayload(value).toString(16)}`)].join('\n') + '\n';
			assert.equal(execFileSync(process.env.BMSX_CPU32_RUNNER,
				['--execute-rom', '--boot-primitives', String(budget)], { input: image.romBytes, encoding: 'utf8' }), expected);
		}
		console.log(JSON.stringify({ optLevel, backend, referenceChecks: FORMAT32_CASES.length, cycles: budget - cpu.instructionBudgetRemaining }));
	});
}
