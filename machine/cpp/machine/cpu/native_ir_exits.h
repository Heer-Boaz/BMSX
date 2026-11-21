#pragma once

#include "machine/cpu/native_ir_ops.h"
#include "spec/blua32/cop0.h"

namespace bmsx {

struct NativeExitPlan {
	NativeBlockExit kind = NativeBlockExit::Continue;
	NativeExitOperands operands{};
};

// Checked operations leave the completed prefix plus the instruction's base
// charge to the runtime. Describe the operands here, not in the SLJIT code.
struct NativeCheckedExit {
	NativeExitPlan operator()(const auto&) const { return {}; }

	NativeExitPlan operator()(const NativeMove& move) const {
		return move.conversion == ValueMoveKind::Copy ? NativeExitPlan{} : NativeExitPlan{NativeBlockExit::InvalidOperand};
	}

	NativeExitPlan operator()(const NativeArithmetic&) const { return {NativeBlockExit::InvalidOperand}; }
	NativeExitPlan operator()(const NativePoolRead&) const { return {NativeBlockExit::InvalidConstant}; }
	NativeExitPlan operator()(const NativeLength&) const { return {NativeBlockExit::InvalidLength}; }

	NativeExitPlan operator()(const NativeVararg& placement) const {
		return {NativeBlockExit::Vararg, {.vararg = placement}};
	}

	NativeExitPlan operator()(const NativeControlAccess& access) const {
		switch (access.mode) {
		case NativeControlMode::ReadFault:
			return {NativeBlockExit::ControlFault};
		case NativeControlMode::ReadWord: case NativeControlMode::ReadZero:
			return access.checkPrivilege ? NativeExitPlan{NativeBlockExit::ControlFault} : NativeExitPlan{};
		case NativeControlMode::WriteWord: case NativeControlMode::ConsumeWord: case NativeControlMode::WriteSemantic:
			return {NativeBlockExit::WriteControl, {.control = {access.slot, access.field}}};
		}
		BMSX_UNREACHABLE();
	}

	NativeExitPlan operator()(const NativeUpvalueAccess& access) const {
		if (access.access == NativeAccess::Read) return {};
		return {NativeBlockExit::WriteUpvalue, {.upvalue = {access.slot, access.capture}}};
	}

	NativeExitPlan operator()(const NativeGlobalAccess& access) const {
		if (access.access == NativeAccess::Read) return {};
		return {access.bank == NativeGlobalBank::System ? NativeBlockExit::WriteSystemGlobal : NativeBlockExit::WriteGlobal,
			{.global = {access.index, access.slot}}};
	}

	NativeExitPlan operator()(const NativeTableAccess& access) const {
		const bool write = access.mode == NativeTableMode::Write;
		const NativeExitOperands operands{.table = {access.value, access.receiver, access.key}};
		switch (access.keyKind) {
		case NativeTableKey::Field: return {write ? NativeBlockExit::WriteField : NativeBlockExit::ReadField, operands};
		case NativeTableKey::Value: return {write ? NativeBlockExit::WriteIndex : NativeBlockExit::ReadIndex, operands};
		case NativeTableKey::Integer: return {write ? NativeBlockExit::WriteInteger : NativeBlockExit::ReadInteger, operands};
		}
		BMSX_UNREACHABLE();
	}

	NativeExitPlan operator()(const NativeMemoryAccess& access) const {
		const NativeExitOperands operands{.memory = {access.displacement, access.slot, access.address, access.format, access.wordCount}};
		switch (access.mode) {
		case NativeMemoryMode::Load: return {NativeBlockExit::ReadMemory, operands};
		case NativeMemoryMode::Store: return {NativeBlockExit::WriteMemory, operands};
		case NativeMemoryMode::StoreWords: return {NativeBlockExit::WriteWords, operands};
		}
		BMSX_UNREACHABLE();
	}
};

struct NativeTerminalExit {
	NativeExitPlan operator()(const auto&) const { return {}; }
	NativeExitPlan operator()(const NativeHalt&) const { return {NativeHalt::terminalExit}; }
	NativeExitPlan operator()(const NativeExceptionReturn&) const { return {NativeExceptionReturn::terminalExit}; }
	NativeExitPlan operator()(const NativeCallSite& call) const { return {call.terminalExit, {.call = call}}; }
	NativeExitPlan operator()(const NativeReturnSite& ret) const { return {ret.terminalExit, {.returned = ret}}; }
	NativeExitPlan operator()(const NativeTableAllocation& table) const { return {table.terminalExit, {.allocation = table}}; }
	NativeExitPlan operator()(const NativeConcat& concat) const { return {concat.terminalExit, {.concat = concat}}; }
	NativeExitPlan operator()(const NativeConcatRange& concat) const { return {concat.terminalExit, {.concatRange = concat}}; }
	NativeExitPlan operator()(const NativeClosure& closure) const { return {closure.terminalExit, {.closure = closure}}; }

	NativeExitPlan operator()(const NativeControlAccess& access) const {
		if (access.mode == NativeControlMode::WriteSemantic && access.field == COP0_EXEC)
			return {NativeBlockExit::WriteControl, {.control = {access.slot, access.field}}};
		if (access.mode == NativeControlMode::WriteWord && access.field == COP0_STATUS)
			return {NativeBlockExit::ControlBoundary};
		return {};
	}
};

} // namespace bmsx
