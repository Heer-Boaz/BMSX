#include "machine/cpu/native_ir.h"

#include <algorithm>

#include "machine/cpu/native_table_constructor.h"
#include "machine/cpu/table.h"
#include "machine/memory/mapped_page.h"
#include "spec/blua32/instruction_format.h"

namespace bmsx {
namespace {

// Follow only the sequence represented by the current compilation. The
// ordinary entries stay available for other predecessors and shorter grants.
bool collectRecordFields(std::span<const u16> successors, std::span<const NativeIrBlock> blocks,
	const NativeTableAllocation& allocation, ConstValueSpan constants, u32 pagePc, NativeTableConstructor& record) {
	auto entry = successors.begin();
	for (u32 field = 0; field < record.count; ++field) {
		// An independent entry at a WIDE body isn't on this fallthrough.
		while (entry != successors.end() && blocks[*entry].instructions.front().before.pc < record.nextPc) ++entry;
		if (entry == successors.end()) return false;
		const auto& inst = blocks[*entry++].instructions.front();
		const auto* store = std::get_if<NativeTableAccess>(&inst.operation);
		if (inst.before.pc != record.nextPc || !store || store->mode != NativeTableMode::Write
			|| store->keyKind != NativeTableKey::Field || store->receiver != allocation.result
			|| store->value == allocation.result || constants.tag(store->key) != ValueTag::String) return false;
		// A decoded WIDE head at the page tail does not make its body immutable.
		if (inst.slow->lastPc - pagePc >= MAPPED_PAGE_BYTE_SIZE) return false;
		const StringId key = constants.payload(store->key);
		const auto end = record.keys.begin() + field;
		if (std::find(record.keys.begin(), end, key) != end) return false;
		record.keys[field] = key;
		record.operands[field] = store->value;
		if (store->value >= 0)
			record.requiredSlots = std::max(record.requiredSlots, static_cast<u32>(store->value) + 1u);
		record.lastInstructionPc = inst.before.pc;
		record.lastWordPc = inst.slow->lastPc;
		record.nextPc = inst.slow->nextPc;
	}
	return true;
}

} // namespace

void NativeIrRegion::planRecordConstructors(std::span<const u16> byAddress, u32 immutablePagePc, ConstValueSpan constants) {
	for (size_t index = 0; index < byAddress.size(); ++index) {
		const size_t entryIndex = byAddress[index];
		auto& entry = *entries[entryIndex];
		const auto& inst = m_blocks[entryIndex].instructions.back();
		const auto* allocation = std::get_if<NativeTableAllocation>(&inst.operation);
		if (!allocation || allocation->arraySize != 0 || entry.terminal.lastPc - immutablePagePc >= MAPPED_PAGE_BYTE_SIZE)
			continue;
		const auto count = static_cast<u32>(allocation->hashSize);
		if (count < 2 || count > TABLE_RECORD_FIELDS_MAX || count >= byAddress.size() - index) continue;

		NativeTableConstructor record;
		record.count = count;
		record.requiredSlots = static_cast<u32>(allocation->result) + 1u;
		record.nextPc = entry.terminal.nextPc;
		if (!collectRecordFields(byAddress.subspan(index + 1), m_blocks, *allocation, constants, immutablePagePc, record))
			continue;
		record.full = TableRecord::planStringRecord(std::span(record.keys).first(count), (1u << count) - 1u);
		entry.sourceWords = std::max(entry.sourceWords, static_cast<u16>((record.nextPc - entry.firstPc) / INSTRUCTION_BYTES));
		entry.terminal.recordConstructor = new NativeTableConstructor(std::move(record));
	}
}

} // namespace bmsx
