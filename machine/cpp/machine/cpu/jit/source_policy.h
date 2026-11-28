#pragma once

#include <array>
#include <cstddef>

#include "machine/cpu/decoded_instruction.h"
#include "spec/blua32/cop0.h"
#include "spec/blua32/memory_access_kind.h"

namespace bmsx {

// Guest control-flow and opcode admission for instruction-source discovery.
inline constexpr bool nativeBlockSupports(u8 op) {
	switch (static_cast<OpCode>(op)) {
		case OpCode::MOV:
		case OpCode::GETT:
		case OpCode::SETT:
		case OpCode::GETI:
		case OpCode::SETI:
		case OpCode::SELF:
		case OpCode::LEN:
		case OpCode::MFC0:
		case OpCode::MTC0:
		case OpCode::SVC:
		case OpCode::RFE:
		case OpCode::LOADK:
		case OpCode::LOADKR:
		case OpCode::LOADNIL:
		case OpCode::GETGL:
		case OpCode::SETGL:
		case OpCode::GETSYS:
		case OpCode::SETSYS:
		case OpCode::GETUP:
		case OpCode::SETUP:
		case OpCode::VARARG:
		case OpCode::KNIL:
		case OpCode::KFALSE:
		case OpCode::KTRUE:
		case OpCode::K0:
		case OpCode::K1:
		case OpCode::ITERN:
		case OpCode::KSMI:
		case OpCode::ADD:
		case OpCode::SUB:
		case OpCode::MUL:
		case OpCode::DIV:
		case OpCode::MOD:
		case OpCode::FLOORDIV:
		case OpCode::POW:
		case OpCode::UNM:
		case OpCode::NOT:
		case OpCode::BAND:
		case OpCode::BOR:
		case OpCode::BXOR:
		case OpCode::SHL:
		case OpCode::SHR:
		case OpCode::BNOT:
		case OpCode::JMP:
		case OpCode::JAL:
		case OpCode::JREG:
		case OpCode::JMPIF:
		case OpCode::JMPIFNOT:
		case OpCode::EQ:
		case OpCode::LT:
		case OpCode::LE:
		case OpCode::HALT:
		case OpCode::CALL:
		case OpCode::RET:
		case OpCode::GETFIELD:
		case OpCode::SETFIELD:
		case OpCode::LOAD_MEM:
		case OpCode::LOAD_MEM_D:
		case OpCode::STORE_MEM:
		case OpCode::STORE_MEM_D:
		case OpCode::STORE_MEM_WORDS:
		case OpCode::STORE_MEM_WORDS_D:
			return true;
		default:
			return false;
	}
}

// Source discovery already ends the run at these instructions. Feed their
// successor if the ordinary CPU can return there.
inline constexpr bool nativeBlockHasTerminalContinuation(u8 op, int field) {
	switch (static_cast<OpCode>(op)) {
		case OpCode::STORE_MEM_WORDS: case OpCode::STORE_MEM_WORDS_D:
		case OpCode::CALL: case OpCode::SVC:
			return true;
		case OpCode::MTC0: return field == COP0_STATUS || field == COP0_RAM_END || field == COP0_CURRENT
			|| (field >= COP0_TABLE_LOOKUP_KEY && field <= COP0_STRING_INDEX_TABLE);
		default: return false;
	}
}

inline constexpr bool nativeComparisonPairsJump(const DecodedInstruction& skipped) {
	return skipped.op == static_cast<u8>(OpCode::JMP) && skipped.a == 0
		&& skipped.dispatchOp != static_cast<u8>(DecodedDispatchOp::Observe);
}

inline constexpr bool nativeBlockCanSkip(u8 op) {
	return op == static_cast<u8>(OpCode::EQ) || op == static_cast<u8>(OpCode::LT)
		|| op == static_cast<u8>(OpCode::LE) || op == static_cast<u8>(OpCode::ITERN);
}

inline constexpr auto NATIVE_BLOCK_BOUNDARY_OPS = [] {
	// Decoded dispatch opcodes are bytes, including the internal pseudo-ops.
	std::array<bool, 256> boundaries{};
	for (const auto op : {OpCode::JMP, OpCode::JAL, OpCode::JREG, OpCode::JMPIF, OpCode::JMPIFNOT, OpCode::HALT,
		OpCode::CALL, OpCode::RET, OpCode::SVC,
		OpCode::STORE_MEM_WORDS, OpCode::STORE_MEM_WORDS_D, OpCode::RFE, OpCode::EQ, OpCode::LT, OpCode::LE, OpCode::ITERN}) {
		boundaries[static_cast<u8>(op)] = true;
	}
	return boundaries;
}();

inline constexpr bool nativeBlockEndsBlock(u8 op, int field) {
	return NATIVE_BLOCK_BOUNDARY_OPS[op]
		|| (op == static_cast<u8>(OpCode::MTC0) && (cop0WriteRetiresControl(field) || !cop0FieldImplemented(field)));
}

#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
inline constexpr u8 nativeWarmDispatch(const DecodedInstruction& row) {
	return static_cast<u8>(nativeBlockEndsBlock(row.op, row.b)
		? DecodedDispatchOp::NativeWarmBoundary : DecodedDispatchOp::NativeWarm);
}

inline constexpr bool isNativeWarmDispatch(u8 dispatch) {
	return dispatch == static_cast<u8>(DecodedDispatchOp::NativeWarm)
		|| dispatch == static_cast<u8>(DecodedDispatchOp::NativeWarmBoundary);
}
#endif

inline bool nativeSourceCanEmit(const DecodedInstruction& instruction) {

	switch (static_cast<OpCode>(instruction.op)) {
		case OpCode::MFC0: return instruction.b != COP0_EVENT_CYCLES;
		case OpCode::LOAD_MEM: return instruction.c != static_cast<int>(MemoryAccessKind::ContextWord);
		case OpCode::JMP: return instruction.a == 0;
		case OpCode::JREG: return instruction.c <= static_cast<int>(RegisterJumpMode::LeaveWindowFromRegister);
		case OpCode::MOV: return instruction.c <= static_cast<int>(ValueMoveKind::SetTop);
		case OpCode::RET: return instruction.c == static_cast<int>(ReturnSource::Registers);
		default: return nativeBlockSupports(instruction.op);
	}
}

} // namespace bmsx
