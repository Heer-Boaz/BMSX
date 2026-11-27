import * as ClosureRecord from '../../machine/ts/machine/cpu/closure';
import assert from 'node:assert/strict';
import test from 'node:test';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { asClosure, asThread, type Value, valueBool, valueClosure, valueInteger, valueNil } from '../../machine/ts/machine/cpu/value';
import { ThreadStatus } from '../../machine/ts/machine/cpu/thread_record';
import { writeLE32 } from '../../machine/ts/common/endian';
import { IO_IRQ_MASK, IRQ_VBLANK } from '../../machine/ts/spec/bmsx/io';
import { SYSTEM_EXECUTION_DOMAIN_ID, SYSTEM_EXECUTION_DOMAIN_MASK } from '../../machine/ts/spec/blua32/execution_domain';
import { blua32FunctionIndexAtAddress, decodeBlua32Image } from '../../toolchain/ts/rompack/blua32_image';
import { applyHotResumeRelocation, buildHotResumeRelocation } from '../../ide/runtime/hot_resume_relocation';
import { compileFrameEvaluationTest } from '../helpers/frame_evaluation';
import { compileCoroutineTest } from '../helpers/coroutine';
import { runGuestToHalt } from '../helpers/cpu_execution';
import { createTestRuntime } from '../helpers/runtime_sources';
import { identityHotResumeRevision } from '../helpers/hot_resume';
import { createTestSystemCpu, linkRawTestSystemBlua32 } from '../helpers/blua32';
import { writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { BLUA32_FUNCTION_MAX_STACK_OFFSET } from '../../machine/ts/spec/blua32/image_format';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { admitTestHeapServiceCpu } from '../helpers/heap_service_system';

test('Hot Resume rejects a widened retained frame before replacing its ROM', () => {
	const text = new Uint8Array(4);
	writeInstruction(text, 0, OpCode.HALT, 0, 0, 0);
	const system = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 1 }] });
	const runtime = createTestRuntime(system.romBytes);
	runtime.boot();
	const { cpu, executionAddressSpace } = runtime.machine;
	admitTestHeapServiceCpu(cpu, executionAddressSpace);
	const frameIndex = cpu.getFrameDepth() - 1;
	const fn = cpu.readFrameFunctionAddress(frameIndex);
	const image = system.image;
	const nextBytes = image.bytes.slice();
	writeLE32(nextBytes, fn - image.address + BLUA32_FUNCTION_MAX_STACK_OFFSET, cpu.activeThread.stackRegisters.capacity() + 1);
	const revision = { ...identityHotResumeRevision(image), nextImage: decodeBlua32Image(nextBytes, image.address) };
	const before = cpu.captureRuntimeState();
	assert.throws(() => buildHotResumeRelocation(cpu, [revision, null, null], cpu.getFrameDepth()), /register backing/);
	assert.deepEqual(cpu.captureRuntimeState(), before);
});

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
	cpu.reset();
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
	const { cpu, executionAddressSpace } = createTestSystemCpu(image);
	cpu.beginCompletionCallInExecutionDomain(SYSTEM_EXECUTION_DOMAIN_ID, image.vectors.startupFunctionAddress);
	assert.equal(cpu.getFrameDepth(), 2);
	const closure = cpu.activeThread.currentFrame!.closure;
	assert.equal(cpu.captureClosureBinding(closure).recordUpvalueCount, 1);
	assert.equal(ClosureRecord.captureCount(cpu.memory, closure), 0);
	const revisions = [identityHotResumeRevision(image.image), null, null] as const;
	const relocation = buildHotResumeRelocation(cpu, revisions, cpu.getFrameDepth());
	cpu.replaceExecutionImages([executionAddressSpace.resolveSystemDomain()], relocation);
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

test('Hot Resume retains a closure held only by the xpcall argument window', () => {
	const image = compileCoroutineTest(`
local function run(captured)
 return xpcall(function() halt_until_irq; error('failure') end, function() return captured end)
end
return pcall(run, 17)
`, 0);
	const { cpu } = createTestSystemCpu(image);
	runGuestToHalt(cpu, 1_000_000);
	assert.ok(cpu.isHaltedUntilIrq());
	const thread = cpu.activeThread;
	const body = thread.currentFrame!.previous!, wrapper = body.previous!;
	const bodyIndex = image.symbols.metadata.functionIds.indexOf('module:kernel/protected_body/module');
	assert.notEqual(bodyIndex, -1);
	assert.equal(body.functionAddress, image.symbols.functionAddresses[bodyIndex]);
	assert.equal(wrapper.varargCount, 1);
	const argument = wrapper.varargBase;
	const handler = asClosure(thread.stackRegisters.get(argument), cpu.gc);
	assert.notEqual(handler, 0);
	assert.equal(ClosureRecord.captureCount(cpu.memory, handler), 1);
	for (let slot = 0; slot < thread.stackTop; ++slot)
		if (slot !== argument && thread.stackRegisters.get(slot) === valueClosure(handler)) thread.stackRegisters.set(slot, valueNil());
	const seen = new Set<number>();
	cpu.visitReachableExecutionRecords(closure => seen.add(closure));
	assert.ok(seen.has(handler));
	cpu.clearHaltUntilIrq();
	runGuestToHalt(cpu, 1_000_000);
	const result: Value[] = [];
	cpu.readCompletionValues(result);
	assert.deepEqual(result, [valueBool(true), valueBool(false), valueInteger(17)]);
});
