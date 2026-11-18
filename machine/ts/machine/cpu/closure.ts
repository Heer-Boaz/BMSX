import { GcObject, GcKind } from './gc_object';
import { ValueTag, valueFromTag, valueTag, valuePayload, type Value } from './value';
import type { CallFrame } from './call_state';
import type { ExecutionDomainId } from '../../spec/blua32/execution_domain';

export class Upvalue extends GcObject {
	public open = false;
	public index = 0;
	public frame: CallFrame | null = null;
	public valueTag = ValueTag.Nil;
	public valueWord = 0;
	public get value(): Value { return valueFromTag(this.valueTag, this.valueWord); }
	public set value(value: Value) { this.valueTag = valueTag(value); this.valueWord = valuePayload(value); }
	public nextOpen: Upvalue | null = null;
	public constructor() { super(GcKind.Upvalue); }
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

export const UPVALUE_HEAP_BYTES = 20;
