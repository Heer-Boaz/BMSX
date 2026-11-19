import { GcObject, GcKind } from './gc_object';
import { heapAllocationBytes } from './heap_allocator';
import { ValueTag, valueFromTag, valueTag, valuePayload, type Value } from './value';
import { MAIN_RAM_SIZE } from '../../spec/bmsx/memory_map';
import type { Memory } from '../memory/memory';
import type { CallFrame } from './call_state';
import type { ExecutionDomainId } from '../../spec/blua32/execution_domain';

export const UPVALUE_HEAP_BYTES = 16;
export const UPVALUE_ADDRESS_MASK = MAIN_RAM_SIZE - UPVALUE_HEAP_BYTES;
export const UPVALUE_RECORD_KIND = 11;
export const UPVALUE_VALUE_TAG = 3;
export const UPVALUE_VALUE_WORD = 4;

export class Upvalue extends GcObject {
	public open = false;
	public index = 0;
	public frame: CallFrame | null = null;
	public get valueTag(): ValueTag { return this.memory.readRamRecordByte(this.address + UPVALUE_VALUE_TAG); }
	public get valueWord(): number { return this.memory.readRamRecordWord(this.address + UPVALUE_VALUE_WORD); }
	public get value(): Value { return valueFromTag(this.valueTag, this.valueWord); }
	public set value(value: Value) { this.setEncoded(valueTag(value), valuePayload(value)); }
	public setEncoded(tag: ValueTag, word: number): void { Upvalue.store(this.memory, this.address, tag, word); }
	public static load(memory: Memory, address: number): Value {
		const cell = address & UPVALUE_ADDRESS_MASK;
		return valueFromTag(memory.readRamRecordByte(cell + UPVALUE_VALUE_TAG), memory.readRamRecordWord(cell + UPVALUE_VALUE_WORD));
	}
	public static store(memory: Memory, address: number, tag: ValueTag, word: number): void {
		const cell = address & UPVALUE_ADDRESS_MASK;
		memory.writeRamRecordWord(cell + UPVALUE_VALUE_WORD, word);
		memory.writeRamRecordByte(cell + UPVALUE_VALUE_TAG, tag);
	}
	public nextOpen: Upvalue | null = null;
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

export const CLOSURE_PROTOTYPE_ADDRESS = 8;
export const CLOSURE_CAPTURE_WORDS = 12;
export function closureRecordBytes(captures: number): number { return CLOSURE_CAPTURE_WORDS + 4 * captures; }

export class Closure extends GcObject {
	public constructor(
		private readonly memory: Memory,
		public readonly address: number,
		public prototypeRecord: Readonly<FunctionPrototype>,
		public readonly upvalueCount: number,
		public readonly canonical: boolean,
	) {
		super(GcKind.Closure);
	}
	public get heapBytes(): number { return heapAllocationBytes(closureRecordBytes(this.upvalueCount)); }
	public initializeRecord(): void {
		const flags = (this.prototypeRecord.executionDomainId + 1) | (this.canonical ? 4 : 0);
		this.memory.writeRamRecordWord(this.address, ValueTag.Closure | (flags << 16));
		this.memory.writeRamRecordWord(this.address + 4, 0);
		this.memory.writeRamRecordWord(this.address + CLOSURE_PROTOTYPE_ADDRESS, this.prototypeRecord.functionAddress);
	}
	public captureAddress(index: number): number {
		return this.memory.readRamRecordWord(this.address + CLOSURE_CAPTURE_WORDS + index * 4);
	}
	public setCaptureAddress(index: number, reference: number): void {
		this.memory.writeRamRecordWord(this.address + CLOSURE_CAPTURE_WORDS + index * 4, reference);
	}
}
