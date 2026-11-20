import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { parseLuaChunk } from '../../toolchain/ts/lua/analysis/parse';
import { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { valueBool, type Value } from '../../machine/ts/machine/cpu/value';
import { createTestSystemCpu, linkTestSystemBlua32 } from '../helpers/blua32';

const source = readFileSync(new URL('../fixtures/compiler32/fixed-motion.lua', import.meta.url), 'utf8');
const modules = [
	...['base', 'number/parse', 'number/decimal'].map(path => ({ path, source: readFileSync(`machine/bios/${path}.lua`, 'utf8') })),
	...['clock', 'event_emitter', 'registry', 'util/dense_set', 'velocity', 'util/div_toward_zero', 'component/base_component',
		'math/affine2', 'math/affine3', 'world/spatial_hierarchy', 'world/base_system', 'world/tick_group',
		'physics/ballistic_movement_component', 'physics/bouncing_movement_component',
		'physics/fixed_point_velocity_component', 'physics/kinematic_movement_component',
		'physics/velocity_component', 'physics/velocity_system'].map(path => ({
		path: `cartlib/${path}`, source: readFileSync(`cartlib/${path}.lua`, 'utf8'),
	})),
	{ path: 'tty/console', source: 'return { write = function() end, end_line = function() end }' },
].map(module => ({ ...module, chunk: parseLuaChunk(module.source, `${module.path}.lua`).chunk }));

for (const optLevel of [3] as const) for (const backend of [CpuExecutionBackend.Interpreter]) {
	test(`signed Q8 movement O${optLevel} ${backend}: negative motion, word limits, rejection and acceleration`, () => {
		const program = compileLuaChunkToProgram(parseLuaChunk(source, 'fixed-motion.lua').chunk, modules,
			{ entrySource: source, programDomain: 'system', optLevel });
		const image = linkTestSystemBlua32(program), { cpu } = createTestSystemCpu(image, backend);
		cpu.installBootPrimitives();
		assert.equal(cpu.runUntilDepth(0, 1_000_000), RunResult.Halted);
		assert.equal(cpu.readLuaFaultReasonWord(), 0);
		const results: Value[] = [];
		cpu.readCompletionValues(results);
		assert.deepEqual(results, [valueBool(true)]);
		if (process.env.BMSX_CPU32_RUNNER) {
			assert.equal(execFileSync(process.env.BMSX_CPU32_RUNNER,
				['--execute-rom', '--boot-primitives', '1000000'], { input: image.romBytes, encoding: 'utf8' }),
				`budget ${cpu.instructionBudgetRemaining} fault 0\n2 0\n`);
		}
	});
}
