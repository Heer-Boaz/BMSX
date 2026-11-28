import { readStockGlobalValue } from '../../toolchain/ts/firmware/stock_global_bank';
import { asClosure, asThread } from '../helpers/native_heap/gc_heap';
import { nativeHeapReference } from '../helpers/native_heap/reference';
import * as ClosureRecord from '../../machine/ts/machine/cpu/closure';
import assert from 'node:assert/strict';
import test from 'node:test';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { FRAME_CONTROL_BYTES, FrameField } from '../../machine/ts/machine/cpu/call_state';
import { isOpen, load as readCapture } from '../../machine/ts/machine/cpu/upvalue';
import { type Value, valueBool, valueClosure, valueInteger, valueNil } from '../../machine/ts/machine/cpu/value';
import { ThreadStatus } from '../../machine/ts/machine/cpu/thread_record';
import { readLE32, writeLE32 } from '../../machine/ts/common/endian';
import { IO_IRQ_FLAGS, IO_IRQ_MASK, IRQ_VBLANK } from '../../machine/ts/spec/bmsx/io';
import { CART_ROM_BASE, CPU_INTERRUPTED_CONTEXT_ADDRESS, RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { CPU_CAUSE_IRQ, CPU_CAUSE_NMI } from '../../machine/ts/spec/blua32/cop0';
import { EXECUTION_IMAGE_BINDING_SIZE, executionImageBindingOffset, SYSTEM_EXECUTION_DOMAIN_ID, SYSTEM_EXECUTION_DOMAIN_MASK } from '../../machine/ts/spec/blua32/execution_domain';
import { decodeBlua32Image } from '../../toolchain/ts/rompack/blua32_image';
import { decodeBlua32InstructionAtPc } from '../../toolchain/ts/rompack/blua32_instruction_decode';
import { applyHotResumeRelocation, buildHotResumeRelocation } from '../../ide/runtime/hot_resume_relocation';
import { readRuntimeStackFrames } from '../../ide/runtime/stack_trace';
import { createLuaSourceRegistry } from '../../ide/runtime/source_registry';
import { visitRuntimeExecutionRecords } from '../../ide/runtime/execution_records';
import { verifyHotResumeBinding } from '../../ide/runtime/hot_resume_binding';
import { integerConstant } from '../../toolchain/ts/lua/number';
import { compileFrameEvaluationTest } from '../helpers/frame_evaluation';
import { compileCoroutineTest } from '../helpers/coroutine';
import { runCpuWithinBudget, runGuestToHalt } from '../helpers/cpu_execution';
import { createTestRuntime, createTestSystemImageRuntimeSourceState } from '../helpers/runtime_sources';
import { identityHotResumeRevision } from '../helpers/hot_resume';
import { createTestSystemCpu, linkRawTestSystemBlua32, writeTestBlua32Rom } from '../helpers/blua32';
import { INSTRUCTION_BYTES, RegisterJumpMode, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { BLUA32_CONSTANT_PAYLOAD_OFFSET, BLUA32_CONSTANT_RECORD_SIZE, BLUA32_FUNCTION_MAX_STACK_OFFSET } from '../../machine/ts/spec/blua32/image_format';
import { BASE_CYCLES, OpCode } from '../../machine/ts/spec/blua32/opcode';
import { admitTestHeapServiceCpu, createTestHeapServiceCpu } from '../helpers/heap_service_system';
import { COROUTINE_FIRMWARE_MODULES } from '../helpers/firmware_modules';
import { linkManagedTestSystem } from '../helpers/managed_system';
import { buildBlua32ExecutionRevision } from '../../toolchain/ts/rompack/blua32_revision';

for (const returnLinkMoved of [false, true]) test(
	`Hot Resume relocates nested software return PCs ${returnLinkMoved ? 'after the leaf moves its link' : 'on leaf entry'} without rewriting equal Integer data`, () => {
	const path = 'fixture/frame-free';
	const mixing = Array.from({ length: 44 }, (_, i) => `x = (x + ${i + 1}) & 255`).join('\n');
	const main = `bss alias_seed: word
local calls<const> = require('${path}')
local marker<const> = *alias_seed
local result<const> = calls.outer(29)
return result, marker`;
	// Move a same-sized arithmetic statement across each pending call. The
	// continuation PCs move, but the ordinary operand bindings stay installed.
	const module = (edited: boolean) => `module<const>
local leaf<const> = function(x)
	${mixing}
	return x + ${edited && !returnLinkMoved ? 1103 : 1101}
end
local middle<const> = function(x)
	${mixing}
	${edited ? 'x = (x + 35) & 255' : ''}
	local value<const> = leaf(x)
	${edited ? '' : 'x = (x + 35) & 255'}
	return value + 13 + x
end
local outer<const> = function(x)
	${mixing}
	${edited ? 'x = (x + 41) & 255' : ''}
	local value<const> = middle(x)
	${edited ? '' : 'x = (x + 41) & 255'}
	return value + 23 + x
end
return { leaf = leaf, middle = middle, outer = outer }`;
	const initial = linkManagedTestSystem(main, 3, [{ path, source: module(false) }]);
	const fresh = linkManagedTestSystem(main, 3, [{ path, source: module(true) }]);
	const metadata = initial.symbols.metadata, next = fresh.symbols.metadata;
	const entry = metadata.functionIds.indexOf('module:main/entry');
	const chain = [entry, ...['outer', 'middle', 'leaf'].map(name => metadata.functionIds.findIndex(id => id.endsWith(`__${name}`)))];
	const runtime = createTestRuntime(writeTestBlua32Rom(initial));
	runtime.boot();
	const { cpu, memory, executionAddressSpace } = runtime.machine;
	const stopAt = (pc: number) => {
		cpu.setExecutionHook((_domain, current) => current === pc, SYSTEM_EXECUTION_DOMAIN_MASK, SYSTEM_EXECUTION_DOMAIN_MASK);
		assert.equal(runCpuWithinBudget(cpu, 1_000_000), RunResult.ExecutionStopped);
		cpu.setExecutionHook(null, 0, 0);
	};
	stopAt(initial.layout.functions[entry].codeAddress);
	const thread = cpu.activeThread, frame = thread.currentFrame!, depth = cpu.getFrameDepth();
	let basis = 0;
	const links = chain.slice(0, -1).map((index, i) => {
		const [before] = metadata.softwareFramesByFunction[index]!.calls;
		const [after] = next.softwareFramesByFunction[index]!.calls;
		assert.deepEqual(before.targetFunctions, [chain[i + 1]]);
		assert.deepEqual(after.targetFunctions, before.targetFunctions);
		assert.equal(after.baseDelta, before.baseDelta);
		basis += before.baseDelta;
		const { textBytes, header, functions } = initial.layout;
		const entryPc = functions[index].codeAddress;
		const jump = decodeBlua32InstructionAtPc(textBytes, header.textAddress, entryPc + before.wordOffset * INSTRUCTION_BYTES);
		assert.equal(jump.op, OpCode.JAL);
		return { slot: frame.stackBase + basis + jump.a,
			before: entryPc + before.continuationWordOffset * INSTRUCTION_BYTES,
			after: fresh.layout.functions[index].codeAddress + after.continuationWordOffset * INSTRUCTION_BYTES };
	});
	assert.ok(links[1].before !== links[1].after && links[2].before !== links[2].after, 'both nested continuations must actually move');
	const marker = valueInteger(links[1].before);
	const seed = metadata.staticScopes.declarations.find(slot => slot.name === 'alias_seed')!;
	memory.writeMappedU32LE(seed.address!, links[1].before);
	const markerSlot = frame.stackBase + metadata.localSlotsByFunction[entry].find(slot => slot.name === 'marker')!.registerIndex;
	const leaf = chain[chain.length - 1];
	const leafLink = links[links.length - 1], initialLeafLink = leafLink.slot;
	let leafWord = 0;
	if (returnLinkMoved) {
		const move = metadata.softwareFramesByFunction[leaf]!.linkSlots.find(point => point.wordOffset > 0)!;
		leafWord = move.wordOffset;
		leafLink.slot = frame.stackBase + basis + move.slot;
	}
	stopAt(initial.layout.functions[leaf].codeAddress + leafWord * INSTRUCTION_BYTES);
	assert.equal(cpu.getFrameDepth(), depth);
	assert.equal(thread.currentFrame, frame);
	assert.equal(frame.functionAddress, initial.layout.functions[entry].address);
	assert.equal(frame.registerBase, basis);
	assert.equal(thread.stackRegisters.get(markerSlot), marker);
	for (const link of links) assert.equal(thread.stackRegisters.get(link.slot), valueInteger(link.before));
	if (returnLinkMoved) assert.equal(thread.stackRegisters.get(initialLeafLink), valueInteger(leafLink.before), 'the live link is now in the scratch');

	const sources = (image: typeof initial) => new Map(Array.from(image.diagnosticSources, ([path, diagnostic]) => [path, diagnostic.source]));
	const previousImage = initial.layout, nextImage = fresh.layout;
	const revision = buildBlua32ExecutionRevision(previousImage, initial.symbols, sources(initial), fresh, sources(fresh));
	assert.equal(verifyHotResumeBinding(cpu, SYSTEM_EXECUTION_DOMAIN_ID, previousImage, nextImage), false);
	const relocation = buildHotResumeRelocation(cpu, [{ previousImage, nextImage, revision }, null, null], depth);
	for (const link of links) assert.equal(thread.stackRegisters.get(link.slot), valueInteger(link.before), 'planning does not relocate in place');
	memory.installSystemRom(writeTestBlua32Rom(fresh));
	cpu.replaceExecutionImages([executionAddressSpace.resolveSystemDomain()]);
	applyHotResumeRelocation(cpu, relocation);
	assert.equal(cpu.getFrameDepth(), depth);
	assert.equal(frame.pc, nextImage.functions[leaf].codeAddress + leafWord * INSTRUCTION_BYTES);
	assert.equal(frame.registerBase, basis);
	assert.equal(thread.stackRegisters.get(markerSlot), marker);
	for (const link of links) assert.equal(thread.stackRegisters.get(link.slot), valueInteger(link.after));
	if (returnLinkMoved) assert.equal(thread.stackRegisters.get(initialLeafLink), valueInteger(leafLink.before), 'the obsolete copy must not be relocated');
	runGuestToHalt(cpu, 1_000_000);
	const values: Value[] = [];
	cpu.readCompletionValues(values);
	assert.deepEqual(values, [valueInteger(returnLinkMoved ? 1788 : 1790), marker]); // Retained inputs, revised continuations.
});

for (const mode of [RegisterJumpMode.EnterWindow, RegisterJumpMode.EnterBankWindow]) test(
	`Hot Resume relocates linked borrowed code and its WIDE caller without creating a Function activation (mode ${mode})`, () => {
	const raw = (first: number, wide: boolean, value: number) => {
		const issue = first + Number(wide), resume = issue + 1, leaf = resume + 1;
		const text = new Uint8Array((leaf + 2) * INSTRUCTION_BYTES);
		if (wide) writeInstruction(text, first, OpCode.WIDE, 0, 0, 0);
		writeInstruction(text, issue, OpCode.JREG, 0, 1, mode);
		writeInstruction(text, resume, OpCode.RET, 4, 2, 0);
		writeInstruction(text, leaf, OpCode.KSMI, 0, 0, value);
		writeInstruction(text, leaf + 1, OpCode.JREG, 0, 1, RegisterJumpMode.LeaveWindow);
		return linkRawTestSystemBlua32({ text, verifiedControlFlow: true,
			functions: [{ firstWord: first, wordCount: resume - first + 1, maxStack: 8 },
				{ firstWord: leaf, wordCount: 2, maxStack: 4 }] });
	};
	const initial = raw(0, true, 7), fresh = raw(4, false, 23);
	const { cpu, memory, executionAddressSpace } = createTestSystemCpu(initial);
	const parent = cpu.rootThread.frameAtDepth(0);
	const [oldParent, oldLeaf] = initial.image.functions, [nextParent, nextLeaf] = fresh.image.functions;
	parent.registers.setInteger(0, oldLeaf.codeAddress);
	parent.registers.setInteger(1, 4);
	parent.registers.setInteger(2, 4);
	parent.registers.setInteger(3, 1);
	if (mode === RegisterJumpMode.EnterBankWindow) parent.registers.setInteger(4, SYSTEM_EXECUTION_DOMAIN_ID);
	assert.equal(cpu.runUntilDepth(0, BASE_CYCLES[OpCode.JREG]), RunResult.Yielded);
	assert.equal(cpu.getFrameDepth(), 2);
	const child = cpu.rootThread.frameAtDepth(1);
	assert.equal(child.functionAddress, 0);
	assert.equal(child.callSitePc, oldParent.codeAddress);
	const sources = createTestSystemImageRuntimeSourceState(initial.romBytes, createLuaSourceRegistry('fixture', 'main.lua'));
	const dbg = readRuntimeStackFrames(cpu, sources);
	assert.equal(dbg[1].functionIndex, 1, 'debugger resolves the lexical extent despite the raw Function word');
	assert.equal(dbg[1].tracePc, oldLeaf.codeAddress);
	sources.catalog.dispose();
	const revision = identityHotResumeRevision(initial.image);
	revision.revision.functionAddresses.set([nextParent.address, nextLeaf.address]);
	const pc = revision.revision.pcAddresses;
	pc.fill(-1);
	const oldText = initial.image.header.textAddress;
	pc[(parent.pc - oldText) / INSTRUCTION_BYTES] = nextParent.codeAddress + INSTRUCTION_BYTES;
	pc[(child.pc - oldText) / INSTRUCTION_BYTES] = nextLeaf.codeAddress;
	const candidate = { ...revision, nextImage: fresh.image };
	const geometry = () => [cpu.rootThread.stackTop, parent.stackBase, parent.stackCapacity, parent.top,
		child.stackBase, child.stackCapacity, child.top, child.closureAddress];
	const before = geometry();
	const oversize = fresh.image.bytes.slice();
	writeLE32(oversize, nextLeaf.address - fresh.image.address + BLUA32_FUNCTION_MAX_STACK_OFFSET, 5);
	assert.throws(() => buildHotResumeRelocation(cpu, [
		{ ...candidate, nextImage: decodeBlua32Image(oversize, fresh.image.address) }, null, null,
	], 2), /borrowed register window/);
	const relocation = buildHotResumeRelocation(cpu, [candidate, null, null], 2);
	memory.installSystemRom(fresh.romBytes);
	cpu.replaceExecutionImages([executionAddressSpace.resolveSystemDomain()]);
	applyHotResumeRelocation(cpu, relocation);
	assert.deepEqual(geometry(), before);
	assert.equal(child.functionAddress, 0);
	assert.equal(child.pc, nextLeaf.codeAddress);
	assert.equal(child.callSitePc, nextParent.codeAddress);
	assert.equal(parent.pc, nextParent.codeAddress + INSTRUCTION_BYTES);
	runGuestToHalt(cpu, 40);
	const values: Value[] = [];
	cpu.readCompletionValues(values);
	assert.deepEqual(values, [valueInteger(23)]);
});

test('Hot Resume admits numeric edits but rejects equal-sized retargeting of installed operand slots', () => {
	const text = new Uint8Array(4);
	writeInstruction(text, 0, OpCode.HALT, 0, 0, 0);
	const system = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 1 }],
		constants: [integerConstant(3), 'left', 'right'], globalNames: ['first', 'second'] });
	const { cpu, memory } = createTestHeapServiceCpu(system);
	const image = system.image, { address, header } = image;
	const binding = executionImageBindingOffset(SYSTEM_EXECUTION_DOMAIN_ID);
	const installed = memory.ramData().slice(binding, binding + EXECUTION_IMAGE_BINDING_SIZE);
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
	assert.deepEqual(memory.ramData().subarray(binding, binding + EXECUTION_IMAGE_BINDING_SIZE), installed);
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

for (const stop of ['ram', 'nmi', 'irq-nmi'] as const) test(`O3: ROM relocation preserves RAM calls and ${stop} return words`, () => {
	const image = compileFrameEvaluationTest(`
ram_leaf = false
ram_outer = false
ram_leaf = assert(load('local result = 3; return result', '=ram-leaf'))
ram_outer = assert(load('local result = ram_leaf(); return result + 3', '=ram-outer'))
return ram_outer() == 6`, 3);
	const runtime = createTestRuntime(image.romBytes);
	const { cpu, memory, executionAddressSpace } = runtime.machine;
	runtime.boot();
	const inRam = (index: number) => {
		const address = cpu.readFrameFunctionAddress(index);
		return address >= RAM_BASE && address < CART_ROM_BASE;
	};
	cpu.setExecutionHook(() => {
		const depth = cpu.getFrameDepth();
		return depth >= 2 && inRam(depth - 1) && inRam(depth - 2);
	}, SYSTEM_EXECUTION_DOMAIN_MASK, SYSTEM_EXECUTION_DOMAIN_MASK);
	assert.equal(runCpuWithinBudget(cpu, 30_000_000), RunResult.ExecutionStopped);
	cpu.setExecutionHook(null, 0, 0);
	const context = cpu.activeThread.address, ramDepth = cpu.getFrameDepth();
	assert.equal(inRam(ramDepth - 1) && inRam(ramDepth - 2), true);
	const ramReturn = cpu.readFramePc(ramDepth - 1);
	const readRamContinuations = () => [ramDepth - 2, ramDepth - 1].map(index =>
		[FrameField.Function, FrameField.Pc, FrameField.CallSite].map(field => cpu.readThreadFrameWord(context, index, field)));
	const ramContinuations = readRamContinuations();
	assert.ok(ramReturn >= RAM_BASE && ramReturn < CART_ROM_BASE);
	assert.ok(ramContinuations[1][2] >= RAM_BASE && ramContinuations[1][2] < CART_ROM_BASE, 'the leaf call site is RAM too');
	const assertFixedReturn = (cause: number) => {
		assert.equal(cpu.fixedInterruptActive(), true);
		assert.equal(cpu.readCauseWord(), cause);
		assert.equal(cpu.readEpcWord(), ramReturn);
		assert.equal(memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS), context);
		assert.equal(runtime.admitExternalCpuMutation(), false, 'Hot Resume cannot install while the System vector is running');
		assert.throws(() => cpu.replaceExecutionImages([executionAddressSpace.resolveSystemDomain()]), /Fixed execution must retire/);
		assert.deepEqual(readRamContinuations(), ramContinuations);
	};
	const retireFixedVector = () => {
		for (let step = 0; step < 4096 && cpu.fixedInterruptActive(); ++step)
			assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
		assert.equal(cpu.fixedInterruptActive(), false);
		assert.equal(cpu.activeThread.address, context);
		assert.equal(cpu.getFrameDepth(), ramDepth);
		assert.equal(cpu.readFramePc(ramDepth - 1), ramReturn);
		assert.deepEqual(readRamContinuations(), ramContinuations);
	};
	if (stop === 'irq-nmi') {
		memory.writeMappedWord(IO_IRQ_MASK, IRQ_VBLANK);
		runtime.machine.irqController.raise(IRQ_VBLANK);
		assert.equal(cpu.enterPendingInterrupt(), true);
		assertFixedReturn(CPU_CAUSE_IRQ);
		cpu.requestNonMaskableInterrupt();
		assert.equal(cpu.enterPendingInterrupt(), false, 'a second vector cannot borrow the occupied fixed bank');
		assert.equal(cpu.captureRuntimeState().nonMaskableInterruptPending, true);
		retireFixedVector();
		assert.equal(memory.readMappedU32LE(IO_IRQ_FLAGS) & IRQ_VBLANK, 0, 'the real IRQ handler acknowledged VBlank');
		assert.equal(cpu.captureRuntimeState().nonMaskableInterruptPending, true, 'the IRQ did not consume the queued NMI');
	} else if (stop === 'nmi') {
		cpu.requestNonMaskableInterrupt();
	}
	if (stop !== 'ram') {
		const previousEpc = cpu.readEpcWord();
		assert.equal(cpu.enterPendingInterrupt(), true);
		assertFixedReturn(CPU_CAUSE_NMI);
		assert.equal(cpu.readNmiReturnEpcWord(), previousEpc);
		retireFixedVector();
		assert.equal(cpu.readEpcWord(), previousEpc, 'RFE restores the preceding exception latch');
	}
	assert.equal(runtime.admitExternalCpuMutation(), true);
	const before = cpu.captureRuntimeState();
	const revision = identityHotResumeRevision(image.image);
	const plan = buildHotResumeRelocation(cpu, [revision, null, null], ramDepth);
	memory.installSystemRom(image.romBytes);
	cpu.replaceExecutionImages([executionAddressSpace.resolveSystemDomain()]);
	applyHotResumeRelocation(cpu, plan);
	assert.deepEqual(cpu.captureRuntimeState(), before, 'RAM PCs/callsites and interrupted return latches are not ROM offsets');
	assert.deepEqual(readRamContinuations(), ramContinuations);
	runGuestToHalt(cpu, 1_000_000);
	const values: Value[] = [];
	cpu.readCompletionValues(values);
	assert.deepEqual(values, [valueBool(true), valueBool(true)]);
});

test('Hot Resume preserves a direct-entry Frame without a guest Closure', () => {
	const text = new Uint8Array(4);
	writeInstruction(text, 0, OpCode.HALT, 0, 0, 0);
	const image = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 1,
		staticClosure: true, numParams: 1, maxStack: 1 }] });
	const { cpu, executionAddressSpace } = createTestSystemCpu(image);
	const fn = image.vectors.startupFunctionAddress, argument = valueInteger(41);
	cpu.beginCompletionCallInExecutionDomain(SYSTEM_EXECUTION_DOMAIN_ID, fn, [argument]);
	assert.equal(cpu.getFrameDepth(), 2);
	const frame = cpu.activeThread.currentFrame!;
	assert.equal(frame.closure, 0);
	assert.equal(frame.functionAddress, fn);
	assert.equal(frame.registers.get(0), argument);
	const revisions = [identityHotResumeRevision(image.image), null, null] as const;
	const relocation = buildHotResumeRelocation(cpu, revisions, cpu.getFrameDepth());
	cpu.replaceExecutionImages([executionAddressSpace.resolveSystemDomain()]);
	applyHotResumeRelocation(cpu, relocation);
	const resumed = cpu.activeThread.currentFrame!;
	assert.equal(resumed.closure, 0);
	assert.equal(resumed.functionAddress, fn);
	assert.equal(resumed.registers.get(0), argument);
});

test('Hot Resume moves a suspended coroutine continuation and preserves its open capture', () => {
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
	const fresh = linkManagedTestSystem(source.replace('return value + 1951', 'return -value + 1953'), 3, COROUTINE_FIRMWARE_MODULES);
	const runtime = createTestRuntime(writeTestBlua32Rom(initial));
	runtime.boot();
	const { cpu, memory, executionAddressSpace } = runtime.machine;
	runGuestToHalt(cpu, 1_000_000);
	assert.equal(cpu.isHaltedUntilIrq(), true);
	assert.equal(cpu.activeThread, cpu.rootThread);
	const worker = asThread(readStockGlobalValue(cpu.memory, nativeHeapReference(cpu).stringPool.find('worker')!), nativeHeapReference(cpu).gc);
	assert.notEqual(worker, 0);
	assert.equal(cpu.readThreadStatus(worker), ThreadStatus.Suspended);
	const bodyFrame = Array.from({ length: cpu.readThreadFrameDepth(worker) }, (_, index) => index)
		.find(index => cpu.readThreadFrameWord(worker, index, FrameField.OpenHead) !== 0)!;
	const readBack = asClosure(readStockGlobalValue(cpu.memory, nativeHeapReference(cpu).stringPool.find('read_back')!), nativeHeapReference(cpu).gc);
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
	const movedPc = revision.pcAddresses[bodyWord];
	assert.ok(movedPc >= 0 && movedPc !== bodyPc, `coroutine PC 0x${bodyPc.toString(16)} -> ${movedPc}`);
	const unmapped = { ...plan, revision: { ...revision, pcAddresses: revision.pcAddresses.slice() } };
	unmapped.revision.pcAddresses[bodyWord] = -1;
	const framesOffset = cpu.readThreadFrameAddress(worker, 0);
	const frameBytes = cpu.readThreadFrameDepth(worker) * FRAME_CONTROL_BYTES;
	const controlBefore = memory.ramData().slice(framesOffset, framesOffset + frameBytes);
	const before = cpu.captureRuntimeState();
	assert.throws(() => buildHotResumeRelocation(cpu, [unmapped, null, null], cpu.getFrameDepth()), /inactive thread .* continuation/);
	assert.deepEqual(cpu.captureRuntimeState(), before);
	assert.deepEqual(memory.ramData().subarray(framesOffset, framesOffset + frameBytes), controlBefore);

	verifyHotResumeBinding(cpu, SYSTEM_EXECUTION_DOMAIN_ID, previousImage, nextImage);
	const accepted = buildHotResumeRelocation(cpu, [plan, null, null], cpu.getFrameDepth());
	assert.deepEqual(memory.ramData().subarray(framesOffset, framesOffset + frameBytes), controlBefore);
	memory.installSystemRom(writeTestBlua32Rom(fresh));
	cpu.replaceExecutionImages([executionAddressSpace.resolveSystemDomain()]);
	applyHotResumeRelocation(cpu, accepted);
	assert.equal(cpu.readThreadFrameWord(worker, bodyFrame, FrameField.Pc), movedPc);
	assert.equal(cpu.readThreadFrameWord(worker, bodyFrame + 1, FrameField.CallSite), movedPc - INSTRUCTION_BYTES);
	assert.equal(isOpen(memory, cell), true);
	assert.equal(readCapture(memory, cell), valueInteger(42));

	cpu.clearHaltUntilIrq();
	runGuestToHalt(cpu, 1_000_000);
	const result: Value[] = [];
	cpu.readCompletionValues(result);
	assert.deepEqual(result, [valueBool(true), valueInteger(42), valueBool(true), valueInteger(1911), valueInteger(1911)]);
	assert.equal(cpu.readThreadStatus(worker), ThreadStatus.Dead);
	assert.equal(isOpen(memory, cell), false);
	assert.equal(readCapture(memory, cell), valueInteger(1911));
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
	const handler = asClosure(thread.stackRegisters.get(argument), nativeHeapReference(cpu).gc);
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
