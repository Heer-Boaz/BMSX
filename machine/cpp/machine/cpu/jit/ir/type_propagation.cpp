#include "machine/cpu/jit/ir/type_propagation.h"

#include <algorithm>
#include "machine/cpu/jit/ir/region.h"
#include "machine/cpu/jit/ir/liveness.h"
#include "spec/blua32/instruction_format.h"
#include "spec/blua32/memory_access_kind.h"

namespace bmsx {

void NativeTypePropagation::specializeRegion(std::span<NativeIrBlock> blocks,
	const NativeRegisterUses& uses, NativeSlotValues& values, std::vector<NativeSlotType>& imports) {
	if (blocks.size() == 1) {
		specialize(blocks.front(), values, blocks.size());
		return;
	}
	// The forward meet proves tags, not identities: two branches can
	// produce different values with the same tag for one entry slot.
	struct ImportRange { size_t first = 0, count = 0; bool received = false; };
	std::vector<ImportRange> ranges(blocks.size());
	for (size_t index = 0; index < blocks.size(); ++index) {
		auto& block = blocks[index];
		const auto& incoming = ranges[index];
		specialize(block, values, blocks.size(), incoming.first, incoming.count);
		if (!block.nativeSuccessor) continue;
		for (size_t edge = 0; edge < block.successors.size(); ++edge) {
			const size_t target = block.successors[edge];
			if (target <= index || target >= blocks.size() || (edge != 0 && target == block.successors[0])) continue;
			auto& range = ranges[target];
			const size_t start = m_assumptions.size();
			if (range.received) {
				for (size_t previous = range.first; previous < range.first + range.count; ++previous) {
					const auto candidate = m_assumptions[previous].type;
					const auto fact = type(values.current(candidate.slot));
					if (fact && fact->tag == candidate.tag)
						m_assumptions.push_back({candidate, fact->assumption, static_cast<u32>(previous + 1u)});
				}
			} else {
				uses.forEachEntryRead(target, [&](int slot) {
					const auto fact = type(values.current(static_cast<NativeSlot>(slot)));
					if (fact)
						m_assumptions.push_back({{static_cast<u16>(slot), fact->tag}, fact->assumption});
				});
			}
			range = {start, m_assumptions.size() - start, true};
			block.provesSuccessorTypes[edge] = true;
		}
	}

	// Assumptions always depend on earlier offers. Follow dependencies of
	// consumed tags once, after specialization; unused meets need no checks.
	for (size_t index = m_assumptions.size(); index-- > 0;) {
		const auto& proof = m_assumptions[index];
		if (!proof.required) continue;
		if (proof.source != 0) m_assumptions[proof.source - 1u].required = true;
		if (proof.alternate != 0) m_assumptions[proof.alternate - 1u].required = true;
	}
	size_t required = 0;
	for (const auto& range : ranges)
		required += std::ranges::count_if(std::span(m_assumptions).subspan(range.first, range.count), &Assumption::required);
	imports.reserve(required);
	for (auto& range : ranges) {
		const size_t first = imports.size();
		for (const auto& assumption : std::span(m_assumptions).subspan(range.first, range.count))
			if (assumption.required) imports.push_back(assumption.type);
		range = {first, imports.size() - first, false};
	}
	for (size_t index = 0; index < blocks.size(); ++index) {
		const auto& range = ranges[index];
		blocks[index].entryTypes = std::span(imports).subspan(range.first, range.count);
	}
}

NativeTypePropagation::Type NativeTypePropagation::type(NativeValueId value) const {
	const auto index = static_cast<u16>(value);
	return index < m_facts.size() ? m_facts[index] : std::nullopt;
}

void NativeTypePropagation::define(NativeValueId value, Fact fact) {
	const auto index = static_cast<u16>(value);
	if (index >= m_facts.size()) m_facts.resize(index + 1u);
	m_facts[index] = fact;
}

void NativeTypePropagation::require(Type type) {
	if (type && type->assumption != 0)
		m_assumptions[type->assumption - 1u].required = true;
}

struct NativeTypePropagation::Transfer {
	NativeTypePropagation& facts;
	NativeRowValues values;
	bool inlineBuiltin;
	bool invalidOperand = false;

	Type input(size_t ordinal) const { return facts.type(values.inputs[ordinal]); }
	void result(ValueTag tag) const { facts.define(values.result, tag); }

	// The value flow has already bound untyped writes to fresh identities.
	void operator()(const auto&) const {}

	void operator()(NativeArithmetic& op) {
		const auto& hint = std::get<NativeArithmeticHint>(op.strategy);
		const auto left = input(0);
		const auto right = input(1);
		const auto tag = [](Type input) { return input ? std::optional(input->tag) : std::nullopt; };
		auto plan = planNativeNumeric(op.operation, tag(left), tag(right), hint.feedback, values.inputs[0] == values.inputs[1], hint.mode);
		bool needsLeft = true, needsRight = !op.unary();
		if (plan.action == NativeNumericAction::Fault) {
			invalidOperand = true;
			const auto nonnumeric = [](Type type) {
				return type && type->tag != ValueTag::Integer && type->tag != ValueTag::Float;
			};
			const bool leftInvalid = nonnumeric(left), rightInvalid = nonnumeric(right);
			needsLeft = leftInvalid && (!rightInvalid || left->assumption == 0 || right->assumption != 0);
			needsRight = !needsLeft && rightInvalid;
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
		if (plan.guardLeft || plan.guardRight) plan.feedbackAssumption = hint.feedback;
		plan.sampleOperands = facts.m_observesArithmetic && hint.mode == NativeNumericFeedbackMode::Sampling
			&& plan.action == NativeNumericAction::Kernel;
		if (plan.guardLeft) facts.define(values.inputs[0], *plan.left);
		if (plan.guardRight) facts.define(values.inputs[1], *plan.right);
		if (plan.result) result(*plan.result);
		op.strategy.emplace<NativeNumericPlan>(plan);
	}

	void operator()(NativeComparison& op) const {
		const auto left = input(0), right = input(1);
		if (!left || !right || left->tag != right->tag) return;
		if (left->tag == ValueTag::Integer) op.strategy = NativeComparisonStrategy::Word;
		else if (left->tag == ValueTag::Float) op.strategy = NativeComparisonStrategy::Float;
		else return;
		facts.require(left);
		facts.require(right);
	}

	void operator()(const NativeLiteral& op) const { result(valueTag(op.value)); }
	void operator()(const NativeLength&) const { result(ValueTag::Integer); }

	NativeTagCheck check(size_t operand, ValueTag expected) const {
		const auto type = input(operand);
		if (!type) return NativeTagCheck::Dynamic;
		facts.require(type);
		return type->tag == expected ? NativeTagCheck::Proved : NativeTagCheck::Rejected;
	}

	NativeWordSource wordSource(size_t operand) const {
		const auto type = input(operand);
		if (!type) return NativeWordSource::Dynamic;
		facts.require(type);
		if (type->tag == ValueTag::Integer) return NativeWordSource::Integer;
		if (type->tag == ValueTag::Float) return NativeWordSource::Float;
		return NativeWordSource::Invalid;
	}

	void operator()(NativePoolRead& op) const {
		op.indexPlan = wordSource(0);
	}

	void operator()(NativeControlAccess& op) const {
		switch (op.mode) {
		case NativeControlMode::ReadWord: case NativeControlMode::ReadZero:
			result(ValueTag::Integer);
			break;
		case NativeControlMode::WriteWord: case NativeControlMode::ConsumeWord:
			op.operand = wordSource(0);
			break;
		case NativeControlMode::ReadFault: case NativeControlMode::WriteSemantic:
			break;
		}
	}

	void operator()(NativeMove& op) {
		if (op.conversion == ValueMoveKind::Copy) {
			const auto type = input(0);
			// Copying bits does not need a speculative admission check. A
			// downstream typed consumer can still require the copied proof.
			if (type && type->assumption == 0) op.copyTag = type->tag;
		} else {
			const auto expected = op.conversion == ValueMoveKind::FloatBits ? ValueTag::Float : ValueTag::Integer;
			op.conversionCheck = check(0, expected);
			if (op.conversionCheck == NativeTagCheck::Rejected) {
				invalidOperand = true;
				return;
			}
			if (op.conversionCheck == NativeTagCheck::Dynamic) facts.define(values.inputs[0], expected);
			result(expected == ValueTag::Float ? ValueTag::Integer : ValueTag::Float);
		}
	}

	std::optional<bool> truth() const {
		const auto type = input(0);
		if (!type) return std::nullopt;
		facts.require(type);
		return type->tag > ValueTag::False;
	}

	void operator()(NativeNot& op) const {
		op.sourceTruthy = truth();
		if (op.sourceTruthy)
			result(*op.sourceTruthy ? ValueTag::False : ValueTag::True);
	}

	void operator()(NativeTruthBranch& op) const { op.sourceTruthy = truth(); }

	void operator()(NativeUpvalueAccess& op) const {
		if (const auto type = input(0)) {
			facts.require(type);
			op.barrier = valueTagHasGcEdge(type->tag) ? NativeGcBarrier::Reference : NativeGcBarrier::None;
		}
	}

	void operator()(NativeTableAccess& op) const {
		op.receiverCheck = check(0, ValueTag::Table);
		if (op.receiverCheck == NativeTagCheck::Rejected) return;
		if (op.receiverCheck == NativeTagCheck::Dynamic)
			facts.define(values.inputs[0], ValueTag::Table);
		const auto key = op.keyKind == NativeTableKey::Value ? input(1) : Type{};
		if (key) {
			switch (key->tag) {
			case ValueTag::Integer: op.indexType = NativeTableIndexType::Integer; break;
			case ValueTag::String: op.indexType = NativeTableIndexType::String; break;
			case ValueTag::Table: op.indexType = NativeTableIndexType::Table; break;
			default: break;
			}
			if (op.indexType != NativeTableIndexType::Dynamic) facts.require(key);
		}
		if (op.mode == NativeTableMode::Write) {
			if (const auto type = input(2)) {
				facts.require(type);
				op.store = {valueTagHasGcEdge(type->tag) ? NativeGcBarrier::Reference : NativeGcBarrier::None,
					type->tag == ValueTag::Nil ? NativeNilValue::Nil : NativeNilValue::Present,
					type->tag == ValueTag::Nil ? NativeArrayLengthEffect::RetreatAtBoundary : NativeArrayLengthEffect::AdvanceAtBoundary};
			}
			const bool canStoreNonNil = op.store.nilValue != NativeNilValue::Nil;
			if (op.keyKind == NativeTableKey::Field)
				op.store.hash = NativeHashStore::String;
			else if (op.keyKind == NativeTableKey::Integer || op.indexType == NativeTableIndexType::Integer) {
				if (canStoreNonNil) op.store.hash = NativeHashStore::Integer;
			} else if (op.indexType == NativeTableIndexType::String)
				op.store.hash = NativeHashStore::String;
			else if (op.indexType == NativeTableIndexType::Table) {
				if (canStoreNonNil) op.store.hash = NativeHashStore::Identity;
			} else if (!key) op.store.hash = canStoreNonNil ? NativeHashStore::Index : NativeHashStore::String;
			return;
		}
		if (op.resultTag) result(*op.resultTag);
	}

	void operator()(NativeMemoryAccess& op) const {
		op.addressCheck = check(0, ValueTag::Integer);
		if (op.addressCheck == NativeTagCheck::Dynamic)
			facts.define(values.inputs[0], ValueTag::Integer);
		if (op.mode == NativeMemoryMode::Load) {
			result(op.format == MemoryAccessKind::F32LE || op.format == MemoryAccessKind::F64LE
				? ValueTag::Float : ValueTag::Integer);
		} else if (op.mode == NativeMemoryMode::Store && op.addressCheck != NativeTagCheck::Rejected) {
			op.store = wordSource(1);
		}
	}

	void operator()(NativeCallSite& op) const {
		if (inlineBuiltin) op.calleeCheck = check(0, ValueTag::BuiltinFunction);
	}

	void operator()(const NativeClearSlots&) const {
		if (values.result != NativeValueId::None) result(ValueTag::Nil);
	}

};

void NativeTypePropagation::specialize(NativeIrBlock& block, NativeSlotValues& values,
	size_t noSuccessor, size_t first, size_t count) {
	values.beginScope();
	m_facts.clear();
	for (size_t index = first; index < first + count; ++index) {
		const auto& type = m_assumptions[index].type;
		define(values.slot(type.slot), Fact{type.tag, static_cast<u32>(index + 1u)});
	}
	for (u16 row = 0; row < block.instructions.size(); ++row) {
		auto& instruction = block.instructions[row];
		const auto rowValues = values.advance(instruction, row);
		for (size_t operand = 0; operand < instruction.slots.reads.size(); ++operand) {
			const int selector = instruction.slots.reads[operand];
			if (selector < 0 && selector != NATIVE_NO_OPERAND) {
				if (const auto constant = nativeImageConstant(m_constants, -1 - selector))
					define(rowValues.inputs[operand], valueTag(*constant));
			}
		}
		Transfer transfer{*this, rowValues, block.inlineBuiltin};
		std::visit(transfer, instruction.operation);
		if (!transfer.invalidOperand) continue;
		// A proven guest fault pays for the attempted instruction, but no
		// result or native successor exists. Other public entries stay intact.
		instruction.operation = NativeInvalidOperand{};
		instruction.slots = {};
		block.instructions = block.instructions.first(row + 1u);
		block.terminal = {.exit = NativeInvalidOperand::terminalExit,
			.nextPc = instruction.pc + u32{instruction.width} * INSTRUCTION_BYTES};
		block.nativeSuccessor = false;
		block.inlineBuiltin = false;
		block.hasFusedJump = false;
		block.skippedWidth = block.fusedJumpCycles = 0;
		block.successors = {noSuccessor, noSuccessor};
		return;
	}
}

} // namespace bmsx
