#include "common/endian.h"
#include "machine/cpu/value_slots.h"
#include "machine/memory/memory.h"
#include "machine/runtime/history/ram_history.h"
#include "spec/bmsx/model.h"

#include <array>
#include <stdexcept>
#include <utility>
#include <vector>

namespace {
using namespace bmsx;

void require(bool value, const char* message) {
	if (!value) throw std::runtime_error(message);
}

struct Watches final : MappedPageInvalidator {
	int code = 0;
	void invalidateMappedWords(u64, u32, u32) override { ++code; }
	void invalidateMappedRange(u64, u64) override {}
};

void physicalByteWatchesFollowCommittedWrites() {
	Memory memory({{}, {}}, PSX_MACHINE_SPEC.ramBytes);
	Watches invalidator;
	memory.attachMappedPageInvalidator(invalidator);
	auto& groups = memory.ramWriteWatches();
	constexpr u32 page = MAPPED_PAGE_BYTE_SIZE;
	constexpr u32 boundary = MAIN_RAM_SIZE - 8u * page;
	constexpr u32 first = boundary - page - 1u, second = first + 1u, privateByte = boundary + 16u;
	memory.setRamBusEnd(RAM_BASE + boundary);
	struct Trace {
		Memory& memory;
		std::vector<std::pair<u32, u8>> writes;
	} trace{memory, {}};
	memory.attachRamWriteObserver(&trace, [](void* context, u32 offset) {
		auto& log = *static_cast<Trace*>(context);
		log.writes.emplace_back(offset, log.memory.readRamRecordByte(offset));
		if (offset == privateByte) log.memory.unwatchRamByte(offset);
	});
	memory.watchRamByte(first);
	memory.watchRamByte(second);
	memory.watchRamByte(privateByte);

	groups.armHistoryWrites();
	groups.armCodeRange(privateByte, 4u);
	memory.writeRamRecordByte(privateByte + 1u, 1);
	require(trace.writes.empty() && invalidator.code == 0
		&& groups.historyPageDirty(privateByte / page, privateByte / page + 1u),
		"a neighboring color byte dirties history without notifying a lifetime or code watch");
	memory.writeRamRecordByte(privateByte, 2);
	memory.writeRamRecordByte(privateByte, 3);
	require(trace.writes == std::vector<std::pair<u32, u8>>{{privateByte, 2}} && invalidator.code == 0,
		"private mirrored writes publish an exact watched byte and allow removal during notification");

	groups.disarmHistoryWrites();
	memory.clearMappedPageWriteWatches();
	const std::array<u8, 2> pair{4, 5};
	memory.writeBytes(RAM_BASE + first, pair.data(), pair.size());
	memory.writeMappedU8(RAM_BASE + second, 6);
	require(trace.writes == std::vector<std::pair<u32, u8>>{{privateByte, 2}, {first, 4}, {second, 5}, {second, 6}},
		"bulk and mapped writes notify committed bytes across pages independently of code and rewind watch lifetimes");

	memory.detachRamWriteObserver();
	memory.writeMappedU8(RAM_BASE + second, 7);
	require(trace.writes.size() == 4u, "detaching the observer removes all its watches");
}
}

int main() {
	physicalByteWatchesFollowCommittedWrites();
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
	require(!watches.anyWatched() && !watches.anyWatched(code, 4), "history does not act as a code watch");
	watches.armCodeRange(code, 8);
	memory.writeU32(RAM_BASE + code + 8, 7);
	require(counter.code == 0, "page write does not consume unrelated watched words");
	writeLE32(memory.ramData() + code, 1);
	memory.invalidateRamWrite(code, 4);
	require(counter.code == 1 && !watches.anyWatched(code, 4) && watches.anyWatched(code + 4, 4),
		"owner publication consumes its exact code word without consuming the adjacent watch");
	memory.writeRamRecordByte(MAIN_RAM_SIZE + code, 1);
	memory.writeU32(RAM_BASE + code + 4, 2);
	require(counter.code == 2 && !watches.anyWatched(), "history remains armed after normal and mirrored writes consume the exact code watches");
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

	constexpr u32 page = MAPPED_PAGE_BYTE_SIZE;
	constexpr u32 boundary = MAIN_RAM_SIZE - 8u * page, slots = 2u * page / sizeof(u32);
	constexpr u32 publicWord = boundary - page;
	const auto dirty = [&](u32 offset) {
		const auto index = offset >> MAPPED_PAGE_BYTE_SHIFT;
		return watches.historyPageDirty(index, index + 1u);
	};
	memory.setRamBusEnd(RAM_BASE + boundary);
	watches.armCodeRange(publicWord, 8);
	watches.armHistoryWrites();
	ValueSpan mixed(memory, publicWord, boundary + page, slots);
	mixed.set(0, valueInteger(73));
	require(counter.code == 3 && !watches.anyWatched(publicWord, 4) && watches.anyWatched(publicWord + 4u, 4),
		"the public plane retires exactly its watched word");
	require(dirty(publicWord) && dirty(boundary + page) && !dirty(boundary),
		"mixed planes dirty their own history pages, not the gap");
	watches.armHistoryWrites();
	ValueSpan privateValues(memory, boundary, boundary + 2u * page, slots);
	privateValues.set(0, valueFloatBits(0x80000000u));
	require(memory.readRamRecordWord(boundary) == 0x80000000u && counter.code == 3,
		"private payload bits do not cause code invalidations");
	require(dirty(boundary) && !dirty(boundary + page) && dirty(boundary + 2u * page),
		"both private planes dirty their exact pages");

	watches.armHistoryWrites();
	constexpr u32 privateWord = boundary + 3u * page;
	// The tag aliases one byte of the adjacent watched public instruction.
	ValueSpan tagAlias(memory, privateWord, publicWord + 5u, slots);
	tagAlias.copyFrom(privateValues, 0, 0, 1);
	require(tagAlias.get(0) == valueFloatBits(0x80000000u) && counter.code == 4 && !watches.anyWatched(publicWord + 4u, 4u),
		"a one-slot copy preserves raw float bits and consumes the tag's public word watch");
	require(dirty(privateWord) && dirty(publicWord) && !dirty(boundary + 2u * page),
		"copying consumes only the destination history pages");
}
