import * as ClosureRecord from '../../machine/ts/machine/cpu/closure';
import assert from 'node:assert/strict';
import test from 'node:test';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { FRAME_CONTROL_BYTES, FrameField } from '../../machine/ts/machine/cpu/call_state';
import { isOpen, load as readCapture } from '../../machine/ts/machine/cpu/upvalue';
import { asClosure, asThread, type Value, valueBool, valueClosure, valueInteger, valueNil } from '../../machine/ts/machine/cpu/value';
import { ThreadStatus } from '../../machine/ts/machine/cpu/thread_record';
import { readLE32, writeLE32 } from '../../machine/ts/common/endian';
import { IO_IRQ_MASK, IRQ_VBLANK } from '../../machine/ts/spec/bmsx/io';
import { EXECUTION_IMAGE_BINDING_SPAN_OFFSET, executionImageBindingOffset, SYSTEM_EXECUTION_DOMAIN_ID, SYSTEM_EXECUTION_DOMAIN_MASK } from '../../machine/ts/spec/blua32/execution_domain';
import { blua32FunctionIndexAtAddress, decodeBlua32Image } from '../../toolchain/ts/rompack/blua32_image';
import { applyHotResumeRelocation, buildHotResumeRelocation } from '../../ide/runtime/hot_resume_relocation';
import { visitRuntimeExecutionRecords } from '../../ide/runtime/execution_records';
import { verifyHotResumeBinding } from '../../ide/runtime/hot_resume_binding';
import { integerConstant } from '../../toolchain/ts/lua/number';
import { compileFrameEvaluationTest } from '../helpers/frame_evaluation';
import { compileCoroutineTest } from '../helpers/coroutine';
import { runGuestToHalt } from '../helpers/cpu_execution';
import { createTestRuntime } from '../helpers/runtime_sources';
import { identityHotResumeRevision } from '../helpers/hot_resume';
import { createTestSystemCpu, linkRawTestSystemBlua32, writeTestBlua32Rom } from '../helpers/blua32';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { BLUA32_CONSTANT_PAYLOAD_OFFSET, BLUA32_CONSTANT_RECORD_SIZE, BLUA32_FUNCTION_MAX_STACK_OFFSET } from '../../machine/ts/spec/blua32/image_format';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { admitTestHeapServiceCpu } from '../helpers/heap_service_system';
import { COROUTINE_FIRMWARE_MODULES } from '../helpers/firmware_modules';
import { linkManagedTestSystem } from '../helpers/managed_system';
import { buildBlua32ExecutionRevision } from '../../toolchain/ts/rompack/blua32_revision';

test('Hot Resume admits numeric edits but rejects equal-sized retargeting of installed operand slots', () => {
	const text = new Uint8Array(4);
	writeInstruction(text, 0, OpCode.HALT, 0, 0, 0);
	const system = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 1 }],
		constants: [integerConstant(3), 'left', 'right'], globalNames: ['first', 'second'] });
	const { cpu, memory } = createTestSystemCpu(system);
	const image = system.image, { address, header } = image;
	const binding = executionImageBindingOffset(cpu.heapAllocator.managementOffset(), SYSTEM_EXECUTION_DOMAIN_ID);
	const span = 4 * (header.globalNameCount + header.systemGlobalNameCount + 2);
	memory.writeRamRecordWord(binding + EXECUTION_IMAGE_BINDING_SPAN_OFFSET, span);
	const before = cpu.captureRuntimeState();
	const verify = (bytes: Uint8Array) => verifyHotResumeBinding(cpu, SYSTEM_EXECUTION_DOMAIN_ID, image, decodeBlua32Image(bytes, address));
	const immediate = header.constantTableAddress - address + BLUA32_CONSTANT_PAYLOAD_OFFSET;
	const changedNumber = image.bytes.slice();
	writeLE32(changedNumber, immediate, 95);
	verify(changedNumber);

	const literal = immediate + BLUA32_CONSTANT_RECORD_SIZE;
	const changedLiteral = image.bytes.slice();
	writeLE32(changedLiteral, literal, readLE32(changedLiteral, literal + BLUA32_CONSTANT_RECORD_SIZE));
	assert.throws(() => verify(changedLiteral), /installed String literal bindings/);
	const name = header.globalNameTableAddress - address;
	const changedName = image.bytes.slice();
	writeLE32(changedName, name, readLE32(changedName, name + 4));
	assert.throws(() => verify(changedName), /installed global-name slots/);
	assert.equal(memory.readRamRecordWord(binding + EXECUTION_IMAGE_BINDING_SPAN_OFFSET), span);
	assert.deepEqual(cpu.captureRuntimeState(), before);
});

test('Hot Resume plans backing for a widened retained frame without mutating it', () => {
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
	const relocation = buildHotResumeRelocation(cpu, [revision, null, null], cpu.getFrameDepth());
	assert.ok(relocation.valueEnd > cpu.activeThread.stackRegisters.capacity());
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
	cpu.replaceExecutionImages([executionAddressSpace.resolveSystemDomain()]);
	applyHotResumeRelocation(cpu, relocation);
	assert.equal(cpu.activeThread.currentFrame!.closure, closure);
	assert.equal(cpu.captureClosureBinding(closure).recordUpvalueCount, 1);
	assert.equal(ClosureRecord.captureCount(cpu.memory, closure), 0);
});

test('Hot Resume preserves a suspended coroutine and its open capture at a proven physical continuation', () => {
	const source = `module<entry>
local coroutines<const> = require('coroutine')
function edited(value) return value + 1951 end
read_back = false
worker = coroutines.create(function(captured)
	read_back = function() return captured end
	coroutines.yield(captured)
	captured = edited(captured)
	return read_back()
end)
local ok, first = coroutines.resume(worker, 42)
halt_until_irq
local finished, last = coroutines.resume(worker)
return ok, first, finished, last, read_back()
`;
	const initial = linkManagedTestSystem(source, 3, COROUTINE_FIRMWARE_MODULES);
	const fresh = linkManagedTestSystem(source.replace('1951', '1953'), 3, COROUTINE_FIRMWARE_MODULES);
	const runtime = createTestRuntime(writeTestBlua32Rom(initial));
	runtime.boot();
	const { cpu, memory, executionAddressSpace } = runtime.machine;
	runGuestToHalt(cpu, 1_000_000);
	assert.equal(cpu.isHaltedUntilIrq(), true);
	assert.equal(cpu.activeThread, cpu.rootThread);
	const worker = asThread(cpu.getGlobalByKey(cpu.stringPool.find('worker')!), cpu.gc);
	assert.notEqual(worker, 0);
	assert.equal(cpu.readThreadStatus(worker), ThreadStatus.Suspended);
	const bodyFrame = Array.from({ length: cpu.readThreadFrameDepth(worker) }, (_, index) => index)
		.find(index => cpu.readThreadFrameWord(worker, index, FrameField.OpenHead) !== 0)!;
	const readBack = asClosure(cpu.getGlobalByKey(cpu.stringPool.find('read_back')!), cpu.gc);
	const cell = ClosureRecord.captureAddress(memory, readBack, 0);
	assert.equal(cpu.readThreadFrameWord(worker, bodyFrame, FrameField.OpenHead), cell);
	assert.equal(isOpen(memory, cell), true);
	assert.equal(readCapture(memory, cell), valueInteger(42));

	const sources = (image: typeof initial) => new Map(Array.from(image.diagnosticSources, ([path, diagnostic]) => [path, diagnostic.source]));
	const previousImage = initial.layout, nextImage = fresh.layout;
	const revision = buildBlua32ExecutionRevision(previousImage, initial.symbols, sources(initial), fresh, sources(fresh));
	const plan = { previousImage, nextImage, revision };
	const bodyPc = cpu.readThreadFrameWord(worker, bodyFrame, FrameField.Pc);
	const bodyWord = (bodyPc - previousImage.header.textAddress) / INSTRUCTION_BYTES;
	assert.equal(revision.pcAddresses[bodyWord], bodyPc);
	const moved = { ...plan, revision: { ...revision, pcAddresses: revision.pcAddresses.slice() } };
	moved.revision.pcAddresses[bodyWord] += INSTRUCTION_BYTES;
	const framesOffset = cpu.readThreadFrameAddress(worker, 0);
	const frameBytes = cpu.readThreadFrameDepth(worker) * FRAME_CONTROL_BYTES;
	const controlBefore = memory.ramData().slice(framesOffset, framesOffset + frameBytes);
	const before = cpu.captureRuntimeState();
	assert.throws(() => buildHotResumeRelocation(cpu, [moved, null, null], cpu.getFrameDepth()), /inactive thread .* continuation/);
	assert.deepEqual(cpu.captureRuntimeState(), before);
	assert.deepEqual(memory.ramData().subarray(framesOffset, framesOffset + frameBytes), controlBefore);

	verifyHotResumeBinding(cpu, SYSTEM_EXECUTION_DOMAIN_ID, previousImage, nextImage);
	const accepted = buildHotResumeRelocation(cpu, [plan, null, null], cpu.getFrameDepth());
	memory.installSystemRom(writeTestBlua32Rom(fresh));
	cpu.replaceExecutionImages([executionAddressSpace.resolveSystemDomain()]);
	applyHotResumeRelocation(cpu, accepted);
	assert.deepEqual(memory.ramData().subarray(framesOffset, framesOffset + frameBytes), controlBefore);
	assert.equal(isOpen(memory, cell), true);
	assert.equal(readCapture(memory, cell), valueInteger(42));

	cpu.clearHaltUntilIrq();
	runGuestToHalt(cpu, 1_000_000);
	const result: Value[] = [];
	cpu.readCompletionValues(result);
	assert.deepEqual(result, [valueBool(true), valueInteger(42), valueBool(true), valueInteger(1995), valueInteger(1995)]);
	assert.equal(cpu.readThreadStatus(worker), ThreadStatus.Dead);
	assert.equal(isOpen(memory, cell), false);
	assert.equal(readCapture(memory, cell), valueInteger(1995));
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
	visitRuntimeExecutionRecords(cpu, closure => seen.add(closure));
	assert.ok(seen.has(handler));
	cpu.clearHaltUntilIrq();
	runGuestToHalt(cpu, 1_000_000);
	const result: Value[] = [];
	cpu.readCompletionValues(result);
	assert.deepEqual(result, [valueBool(true), valueBool(false), valueInteger(17)]);
});
