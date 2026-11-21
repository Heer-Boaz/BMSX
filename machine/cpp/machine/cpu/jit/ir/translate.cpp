#include "machine/cpu/jit/ir/region.h"

#include "machine/cpu/decoded_instruction.h"
#include "spec/blua32/cop0.h"

namespace bmsx {

NativeOperation translateNativeOperation(const DecodedInstruction& instruction) {
	const auto op = static_cast<OpCode>(instruction.op);
	const auto a = instruction.a;
	const auto b = instruction.b, c = instruction.c;
	switch (op) {
	case OpCode::MOV:
		switch (static_cast<ValueMoveKind>(c)) {
		case ValueMoveKind::Copy: case ValueMoveKind::FloatBits: case ValueMoveKind::FloatFromBits:
			return NativeMove{a, b, static_cast<ValueMoveKind>(c)};
		}
		return NativeReplay{};

	case OpCode::NOT: return NativeNot{a, b};
	case OpCode::LOADNIL: return NativeClearSlots{a, static_cast<u16>(b)};
	case OpCode::LOADK: return NativeConstantLoad{a, instruction.bx()};
	case OpCode::KNIL: return NativeLiteral{a, valueNil()};
	case OpCode::KFALSE: return NativeLiteral{a, valueBool(false)};
	case OpCode::KTRUE: return NativeLiteral{a, valueBool(true)};
	case OpCode::K0: return NativeLiteral{a, valueInteger(0)};
	case OpCode::K1: return NativeLiteral{a, valueInteger(1)};
	case OpCode::KM1: return NativeLiteral{a, valueInteger(-1)};
	case OpCode::KSMI: return NativeLiteral{a, valueInteger(instruction.sbx())};
	case OpCode::LOADKR: return NativePoolRead{a, static_cast<u16>(b)};
	case OpCode::LEN: return NativeLength{a, static_cast<u16>(b)};
	case OpCode::GETUP: return NativeUpvalueAccess{a, static_cast<u16>(b), NativeAccess::Read};
	case OpCode::SETUP: return NativeUpvalueAccess{a, static_cast<u16>(b), NativeAccess::Write};
	case OpCode::GETGL: return NativeGlobalAccess{a, instruction.bx(), NativeGlobalBank::Execution, NativeAccess::Read};
	case OpCode::SETGL: return NativeGlobalAccess{a, instruction.bx(), NativeGlobalBank::Execution, NativeAccess::Write};
	case OpCode::GETSYS: return NativeGlobalAccess{a, instruction.bx(), NativeGlobalBank::System, NativeAccess::Read};
	case OpCode::SETSYS: return NativeGlobalAccess{a, instruction.bx(), NativeGlobalBank::System, NativeAccess::Write};
	case OpCode::MFC0: case OpCode::MTC0: {
		const bool implemented = cop0FieldImplemented(b);
		const auto mode = op == OpCode::MFC0
			? !implemented ? NativeControlMode::ReadFault : b == COP0_EXEC ? NativeControlMode::ReadZero : NativeControlMode::ReadWord
			: !implemented || b == COP0_EXEC ? NativeControlMode::WriteSemantic
			: b == COP0_STATUS || b == COP0_EPC ? NativeControlMode::WriteWord : NativeControlMode::ConsumeWord;
		return NativeControlAccess{a, static_cast<u16>(b), mode, true};
	}
	case OpCode::LOAD_MEM: case OpCode::LOAD_MEM_D:
		return NativeMemoryAccess{a, b, op == OpCode::LOAD_MEM_D ? instruction.bx() * 4u : 0u,
			static_cast<MemoryAccessKind>(c), NativeMemoryMode::Load, 0};
	case OpCode::STORE_MEM: case OpCode::STORE_MEM_D:
		return NativeMemoryAccess{a, b, op == OpCode::STORE_MEM_D ? instruction.bx() * 4u : 0u,
			static_cast<MemoryAccessKind>(c), NativeMemoryMode::Store, 0};
	case OpCode::STORE_MEM_WORDS: case OpCode::STORE_MEM_WORDS_D:
		return NativeMemoryAccess{a, b, op == OpCode::STORE_MEM_WORDS_D ? instruction.bx() * 4u : 0u,
			MemoryAccessKind::Word, NativeMemoryMode::StoreWords, static_cast<u16>(c)};
	case OpCode::GETT:
		return NativeTableAccess{.value = static_cast<i16>(a), .receiver = b, .key = c, .mode = NativeTableMode::Read,
			.keyKind = NativeTableKey::Value, .resultTag = {}, .predictedSlot = instruction.tableCacheSlot(),
			.readPlan = NativeTableReadPlan::OneHopIndex};
	case OpCode::GETI:
		return NativeTableAccess{static_cast<i16>(a), b, c, NativeTableMode::Read, NativeTableKey::Integer, {}};
	case OpCode::GETFIELD:
		return NativeTableAccess{.value = static_cast<i16>(a), .receiver = b, .key = c, .mode = NativeTableMode::Read,
			.keyKind = NativeTableKey::Field, .resultTag = {}, .predictedSlot = instruction.tableCacheSlot(),
			.readPlan = NativeTableReadPlan::OneHopIndex};
	case OpCode::SELF:
		return NativeTableAccess{.value = static_cast<i16>(a), .receiver = b, .key = c, .mode = NativeTableMode::ReadMethod,
			.keyKind = NativeTableKey::Field, .resultTag = {}, .predictedSlot = instruction.tableCacheSlot(),
			.readPlan = NativeTableReadPlan::OneHopIndex};
	case OpCode::SETT:
		return NativeTableAccess{c, static_cast<i16>(a), b, NativeTableMode::Write, NativeTableKey::Value, {}, instruction.tableCacheSlot()};
	case OpCode::SETI:
		return NativeTableAccess{c, static_cast<i16>(a), b, NativeTableMode::Write, NativeTableKey::Integer, {}};
	case OpCode::SETFIELD:
		return NativeTableAccess{c, static_cast<i16>(a), b, NativeTableMode::Write, NativeTableKey::Field, {}, instruction.tableCacheSlot()};
	case OpCode::ADD: case OpCode::SUB: case OpCode::MUL: {
		const auto observed = instruction.nativeNumericTypes();
		NativeArithmeticHint hint;
		if (observed.stable())
			hint.feedback = NativeArithmeticFeedback{observed.left, observed.right};
		return NativeArithmetic{a, b, c, op, hint};
	}
	case OpCode::DIV: case OpCode::MOD: case OpCode::FLOORDIV: case OpCode::POW:
	case OpCode::BAND: case OpCode::BOR: case OpCode::BXOR: case OpCode::SHL: case OpCode::SHR:
	case OpCode::UNM: case OpCode::BNOT:
		return NativeArithmetic{a, b, c, op, NativeArithmeticHint{}};
	case OpCode::JMP: return NativeJump{instruction.bx()};
	case OpCode::JMPIF: case OpCode::JMPIFNOT:
		return NativeTruthBranch{instruction.bx(), static_cast<i16>(a), op == OpCode::JMPIF};
	case OpCode::EQ: case OpCode::LT: case OpCode::LE:
		return NativeComparison{b, c, op, a == 0};
	case OpCode::CALL: return NativeCallSite{{a, static_cast<i16>(decodeValueCount(b, -1)), static_cast<i16>(decodeValueCount(c, -1))}};
	case OpCode::VARARG: return NativeVararg{{a, static_cast<i16>(decodeValueCount(b, -1))}};
	case OpCode::RET: return NativeReturnSite{{a, static_cast<i16>(decodeValueCount(b, -1))}};
	case OpCode::HALT: return NativeHalt{};
	case OpCode::NEWT: return NativeTableAllocation{{a, static_cast<u16>(b), static_cast<u16>(c)}};
	case OpCode::CONCAT: return NativeConcat{{a, b, c}};
	case OpCode::CONCATN: return NativeConcatRange{{a, static_cast<u16>(b), static_cast<u16>(c)}};
	case OpCode::CLOSURE: return NativeClosure{{instruction.bx(), a, static_cast<u16>(c)}};
	case OpCode::RFE: return NativeExceptionReturn{};
	default:
		return NativeReplay{};
	}
}

} // namespace bmsx
