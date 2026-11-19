#include "common/endian.h"
#include "machine/memory/memory.h"
#include "machine/runtime/history/ram_history.h"
#include "spec/bmsx/model.h"

#include <array>
#include <stdexcept>

namespace {
using namespace bmsx;

void require(bool value, const char* message) {
	if (!value) throw std::runtime_error(message);
}

struct Watches final : MappedPageInvalidator {
	int code = 0, views = 0;
	void invalidateMappedWords(u64, u32, u32) override { ++code; }
	void invalidateMappedRange(u64, u64) override {}
	void invalidateMappedViews(u64, u32, u32) override { ++views; }
};
}

int main() {
	const std::array<u8, 8> rom{1, 2, 3, 4, 5, 6, 7, 8};
	Memory memory({rom, {}}, PSX_MACHINE_SPEC.ramBytes);
	Watches counter;
	memory.attachMappedPageInvalidator(counter);
	auto& watches = memory.ramWriteWatches();
	RamHistory archive;
	RamHistory::PageMap first, second, branch;
	archive.capture(memory, nullptr, first);
	memory.clearMappedPageWriteWatches();
	constexpr u32 code = DYNAMIC_RAM_BASE - RAM_BASE + 0x80u;
	constexpr u32 dma = DYNAMIC_RAM_BASE - RAM_BASE + 0x3ffcu;
	constexpr u32 mirror = DYNAMIC_RAM_BASE - RAM_BASE + 0x71f0u;
	require(!watches.anyWatched() && !watches.anyWatched(code, 4), "history does not act as a code or view watch");
	watches.armCodeRange(code, 4);
	memory.armRamViewWord(code);
	memory.armRamViewWord(code + 4);
	memory.writeU32(RAM_BASE + code + 8, 7);
	require(counter.code == 0 && counter.views == 0, "page write does not consume unrelated watched words");
	writeLE32(memory.ramData() + code, 1);
	memory.invalidateRamWrite(code, 4, false);
	require(counter.code == 1 && counter.views == 0 && !watches.anyWatched(code, 4, false) && watches.anyWatched(code, 4),
		"owner publication consumes the code word without consuming its armed view");
	memory.writeRamRecordByte(MAIN_RAM_SIZE + code, 1);
	memory.writeU32(RAM_BASE + code + 4, 2);
	require(counter.code == 1 && counter.views == 2 && !watches.anyWatched(), "normal and mirrored writes still invalidate their exact views");
	memory.transferDmaBlock(0, RAM_BASE + dma, 2, 4, 4, MAPPED_BUS_MASTER_DMA, MAPPED_BUS_MASTER_DMA);
	memory.writeRamRecordByte(MAIN_RAM_SIZE + mirror, 9);
	archive.capture(memory, &first, second);
	for (size_t index = 0; index < first.size(); ++index) {
		const bool written = index == code / 4096 || index == dma / 4096 || index == (dma + 4) / 4096 || index == mirror / 4096;
		require((first[index] != second[index]) == written, "only physical pages written by each port are copied");
	}
	archive.restore(memory, second, first);
	require(memory.readRamRecordWord(dma) == 0 && memory.readRamRecordWord(dma + 4) == 0 && memory.readRamRecordByte(mirror) == 0,
		"DMA and the mirrored record write are undone");
	memory.writeRamRecordWord(code, 3);
	archive.capture(memory, &first, branch);
	require(branch[dma / 4096] == first[dma / 4096], "branch shares with the installed checkpoint, not the discarded future");
	archive.restore(memory, branch, second);
	require(memory.readRamRecordWord(code) == 1 && memory.readRamRecordWord(dma) == 0x04030201u
		&& memory.readRamRecordWord(dma + 4) == 0x08070605u && memory.readRamRecordByte(mirror) == 9,
		"the old future kept its independent page versions");
	memory.writeRamRecordWord(code, 4);
	archive.capture(memory, &second, second); // Reuse even if the ring has just one slot.
	archive.restore(memory, second, branch);
	require(memory.readRamRecordWord(code) == 3, "recycling a dirty slot did not mutate another branch");
	archive.restore(memory, branch, second);
	require(memory.readRamRecordWord(code) == 4, "the recycled slot is independently restorable");
	watches.disarmHistoryWrites();
	require(watches.groupData()[code >> MAPPED_PAGE_BYTE_SHIFT] == 0, "stopping rewind removes the write admission");
}
