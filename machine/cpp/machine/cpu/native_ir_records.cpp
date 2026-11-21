#include "machine/cpu/native_ir.h"

#include <algorithm>

#include "machine/memory/mapped_page.h"
#include "spec/blua32/instruction_format.h"

namespace bmsx {
namespace {

// Follow only the sequence represented by the current compilation. The
// ordinary entries stay available for other predecessors and shorter grants.
bool collectRecordFields(std::span<const u16> successors, std::span<const NativeIrBlock> blocks,
	std::span<const NativeIrExit> exits, const NativeTableAllocation& allocation,
	u32 pagePc, NativeRecordPlan& record) {
	auto entry = successors.begin();
	for (u32 field = 0; field < record.count; ++field) {
		// An independent entry at a WIDE body isn't on this fallthrough.
		while (entry != successors.end() && blocks[*entry].instructions.front().before.pc < record.nextPc) ++entry;
		if (entry == successors.end()) return false;
		const auto& block = blocks[*entry++];
		const auto& inst = block.instructions.front();
		const auto* store = std::get_if<NativeTableAccess>(&inst.operation);
		if (inst.before.pc != record.nextPc || !store || store->mode != NativeTableMode::Write
			|| store->keyKind != NativeTableKey::Field || store->receiver != allocation.result
			|| store->value == allocation.result) return false;
		// A decoded WIDE head at the page tail does not make its body immutable.
		const auto& checked = exits[block.firstSideExit + *inst.slow];
		if (checked.lastPc - pagePc >= MAPPED_PAGE_BYTE_SIZE) return false;
		const auto key = static_cast<u16>(store->key);
		const auto end = record.keySelectors.begin() + field;
		if (std::find(record.keySelectors.begin(), end, key) != end) return false;
		record.keySelectors[field] = key;
		record.operands[field] = store->value;
		if (store->value >= 0)
			record.requiredSlots = std::max(record.requiredSlots, static_cast<u32>(store->value) + 1u);
		record.lastInstructionPc = inst.before.pc;
		record.lastWordPc = checked.lastPc;
		record.nextPc = checked.nextPc;
	}
	return true;
}

} // namespace

void NativeIrRegion::planRecordConstructors(std::span<const u16> byAddress, u32 immutablePagePc) {
	for (size_t index = 0; index < byAddress.size(); ++index) {
		auto& entry = m_blocks[byAddress[index]];
		auto* allocation = std::get_if<NativeTableAllocation>(&entry.instructions.back().operation);
		if (!allocation || allocation->arraySize != 0 || entry.terminal.lastPc - immutablePagePc >= MAPPED_PAGE_BYTE_SIZE)
			continue;
		const auto count = static_cast<u32>(allocation->hashSize);
		if (count < 2 || count > TABLE_RECORD_FIELDS_MAX || count >= byAddress.size() - index) continue;

		NativeRecordPlan record;
		record.count = count;
		record.requiredSlots = static_cast<u32>(allocation->result) + 1u;
		record.nextPc = entry.terminal.nextPc;
		if (!collectRecordFields(byAddress.subspan(index + 1), m_blocks, m_sideExits, *allocation, immutablePagePc, record))
			continue;
		entry.sourceWords = std::max(entry.sourceWords, static_cast<u16>((record.nextPc - entry.firstPc) / INSTRUCTION_BYTES));
		allocation->record = static_cast<NativeRecordId>(m_records.size());
		m_records.push_back(std::move(record));
	}
}

} // namespace bmsx
