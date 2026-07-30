import type { Closure } from './closure';
import type { StringId } from './string_pool';
import type { Table } from './table';
import {
	ValueTag,
	asStringId,
	materializeValue,
	valueFromNumber,
	valueTag,
	type BuiltinFunction,
	type StringValue,
	type Value,
	type ValueReference,
} from './value';

// start normalized-body-acceptable -- Register storage keeps tag-specialized setters so the VM hot path avoids generic value dispatch.
// start repeated-sequence-acceptable -- Register copies keep direct parallel-array writes in the hot path.

export type ValueWriteTarget = {
	setEncoded(index: number, tag: ValueTag, scalar: number, reference: ValueReference): void;
	setNumber(index: number, value: number): void;
	setNil(index: number): void;
};

export class ValueSlots {
	private tags: Uint8Array;
	private scalars: Float64Array;
	private refs: ValueReference[];
	private base = 0;
	private size: number;

	constructor(size: number) {
		this.tags = new Uint8Array(size);
		this.scalars = new Float64Array(size);
		this.scalars.fill(NaN);
		this.refs = new Array<ValueReference>(size);
		this.size = size;
		for (let index = 0; index < size; index += 1) {
			this.refs[index] = null;
		}
	}

	public capacity(): number {
		return this.size;
	}

	public rebind(source: ValueSlots, base: number, size: number): void {
		this.tags = source.tags;
		this.scalars = source.scalars;
		this.refs = source.refs;
		this.base = base;
		this.size = size;
	}

	public clear(count: number): void {
		const start = this.base;
		const end = start + count;
		this.tags.fill(ValueTag.Nil, start, end);
		this.scalars.fill(NaN, start, end);
		for (let slot = start; slot < end; slot += 1) {
			this.refs[slot] = null;
		}
	}

	public copyTo(target: Value[], count: number): void {
		target.length = count;
		for (let index = 0; index < count; index += 1) {
			target[index] = this.get(index);
		}
	}

	public copySlot(dst: number, src: number): void {
		const dstSlot = this.base + dst;
		const srcSlot = this.base + src;
		this.tags[dstSlot] = this.tags[srcSlot];
		this.scalars[dstSlot] = this.scalars[srcSlot];
		this.refs[dstSlot] = this.refs[srcSlot];
	}

	public copySlotFrom(source: ValueSlots, dst: number, src: number): void {
		const dstSlot = this.base + dst;
		const srcSlot = source.base + src;
		this.tags[dstSlot] = source.tags[srcSlot];
		this.scalars[dstSlot] = source.scalars[srcSlot];
		this.refs[dstSlot] = source.refs[srcSlot];
	}

	public copyRangeFrom(source: ValueSlots, dstBase: number, srcBase: number, count: number): void {
		const dstOffset = this.base;
		const srcOffset = source.base;
		for (let index = 0; index < count; index += 1) {
			const dst = dstOffset + dstBase + index;
			const src = srcOffset + srcBase + index;
			this.tags[dst] = source.tags[src];
			this.scalars[dst] = source.scalars[src];
			this.refs[dst] = source.refs[src];
		}
	}

	public moveRange(dstBase: number, srcBase: number, count: number): void {
		const base = this.base;
		if (count <= 0 || dstBase === srcBase) {
			return;
		}
		if (dstBase > srcBase) {
			for (let index = count - 1; index >= 0; index -= 1) {
				const dst = base + dstBase + index;
				const src = base + srcBase + index;
				this.tags[dst] = this.tags[src];
				this.scalars[dst] = this.scalars[src];
				this.refs[dst] = this.refs[src];
			}
			return;
		}
		for (let index = 0; index < count; index += 1) {
			const dst = base + dstBase + index;
			const src = base + srcBase + index;
			this.tags[dst] = this.tags[src];
			this.scalars[dst] = this.scalars[src];
			this.refs[dst] = this.refs[src];
		}
	}

	public getTag(index: number): ValueTag {
		return this.tags[this.base + index];
	}

	public getNumber(index: number): number {
		const slot = this.base + index;
		return this.tags[slot] === ValueTag.Number ? this.scalars[slot] : NaN;
	}

	public getScalar(index: number): number {
		return this.scalars[this.base + index];
	}

	public getReference(index: number): ValueReference {
		return this.refs[this.base + index];
	}

	public getStringId(index: number): StringId {
		return this.scalars[this.base + index] as StringId;
	}

	public getTable(index: number): Table {
		return this.refs[this.base + index] as Table;
	}

	public getClosure(index: number): Closure {
		return this.refs[this.base + index] as Closure;
	}

	public getBuiltinFunctionId(index: number): BuiltinFunction['id'] {
		return this.scalars[this.base + index] as BuiltinFunction['id'];
	}

	public isTruthy(index: number): boolean {
		const tag = this.tags[this.base + index];
		return tag !== ValueTag.Nil && tag !== ValueTag.False;
	}

	public get(index: number): Value {
		const slot = this.base + index;
		return materializeValue(this.tags[slot], this.scalars[slot], this.refs[slot]);
	}

	public setNil(index: number): void {
		const slot = this.base + index;
		this.tags[slot] = ValueTag.Nil;
		this.scalars[slot] = NaN;
		this.refs[slot] = null;
	}

	public setBool(index: number, value: boolean): void {
		const slot = this.base + index;
		this.tags[slot] = value ? ValueTag.True : ValueTag.False;
		this.scalars[slot] = NaN;
		this.refs[slot] = null;
	}

	public setNumber(index: number, value: number): void {
		const slot = this.base + index;
		this.tags[slot] = ValueTag.Number;
		this.scalars[slot] = valueFromNumber(value);
		this.refs[slot] = null;
	}

	public setStringId(index: number, value: StringId): void {
		const slot = this.base + index;
		this.tags[slot] = ValueTag.String;
		this.scalars[slot] = value;
		this.refs[slot] = null;
	}

	public setTable(index: number, value: Table): void {
		const slot = this.base + index;
		this.tags[slot] = ValueTag.Table;
		this.scalars[slot] = NaN;
		this.refs[slot] = value;
	}

	public setClosure(index: number, value: Closure): void {
		const slot = this.base + index;
		this.tags[slot] = ValueTag.Closure;
		this.scalars[slot] = NaN;
		this.refs[slot] = value;
	}

	public setEncoded(index: number, tag: ValueTag, scalar: number, reference: ValueReference): void {
		const slot = this.base + index;
		this.tags[slot] = tag;
		this.scalars[slot] = scalar;
		this.refs[slot] = reference;
	}

	public set(index: number, value: Value): void {
		const slot = this.base + index;
		const tag = valueTag(value);
		this.tags[slot] = tag;
		switch (tag) {
			case ValueTag.Number:
				this.scalars[slot] = valueFromNumber(value as number);
				this.refs[slot] = null;
				return;
			case ValueTag.String:
				this.scalars[slot] = asStringId(value as StringValue);
				this.refs[slot] = null;
				return;
			case ValueTag.Table:
			case ValueTag.Closure:
				this.scalars[slot] = NaN;
				this.refs[slot] = value as Table | Closure;
				return;
			case ValueTag.BuiltinFunction:
				this.scalars[slot] = (value as BuiltinFunction).id;
				this.refs[slot] = null;
				return;
			case ValueTag.Nil:
			case ValueTag.False:
			case ValueTag.True:
				this.scalars[slot] = NaN;
				this.refs[slot] = null;
		}
	}
}

const EMPTY_VALUE_SLOTS = new ValueSlots(0);

export class BuiltinArgsView {
	public registers = EMPTY_VALUE_SLOTS;
	public base = 0;
	public length = 0;

	public bind(registers: ValueSlots, base: number, length: number): void {
		this.registers = registers;
		this.base = base;
		this.length = length;
	}

	public clear(): void {
		this.registers = EMPTY_VALUE_SLOTS;
		this.base = 0;
		this.length = 0;
	}
}

export class BuiltinResults {
	private values = new ValueSlots(8);
	public length = 0;

	public clear(): void {
		this.values.clear(this.length);
		this.length = 0;
	}

	public push(
		tag: ValueTag,
		scalar: number = NaN,
		reference: ValueReference = null,
	): void {
		this.ensureCapacity(this.length + 1);
		this.values.setEncoded(this.length, tag, scalar, reference);
		this.length += 1;
	}

	public setEncoded(index: number, tag: ValueTag, scalar: number, reference: ValueReference): void {
		this.ensureCapacity(index + 1);
		this.values.setEncoded(index, tag, scalar, reference);
		if (index >= this.length) {
			this.length = index + 1;
		}
	}

	public setNumber(index: number, value: number): void {
		this.ensureCapacity(index + 1);
		this.values.setNumber(index, value);
		if (index >= this.length) {
			this.length = index + 1;
		}
	}

	public setNil(index: number): void {
		this.setEncoded(index, ValueTag.Nil, NaN, null);
	}

	public copyTo(target: ValueSlots, targetIndex: number, count: number): void {
		target.copyRangeFrom(this.values, targetIndex, 0, count);
	}

	public getTag(index: number): ValueTag {
		return this.values.getTag(index);
	}

	public getScalar(index: number): number {
		return this.values.getScalar(index);
	}

	public getReference(index: number): ValueReference {
		return this.values.getReference(index);
	}

	private ensureCapacity(capacity: number): void {
		if (capacity <= this.values.capacity()) {
			return;
		}
		let nextCapacity = this.values.capacity() * 2;
		while (nextCapacity < capacity) {
			nextCapacity *= 2;
		}
		const next = new ValueSlots(nextCapacity);
		next.copyRangeFrom(this.values, 0, 0, this.length);
		this.values = next;
	}
}
