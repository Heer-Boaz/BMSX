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
	{ id: BuiltinFunctionId.Next, cost: BUILTIN_COST_TIER1 },
	{ id: BuiltinFunctionId.Type, cost: BUILTIN_COST_TIER1 },
	{ id: BuiltinFunctionId.SetMetatable, cost: BUILTIN_COST_TIER2 },
	{ id: BuiltinFunctionId.GetMetatable, cost: BUILTIN_COST_TIER2 },
	{ id: BuiltinFunctionId.RawGet, cost: BUILTIN_COST_TIER1 },
	{ id: BuiltinFunctionId.RawSet, cost: BUILTIN_COST_TIER1 },
	{ id: BuiltinFunctionId.Select, cost: BUILTIN_COST_TIER1 },
	{ id: BuiltinFunctionId.StringByte, cost: BUILTIN_COST_TIER2 },
	{ id: BuiltinFunctionId.StringChar, cost: BUILTIN_COST_TIER2 },
	{ id: BuiltinFunctionId.Error, cost: BUILTIN_COST_TIER2 },
	{ id: BuiltinFunctionId.PCall, cost: BUILTIN_COST_TIER4 },
	{ id: BuiltinFunctionId.XPCall, cost: BUILTIN_COST_TIER4 },
	{ id: BuiltinFunctionId.SetStringIndex, cost: BUILTIN_COST_TIER1 },
	{ id: BuiltinFunctionId.CollectGarbage, cost: BUILTIN_COST_TIER4 },
	{ id: BuiltinFunctionId.CoroutineCreate, cost: BUILTIN_COST_TIER4 },
	{ id: BuiltinFunctionId.CoroutineResume, cost: BUILTIN_COST_TIER4 },
	{ id: BuiltinFunctionId.CoroutineYield, cost: BUILTIN_COST_TIER4 },
	{ id: BuiltinFunctionId.CoroutineStatus, cost: BUILTIN_COST_TIER4 },
	{ id: BuiltinFunctionId.CoroutineRunning, cost: BUILTIN_COST_TIER4 },
	{ id: BuiltinFunctionId.CoroutineClose, cost: BUILTIN_COST_TIER4 },
	{ id: BuiltinFunctionId.CoroutineIsYieldable, cost: BUILTIN_COST_TIER4 },
	{ id: BuiltinFunctionId.GetGlobal, cost: BUILTIN_COST_TIER1 },
	{ id: BuiltinFunctionId.SetGlobal, cost: BUILTIN_COST_TIER1 },
	{ id: BuiltinFunctionId.FrameCount, cost: BUILTIN_COST_TIER1 },
	{ id: BuiltinFunctionId.GetFrameRegister, cost: BUILTIN_COST_TIER1 },
	{ id: BuiltinFunctionId.SetFrameRegister, cost: BUILTIN_COST_TIER1 },
	{ id: BuiltinFunctionId.GetFrameUpvalue, cost: BUILTIN_COST_TIER1 },
	{ id: BuiltinFunctionId.SetFrameUpvalue, cost: BUILTIN_COST_TIER1 },
	{ id: BuiltinFunctionId.FrameHeader, cost: BUILTIN_COST_TIER1 },
	{ id: BuiltinFunctionId.NumberType, cost: BUILTIN_COST_TIER1 },
	{ id: BuiltinFunctionId.ToInteger, cost: BUILTIN_COST_TIER1 },
];

// Borrowed argument windows and reusable return transport belong to builtin
// invocation. Neither introduces a second reference representation.
const EMPTY_VALUE_SLOTS = new ValueSlots(0);
export class BuiltinArgsView {
	private readonly aperture = new ValueSlots(0);
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
}
export class BuiltinResults {
	private readonly values = new ValueSlots(8);
	public length = 0;
	public clear(): void { this.values.clear(this.length); this.length = 0; }
	public push(value: Value): void {
		this.values.reserveCapacity(this.length + 1); this.values.set(this.length++, value);
	}
	public setEncoded(index: number, tag: ValueTag, word: number): void {
		this.values.reserveCapacity(index + 1); this.values.setEncoded(index, tag, word);
		if (index >= this.length) this.length = index + 1;
	}
	public setInteger(index: number, value: number): void { this.setEncoded(index, ValueTag.Integer, value >>> 0); }
	public setFloatBits(index: number, bits: number): void { this.setEncoded(index, ValueTag.Float, bits); }
	public setNil(index: number): void { this.setEncoded(index, ValueTag.Nil, 0); }
	public copyTo(target: ValueSlots, first: number, count: number): void { target.copyRangeFrom(this.values, first, 0, count); }
	public get(index: number): Value { return this.values.get(index); }
	public getTag(index: number): ValueTag { return this.values.getTag(index); }
	public getPayload(index: number): number { return this.values.getPayload(index); }
}
