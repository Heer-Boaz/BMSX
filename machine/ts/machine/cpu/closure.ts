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

export class Closure extends GcObject {
	public constructor(
		public prototypeRecord: Readonly<FunctionPrototype>,
		public upvalues: Uint32Array,
		public heapBytes: number,
		public canonical: boolean,
	) {
		super(GcKind.Closure);
	}
}
