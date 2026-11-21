import * as ClosureRecord from '../../machine/ts/machine/cpu/closure';
import assert from 'node:assert/strict';
import test from 'node:test';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { asThread } from '../../machine/ts/machine/cpu/value';
import { ThreadStatus } from '../../machine/ts/machine/cpu/thread_record';
import { IO_IRQ_MASK, IRQ_VBLANK } from '../../machine/ts/spec/bmsx/io';
import { SYSTEM_EXECUTION_DOMAIN_MASK } from '../../machine/ts/spec/blua32/execution_domain';
import { blua32FunctionIndexAtAddress } from '../../toolchain/ts/rompack/blua32_image';
import { applyHotResumeClosureRevision, applyHotResumeRelocation, buildHotResumeRelocation } from '../../ide/runtime/hot_resume_relocation';
import { compileFrameEvaluationTest } from '../helpers/frame_evaluation';
import { createTestRuntime } from '../helpers/runtime_sources';
import { identityHotResumeRevision } from '../helpers/hot_resume';
import { createTestSystemCpu, linkRawTestSystemBlua32 } from '../helpers/blua32';
import { writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';

for (const optLevel of [3] as const) for (const stop of ['ram', 'nmi', 'irq-nmi'] as const) test(`O${optLevel}: ROM relocation preserves RAM calls and ${stop} return words`, () => {
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

test('Hot Resume preserves a direct-entry record count independently of captured cells', () => {
	const text = new Uint8Array(4);
	writeInstruction(text, 0, OpCode.HALT, 0, 0, 0);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 1,
		staticClosure: true, upvalueDescs: [{ inStack: true, index: 0 }] }] });
	const { cpu } = createTestSystemCpu(image);
	const closure = cpu.activeThread.currentFrame!.closure;
	assert.equal(cpu.captureClosureBinding(closure).recordUpvalueCount, 1);
	assert.equal(ClosureRecord.captureCount(cpu.memory, closure), 0);
	const revisions = [identityHotResumeRevision(image.image), null, null] as const;
	assert.doesNotThrow(() => buildHotResumeRelocation(cpu, revisions, cpu.getFrameDepth()));
	applyHotResumeClosureRevision(cpu, revisions);
	assert.equal(cpu.activeThread.currentFrame!.closure, closure);
	assert.equal(cpu.captureClosureBinding(closure).recordUpvalueCount, 1);
	assert.equal(ClosureRecord.captureCount(cpu.memory, closure), 0);
});

test('Hot Resume rejects a replaced ROM body retained by an inactive coroutine before mounting', () => {
	const image = compileFrameEvaluationTest(`
worker = coroutine.create(function() coroutine.yield(42) end)
local ok, result = coroutine.resume(worker)
assert(ok and result == 42)
halt_until_irq
`, 3);
	const { cpu } = createTestSystemCpu(image);
	cpu.installBootPrimitives();
	let result = RunResult.Yielded;
	for (let step = 0; step < 10 && result === RunResult.Yielded; ++step) result = cpu.runUntilDepth(0, 1_000_000);
	assert.equal(result, RunResult.Halted);
	assert.equal(cpu.activeThread, cpu.rootThread);
	const worker = asThread(cpu.getGlobalByKey(cpu.stringPool.intern('worker')), cpu.gc);
	assert.notEqual(worker, 0);
	assert.equal(cpu.readThreadStatus(worker), ThreadStatus.Suspended);
	assert.ok(cpu.readThreadFrameDepth(worker) > 0);
	const before = cpu.captureRuntimeState();
	assert.throws(() => buildHotResumeRelocation(cpu, [identityHotResumeRevision(image.image), null, null], cpu.getFrameDepth()), /inactive thread .* frame 0/);
	assert.deepEqual(cpu.captureRuntimeState(), before);
});
