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
	// Each candidate names the proof at its origin. A copy can forward the
	// dependency without needing a check itself. Only an emitted use makes
	// that candidate and its incoming chain part of the entry contract.
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
		specialize(block.instructions.first(length), constants, first, count);
		const auto add = [&](size_t target) {
			const size_t start = m_assumptions.size();
			uses.forEachEntryRead(target, [&](int slot) {
				const auto fact = type(slot, constants);
				if (fact && (fact->tag == ValueTag::Integer || fact->tag == ValueTag::Float))
					m_assumptions.push_back({{static_cast<u16>(slot), fact->tag}, fact->assumption});
			});
			ranges[target] = {start, m_assumptions.size() - start};
			blocks[target].typePredecessor = index;
		};
		if (exportPrimary) add(primary);
		if (exportAlternate) add(alternate);
	}

	imports.reserve(std::count_if(m_assumptions.begin(), m_assumptions.end(),
		[](const Assumption& assumption) { return assumption.required; }));
	for (auto& [first, count] : ranges) {
		const size_t output = imports.size();
		for (const auto& assumption : std::span(m_assumptions).subspan(first, count))
			if (assumption.required) imports.push_back(assumption.type);
		first = output;
		count = imports.size() - output;
	}
	for (size_t index = 0; index < blocks.size(); ++index) {
		const auto [first, count] = ranges[index];
		blocks[index].entryTypes = std::span(imports).subspan(first, count);
	}
}

NativeTypePropagation::Type NativeTypePropagation::type(int selector, ConstValueSpan constants) const {
	if (selector < 0) return Fact{m_block, constants.tag(-selector - 1)};
	const auto slot = static_cast<size_t>(selector);
	if (slot < m_facts.size() && m_facts[slot].block == m_block) return m_facts[slot];
	return std::nullopt;
}

void NativeTypePropagation::define(u16 slot, Type type) {
	if (type) {
		if (slot >= m_facts.size()) m_facts.resize(slot + 1u);
		m_facts[slot] = *type;
	} else if (slot < m_facts.size()) {
		m_facts[slot].block = 0;
	}
}

void NativeTypePropagation::require(Type type) {
	if (!type) return;
	for (u32 proof = type->assumption; proof != 0;) {
		auto& assumption = m_assumptions[proof - 1u];
		if (assumption.required) break;
		assumption.required = true;
		proof = assumption.source;
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
		const auto tag = [](Type input) { return input ? std::optional(input->tag) : std::nullopt; };
		auto plan = planNativeNumeric(op.operation, tag(left), tag(right), hint.feedback, op.left == op.right, hint.resultFeedsStore);
		bool needsLeft = true, needsRight = !op.unary();
		if (plan.action == NativeNumericAction::Fault) {
			needsLeft = needsRight = false;
		} else if (plan.action == NativeNumericAction::Kernel) {
			if (!plan.resultDependsOnInputs) {
				needsLeft = needsRight = false;
			} else if (plan.result == ValueTag::Float) {
				// A successful generic numeric operation yields Float if
				// either input is Float. Prefer a local proof to an admission.
				const auto rank = [](Type input, std::optional<ValueTag> inferred) {
					return inferred != ValueTag::Float ? 0 : input ? input->assumption == 0 ? 3 : 2 : 1;
				};
				needsLeft = op.unary() || rank(left, plan.left) >= rank(right, plan.right);
				needsRight = !needsLeft;
			}
		}
		if (needsLeft) facts.require(left);
		if (needsRight) facts.require(right);
		plan.guardLeft &= needsLeft;
		plan.guardRight &= needsRight;
		if (plan.guardLeft) facts.define(op.left, *plan.left);
		if (plan.guardRight) facts.define(op.right, *plan.right);
		facts.define(op.result, plan.result ? Type(Fact{facts.m_block, *plan.result}) : std::nullopt);
		op.strategy.emplace<NativeNumericPlan>(plan);
	}

	void operator()(NativeComparison& op) const {
		const auto left = facts.type(op.left, constants), right = facts.type(op.right, constants);
		if (!left || !right || left->tag != right->tag) return;
		if (left->tag == ValueTag::Integer) op.strategy = NativeComparisonStrategy::Word;
		else if (left->tag == ValueTag::Float) op.strategy = NativeComparisonStrategy::Float;
		else return;
		facts.require(left);
		facts.require(right);
	}

	void operator()(const NativeLiteral& op) const { facts.define(op.result, valueTag(op.value)); }
	void operator()(const NativeLength& op) const { facts.define(op.result, ValueTag::Integer); }

	void operator()(const NativeControlAccess& op) const {
		if (op.mode == NativeControlMode::ReadWord || op.mode == NativeControlMode::ReadZero)
			facts.define(op.slot, ValueTag::Integer);
	}

	void operator()(const NativeMove& op) const {
		if (op.conversion == ValueMoveKind::Copy)
			facts.define(op.result, facts.type(op.source, constants));
		else
			facts.define(op.result, op.conversion == ValueMoveKind::FloatBits ? ValueTag::Integer : ValueTag::Float);
	}

	void operator()(const NativeNot& op) const {
		auto type = facts.type(op.source, constants);
		if (type) type->tag = type->tag <= ValueTag::False ? ValueTag::True : ValueTag::False;
		facts.define(op.result, type);
	}

	void operator()(const NativeTableAccess& op) const {
		if (op.mode == NativeTableMode::Write) return;
		if (op.mode == NativeTableMode::ReadMethod)
			facts.define(op.value + 1, facts.type(op.receiver, constants));
		facts.define(op.value, op.resultTag ? Type(Fact{facts.m_block, *op.resultTag}) : std::nullopt);
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
	size_t first, size_t count) {
	++m_block;
	for (size_t index = first; index < first + count; ++index) {
		const auto& type = m_assumptions[index].type;
		define(type.slot, Fact{m_block, type.tag, static_cast<u32>(index + 1u)});
	}
	for (auto& instruction : instructions)
		std::visit(Transfer{*this, constants, instruction.slots}, instruction.operation);
}

} // namespace bmsx
