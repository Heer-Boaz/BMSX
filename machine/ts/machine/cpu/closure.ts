import { GcObject, GcKind } from './gc_object';
import { ValueTag, valueFromTag, valueTag, valuePayload, type Value } from './value';
import type { Memory } from '../memory/memory';
import type { CallFrame } from './call_state';
import type { ExecutionDomainId } from '../../spec/blua32/execution_domain';

export const UPVALUE_HEAP_BYTES = 16;
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
	public setEncoded(tag: ValueTag, word: number): void {
		this.memory.writeRamRecordWord(this.address + UPVALUE_VALUE_WORD, word);
		this.memory.writeRamRecordByte(this.address + UPVALUE_VALUE_TAG, tag);
	}
	public nextOpen: Upvalue | null = null;
	public constructor(private readonly memory: Memory, public readonly address: number) { super(GcKind.Upvalue); }
}

export const EMPTY_CLOSURE_UPVALUES = new Uint32Array();

export class Closure extends GcObject {

	public constructor(
		public functionAddress: number,
		public upvalues: Uint32Array,
		public heapBytes: number,
		public codeAddress: number,
		public numParams: number,
		public maxStack: number,
		public flags: number,
		public upvalueTableAddress: number,
		public executionDomainId: ExecutionDomainId,
		public recordUpvalueCount: number,
		public canonical: boolean,
	) {
		super(GcKind.Closure);
	}
}
