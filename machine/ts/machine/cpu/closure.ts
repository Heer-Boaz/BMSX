import { GC_GRAY_INDEX_BITS, GC_RECORD_LINK, GcObject, GcKind } from './gc_object';
import { heapAllocationBytes } from './heap_allocator';
import { ValueTag, valueFromTag, valueTag, valuePayload, type Value } from './value';
import { MAIN_RAM_SIZE, RAM_RECORD_WORD_MASK } from '../../spec/bmsx/memory_map';
import { readLE32, writeLE32 } from '../../common/endian';
import type { Memory, MemoryByteView } from '../memory/memory';
import { ThreadField } from './thread_record';
import type { ExecutionDomainId } from '../../spec/blua32/execution_domain';
import {
	BLUA32_FUNCTION_CODE_ADDRESS_OFFSET, BLUA32_FUNCTION_FLAGS_OFFSET, BLUA32_FUNCTION_MAX_STACK_OFFSET,
	BLUA32_FUNCTION_NUM_PARAMS_OFFSET, BLUA32_FUNCTION_RECORD_SIZE, BLUA32_FUNCTION_UPVALUE_COUNT_OFFSET,
	BLUA32_FUNCTION_UPVALUE_TABLE_ADDRESS_OFFSET,
} from '../../spec/blua32/image_format';

export const UPVALUE_HEAP_BYTES = 16;
export const UPVALUE_ADDRESS_MASK = MAIN_RAM_SIZE - UPVALUE_HEAP_BYTES;
export const UPVALUE_RECORD_KIND = 11;
export const UPVALUE_FLAGS = 2;
export const UPVALUE_OPEN = 1;
export const UPVALUE_VALUE_TAG = 3;
export const UPVALUE_VALUE_WORD = 4;
export const UPVALUE_OWNER = 8;
export const UPVALUE_NEXT = 12;
export const UPVALUE_CHAIN_LIMIT = MAIN_RAM_SIZE / UPVALUE_HEAP_BYTES;

export class Upvalue extends GcObject {
	public get open(): boolean { return Upvalue.isOpen(this.memory, this.address); }
	public get stackSlot(): number { return this.memory.readRamRecordWord(this.address + UPVALUE_VALUE_WORD); }
	public get ownerAddress(): number { return this.memory.readRamRecordWord(this.address + UPVALUE_OWNER); }
	public get nextAddress(): number { return this.memory.readRamRecordWord(this.address + UPVALUE_NEXT); }
	public set nextAddress(next: number) { this.memory.writeRamRecordWord(this.address + UPVALUE_NEXT, next); }
	public get value(): Value { return Upvalue.load(this.memory, this.address); }
	public set value(value: Value) { this.setEncoded(valueTag(value), valuePayload(value)); }
	public setEncoded(tag: ValueTag, word: number): void { Upvalue.store(this.memory, this.address, tag, word); }
	public static isOpen(memory: Memory, address: number): boolean {
		return (memory.readRamRecordByte((address & UPVALUE_ADDRESS_MASK) + UPVALUE_FLAGS) & UPVALUE_OPEN) !== 0;
	}
	public bind(owner: number, slot: number, next: number): void {
		const offset = this.address & UPVALUE_ADDRESS_MASK;
		const ram = this.memory.ramData();
		ram[offset + UPVALUE_FLAGS] = UPVALUE_OPEN;
		writeLE32(ram, offset + UPVALUE_VALUE_WORD, slot);
		writeLE32(ram, offset + UPVALUE_OWNER, owner);
		writeLE32(ram, offset + UPVALUE_NEXT, next);
		this.memory.invalidateRamWrite(offset, UPVALUE_HEAP_BYTES);
	}
	public close(): void {
		const captured = this.value;
		const offset = this.address & UPVALUE_ADDRESS_MASK;
		const ram = this.memory.ramData();
		ram[offset + UPVALUE_FLAGS] &= ~UPVALUE_OPEN;
		ram[offset + UPVALUE_VALUE_TAG] = valueTag(captured);
		writeLE32(ram, offset + UPVALUE_VALUE_WORD, valuePayload(captured));
		writeLE32(ram, offset + UPVALUE_OWNER, 0);
		writeLE32(ram, offset + UPVALUE_NEXT, 0);
		this.memory.invalidateRamWrite(offset, UPVALUE_HEAP_BYTES);
		this.gcOwner.writeBarrier(this.address, UPVALUE_NEXT);
	}
	public static load(memory: Memory, address: number): Value {
		const cell = address & UPVALUE_ADDRESS_MASK;
		const word = memory.readRamRecordWord(cell + UPVALUE_VALUE_WORD);
		if ((memory.readRamRecordByte(cell + UPVALUE_FLAGS) & UPVALUE_OPEN) === 0)
			return valueFromTag(memory.readRamRecordByte(cell + UPVALUE_VALUE_TAG), word);
		const owner = memory.readRamRecordWord(cell + UPVALUE_OWNER);
		const block = memory.readRamRecordWord(owner + ThreadField.StackBlock) & RAM_RECORD_WORD_MASK;
		const capacity = memory.readRamRecordWord(owner + ThreadField.StackCapacity);
		return valueFromTag(memory.readRamRecordByte(block + capacity * 4 + word), memory.readRamRecordWord(block + word * 4));
	}
	public static store(memory: Memory, address: number, tag: ValueTag, word: number): void {
		const cell = address & UPVALUE_ADDRESS_MASK;
		if ((memory.readRamRecordByte(cell + UPVALUE_FLAGS) & UPVALUE_OPEN) === 0) {
			memory.writeRamRecordWord(cell + UPVALUE_VALUE_WORD, word);
			memory.writeRamRecordByte(cell + UPVALUE_VALUE_TAG, tag);
			return;
		}
		const owner = memory.readRamRecordWord(cell + UPVALUE_OWNER);
		const slot = memory.readRamRecordWord(cell + UPVALUE_VALUE_WORD);
		const block = memory.readRamRecordWord(owner + ThreadField.StackBlock) & RAM_RECORD_WORD_MASK;
		const capacity = memory.readRamRecordWord(owner + ThreadField.StackCapacity);
		memory.writeRamRecordWord(block + slot * 4, word);
		memory.writeRamRecordByte(block + capacity * 4 + slot, tag);
	}
	public constructor(private readonly memory: Memory, public readonly address: number) { super(GcKind.Upvalue); }
}

export type FunctionPrototype = {
	functionAddress: number;
	codeAddress: number;
	numParams: number;
	maxStack: number;
	flags: number;
	upvalueTableAddress: number;
	recordUpvalueCount: number;
	executionDomainId: ExecutionDomainId;
};

export function sameFunctionPrototype(a: Readonly<FunctionPrototype>, b: Readonly<FunctionPrototype>): boolean {
	return a.functionAddress === b.functionAddress && a.executionDomainId === b.executionDomainId
		&& a.codeAddress === b.codeAddress && a.numParams === b.numParams && a.maxStack === b.maxStack
		&& a.flags === b.flags && a.upvalueTableAddress === b.upvalueTableAddress
		&& a.recordUpvalueCount === b.recordUpvalueCount;
}

type RetainedPrototype = Readonly<FunctionPrototype> & { retainedClosures: number };

export class FunctionPrototypePool {
	private readonly byAddress = new Map<number, RetainedPrototype[]>();

	public retain(record: Readonly<FunctionPrototype>): Readonly<FunctionPrototype> {
		let versions = this.byAddress.get(record.functionAddress);
		if (versions === undefined) {
			versions = [];
			this.byAddress.set(record.functionAddress, versions);
		} else {
			for (let i = 0; i < versions.length; ++i) {
				const existing = versions[i];
				if (sameFunctionPrototype(existing, record)) {
					++existing.retainedClosures;
					return existing;
				}
			}
		}
		const prototype: RetainedPrototype = {
			functionAddress: record.functionAddress, codeAddress: record.codeAddress, numParams: record.numParams,
			maxStack: record.maxStack, flags: record.flags, upvalueTableAddress: record.upvalueTableAddress,
			recordUpvalueCount: record.recordUpvalueCount, executionDomainId: record.executionDomainId, retainedClosures: 1,
		};
		versions.push(prototype);
		return prototype;
	}

	public release(prototype: Readonly<FunctionPrototype>): void {
		const retained = prototype as RetainedPrototype;
		if (--retained.retainedClosures !== 0) return;
		const versions = this.byAddress.get(retained.functionAddress)!;
		versions.splice(versions.indexOf(retained), 1);
		if (versions.length === 0) this.byAddress.delete(retained.functionAddress);
	}
}

export const CLOSURE_BINDING_FLAGS = 2;
export const CLOSURE_BINDING_DOMAIN_MASK = 3;
export const CLOSURE_CANONICAL = 4;
export const CLOSURE_LATCHED_PROTOTYPE = 8;
const CLOSURE_COUNT_HIGH_BYTE = 3;
const CLOSURE_COUNT_LOW_BITS = 32 - GC_GRAY_INDEX_BITS;
export const CLOSURE_PROTOTYPE_ADDRESS = 8;
export const CLOSURE_CAPTURE_WORDS = 12;
const CLOSURE_LATCHED_PROTOTYPE_BYTES = 6 * 4;
export function closureRecordBytes(captures: number, latched = false): number {
	return CLOSURE_CAPTURE_WORDS + 4 * captures + (latched ? CLOSURE_LATCHED_PROTOTYPE_BYTES : 0);
}

export class Closure extends GcObject {
	public constructor(
		private readonly memory: Memory,
		public readonly address: number,
		public prototypeRecord: Readonly<FunctionPrototype>,
		public readonly canonical: boolean,
	) {
		super(GcKind.Closure);
	}
	public get heapBytes(): number {
		return heapAllocationBytes(closureRecordBytes(this.upvalueCount,
			(this.memory.readRamRecordByte(this.address + CLOSURE_BINDING_FLAGS) & CLOSURE_LATCHED_PROTOTYPE) !== 0));
	}
	public get upvalueCount(): number { return Closure.captureCount(this.memory, this.address); }
	public static captureCount(memory: Memory, address: number): number {
		const low = memory.readRamRecordWord(address + GC_RECORD_LINK) >>> GC_GRAY_INDEX_BITS;
		const high = memory.readRamRecordByte(address + CLOSURE_COUNT_HIGH_BYTE) & 0x7f;
		return low | (high << CLOSURE_COUNT_LOW_BITS);
	}
	public initializeRecord(white: number, count: number, latched = false): void {
		const prototype = this.prototypeRecord;
		const flags = (prototype.executionDomainId + 1)
			| (this.canonical ? CLOSURE_CANONICAL : 0) | (latched ? CLOSURE_LATCHED_PROTOTYPE : 0);
		this.memory.writeRamRecordWord(this.address, ValueTag.Closure | (white << 8)
			| (flags << 16) | ((count >>> CLOSURE_COUNT_LOW_BITS) << 24));
		this.memory.writeRamRecordWord(this.address + GC_RECORD_LINK, count << GC_GRAY_INDEX_BITS);
		this.memory.writeRamRecordWord(this.address + CLOSURE_PROTOTYPE_ADDRESS, prototype.functionAddress);
		if (latched) {
			const tail = this.address + CLOSURE_CAPTURE_WORDS + count * 4;
			this.memory.writeRamRecordWord(tail, prototype.codeAddress);
			this.memory.writeRamRecordWord(tail + 4, prototype.numParams);
			this.memory.writeRamRecordWord(tail + 8, prototype.maxStack);
			this.memory.writeRamRecordWord(tail + 12, prototype.flags);
			this.memory.writeRamRecordWord(tail + 16, prototype.upvalueTableAddress);
			this.memory.writeRamRecordWord(tail + 20, prototype.recordUpvalueCount);
		}
	}
	public static readBinding(memory: Memory, address: number, flags: number, view: MemoryByteView): FunctionPrototype {
		const functionAddress = memory.readRamRecordWord(address + CLOSURE_PROTOTYPE_ADDRESS);
		const bank = flags & CLOSURE_BINDING_DOMAIN_MASK;
		const executionDomainId = (bank >= 2 ? 1 : bank - 1) as ExecutionDomainId;
		if ((flags & CLOSURE_LATCHED_PROTOTYPE) !== 0) {
			const tail = address + CLOSURE_CAPTURE_WORDS + Closure.captureCount(memory, address) * 4;
			return {
				functionAddress, executionDomainId,
				codeAddress: memory.readRamRecordWord(tail),
				numParams: memory.readRamRecordWord(tail + 4),
				maxStack: memory.readRamRecordWord(tail + 8),
				flags: memory.readRamRecordWord(tail + 12),
				upvalueTableAddress: memory.readRamRecordWord(tail + 16),
				recordUpvalueCount: memory.readRamRecordWord(tail + 20),
			};
		}
		// Unconnected ROM data lanes read zero without invoking a bus device.
		if (!memory.bindRomByteView(functionAddress, BLUA32_FUNCTION_RECORD_SIZE, bank >>> 1, view)) {
			return { functionAddress, executionDomainId, codeAddress: 0, numParams: 0, maxStack: 0, flags: 0, upvalueTableAddress: 0, recordUpvalueCount: 0 };
		}
		const { bytes, byteOffset } = view;
		return {
			functionAddress, executionDomainId,
			codeAddress: readLE32(bytes, byteOffset + BLUA32_FUNCTION_CODE_ADDRESS_OFFSET),
			numParams: readLE32(bytes, byteOffset + BLUA32_FUNCTION_NUM_PARAMS_OFFSET),
			maxStack: readLE32(bytes, byteOffset + BLUA32_FUNCTION_MAX_STACK_OFFSET),
			flags: readLE32(bytes, byteOffset + BLUA32_FUNCTION_FLAGS_OFFSET),
			upvalueTableAddress: readLE32(bytes, byteOffset + BLUA32_FUNCTION_UPVALUE_TABLE_ADDRESS_OFFSET),
			recordUpvalueCount: readLE32(bytes, byteOffset + BLUA32_FUNCTION_UPVALUE_COUNT_OFFSET),
		};
	}

	public captureAddress(index: number): number {
		return this.memory.readRamRecordWord(this.address + CLOSURE_CAPTURE_WORDS + index * 4);
	}
	public setCaptureAddress(index: number, reference: number): void {
		this.memory.writeRamRecordWord(this.address + CLOSURE_CAPTURE_WORDS + index * 4, reference);
	}
}
