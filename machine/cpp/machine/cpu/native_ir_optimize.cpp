#include "machine/cpu/native_ir_optimize.h"

#include <algorithm>
#include "machine/cpu/native_ir.h"
#include "machine/cpu/native_ir_liveness.h"
#include "spec/blua32/instruction_format.h"
#include "spec/blua32/memory_access_kind.h"

namespace bmsx {

void NativeTypePropagation::specializeRegion(std::span<NativeIrBlock> blocks, ConstValueSpan constants,
	const NativeRegisterUses& uses, std::vector<NativeSlotType>& imports) {
	if (blocks.size() == 1) {
		auto& block = blocks.front();
		if (block.optimizationPrefix != 0) specialize(block.instructions.first(block.optimizationPrefix), constants);
		return;
	}
	// Only a single forward native predecessor can supply an assumption.
	// Other incoming paths must prove it at the receiving entry; they do
	// not participate in choosing the types. Merges start without facts.
	struct ImportRange { size_t first = 0, count = 0; };
	std::vector<ImportRange> ranges(blocks.size());
	for (size_t index = 0; index < blocks.size(); ++index) {
		auto& block = blocks[index];
		const auto outgoing = [&](size_t target) {
			return block.nativeSuccessor && target > index && target < blocks.size() && !uses.hasForwardMerge(target);
		};
		const auto [primary, alternate] = block.successors;
		const bool exportPrimary = outgoing(primary), exportAlternate = alternate != primary && outgoing(alternate);
		const size_t length = exportPrimary || exportAlternate ? block.instructions.size() : block.optimizationPrefix;
		if (length == 0) continue;

		const auto [first, count] = ranges[index];
		specialize(block.instructions.first(length), constants, std::span(imports).subspan(first, count));
		const auto add = [&](size_t target) {
			const size_t start = imports.size();
			uses.forEachEntryRead(target, [&](int slot) {
				const auto tag = type(slot, constants);
				if (tag == ValueTag::Integer || tag == ValueTag::Float)
					imports.push_back({static_cast<u16>(slot), *tag});
			});
			ranges[target] = {start, imports.size() - start};
		};
		if (exportPrimary) add(primary);
		if (exportAlternate) add(alternate);
	}

	// Finalize views only after all import storage has been appended.
	for (size_t index = 0; index < blocks.size(); ++index) {
		const auto [first, count] = ranges[index];
		blocks[index].entryTypes = std::span(imports).subspan(first, count);
	}
}

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

struct NativeTypePropagation::Transfer {
	NativeTypePropagation& facts;
	ConstValueSpan constants;
	const NativeSlotAccess& slots;

	// A definition without a typed result kills the previous slot fact.
	void operator()(const auto&) const {
		if (slots.writes.count != 0 || slots.writes.open)
			facts.forgetRange(slots.writes.first, slots.writes.end());
	}

	void operator()(NativeArithmetic& op) const {
		const auto& hint = std::get<NativeArithmeticHint>(op.strategy);
		const auto left = facts.type(op.left, constants);
		const auto right = op.unary() ? std::nullopt : facts.type(op.right, constants);
		const auto plan = planNativeNumeric(op.operation, left, right, hint.feedback, op.left == op.right, hint.resultFeedsStore);
		if (plan.guardLeft) facts.define(op.left, plan.left);
		if (plan.guardRight) facts.define(op.right, plan.right);
		facts.define(op.result, plan.result);
		op.strategy.emplace<NativeNumericPlan>(plan);
	}

	void operator()(NativeComparison& op) const {
		const auto left = facts.type(op.left, constants), right = facts.type(op.right, constants);
		if (left == right && left == ValueTag::Integer) op.strategy = NativeComparisonStrategy::Word;
		else if (left == right && left == ValueTag::Float) op.strategy = NativeComparisonStrategy::Float;
	}

	void operator()(const NativeLiteral& op) const { facts.define(op.result, valueTag(op.value)); }
	void operator()(const NativeLength& op) const { facts.define(op.result, ValueTag::Integer); }

	void operator()(const NativeControlAccess& op) const {
		if (op.mode == NativeControlMode::ReadWord || op.mode == NativeControlMode::ReadZero)
			facts.define(op.slot, ValueTag::Integer);
	}

	void operator()(const NativeMove& op) const {
		const auto type = op.conversion == ValueMoveKind::Copy ? facts.type(op.source, constants)
			: op.conversion == ValueMoveKind::FloatBits ? ValueTag::Integer : ValueTag::Float;
		facts.define(op.result, type);
	}

	void operator()(const NativeNot& op) const {
		const auto type = facts.type(op.source, constants);
		facts.define(op.result, type ? std::optional(*type <= ValueTag::False ? ValueTag::True : ValueTag::False)
			: std::nullopt);
	}

	void operator()(const NativeTableAccess& op) const {
		if (op.mode == NativeTableMode::Write) return;
		if (op.mode == NativeTableMode::ReadMethod)
			facts.define(op.value + 1, facts.type(op.receiver, constants));
		facts.define(op.value, op.resultTag);
	}

	void operator()(const NativeMemoryAccess& op) const {
		if (op.mode == NativeMemoryMode::Load)
			facts.define(op.slot, op.format == MemoryAccessKind::F32LE || op.format == MemoryAccessKind::F64LE
				? ValueTag::Float : ValueTag::Integer);
	}

	void operator()(const NativeClearSlots& op) const {
		const size_t first = op.first, end = std::min<size_t>(op.first + op.count, facts.m_facts.size());
		if (first < end)
			std::fill(facts.m_facts.begin() + first, facts.m_facts.begin() + end, Fact{facts.m_block, ValueTag::Nil});
	}

};

void NativeTypePropagation::specialize(std::span<NativeInstruction> instructions, ConstValueSpan constants,
	std::span<const NativeSlotType> entryTypes) {
	++m_block;
	for (const auto& value : entryTypes) define(value.slot, value.tag);
	for (auto& instruction : instructions)
		std::visit(Transfer{*this, constants, instruction.slots}, instruction.operation);
}

} // namespace bmsx
