import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FrameField } from '../../machine/ts/machine/cpu/call_state';
import { CLOSURE_CAPTURE_WORDS, closureRecordBytes, type FunctionPrototype, initializeRecord } from '../../machine/ts/machine/cpu/closure';
import { CPU, CpuRunKind, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { GC_OBJECT_PREFIX } from '../../machine/ts/machine/cpu/gc_object';
import { HEAP_GC_CONTROL_OFFSET } from '../../machine/ts/machine/cpu/heap_allocator';
import { isOpen, UPVALUE_FLAGS, UPVALUE_HEAP_BYTES, UPVALUE_NEXT, UPVALUE_OWNER, UPVALUE_VALUE_WORD } from '../../machine/ts/machine/cpu/upvalue';
import { type Value, valueInteger, valuePayload } from '../../machine/ts/machine/cpu/value';
import { IrqController } from '../../machine/ts/machine/devices/irq/controller';
import { ExecutionAddressSpace } from '../../machine/ts/machine/execution_address_space';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { RamHistory } from '../../machine/ts/machine/runtime/history/ram_history';
import { BLUA32_FUNCTION_ALIGNMENT, BLUA32_UPVALUE_IN_STACK_MASK, BLUA32_UPVALUE_INDEX_MASK } from '../../machine/ts/spec/blua32/image_format';
import { INSTRUCTION_BYTES, instructionBx, instructionLowB, instructionOpcode } from '../../machine/ts/spec/blua32/instruction_format';
import { LUA_FAULT_REASON_INVALID_ARGUMENT, LUA_FAULT_REASON_OUT_OF_MEMORY } from '../../machine/ts/spec/blua32/cop0';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { HEAP_SERVICE_FRAME_COUNT, HEAP_SERVICE_VALUE_COUNT } from '../../machine/ts/spec/bmsx/heap_service';
import { RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { encodeCompiledProgramObject } from '../../toolchain/ts/lua/compiler';
import { deriveBlua32FixedStack } from '../../toolchain/ts/rompack/blua32_fixed_stack';
import { linkTestSystemBlua32 } from '../helpers/blua32';
import { captureCpuCheckpoint, restoreCpuCheckpoint, runGuestToHalt } from '../helpers/cpu_execution';
import { compileHeapServiceSystem } from '../helpers/heap_service_system';

const modulePath = 'kernel/closure_capture_create';
const driverPath = 'kernel/allocate_captured_closure';
const program = `
local function seed(x)
  return function(a, b, c, d, e)
    local function first() return b, c, e end
    local function second() return a, c, d, e, x, b end
    return first, second
  end
end
return seed(73)
`;

for (const level of [0, 3] as const) {
	function fixture() {
		const compiled = compileHeapServiceSystem(program, level);
		const linked = linkTestSystemBlua32(compiled), object = encodeCompiledProgramObject(compiled);
		function entry(exportPathKey: string, path = modulePath) {
			const { slotName } = object.sections.rodata.moduleExports.find(e => e.path === path && e.exportPathKey === exportPathKey)!;
			const index = linked.symbols.metadata.functionIds.indexOf(object.link.symbols.exportProtoIdBySlot[slotName]);
			assert.ok(index >= 0);
			const stack = deriveBlua32FixedStack(linked.image, [index]);
			assert.ok(stack.frames <= HEAP_SERVICE_FRAME_COUNT && stack.valueSlots <= HEAP_SERVICE_VALUE_COUNT);
			return linked.image.functions[index].address;
		}
		const prepare = entry('prepare_closure'), attempt = entry('create_prepared_closure');
		const driver = entry('allocate_captured_closure', driverPath);
		const target = linked.image.functions.find(f => f.upvalues.length === 6)!;
		assert.ok(target, 'real CLOSURE has inherited, reused and newly open captures');
		function machine() {
			const memory = new Memory({ systemRom: linked.romBytes, cartridgeSlots: [null, null] }, PSX_MACHINE_SPEC.ramBytes);
			const cpu = new CPU(memory, new IrqController(memory), new ExecutionAddressSpace(memory));
			cpu.reset();
			return cpu;
		}
		const actual = machine(), oracle = machine(), memory = actual.memory;
		runGuestToHalt(oracle, 100_000);
		oracle.luaHeap.setCollectionTarget(oracle.luaHeap.capacity());
		const completion: Value[] = [];
		oracle.readCompletionValues(completion);
		oracle.beginCompletionCall(valuePayload(completion[0]), [valueInteger(11), valueInteger(12), valueInteger(13), valueInteger(14), valueInteger(15)]);
		let instruction = 0, bx = 0;
		for (let i = 0; i < 1024; ++i) {
			if (oracle.heapServiceActive()) {
				assert.equal(oracle.runUntilDepth(0, 127), RunResult.Yielded);
				continue;
			}
			const frame = oracle.activeThread.currentFrame!;
			const head = oracle.memory.readMappedU32LE(frame.pc), wide = instructionOpcode(head) === OpCode.WIDE;
			instruction = wide ? oracle.memory.readMappedU32LE(frame.pc + INSTRUCTION_BYTES) : head;
			bx = instructionBx(instruction, wide ? instructionLowB(head) : 0);
			if (instructionOpcode(instruction) === OpCode.CLOSURE && bx * BLUA32_FUNCTION_ALIGNMENT === target.address) break;
			assert.equal(oracle.runUntilDepth(0, 1), RunResult.Yielded);
		}
		assert.equal(bx * BLUA32_FUNCTION_ALIGNMENT, target.address);
		const seed = captureCpuCheckpoint(oracle);
		restoreCpuCheckpoint(actual, seed);
		const arena = actual.heapAllocator, management = arena.managementOffset(), state = arena.allocatorStateOffset();
		const control = management + HEAP_GC_CONTROL_OFFSET, occupied = actual.luaHeap.occupiedOffset;
		// Isolated test workspace: no production capture count cap or heap reservation.
		const workspace = RAM_BASE + management + 0x200, binding = workspace + 12, descriptors = binding + 36;
		const resolved = descriptors + 4 * target.upvalues.length, cells = resolved + 4 * target.upvalues.length;
		memory.writeRamRecordWord(workspace, descriptors);
		memory.writeRamRecordWord(workspace + 4, resolved);
		memory.writeRamRecordWord(workspace + 8, cells);
		const frame = actual.activeThread.currentFrame!, owner = frame.thread.address;
		function bind(latched: boolean) {
			[target.address, -1, +latched, target.codeAddress, target.numParams, target.maxStack, target.flags,
				target.upvalueTableAddress, target.upvalues.length].forEach((word, i) => memory.writeRamRecordWord(binding + 4 * i, word));
			for (let i = 0; i < target.upvalues.length; ++i) memory.writeRamRecordWord(descriptors + i * 4,
				memory.readMappedU32LE(target.upvalueTableAddress + 4 * i));
		}
		function grant(cycles: number) {
			assert.equal(actual.runUntilDepth(0, cycles), RunResult.Yielded);
			const consumed = cycles - actual.instructionBudgetRemaining;
			assert.ok(consumed > 0);
			return consumed;
		}
		function finish() {
			let spent = 0;
			for (let n = 0; n < 4096 && actual.heapServiceActive(); ++n) spent += grant(256);
			assert.equal(actual.heapServiceActive(), false);
			return spent;
		}
		function plan() {
			assert.ok(actual.beginHeapService(prepare, [state, RAM_BASE + frame.controlOffset, binding, workspace]));
			finish();
			return actual.heapServiceResult() | 0;
		}
		// Call the unchanged native mutable-descriptor sampler as a test oracle.
		// Its mapped reads consume the same verified prototype descriptor words.
		function nativeCapture(frame: typeof oracle.activeThread.currentFrame & {}) {
			assert.ok(oracle['readFunctionRecordOnBus'](frame.executionImage, target.address, oracle.readExecutionBusSignals()));
			oracle.instructionBudgetRemaining = 0;
			oracle['runKind'] = CpuRunKind.Direct;
			return oracle['createClosure'](frame);
		}
		function startWhole() {
			assert.ok(actual.beginHeapService(driver, [management, RAM_BASE + frame.controlOffset, owner, binding, workspace, 0]));
		}
		function start(missing: number) {
			assert.ok(actual.beginHeapService(attempt, [state, control, occupied, RAM_BASE + frame.controlOffset, owner, binding, workspace, missing]));
		}
		const destination = (instruction >>> 12) & 0x3f;
		return { actual, oracle, memory, frame, arena, management, control, state, occupied, cells, binding, descriptors, resolved, target,
			destination, bind, plan, nativeCapture, start, startWhole, finish, grant };
	}

	test(`captured Closure native allocation, exact open linkage and rewind at O${level}`, () => {
		const f = fixture(), { actual, oracle, memory, control, frame } = f;
		f.bind(false);
		const parent = frame.closureAddress, parentCell = frame.captureAddress(0);
		const oldHead = frame.openUpvalueHead, stackBase = frame.stackBase;
		const previousBytes = actual.luaHeap.usedBytes();
		assert.notEqual(oldHead, 0);
		// The source descriptor scan occurs before reservation; two Cells are new,
		// three alias the first closure's Cells, and one is an inherited cell.
		assert.equal(f.plan(), 2);
		assert.equal(actual.luaHeap.usedBytes(), previousBytes);
		const oracleFrame = oracle.activeThread.currentFrame!;
		const pc = frame.pc;
		const result = f.nativeCapture(oracleFrame);
		assert.notEqual(result, 0);
		const countAddress = control + 0x70, headAddress = control + 0x6c;
		const countBefore = memory.readRamRecordWord(countAddress);
		const firstCaptureBefore = memory.readRamRecordWord(result + CLOSURE_CAPTURE_WORDS);
		const history = new RamHistory();
		history.start(memory);
		const baseline = history.capture(memory, null);
		f.startWhole();
		for (let n = 0; n < 12000 && memory.readRamRecordWord(countAddress) !== countBefore + 3; ++n) f.grant(1);
		assert.ok(actual.heapServiceActive());
		assert.equal(frame.pc, pc);
		assert.equal(memory.readRamRecordWord(countAddress), countBefore + 3);
		assert.equal(memory.readRamRecordWord(headAddress), result);
		assert.equal(memory.readRamRecordWord(result + CLOSURE_CAPTURE_WORDS), firstCaptureBefore,
			'C++ source policy publishes after allocation and header, before edge/link changes');
		assert.equal(frame.openUpvalueHead, oldHead);
		const checkpoint = actual.captureRuntimeState(), shadow = history.capture(memory, baseline);
		const cycles = f.finish();
		assert.equal(actual.heapServiceResult(), result - RAM_BASE);
		assert.equal(actual.luaHeap.usedBytes(), previousBytes + closureRecordBytes(f.target.upvalues.length, false) + 2 * UPVALUE_HEAP_BYTES);
		assert.equal(memory.readRamRecordWord(parent + CLOSURE_CAPTURE_WORDS), parentCell);
		assert.equal(memory.readRamRecordWord(result + CLOSURE_CAPTURE_WORDS + 16), parentCell);
		assert.equal(frame.openUpvalueHead, oracleFrame.openUpvalueHead);
		const slots: number[] = [];
		for (let cell = frame.openUpvalueHead; cell !== 0; cell = memory.readRamRecordWord(cell + UPVALUE_NEXT)) {
			assert.equal(isOpen(memory, cell), true);
			assert.equal(memory.readRamRecordByte(cell + UPVALUE_FLAGS), 1);
			assert.equal(memory.readRamRecordWord(cell + UPVALUE_OWNER), frame.thread.address);
			slots.push(memory.readRamRecordWord(cell + UPVALUE_VALUE_WORD));
		}
		assert.deepEqual(slots, [4, 3, 2, 1, 0].map(slot => stackBase + slot));
		function compare() {
			// Match only operation-owned bytes. The native CLOSURE instruction
			// additionally writes its successor PC and destination register.
			const first = memory.ramBusEnd() - RAM_BASE, last = f.management;
			const actual = memory.ramData().slice(first, last), expected = oracle.memory.ramData().slice(first, last);
			for (const [offset, bytes] of [[frame.controlOffset + FrameField.Pc, 4], [frame.controlOffset + FrameField.Top, 4],
				[frame.registers.ramOffset() + 4 * f.destination, 4], [frame.registers.ramOffset() + frame.thread.stackRegisters.capacity() * 4 + f.destination, 1]]) {
				expected.set(actual.subarray(offset - first, offset - first + bytes), offset - first);
			}
			const difference = actual.findIndex((byte, i) => byte !== expected[i]);
			assert.equal(difference, -1, `private-byte difference at ${(first + difference).toString(16)}`);

			assert.equal(Buffer.compare(memory.ramData().subarray(control, control + 0x78),
				oracle.memory.ramData().subarray(control, control + 0x78)), 0, 'inventory and collector control');
			assert.equal(Buffer.compare(memory.ramData().subarray(f.state, f.management + 0x600),
				oracle.memory.ramData().subarray(f.state, f.management + 0x600)), 0, 'allocator state');
		}
		compare();
		const end = history.capture(memory, shadow);
		history.restore(memory, end, shadow);
		actual.restoreRuntimeState(checkpoint);
		assert.equal(f.finish(), cycles);
		assert.equal(actual.heapServiceResult(), result - RAM_BASE);
		compare();
	});

	test(`RAM-latched Closure tail and descriptor fault order at O${level}`, () => {
		const f = fixture(), { memory, oracle, frame } = f;
		f.bind(true);
		const word = memory.readRamRecordWord(f.descriptors);
		memory.writeRamRecordWord(f.descriptors, BLUA32_UPVALUE_IN_STACK_MASK | frame.registers.capacity());
		assert.equal(f.plan(), -(LUA_FAULT_REASON_INVALID_ARGUMENT + 1));
		memory.writeRamRecordWord(f.descriptors, BLUA32_UPVALUE_INDEX_MASK);
		assert.equal(f.plan(), -(LUA_FAULT_REASON_INVALID_ARGUMENT + 1));
		memory.writeRamRecordWord(f.descriptors, word);
		memory.writeRamRecordWord(f.binding + 32, 0xffff_ffff);
		assert.equal(f.plan(), -(LUA_FAULT_REASON_OUT_OF_MEMORY + 1));
		f.bind(true);
		assert.equal(f.plan(), 2);
		const address = oracle.luaHeap.allocateClosureRecord(6, true);
		// The tail writer belongs to the published Closure representation; the
		// actual CLOSURE opcode test above separately exercises the capture list.
		const proto: FunctionPrototype = {
			functionAddress: f.target.address, executionDomainId: -1, codeAddress: f.target.codeAddress,
			numParams: f.target.numParams, maxStack: f.target.maxStack, flags: f.target.flags,
			upvalueTableAddress: f.target.upvalueTableAddress, recordUpvalueCount: 6,
		};
		initializeRecord(oracle.memory, address, proto, false, oracle.gc.white(), 6, true);
		f.start(2);
		f.finish();
		assert.equal(f.actual.heapServiceResult(), address - RAM_BASE);
		const tail = address + CLOSURE_CAPTURE_WORDS + 4 * 6;
		for (let word = 0; word < 6; ++word)
			assert.equal(memory.readRamRecordWord(tail + word * 4), oracle.memory.readRamRecordWord(tail + word * 4));
	});
	test(`captured Closure BIOS owns true physical refusal and retries the same prepared edges at O${level}`, () => {
		const f = fixture(), { actual, oracle, frame, arena, memory } = f;
		f.bind(false);
		const text = 'unrooted capture allocation retry '.repeat(256);
		actual.stringPool.intern(text);
		while (arena.allocate(4088, true)) { /* fence out the remaining arena pages */ }
		while (arena.allocate(24, true)) { /* consume every remaining Cell-sized fit */ }
		const before = actual.luaHeap.usedBytes();
		const open = frame.openUpvalueHead;
		restoreCpuCheckpoint(oracle, captureCpuCheckpoint(actual));
		const nativeFrame = oracle.activeThread.currentFrame!;
		const result = f.nativeCapture(nativeFrame);
		assert.notEqual(result, 0);

		f.startWhole();
		for (let i = 0; i < 16384 && actual.heapServiceActive() && !actual.gc.active(); ++i) f.grant(3);
		assert.ok(actual.heapServiceActive());
		assert.ok(actual.gc.active(), 'reservation genuinely needed a collector epoch');
		assert.equal(frame.openUpvalueHead, open);
		const partial = captureCpuCheckpoint(actual);
		const cycles = f.finish();
		function compare() {
			assert.equal(actual.stringPool.find(text), undefined);
			assert.equal(actual.heapServiceResult(), result - RAM_BASE);
			assert.equal(frame.openUpvalueHead, nativeFrame.openUpvalueHead);
			assert.equal(actual.luaHeap.usedBytes(), oracle.luaHeap.usedBytes());
			assert.equal(arena.occupiedBytes(), oracle.heapAllocator.occupiedBytes());
			assert.ok(actual.luaHeap.usedBytes() < before);
			assert.deepEqual(Array.from({ length: 6 }, (_, index) => memory.readRamRecordWord(result + CLOSURE_CAPTURE_WORDS + 4 * index)),
				Array.from({ length: 6 }, (_, index) => oracle.memory.readRamRecordWord(result + CLOSURE_CAPTURE_WORDS + 4 * index)));
		}
		compare();
		restoreCpuCheckpoint(actual, partial);
		assert.equal(f.finish(), cycles);
		compare();
	});

	test(`captured Closure third-cell refusal releases previous Cells in reverse with no publication at O${level}`, () => {
		const f = fixture(), { actual, oracle, memory, frame, arena, control } = f;
		f.bind(false);
		// Native sources resolve against the original frame before linking any
		// Cell. A repeated descriptor for the same absent slot is not deduped.
		memory.writeRamRecordWord(f.descriptors + 4, BLUA32_UPVALUE_IN_STACK_MASK);
		assert.equal(f.plan(), 3);
		const cellBytes = UPVALUE_HEAP_BYTES + GC_OBJECT_PREFIX;
		const closureBytes = closureRecordBytes(6, false) + GC_OBJECT_PREFIX;
		const hole = arena.allocate(closureBytes, true);
		assert.notEqual(hole, 0);
		const holeBytes = arena.allocationBytes(hole);
		assert.notEqual(arena.allocate(cellBytes, true), 0); // fence
		const left = arena.allocate(cellBytes, true);
		assert.notEqual(arena.allocate(cellBytes, true), 0); // fence
		const right = arena.allocate(cellBytes, true);
		assert.notEqual(arena.allocate(cellBytes, true), 0); // fence
		assert.notEqual(left, 0);
		assert.notEqual(right, 0);
		const bytes = holeBytes + arena.allocationBytes(left) + arena.allocationBytes(right);
		for (const address of [hole, left, right]) {
			const end = arena.allocationBytes(address) - 4;
			for (let offset = 0; offset < end; offset += 4) memory.writeRamRecordWord(address + offset, 0x6ced_3189);
		}
		while (arena.allocate(4088, true)) { /* exhaust complete pages */ }
		while (arena.allocate(cellBytes, true)) { /* exhaust remaining Cell fits */ }
		for (const address of [right, left, hole]) arena.free(address);
		const occupied = arena.occupiedBytes(), charged = actual.luaHeap.usedBytes(), open = frame.openUpvalueHead;
		const count = memory.readRamRecordWord(control + 0x70);
		restoreCpuCheckpoint(oracle, captureCpuCheckpoint(actual));
		const native = oracle.heapAllocator;
		const raw = native.allocate(closureBytes, false), a = native.allocate(cellBytes, false), b = native.allocate(cellBytes, false);
		assert.equal(raw, hole);
		assert.notEqual(a, 0);
		assert.notEqual(b, 0);
		assert.equal(native.allocate(cellBytes, false), 0);
		assert.equal(native.occupiedBytes(), occupied + bytes);
		for (const address of [b, a, raw]) native.free(address);
		f.start(3);
		for (let n = 0; n < 12000 && arena.occupiedBytes() !== occupied + bytes; ++n) f.grant(1);
		assert.equal(arena.occupiedBytes(), occupied + bytes);
		const checkpoint = captureCpuCheckpoint(actual);
		const spent = f.finish();
		function compare() {
			assert.equal(actual.heapServiceResult(), 0);
			assert.equal(actual.luaHeap.usedBytes(), charged);
			assert.equal(arena.occupiedBytes(), occupied);
			assert.equal(memory.readRamRecordWord(control + 0x70), count);
			assert.equal(frame.openUpvalueHead, open);
			const first = memory.ramBusEnd() - RAM_BASE;
			assert.equal(Buffer.compare(memory.ramData().subarray(first, f.management),
				oracle.memory.ramData().subarray(first, f.management)), 0, 'allocator words, headers and discarded payloads');
			assert.equal(Buffer.compare(memory.ramData().subarray(f.state, f.management + 0x600),
				oracle.memory.ramData().subarray(f.state, f.management + 0x600)), 0, 'allocator state');
		}
		compare();
		restoreCpuCheckpoint(actual, checkpoint);
		assert.equal(f.finish(), spent);
		compare();
	});

}
