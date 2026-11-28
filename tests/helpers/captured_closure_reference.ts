import { bindOpen, initialize } from './native_heap/upvalue_record';
import { initializeRecord, setCaptureAddress } from './native_heap/closure_record';
import { nativeHeapReference } from './native_heap/reference';
import { gcPacedPhase } from './native_heap/gc_heap';
import { GC_OBJECT_PREFIX } from '../../toolchain/ts/firmware/stock_object_layout';
import { valueNil } from '../../machine/ts/machine/cpu/value';
import type { CallFrame } from '../../machine/ts/machine/cpu/call_state';
import * as Closure from '../../machine/ts/machine/cpu/closure';
import type { CPU } from '../../machine/ts/machine/cpu/cpu';
import type { MappedBusSignals } from '../../machine/ts/machine/memory/bus_signals';
import { LUA_OUT_OF_MEMORY_SIGNAL, LuaExecutionError } from '../../machine/ts/machine/cpu/errors';
import type { Blua32FunctionRecordLatch } from '../../machine/ts/machine/cpu/execution_image';
import * as Upvalue from '../../machine/ts/machine/cpu/upvalue';
import { UPVALUE_CHAIN_LIMIT, UPVALUE_NEXT, UPVALUE_VALUE_WORD } from '../../machine/ts/machine/cpu/upvalue';
import { LUA_FAULT_REASON_INVALID_ARGUMENT } from '../../machine/ts/spec/blua32/cop0';
import { BLUA32_UPVALUE_INDEX_MASK, BLUA32_UPVALUE_IN_STACK_MASK, BLUA32_UPVALUE_RECORD_SIZE } from '../../machine/ts/spec/blua32/image_format';
import { MAIN_RAM_SIZE } from '../../machine/ts/spec/bmsx/memory_map';

const NO_NEW_CELLS = new Uint32Array(0);

/** Admit the closure and its new cells before publishing any frame link. */
export function allocateClosureRecordReference(cpu: CPU, captures: number, latched = false, cells: Uint32Array = NO_NEW_CELLS, newCount = 0): number {
	const bytes = Closure.closureRecordBytes(captures, latched);
	const charged = bytes + newCount * Upvalue.UPVALUE_HEAP_BYTES;
	const { memory } = cpu, { luaHeap: budget, heapAllocator: arena, gc } = nativeHeapReference(cpu);
	let recovery = budget.admit(charged, valueNil(), valueNil(), valueNil(), 0);
	if (gcPacedPhase(gc.phase())) gc.assistBeforeReservation(charged + GC_OBJECT_PREFIX * (1 + newCount));
	for (;;) {
		const closure = arena.allocate(bytes + GC_OBJECT_PREFIX, false);
		if (closure !== 0) {
			let count = 0;
			for (; count < newCount; ++count) {
				const cell = arena.allocate(Upvalue.UPVALUE_HEAP_BYTES + GC_OBJECT_PREFIX, false);
				if (cell === 0) break;
				cells[count] = cell + GC_OBJECT_PREFIX;
			}
			if (count === newCount) {
				const white = gc.white();
				for (let index = 0; index < newCount; ++index) {
					const cell = cells[index];
					initialize(memory, cell, white);
					gc.publishObject(cell);
				}
				budget.resizeRecordCharge(0, charged);
				return closure + GC_OBJECT_PREFIX;
			}
			while (count !== 0) arena.free(cells[--count] - GC_OBJECT_PREFIX);
			arena.free(closure);
		}
		recovery = gc.recoverAllocation(recovery);
	}
}

// Frozen TS capture sampler/search/link loop from 7c989e96d (cpu.ts).
// Only scratch ownership changes: the oracle has local, test-side buffers.

function findOpenUpvalue(cpu: CPU, frame: CallFrame, index: number): number {
	const { gc } = nativeHeapReference(cpu);
	const slot = (frame.stackBase + index) >>> 0;
	let address = frame.openUpvalueHead;
	for (let remaining = UPVALUE_CHAIN_LIMIT; address !== 0 && remaining !== 0; --remaining) {
		const cell = gc.openCellAddress(address);
		if (cell === 0) break;
		const current = cpu.memory.readRamRecordWord(cell + UPVALUE_VALUE_WORD);
		if (current <= slot) return current === slot ? cell : 0;
		address = cpu.memory.readRamRecordWord(cell + UPVALUE_NEXT);
	}
	return 0;
}

function linkOpenUpvalue(cpu: CPU, frame: CallFrame, cell: number, slot: number): void {
	const { gc } = nativeHeapReference(cpu);
	let previous = 0;
	let next = frame.openUpvalueHead;
	for (let remaining = UPVALUE_CHAIN_LIMIT; next !== 0 && remaining !== 0; --remaining) {
		const current = gc.openCellAddress(next);
		if (current === 0 || cpu.memory.readRamRecordWord(current + UPVALUE_VALUE_WORD) <= slot) break;
		previous = current;
		next = cpu.memory.readRamRecordWord(current + UPVALUE_NEXT);
	}
	bindOpen(cpu.memory, cell, frame.thread.address, slot, next);
	if (previous === 0) frame.openUpvalueHead = cell;
	else cpu.memory.writeRamRecordWord(previous + UPVALUE_NEXT, cell);
}

export function createReferenceCapturedClosure(cpu: CPU, frame: CallFrame, functionRecord: Blua32FunctionRecordLatch, signals: MappedBusSignals): number {
	const count = functionRecord.recordUpvalueCount;
	const latched = !functionRecord.romBacked;
	if (Closure.closureRecordBytes(count, latched) > MAIN_RAM_SIZE) throw LUA_OUT_OF_MEMORY_SIGNAL;
	const upvalueWords = new Uint32Array(count);
	const upvalues = new Uint32Array(count);
	const faultSequence = cpu.memory.readBusFaultSequence();
	let newUpvalueCount = 0;
	for (let index = 0; index < functionRecord.recordUpvalueCount; index += 1) {
		const word = cpu.memory.readMappedBusU32LE(
			(functionRecord.upvalueTableAddress
				+ index * BLUA32_UPVALUE_RECORD_SIZE) >>> 0,
			signals,
		);
		if (cpu.memory.readBusFaultSequence() !== faultSequence) {
			cpu['hardHalt']();
			return 0;
		}
		upvalueWords[index] = word;
		const upvalueIndex = word & BLUA32_UPVALUE_INDEX_MASK;
		if ((word & BLUA32_UPVALUE_IN_STACK_MASK) !== 0) {
			if (upvalueIndex >= frame.registers.capacity()) throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
			const cell = findOpenUpvalue(cpu, frame, upvalueIndex);
			upvalues[index] = cell;
			if (cell === 0) newUpvalueCount += 1;
			continue;
		}
		if (upvalueIndex >= frame.captureCount) throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
		upvalues[index] = frame.captureAddress(upvalueIndex);
	}
	const cells = new Uint32Array(newUpvalueCount);
	const address = allocateClosureRecordReference(cpu, count, latched, cells, newUpvalueCount);
	const closure = address;
	initializeRecord(cpu.memory, address, functionRecord, false, nativeHeapReference(cpu).gc.white(), count, latched);
	let nextCell = 0;
	for (let index = 0; index < functionRecord.recordUpvalueCount; index += 1) {
		if (upvalues[index] !== 0 || (upvalueWords[index] & BLUA32_UPVALUE_IN_STACK_MASK) === 0) {
			setCaptureAddress(cpu.memory, closure, index, upvalues[index]);
			continue;
		}
		const cell = cells[nextCell++];
		linkOpenUpvalue(cpu, frame, cell, (frame.stackBase + (upvalueWords[index] & BLUA32_UPVALUE_INDEX_MASK)) >>> 0);
		setCaptureAddress(cpu.memory, closure, index, cell);
	}
	nativeHeapReference(cpu).gc.publishObject(closure);
	cpu['charge'](count);
	return closure;
}
