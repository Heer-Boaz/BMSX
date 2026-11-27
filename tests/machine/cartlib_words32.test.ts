import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import * as v from '../../machine/ts/machine/cpu/value';
import { compileTestSystemWithHeap } from '../helpers/heap_service_system';
import { createTestBlua32PairCpu, createTestSystemCpu, linkTestSystemBlua32 } from '../helpers/blua32';
import { compileCartlibProgram } from '../helpers/cartlib_cpu';
import { CLOCK_WORD_CHECKS, CLOCK_WORD_MODULES, CLOCK_WORD_ROM_SOURCE } from '../helpers/clock_words32';
import { materializeCpuCompletionValues, parseLuaChunk, runCompletionClosure, runGuestToHalt } from '../helpers/cpu_test_harness';

const modules = CLOCK_WORD_MODULES.map(path => {
	const source = readFileSync(`${path}.lua`, 'utf8');
	return { path, source, chunk: parseLuaChunk(source, path) };
});
for (const optLevel of [3] as const) for (const backend of [CpuExecutionBackend.Interpreter]) {
	test(`cartlib clock words O${optLevel} ${backend}: both wraps and binary32 audio conversion`, () => {
		const image = linkTestSystemBlua32(compileTestSystemWithHeap(parseLuaChunk(CLOCK_WORD_ROM_SOURCE), modules,
			{ entrySource: CLOCK_WORD_ROM_SOURCE, optLevel, programDomain: 'system' }));
		const { cpu } = createTestSystemCpu(image, backend), budget = 1_000_000;
		runGuestToHalt(cpu, budget);
		const result = materializeCpuCompletionValues(cpu);
		assert.deepEqual(result, [v.valueBool(true), v.valueInteger(CLOCK_WORD_CHECKS)]);
		if (backend === CpuExecutionBackend.Interpreter && process.env.BMSX_CPU32_RUNNER) {
			const expected = [`budget ${cpu.instructionBudgetRemaining} fault 0`, ...result.map(value =>
				`${v.valueTag(value).toString(16)} ${v.valuePayload(value).toString(16)}`)].join('\n') + '\n';
			assert.equal(execFileSync(process.env.BMSX_CPU32_RUNNER, ['--execute-rom', String(budget)],
				{ input: image.romBytes, encoding: 'utf8' }), expected);
		}
	});
}

const inputModules = ['input', 'action_parser', 'action_syntax', 'action_program_syntax',
	'action_state_program', 'action_state_program_syntax', 'icu', 'keys'].map(name => ({
	path: `cartlib/input/${name}`, source: readFileSync(`cartlib/input/${name}.lua`, 'utf8'),
}));
const inputSource = `
local input<const> = require('cartlib/input/input')
local clock<const> = require('cartlib/clock')
input.add_player(1)
local directions<const> = input.stick_directions('ls', 0x4000)
input.push_context(1, 'axes', {}, {left={directions.left},right={directions.right}}, {}, 100, true)
input.advance_frame()
word32_read_axis = function()
 return input.get_action_value(1, clock.frame, 'left'), input.get_action_value(1, clock.frame, 'right'),
  input.is_action_pressed(1, clock.frame, 'left'), input.is_action_pressed(1, clock.frame, 'right')
end
word32_sample_axis = function() input.advance_frame() end
return true
`;
for (const optLevel of [3] as const) for (const backend of [CpuExecutionBackend.Interpreter]) {
	test(`cartlib input words O${optLevel} ${backend}: initial and grouped signed-axis sampling`, () => {
		const { images } = compileCartlibProgram(inputSource, { optLevel, modules: inputModules });
		const { cpu, memory } = createTestBlua32PairCpu(images, backend);
		runGuestToHalt(cpu, 20_000_000);
		const read = v.asClosure(cpu.getGlobalByKey(cpu.stringPool.find('word32_read_axis')!), cpu.gc);
		const sample = v.asClosure(cpu.getGlobalByKey(cpu.stringPool.find('word32_sample_axis')!), cpu.gc);
		// Supply the ICU's retained raw word at the CPU/MMIO boundary. This
		// exercises cartlib, not the physical controller or host input transport.
		const axis = 0x080000a0;
		for (const [index, raw] of [-0x10000, 0x10000, -1, 0, -0x4000, 0x4000, -2147483648].entries()) {
			memory.writeIoU32(axis, raw >>> 0);
			if (index !== 0) runCompletionClosure(cpu, sample, []);
			runCompletionClosure(cpu, read, []);
			const negative = raw < 0 ? -raw | 0 : 0, positive = raw >= 0 ? raw : 0;
			assert.deepEqual(materializeCpuCompletionValues(cpu), [v.valueInteger(negative), v.valueInteger(positive),
				v.valueBool(negative >= 0x4000), v.valueBool(positive >= 0x4000)], `raw ${raw}`);
		}
	});
}
