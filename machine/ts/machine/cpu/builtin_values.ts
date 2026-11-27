import { ValueTag, type Value } from './value';
import { ValueSlots } from './value_slots';
import { BuiltinFunctionId } from '../../spec/blua32/builtin';

export type BuiltinFunctionCost = {
	base: number;
	perArg: number;
	perRet: number;
};

export type BuiltinFunction = {
	readonly id: BuiltinFunctionId;
	readonly cost: BuiltinFunctionCost;
};

const BUILTIN_COST_TIER1: BuiltinFunctionCost = { base: 1, perArg: 0, perRet: 0 };
const BUILTIN_COST_TIER2: BuiltinFunctionCost = { base: 2, perArg: 0, perRet: 0 };
const BUILTIN_COST_TIER4: BuiltinFunctionCost = { base: 4, perArg: 0, perRet: 0 };
export const BUILTIN_FUNCTIONS: readonly BuiltinFunction[] = [
	{ id: BuiltinFunctionId.GetMetatable, cost: BUILTIN_COST_TIER2 },
	{ id: BuiltinFunctionId.StringByte, cost: BUILTIN_COST_TIER2 },
	{ id: BuiltinFunctionId.ToInteger, cost: BUILTIN_COST_TIER1 },
	{ id: BuiltinFunctionId.Next, cost: BUILTIN_COST_TIER1 },
	{ id: BuiltinFunctionId.RawGet, cost: BUILTIN_COST_TIER1 },
	{ id: BuiltinFunctionId.Error, cost: BUILTIN_COST_TIER2 },
	{ id: BuiltinFunctionId.CoroutineStatus, cost: BUILTIN_COST_TIER4 },
	{ id: BuiltinFunctionId.CoroutineRunning, cost: BUILTIN_COST_TIER4 },
	{ id: BuiltinFunctionId.GetGlobal, cost: BUILTIN_COST_TIER1 },
	{ id: BuiltinFunctionId.FrameCount, cost: BUILTIN_COST_TIER1 },
	{ id: BuiltinFunctionId.GetFrameRegister, cost: BUILTIN_COST_TIER1 },
	{ id: BuiltinFunctionId.SetFrameRegister, cost: BUILTIN_COST_TIER1 },
	{ id: BuiltinFunctionId.GetFrameUpvalue, cost: BUILTIN_COST_TIER1 },
	{ id: BuiltinFunctionId.FrameHeader, cost: BUILTIN_COST_TIER1 },
	{ id: BuiltinFunctionId.StringFromBytes, cost: BUILTIN_COST_TIER2 },
];

// Borrowed argument windows and reusable return transport belong to builtin
// invocation. Neither introduces a second reference representation.
const EMPTY_VALUE_SLOTS = new ValueSlots(0);
export class BuiltinArgsView {
	private readonly aperture = new ValueSlots(0);
	private detached: ValueSlots | null = null;
	public registers = EMPTY_VALUE_SLOTS;
	public base = 0;
	public length = 0;
	public bind(registers: ValueSlots, base: number, length: number): void {
		this.length = length;
		if (base + length > registers.capacity()) {
			this.aperture.rebind(registers, base, length);
			this.registers = this.aperture; this.base = 0;
		} else {
			this.registers = registers; this.base = base;
		}
	}
	public clear(): void {
		if (this.registers === this.aperture) this.aperture.unbind();
		this.registers = EMPTY_VALUE_SLOTS; this.base = 0; this.length = 0;
	}
	public bindDetached(first: Value, second?: Value, third?: Value): void {
		const slots = this.detached ??= new ValueSlots(3);
		slots.set(0, first);
		if (second !== undefined) slots.set(1, second);
		if (third !== undefined) slots.set(2, third);
		this.registers = slots;
		this.base = 0;
		this.length = third !== undefined ? 3 : second !== undefined ? 2 : 1;
	}
}
export class BuiltinResults {
	public readonly slots = new ValueSlots(8);
	public length = 0;
	public clear(): void { this.slots.clear(this.length); this.length = 0; }
	public push(value: Value): void {
		this.slots.reserveCapacity(this.length + 1); this.slots.set(this.length++, value);
	}
	public setEncoded(index: number, tag: ValueTag, word: number): void {
		this.slots.reserveCapacity(index + 1); this.slots.setEncoded(index, tag, word);
		if (index >= this.length) this.length = index + 1;
	}
	public setInteger(index: number, value: number): void { this.setEncoded(index, ValueTag.Integer, value >>> 0); }
	public setFloatBits(index: number, bits: number): void { this.setEncoded(index, ValueTag.Float, bits); }
	public setNil(index: number): void { this.setEncoded(index, ValueTag.Nil, 0); }
	public get(index: number): Value { return this.slots.get(index); }
	public getTag(index: number): ValueTag { return this.slots.getTag(index); }
	public getPayload(index: number): number { return this.slots.getPayload(index); }
}
