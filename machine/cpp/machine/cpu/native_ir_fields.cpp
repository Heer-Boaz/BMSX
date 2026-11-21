#include "machine/cpu/native_ir.h"
#include "machine/cpu/native_ir_values.h"

#include <algorithm>

namespace bmsx {
namespace {

NativeTableAccess* fixedFieldRead(NativeOperation& operation) {
	auto* access = std::get_if<NativeTableAccess>(&operation);
	return access && access->readsFixedField() ? access : nullptr;
}

bool invalidatesFieldAddresses(const NativeOperation& operation) {
	if (const auto* global = std::get_if<NativeGlobalAccess>(&operation))
		return global->access == NativeAccess::Write;
	return nativeOperationFlow(operation) != NativeOperationFlow::Linear;
}

// Only the checked, straight-line path can retain an address. Slot identity
// is the reaching definition, not the guest register or its current host
// location. Matching seeds are a profitability choice; lowering still
// admits the physical footprint and checks each consumer's live prediction.
void selectFieldAddresses(std::span<NativeInstruction> instructions, const NativeRunValues& values,
	size_t firstRow, std::span<NativeFieldAddressUse> uses) {
	std::array<u8, NATIVE_BLOCK_MAX_INSTRUCTIONS> candidates;
	std::array<u8, NATIVE_BLOCK_MAX_INSTRUCTIONS> lastUses{};
	size_t count = 0;
	for (size_t index = 0; index < instructions.size(); ++index) {
		auto& operation = instructions[index].operation;
		const auto* field = fixedFieldRead(operation);
		if (!field) {
			if (invalidatesFieldAddresses(operation)) count = 0;
			continue;
		}
		uses[index] = {static_cast<u8>(firstRow + index)};
		if (field->predictedSlot < 0) {
			count = 0;
			continue;
		}
		const auto receiver = values.inputs(index)[0];
		if (receiver.producer == NativeValueOrigin::Unknown) continue;
		const auto available = std::span(candidates).first(count);
		const auto same = std::ranges::find_if(available, [&](u8 definingRow) {
			const auto& prior = std::get<NativeTableAccess>(instructions[definingRow].operation);
			return values.inputs(definingRow)[0] == receiver && prior.key == field->key
				&& prior.predictedSlot == field->predictedSlot;
		});
		if (same == available.end()) candidates[count++] = static_cast<u8>(index);
		else {
			uses[index].definition = static_cast<u8>(firstRow + *same);
			lastUses[*same] = static_cast<u8>(index);
		}
	}

	int inlineThrough = -1;
	std::array<int, NATIVE_OWN_FIELD_TEMPORARIES> temporaryEnds;
	temporaryEnds.fill(-1);
	for (size_t index = 0; index < instructions.size(); ++index) {
		auto* field = fixedFieldRead(instructions[index].operation);
		if (!field) continue;
		auto& use = uses[index];
		if (lastUses[index] > index) {
			const auto temporary = std::ranges::find_if(temporaryEnds, [index](int end) { return end < static_cast<int>(index); });
			if (temporary != temporaryEnds.end()) {
				*temporary = lastUses[index];
				use.temporary = static_cast<u8>(temporary - temporaryEnds.begin());
				inlineThrough = std::max(inlineThrough, *temporary);
			}
		}
		if (const size_t definition = use.definition - firstRow; definition != index && !uses[definition].temporary)
			use.definition = static_cast<u8>(firstRow + index);
		field->ownFieldOnly = field->resultTag.has_value() || static_cast<int>(index) <= inlineThrough;
	}
}

} // namespace

size_t planNativeFieldReads(std::span<NativeInstruction> instructions, NativeCompilationTier tier,
	std::span<NativeFieldAddressUse> addressUses) {
	const auto first = std::ranges::find_if(instructions,
		[](NativeInstruction& instruction) { return fixedFieldRead(instruction.operation); });
	if (first == instructions.end()) return instructions.size();

	const auto prefix = static_cast<size_t>(first - instructions.begin());
	auto tail = instructions.subspan(prefix);
	const NativeRunValues values(tail);
	struct Selection {
		u16 consumer = NativeValueOrigin::Input;
		ValueTag tag = ValueTag::Nil;
	};
	std::array<Selection, NATIVE_BLOCK_MAX_INSTRUCTIONS> selections;
	size_t frontier = 0;
	size_t cut = tail.size();
	const auto select = [&](size_t index, NativeValueOrigin origin, ValueTag tag) {
		if (origin.producer < frontier || origin.producer >= index) return;
		auto* field = fixedFieldRead(tail[origin.producer].operation);
		if (auto& candidate = selections[origin.producer];
			field && field->predictedSlot >= 0 && candidate.consumer == NativeValueOrigin::Input)
			candidate = {static_cast<u16>(index), tag};
	};
	for (size_t index = 0; index < cut; ++index) {
		auto& operation = tail[index].operation;
		// Fixed-key loads can each acquire a checked fast path. Other
		// checkpoints delimit the native path used by this optimization.
		if (fixedFieldRead(operation)) {
			select(index, values.inputs(index)[0], ValueTag::Table);
			continue;
		}
		if (invalidatesFieldAddresses(operation)) {
			frontier = index + 1;
			continue;
		}
		const auto* arithmetic = std::get_if<NativeArithmetic>(&operation);
		if (!arithmetic || (arithmetic->operation != OpCode::ADD && arithmetic->operation != OpCode::SUB
			&& arithmetic->operation != OpCode::MUL)) continue;
		const auto& hint = std::get<NativeArithmeticHint>(arithmetic->strategy);
		const auto& inputs = values.inputs(index);
		for (size_t operand = 0; operand < 2; ++operand) {
			const auto origin = inputs[operand];
			if (origin.producer < frontier || origin.producer >= index) continue;
			auto* field = fixedFieldRead(tail[origin.producer].operation);
			if (!field) continue;
			if (tier == NativeCompilationTier::ColdImage && !hint.observed)
				cut = std::min<size_t>(cut, origin.producer);
			else if (hint.feedback)
				select(index, origin, operand == 0 ? hint.feedback->left : hint.feedback->right);
		}
	}
	for (size_t producer = 0; producer < cut; ++producer)
		if (selections[producer].consumer < cut)
			std::get<NativeTableAccess>(tail[producer].operation).resultTag = selections[producer].tag;
	selectFieldAddresses(tail.first(cut), values, prefix, addressUses.subspan(prefix, cut));
	return prefix + cut;
}

void NativeIrRegion::bindOwnFieldAddresses(NativeIrBlock& block, std::span<const NativeFieldAddressUse> uses, size_t firstRow) {
	const size_t firstAddress = m_ownFieldAddresses.size();
	for (size_t row = 0; row < block.instructions.size(); ++row) {
		auto* field = fixedFieldRead(block.instructions[row].operation);
		if (!field) continue;
		const auto& use = uses[row];
		const size_t definition = use.definition - firstRow;
		if (definition == row) {
			if (m_ownFieldAddresses.capacity() == 0) m_ownFieldAddresses.reserve(m_instructions.capacity());
			field->ownFieldAddress = static_cast<NativeOwnFieldAddressId>(m_ownFieldAddresses.size() - firstAddress);
			m_ownFieldAddresses.push_back({static_cast<u8>(row), field->receiver, static_cast<u16>(field->key), use.temporary});
		} else {
			field->ownFieldAddress = std::get<NativeTableAccess>(block.instructions[definition].operation).ownFieldAddress;
		}
	}
	block.ownFieldAddresses = std::span(m_ownFieldAddresses).subspan(firstAddress);
}

} // namespace bmsx
