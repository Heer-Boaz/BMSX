import assert from 'node:assert/strict';
import test from 'node:test';
import { OffscreenMachine } from '../../hosts/common/offscreen_machine';
import { TestInput } from '../../ide/testing/input';
import { IO_GX_GPU_GP0 } from '../../machine/ts/spec/bmsx/io';
import { PSX_CPU_FREQ_HZ, PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { GX_GPU_GP0_VRAM_TO_CPU_FIRST } from '../../machine/ts/spec/gx/gp0';
import { linkTestSystemBlua32 } from '../helpers/blua32';
import { compileLuaSource } from './cpu_test_harness';

for (const optLevel of [0, 3] as const) {
	test(`O${optLevel}: offscreen admission preserves exact raw cycle grants without paced clamping`, t => {
		const system = linkTestSystemBlua32(compileLuaSource('while true do end', 'offscreen_exact_grant', optLevel));
		const target = new OffscreenMachine(system.romBytes, [null, null], PSX_MACHINE_SPEC, new TestInput());
		t.after(() => target.dispose());
		const runtime = target.runtime;
		assert.equal(target.advanceGame(55), false);
		assert.equal(runtime.frameLoop.frameState.cycleBudgetGranted, 55, 'cycle grants do not round-trip through fractional host time');
		assert.equal(runtime.frameScheduler.captureState().cycleGrantRemainder, 0);
		assert.equal(target.advanceGame(149), false);
		assert.equal(runtime.frameLoop.frameState.cycleBudgetGranted, 204);
		const grant = PSX_CPU_FREQ_HZ;
		assert.equal(target.advanceGame(grant), true);
		assert.equal(runtime.frameScheduler.lastTickSequence, 1);
		assert.equal(runtime.frameScheduler.lastTickBudgetGranted, grant + 204, 'explicit grants are not paced catch-up time');
		const carry = runtime.frameScheduler.captureState().carriedCycleBudget;
		assert.equal(carry, grant + 204 - runtime.machine.scheduler.nowCycles);
		assert.equal(target.advanceGame(0), true);
		assert.equal(runtime.frameScheduler.lastTickSequence, 2, 'zero resumes only the next retained tick');
		assert.equal(runtime.frameScheduler.lastTickBudgetGranted, carry);
		assert.equal(runtime.frameScheduler.captureState().cycleGrantRemainder, 0);
	});

	test(`O${optLevel}: offscreen GPU readbacks resume the accepted grant before admitting the next one`, t => {
		const system = linkTestSystemBlua32(compileLuaSource(`
local port<const>: *word = ${IO_GX_GPU_GP0}
for i = 1, 3 do
 *port = ${GX_GPU_GP0_VRAM_TO_CPU_FIRST << 24 >>> 0}
 *port = 0
 *port = 0x00010001
 local pixel = *port
end
while true do end`, 'offscreen_readback_grant', optLevel));
		const target = new OffscreenMachine(system.romBytes, [null, null], PSX_MACHINE_SPEC, new TestInput());
		t.after(() => target.dispose());
		const readback = t.mock.method(target.backend, 'executeGxGpuReadback');
		for (let grant = 1; grant <= 3; grant++) {
			assert.equal(target.advanceGame(1000), false);
			assert.equal(target.runtime.machine.gxGpu.backendServiceBlocksMachine(), false);
			assert.equal(target.runtime.machine.scheduler.nowCycles, grant * 1000);
			assert.equal(target.runtime.frameLoop.frameState.cycleBudgetRemaining, 0);
			assert.equal(target.runtime.frameLoop.frameState.cycleBudgetGranted, grant * 1000);
		}
		assert.equal(readback.mock.callCount(), 3, 'all fences are serviced within the original grant');
	});

	for (const extraPeriods of [0, 2]) {
		test(`O${optLevel}: readback at VBlank preserves bounded completion and ${extraPeriods} periods of carry`, t => {
			const system = linkTestSystemBlua32(compileLuaSource('while true do end', 'offscreen_same_edge', optLevel));
			const baseline = new OffscreenMachine(system.romBytes, [null, null], PSX_MACHINE_SPEC, new TestInput());
			const target = new OffscreenMachine(system.romBytes, [null, null], PSX_MACHINE_SPEC, new TestInput());
			t.after(() => { baseline.dispose(); target.dispose(); });
			assert.equal(baseline.advanceGame(baseline.runtime.timing.cycleBudgetPerFrame), true);
			const edge = baseline.runtime.machine.scheduler.nowCycles;
			assert.equal(target.advanceGame(edge - 1), false);
			const gpu = target.runtime.machine.gxGpu;
			gpu.writeGp0(GX_GPU_GP0_VRAM_TO_CPU_FIRST << 24);
			gpu.writeGp0(0);
			gpu.writeGp0(0x00010001);
			assert.equal(gpu.captureState().pendingCommandCycles, 1);
			const carry = extraPeriods * target.runtime.timing.cycleBudgetPerFrame;
			assert.equal(target.advanceGame(1 + carry), true);
			assert.equal(target.runtime.frameScheduler.lastTickSequence, 1);
			assert.equal(target.runtime.machine.scheduler.nowCycles, edge, 'backend completion cannot execute another tick');
			assert.equal(gpu.backendServiceBlocksMachine(), false);
			assert.equal(target.runtime.frameScheduler.captureState().carriedCycleBudget, carry);
			if (extraPeriods === 0) {
				assert.equal(target.advanceGame(1000), false);
				assert.equal(target.runtime.machine.scheduler.nowCycles, edge + 1000, 'the next independent grant is retained');
			}
		});
	}
}
