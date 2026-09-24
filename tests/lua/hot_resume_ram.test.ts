import assert from 'node:assert/strict';
import test from 'node:test';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { IO_IRQ_MASK, IRQ_VBLANK } from '../../machine/ts/spec/bmsx/io';
import { SYSTEM_EXECUTION_DOMAIN_MASK } from '../../machine/ts/spec/blua32/execution_domain';
import { blua32FunctionIndexAtAddress } from '../../toolchain/ts/rompack/blua32_image';
import { applyHotResumeRelocation, buildHotResumeRelocation } from '../../ide/runtime/hot_resume_relocation';
import { compileFrameEvaluationTest } from '../helpers/frame_evaluation';
import { createTestRuntime } from '../helpers/runtime_sources';
import { identityHotResumeRevision } from '../helpers/hot_resume';

for (const optLevel of [0, 3] as const) for (const stop of ['ram', 'nmi', 'irq-nmi'] as const) test(`O${optLevel}: ROM relocation preserves RAM calls and ${stop} return words`, () => {
	const image = compileFrameEvaluationTest(`
function irq() end
function exception() end
ram_leaf = false
ram_outer = false
ram_leaf = assert(load('local result = 3; return result', '=ram-leaf'))
ram_outer = assert(load('local result = ram_leaf(); return result + 3', '=ram-outer'))
return ram_outer() == 6`, optLevel);
	const runtime = createTestRuntime(image.romBytes), cpu = runtime.machine.cpu;
	cpu.reset(); cpu.installBootPrimitives();
	cpu.setExecutionHook(() => {
		const depth = cpu.getFrameDepth();
		return depth >= 2 && blua32FunctionIndexAtAddress(image.image, cpu.readFrameFunctionAddress(depth - 1)) === -1
			&& blua32FunctionIndexAtAddress(image.image, cpu.readFrameFunctionAddress(depth - 2)) === -1;
	}, SYSTEM_EXECUTION_DOMAIN_MASK, SYSTEM_EXECUTION_DOMAIN_MASK);
	assert.equal(cpu.runUntilDepth(0, 30_000_000), RunResult.ExecutionStopped);
	cpu.setExecutionHook(null, 0, 0);
	const ramDepth = cpu.getFrameDepth();
	assert.equal(blua32FunctionIndexAtAddress(image.image, cpu.readFrameFunctionAddress(ramDepth - 1)), -1);
	assert.equal(blua32FunctionIndexAtAddress(image.image, cpu.readFrameFunctionAddress(ramDepth - 2)), -1);
	if (stop === 'irq-nmi') {
		runtime.machine.memory.writeMappedWord(IO_IRQ_MASK, IRQ_VBLANK);
		runtime.machine.irqController.raise(IRQ_VBLANK);
		assert.equal(cpu.enterPendingInterrupt(), true);
	}
	if (stop !== 'ram') {
		cpu.requestNonMaskableInterrupt();
		assert.equal(cpu.enterPendingInterrupt(), true);
	}
	const before = cpu.captureRuntimeState();
	const revision = identityHotResumeRevision(image.image);
	applyHotResumeRelocation(cpu, buildHotResumeRelocation(cpu, [revision, null, null], cpu.getFrameDepth()));
	assert.deepEqual(cpu.captureRuntimeState(), before, 'RAM PCs/callsites and interrupted return latches are not ROM offsets');
});
