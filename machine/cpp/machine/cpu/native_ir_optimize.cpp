#include "machine/cpu/native_ir_optimize.h"

#include <algorithm>
#include <limits>
#include "machine/cpu/native_ir.h"
#include "spec/blua32/instruction_format.h"
#include "spec/blua32/memory_access_kind.h"

namespace bmsx {

std::optional<ValueTag> NativeTypePropagation::type(int selector, ConstValueSpan constants) const {
	if (selector < 0) return constants.tag(-selector - 1);
	const auto slot = static_cast<size_t>(selector);
	if (slot < m_facts.size() && m_facts[slot].block == m_block) return m_facts[slot].tag;
	return std::nullopt;
}

void NativeTypePropagation::define(u16 slot, std::optional<ValueTag> tag) {
	if (tag) {
		if (slot >= m_facts.size()) m_facts.resize(slot + 1u);
		m_facts[slot] = {m_block, *tag};
	} else if (slot < m_facts.size()) {
		m_facts[slot].block = 0;
	}
}

void NativeTypePropagation::forgetRange(size_t first, size_t end) {
	if (first < m_facts.size())
		std::fill(m_facts.begin() + first, m_facts.begin() + std::min(end, m_facts.size()), Fact{});
}

void NativeTypePropagation::specialize(std::span<NativeInstruction> instructions, ConstValueSpan constants,
	std::span<const NativeSlotType> entryTypes) {
	++m_block;
	for (const auto& value : entryTypes) define(value.slot, value.tag);

	for (auto& instruction : instructions) {
		const auto [op, destination, left, right, immediate] = instruction.operands;
		std::optional<ValueTag> result;
		switch (op) {
		case OpCode::ADD: case OpCode::SUB: case OpCode::MUL: case OpCode::DIV:
		case OpCode::MOD: case OpCode::FLOORDIV: case OpCode::POW: case OpCode::UNM:
		case OpCode::BAND: case OpCode::BOR: case OpCode::BXOR: case OpCode::SHL: case OpCode::SHR: case OpCode::BNOT: {
			const auto* hint = std::get_if<NativeArithmeticHint>(&instruction.specialization);
			const bool unary = op == OpCode::UNM || op == OpCode::BNOT;
			const auto plan = planNativeNumeric(op, type(left, constants), unary ? std::nullopt : type(right, constants),
				hint ? hint->feedback : std::nullopt, left == right, hint && hint->resultFeedsStore);
			if (plan.guardLeft) define(left, plan.left);
			if (plan.guardRight) define(right, plan.right);
			result = plan.result;
			instruction.specialization.emplace<NativeNumericPlan>(plan);
			break;
		}
		case OpCode::LOADK:
			result = constants.tag(immediate);
			break;
		case OpCode::KNIL: result = ValueTag::Nil; break;
		case OpCode::KFALSE: result = ValueTag::False; break;
		case OpCode::KTRUE: result = ValueTag::True; break;
		case OpCode::K0: case OpCode::K1: case OpCode::KM1: case OpCode::KSMI:
		case OpCode::LEN: case OpCode::MFC0:
			result = ValueTag::Integer;
			break;
		case OpCode::MOV:
			switch (static_cast<ValueMoveKind>(right)) {
			case ValueMoveKind::Copy: result = type(left, constants); break;
			case ValueMoveKind::FloatBits: result = ValueTag::Integer; break;
			case ValueMoveKind::FloatFromBits: result = ValueTag::Float; break;
			}
			break;
		case OpCode::NOT:
			if (auto tag = type(left, constants))
				result = *tag <= ValueTag::False ? ValueTag::True : ValueTag::False;
			break;
		case OpCode::GETFIELD:
			if (const auto* field = std::get_if<NativeFieldRead>(&instruction.specialization)) result = field->result;
			break;
		case OpCode::LOAD_MEM: case OpCode::LOAD_MEM_D:
			result = right == static_cast<i16>(MemoryAccessKind::F32LE) || right == static_cast<i16>(MemoryAccessKind::F64LE)
				? ValueTag::Float : ValueTag::Integer;
			break;
		case OpCode::SELF:
			define(destination + 1u, type(left, constants));
			break;
		case OpCode::LOADNIL:
			if (destination < m_facts.size()) {
				const size_t end = std::min<size_t>(destination + left, m_facts.size());
				std::fill(m_facts.begin() + destination, m_facts.begin() + end, Fact{m_block, ValueTag::Nil});
			}
			break;
		case OpCode::VARARG:
			forgetRange(destination, left == 0 ? m_facts.size() : static_cast<size_t>(destination + left - 1));
			break;
		default:
			break;
		}
		if (OPCODE_WRITES_REGISTER_A[static_cast<size_t>(op)]) define(destination, result);
	}
}

} // namespace bmsx
