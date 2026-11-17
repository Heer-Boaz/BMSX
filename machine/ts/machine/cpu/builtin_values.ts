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
];
