import type { Closure } from './closure';
import { Table } from './table';
import {
	EMPTY_CALL_ARGS,
	ValueTag,
	valueTag,
	type BuiltinArgs,
	type BuiltinFunction,
	type StringValue,
	type Value,
} from './value';

// start normalized-body-acceptable -- Register storage keeps tag-specialized setters so the VM hot path avoids generic value dispatch.
// start repeated-sequence-acceptable -- Register copies keep direct parallel-array writes in the hot path.

export class RegisterFile {
	private tags: Uint8Array;
	private numbers: Float64Array;
	private refs: Value[];
	private base = 0;
	private size: number;

	constructor(size: number) {
		this.tags = new Uint8Array(size);
		this.numbers = new Float64Array(size);
		this.refs = new Array<Value>(size);
		this.size = size;
		for (let index = 0; index < size; index += 1) {
			this.refs[index] = null;
		}
	}

	public capacity(): number {
		return this.size;
	}

	public rebind(source: RegisterFile, base: number, size: number): void {
		this.tags = source.tags;
		this.numbers = source.numbers;
		this.refs = source.refs;
		this.base = base;
		this.size = size;
	}

	public clear(count: number): void {
		const start = this.base;
		const end = start + count;
		this.tags.fill(ValueTag.Nil, start, end);
		for (let slot = start; slot < end; slot += 1) {
			this.refs[slot] = null;
		}
	}

	public copyFrom(source: RegisterFile, count: number): void {
		const dstBase = this.base;
		const srcBase = source.base;
		for (let index = 0; index < count; index += 1) {
			const dst = dstBase + index;
			const src = srcBase + index;
			this.tags[dst] = source.tags[src];
			this.numbers[dst] = source.numbers[src];
			this.refs[dst] = source.refs[src];
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
		this.numbers[dstSlot] = this.numbers[srcSlot];
		this.refs[dstSlot] = this.refs[srcSlot];
	}

	public copyRangeFrom(source: RegisterFile, dstBase: number, srcBase: number, count: number): void {
		const dstOffset = this.base;
		const srcOffset = source.base;
		for (let index = 0; index < count; index += 1) {
			const dst = dstOffset + dstBase + index;
			const src = srcOffset + srcBase + index;
			this.tags[dst] = source.tags[src];
			this.numbers[dst] = source.numbers[src];
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
				this.numbers[dst] = this.numbers[src];
				this.refs[dst] = this.refs[src];
			}
			return;
		}
		for (let index = 0; index < count; index += 1) {
			const dst = base + dstBase + index;
			const src = base + srcBase + index;
			this.tags[dst] = this.tags[src];
			this.numbers[dst] = this.numbers[src];
			this.refs[dst] = this.refs[src];
		}
	}

	public isNumber(index: number): boolean {
		return this.tags[this.base + index] === ValueTag.Number;
	}

	public getNumber(index: number): number {
		return this.numbers[this.base + index];
	}

	public isTruthy(index: number): boolean {
		const tag = this.tags[this.base + index];
		return tag !== ValueTag.Nil && tag !== ValueTag.False;
	}

	public get(index: number): Value {
		const slot = this.base + index;
		switch (this.tags[slot]) {
			case ValueTag.Nil:
				return null;
			case ValueTag.False:
				return false;
			case ValueTag.True:
				return true;
			case ValueTag.Number:
				return this.numbers[slot];
			case ValueTag.String:
			case ValueTag.Table:
			case ValueTag.Closure:
			case ValueTag.BuiltinFunction:
				return this.refs[slot];
			default:
				throw new Error('Invalid register tag.');
		}
	}

	public setNil(index: number): void {
		const slot = this.base + index;
		this.tags[slot] = ValueTag.Nil;
		this.refs[slot] = null;
	}

	public setBool(index: number, value: boolean): void {
		const slot = this.base + index;
		this.tags[slot] = value ? ValueTag.True : ValueTag.False;
		this.refs[slot] = null;
	}

	public setNumber(index: number, value: number): void {
		const slot = this.base + index;
		this.tags[slot] = ValueTag.Number;
		this.numbers[slot] = value;
		this.refs[slot] = null;
	}

	public setString(index: number, value: StringValue): void {
		const slot = this.base + index;
		this.tags[slot] = ValueTag.String;
		this.refs[slot] = value;
	}

	public setTable(index: number, value: Table): void {
		const slot = this.base + index;
		this.tags[slot] = ValueTag.Table;
		this.refs[slot] = value;
	}

	public setClosure(index: number, value: Closure): void {
		const slot = this.base + index;
		this.tags[slot] = ValueTag.Closure;
		this.refs[slot] = value;
	}

	public setBuiltinFunction(index: number, value: BuiltinFunction): void {
		const slot = this.base + index;
		this.tags[slot] = ValueTag.BuiltinFunction;
		this.refs[slot] = value;
	}

	public set(index: number, value: Value): void {
		const slot = this.base + index;
		const tag = valueTag(value);
		this.tags[slot] = tag;
		if (tag === ValueTag.Number) {
			this.numbers[slot] = value as number;
			this.refs[slot] = null;
		} else if (tag <= ValueTag.Number) {
			this.refs[slot] = null;
		} else {
			this.refs[slot] = value;
		}
	}
}

const EMPTY_REGISTER_FILE = new RegisterFile(0);

export class ArrayBuiltinArgsView implements BuiltinArgs {
	private values: ReadonlyArray<Value> = EMPTY_CALL_ARGS;
	public length = 0;

	public bind(values: ReadonlyArray<Value>): void {
		this.values = values;
		this.length = values.length;
	}

	public clear(): void {
		this.values = EMPTY_CALL_ARGS;
		this.length = 0;
	}

	public get(index: number): Value {
		return index < this.length ? this.values[index] : null;
	}
}

export class RegisterBuiltinArgsView implements BuiltinArgs {
	private registers = EMPTY_REGISTER_FILE;
	private base = 0;
	public length = 0;

	public bind(registers: RegisterFile, base: number, length: number): void {
		this.registers = registers;
		this.base = base;
		this.length = length;
	}

	public clear(): void {
		this.registers = EMPTY_REGISTER_FILE;
		this.base = 0;
		this.length = 0;
	}

	public get(index: number): Value {
		return index < this.length ? this.registers.get(this.base + index) : null;
	}
}
