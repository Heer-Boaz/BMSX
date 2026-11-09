import assert from 'node:assert/strict';
import { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { DYNAMIC_RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { createTestSystemCpu, linkTestSystemBlua32 } from '../helpers/blua32';
import { compileLuaSource } from '../lua/cpu_test_harness';

// Invoke through npm run test:exec -- tsx --tsconfig tsconfig.base.json <file>.
// These programs do not HALT/wait: reported cycles are actual CPU execution.
const iterations = Number(process.argv[2] ?? 100000);
const rounds = Number(process.argv[3] ?? 3);
const workloads = {
	registers: `local n = 1
for i = 1, ${iterations} do n = ((n + 3) ~ (i << 2)) & 65535 end
return n`,
	fractions: `local n = 0.25
for i = 1, ${iterations} do n = (n + 0.125) * 0.99 - 0.0625 end
return n`,
	tables: `local t = { x = 1, y = 2, 3, 4 }
for i = 1, ${iterations} do t.x = t.x + 1; t[1] = t.x; t.y = t[1] + t[2] end
return t.x, t.y`,
	calls: `local function step(x, y) return ((x << 1) ~ y) & 65535 end
local n = 1
for i = 1, ${iterations} do n = step(n, i) end
return n`,
	closures: `local n = 1
local function step(x) n = (n + x) & 65535 end
for i = 1, ${iterations} do step(i) end
return n`,
	closed_captures: `local function make()
local n = 1
return function(x) n = (n + x) & 65535; return n end
end
local step = make()
for i = 1, ${iterations} do step(i) end
return step(0)`,
	globals: `counter = 1
for i = 1, ${iterations} do counter = (counter + i) & 65535 end
return counter`,
	varargs: `local function step(...)
local a, b, c, d = ...
return (a + b + c) & 65535, d
end
local n, missing = 1, nil
for i = 1, ${iterations} do n, missing = step(n, i, 3) end
return n, missing`,
	ram: `local address = ${DYNAMIC_RAM_BASE + 0x1000}
mem32le[address] = 1
for i = 1, ${iterations} do mem32le[address] = (mem32le[address] + i) & 65535 end
return mem32le[address]`,
	allocation: `local n = 0
for i = 1, ${iterations} do local t = { i, i + 1, x = i }; n = (n + t.x + t[2]) & 65535 end
return n`,
};

for (const [name, source] of Object.entries(workloads)) {
	const image = linkTestSystemBlua32(compileLuaSource(source, `cpu-execution-${name}.lua`));
	for (const grant of [256, 4096]) {
		let expected: ReturnType<ReturnType<typeof createTestSystemCpu>['cpu']['captureRuntimeState']> | null = null;
		for (let round = 0; round < rounds; ++round) {
			const order = round % 2 === 0
				? [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]
				: [CpuExecutionBackend.JavaScript, CpuExecutionBackend.Interpreter];
			for (const backend of order) {
				const cpu = createTestSystemCpu(image, backend).cpu;
				const executionImage = cpu.rootThread.frames[0].executionImage;
				let result = RunResult.Yielded;
				let cycles = 0;
				const start = performance.now();
				while (result === RunResult.Yielded) {
					result = cpu.runUntilDepth(0, grant);
					cycles += grant - cpu.instructionBudgetRemaining;
				}
				const milliseconds = performance.now() - start;
				assert.equal(result, RunResult.Halted);
				const state = cpu.captureRuntimeState();
				if (expected === null) expected = state;
				else assert.deepEqual(state, expected, `${name}: complete CPU state must match`);
				let compiledBlocks = 0;
				let sourceUnits = 0;
				for (const page of executionImage.decodedPages.values()) {
					if (page.compiledBlocks === null) continue;
					sourceUnits += page.compiledBlocks.sourceUnits;
					for (const block of page.compiledBlocks.entries) if (block !== null) ++compiledBlocks;
				}
				console.log(JSON.stringify({ workload: name, iterations, round, grant,
					backend: backend === CpuExecutionBackend.Interpreter ? 'interpreter' : 'javascript',
					modelHz: PSX_MACHINE_SPEC.cpuFreqHz, activeCycles: cycles, idleCycles: 0,
					milliseconds, megahertz: cycles / milliseconds / 1000, compiledBlocks, sourceUnits }));
			}
		}
	}
}
