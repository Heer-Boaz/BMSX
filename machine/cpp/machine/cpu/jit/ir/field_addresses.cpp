#include "machine/cpu/jit/ir/region.h"
#include "machine/cpu/jit/ir/value_flow.h"
#include "machine/memory/mapped_page.h"

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
void selectFieldAddresses(std::span<NativeInstruction> instructions, std::span<const NativeBlockInstruction> source,
	std::span<const NativeRowValues> rows, const NativeSlotValues& values, size_t firstRow, std::span<NativeFieldAddressUse> uses) {
	std::array<u8, NATIVE_BLOCK_MAX_INSTRUCTIONS> candidates;
	std::array<u8, NATIVE_BLOCK_MAX_INSTRUCTIONS> lastUses{};
	size_t count = 0, addressFloor = 0;
	const auto pageWord = [&](size_t row) { return static_cast<u16>((source[row].pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES); };
	for (size_t index = 0; index < instructions.size(); ++index) {
		auto& operation = instructions[index].operation;
		auto* field = fixedFieldRead(operation);
		if (!field) {
			if (invalidatesFieldAddresses(operation)) count = 0;
			continue;
		}
		uses[index] = {static_cast<u8>(firstRow + index)};
		const bool hasSlot = field->predictedSlot >= 0;
		if (!hasSlot) addressFloor = index + 1;
		const auto receiver = rows[index].inputs[0];
		if (values.origin(receiver).producer == NativeValueOrigin::Opaque) continue;
		std::optional<u8> reuse, learn;
		for (const u8 row : std::span(candidates).first(count)) {
			auto& prior = std::get<NativeTableAccess>(instructions[row].operation);
			if (rows[row].inputs[0] != receiver || prior.key != field->key) continue;
			if (row >= addressFloor && hasSlot && prior.predictedSlot == field->predictedSlot) {
				reuse = row;
				break;
			}
			if (!hasSlot || prior.predictedSlot < 0) learn = row;
		}
		if (reuse) {
			uses[index].definition = static_cast<u8>(firstRow + *reuse);
			lastUses[*reuse] = static_cast<u8>(index);
			continue;
		}
		if (learn) {
			// A cold pair keeps ordinary checkpointed reads. Request
			// reprojection only when the owning slots establish reuse.
			auto& peer = std::get<NativeTableAccess>(instructions[*learn].operation);
			if (!hasSlot) field->reusePeerWord = pageWord(*learn);
			if (peer.predictedSlot < 0 && !peer.reusePeerWord) peer.reusePeerWord = pageWord(index);
		}
		candidates[count++] = static_cast<u8>(index);
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

void planNativeFieldReads(std::span<NativeInstruction> instructions, std::span<const NativeBlockInstruction> source,
	NativeSlotValues& values, std::span<NativeFieldAddressUse> addressUses, NativeCompileSpecializations specializations) {
	const auto first = std::ranges::find_if(instructions,
		[](NativeInstruction& instruction) { return fixedFieldRead(instruction.operation); });
	if (first == instructions.end()) return;

	const auto prefix = static_cast<size_t>(first - instructions.begin());
	auto tail = instructions.subspan(prefix);
	std::array<NativeRowValues, NATIVE_BLOCK_MAX_INSTRUCTIONS> rowStorage;
	auto rows = std::span(rowStorage).first(tail.size());
	values.beginScope();
	for (u16 row = 0; row < rows.size(); ++row)
		rows[row] = values.advance(tail[row], row);
	struct Selection {
		u16 consumer = NativeValueOrigin::Entry;
		ValueTag tag = ValueTag::Nil;
	};
	std::array<Selection, NATIVE_BLOCK_MAX_INSTRUCTIONS> selections;
	size_t frontier = 0;
	const auto select = [&](size_t index, NativeValueOrigin origin, ValueTag tag) {
		if (origin.producer < frontier || origin.producer >= index) return;
		auto* field = fixedFieldRead(tail[origin.producer].operation);
		auto& candidate = selections[origin.producer];
		if (!field || field->predictedSlot < 0 || candidate.consumer != NativeValueOrigin::Entry) return;
		const u32 pc = source[prefix + origin.producer].pc;
		const auto rejected = std::ranges::equal_range(specializations.rejectedFieldProofs, pc, {}, &NativeRejectedFieldProof::pc);
		if (std::ranges::find(rejected, tag, &NativeRejectedFieldProof::tag) == rejected.end())
			candidate = {static_cast<u16>(index), tag};
	};
	for (size_t index = 0; index < tail.size(); ++index) {
		auto& operation = tail[index].operation;
		// Fixed-key loads can each acquire a checked fast path. Other
		// checkpoints delimit the native path used by this optimization.
		if (fixedFieldRead(operation)) {
			select(index, values.origin(rows[index].inputs[0]), ValueTag::Table);
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
		if (!hint.feedback) continue;
		const auto& inputs = rows[index].inputs;
		select(index, values.origin(inputs[0]), hint.feedback->left);
		select(index, values.origin(inputs[1]), hint.feedback->right);
	}
	for (size_t producer = 0; producer < tail.size(); ++producer)
		if (selections[producer].consumer != NativeValueOrigin::Entry)
			std::get<NativeTableAccess>(tail[producer].operation).resultTag = selections[producer].tag;
	selectFieldAddresses(tail, source.subspan(prefix), rows, values, prefix, addressUses.subspan(prefix, tail.size()));
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
