#include "machine/devices/cartridge/card.h"
#include "machine/devices/cartridge/signals.h"
#include "spec/bmsx/cartridge.h"
#include "spec/bmsx/memory_map.h"

#include <array>
#include <stdexcept>
#include <tuple>
#include <utility>
#include <vector>

namespace {

constexpr bmsx::u64 MAPPED_KEY_OFFSET = 1ull << 32u;

void require(bool condition, const char* message) {
	if (!condition) {
		throw std::runtime_error(message);
	}
}

class RecordingInvalidator final : public bmsx::MappedPageInvalidator {
public:
	void invalidateMappedWords(bmsx::u64 key, bmsx::u32 firstWord, bmsx::u32 endWord) override {
		writes.emplace_back(key, firstWord, endWord);
	}

	void invalidateMappedRange(bmsx::u64 firstKey, bmsx::u64 endKey) override {
		ranges.emplace_back(firstKey, endKey);
	}

	std::vector<std::tuple<bmsx::u64, bmsx::u32, bmsx::u32>> writes;
	std::vector<std::pair<bmsx::u64, bmsx::u64>> ranges;
};

struct CardFixture {
	std::array<bmsx::u8, 2048> rom{};
	bmsx::CartridgeCard card;

	CardFixture()
		: card(bmsx::CartridgeCardMedia{rom, 2048u, true}, MAPPED_KEY_OFFSET) {}
};

void testDirectMappedPagesAndSocketLocalKeys() {
	CardFixture fixture;
	fixture.rom[0] = 0x44u;
	fixture.rom[1] = 0x33u;
	fixture.rom[2] = 0x22u;
	fixture.rom[3] = 0x11u;
	RecordingInvalidator invalidator;
	fixture.card.attachMappedPageInvalidator(invalidator);

	bmsx::MappedPageBinding romBinding{};
	fixture.card.bindMappedPage(bmsx::CART_ROM_BASE, romBinding);
	require(romBinding.key == MAPPED_KEY_OFFSET + bmsx::CART_ROM_BASE, "ROM key includes the physical socket offset");
	require(romBinding.cacheable, "ROM page is cacheable");
	require(romBinding.readBytes == fixture.rom.data(), "ROM page binds the card bytes directly");

	bmsx::MappedPageBinding ramBinding{};
	fixture.card.bindMappedPage(bmsx::CART_RAM_BASE, ramBinding);
	require(ramBinding.key == MAPPED_KEY_OFFSET + bmsx::CART_RAM_BASE, "RAM key includes the physical socket offset");
	require(ramBinding.cacheable, "RAM page is cacheable");
	require(ramBinding.readBytes != nullptr, "RAM page binds the card RAM directly");
	require(ramBinding.writeWatch.groups != nullptr, "RAM page exposes its write watch");
	ramBinding.writeWatch.armWord(0u);
	ramBinding.writeWatch.armWord(8u);
	fixture.card.writeU32(bmsx::CART_RAM_BASE, 0xaabbccddu);
	require(fixture.card.readU32(bmsx::CART_RAM_BASE) == 0xaabbccddu, "RAM scalar datapath sees the mapped bytes");
	require(invalidator.writes.size() == 1u, "watched RAM write reports its word range once");
	require(invalidator.writes[0] == std::tuple{MAPPED_KEY_OFFSET + bmsx::CART_RAM_BASE, 0u, 1u}, "RAM write uses the socket-local key and containing word span");

	fixture.card.writeU32(bmsx::CART_RAM_BASE, 0x55667788u);
	require(invalidator.writes.size() == 1u, "an already invalidated source word needs no repeated callback");
	fixture.card.writeU16(bmsx::CART_RAM_BASE + 8u * 4u, 0x1234u);
	require(invalidator.writes.size() == 2u, "partial invalidation retains the watch for other decoded starts");
	fixture.card.clearMappedPageWriteWatches();
	fixture.card.writeU8(bmsx::CART_RAM_BASE, 0x99u);
	require(invalidator.writes.size() == 2u, "the memory owner can clear all code watches");
}

void testMappedWriteRangesRetainAllTouchedWatches() {
	using namespace bmsx;
	MappedPageWriteWatches watches(3u * MAPPED_PAGE_BYTE_SIZE);
	for (u32 page = 0; page < 3u; ++page) {
		MappedPageBinding binding{};
		watches.bind(page * MAPPED_PAGE_BYTE_SIZE, binding);
		binding.writeWatch.armWord(0u);
		binding.writeWatch.armWord(MAPPED_PAGE_BYTE_SIZE / 4u - 1u);
	}
	RecordingInvalidator invalidator;
	watches.invalidateWrite(MAPPED_PAGE_BYTE_SIZE - 3u, MAPPED_PAGE_BYTE_SIZE + 7u, MAPPED_KEY_OFFSET, &invalidator);
	require(invalidator.writes == decltype(invalidator.writes){
		{MAPPED_KEY_OFFSET, 255u, 256u},
		{MAPPED_KEY_OFFSET + MAPPED_PAGE_BYTE_SIZE, 0u, 256u},
		{MAPPED_KEY_OFFSET + 2u * MAPPED_PAGE_BYTE_SIZE, 0u, 1u},
	}, "a spanning write emits each page's containing source-word window");
	watches.invalidateWrite(1u, 2u, MAPPED_KEY_OFFSET, &invalidator);
	require(invalidator.writes.back() == std::tuple{MAPPED_KEY_OFFSET, 0u, 1u}, "even a second partial write before re-decode remains visible");
	watches.clear();
	watches.invalidateWrite(0u, 3u * MAPPED_PAGE_BYTE_SIZE, MAPPED_KEY_OFFSET, &invalidator);
	require(invalidator.writes.size() == 4u, "cleared watches produce no invalidations");
}

void testEveryMappedSourceWordConsumesOnlyItsOwnBytes() {
	using namespace bmsx;
	MappedPageWriteWatches watches(MAPPED_PAGE_BYTE_SIZE);
	MappedPageBinding binding{};
	watches.bind(0u, binding);
	RecordingInvalidator invalidator;
	for (u32 word = 0; word < MAPPED_PAGE_BYTE_SIZE / 4u; ++word) {
		for (i32 delta : {-5, -1, 0, 3, 4}) for (u32 length : {1u, 2u, 4u, 8u}) {
			const i32 firstByte = static_cast<i32>(word * 4u) + delta;
			if (firstByte < 0 || static_cast<u32>(firstByte) + length > MAPPED_PAGE_BYTE_SIZE) continue;
			watches.clear();
			binding.writeWatch.armWord(word);
			invalidator.writes.clear();
			watches.invalidateWrite(firstByte, length, MAPPED_KEY_OFFSET, &invalidator);
			const bool overlaps = static_cast<u32>(firstByte) < (word + 1u) * 4u
				&& static_cast<u32>(firstByte) + length > word * 4u;
			require(invalidator.writes.size() == (overlaps ? 1u : 0u), "word watches test only the changed bytes, including group edges");
			if (overlaps) require(invalidator.writes[0] == std::tuple{MAPPED_KEY_OFFSET,
				static_cast<u32>(firstByte) >> 2u, (static_cast<u32>(firstByte) + length + 3u) >> 2u}, "the producer emits the exact containing word span for every byte window");
			watches.invalidateWrite(firstByte, length, MAPPED_KEY_OFFSET, &invalidator);
			require(invalidator.writes.size() == (overlaps ? 1u : 0u), "consumed word bits do not trigger repeated invalidation");
			watches.invalidateWrite(word * 4u, 1u, MAPPED_KEY_OFFSET, &invalidator);
			require(invalidator.writes.size() == 1u, "unaffected source words remain armed until written");
		}
	}
}

void testSingleWordConsumptionRetainsOtherGroups() {
	using namespace bmsx;
	MappedPageWriteWatches watches(MAPPED_PAGE_BYTE_SIZE);
	MappedPageBinding binding{};
	watches.bind(0u, binding);
	for (u32 word : {30u, 31u, 32u, 63u, 64u, 255u}) binding.writeWatch.armWord(word);
	RecordingInvalidator invalidator;
	for (u32 word : {31u, 30u, 32u, 64u, 63u, 255u}) {
		const size_t before = invalidator.writes.size();
		watches.invalidateWrite(word * 4u + 3u, 1u, MAPPED_KEY_OFFSET, &invalidator);
		require(invalidator.writes.size() == before + 1u && invalidator.writes.back() == std::tuple{MAPPED_KEY_OFFSET, word, word + 1u}, "single-word consumption keeps every other group and the high mask bit armed");
		watches.invalidateWrite(word * 4u, 4u, MAPPED_KEY_OFFSET, &invalidator);
		require(invalidator.writes.size() == before + 1u, "a consumed single-word watch does not fire again");
	}
}

void testRomInstallAndRamRestoreInvalidateOwnedRegions() {
	CardFixture fixture;
	RecordingInvalidator invalidator;
	fixture.card.attachMappedPageInvalidator(invalidator);
	std::array<bmsx::u8, 2048> replacement{};
	replacement[0] = 0xefu;
	replacement[1] = 0xcdu;
	replacement[2] = 0xabu;
	replacement[3] = 0x89u;
	fixture.card.installRom(replacement);
	require(invalidator.ranges.size() == 1u, "ROM install invalidates one range");
	require(invalidator.ranges[0].first == MAPPED_KEY_OFFSET + bmsx::CART_ROM_BASE, "ROM invalidation starts at the socket ROM key");
	require(invalidator.ranges[0].second == MAPPED_KEY_OFFSET + bmsx::CART_ROM_END, "ROM invalidation covers the complete aperture");
	require(fixture.card.readU32(bmsx::CART_ROM_BASE) == 0x89abcdefu, "ROM install replaces the card span");

	bmsx::CartridgeCardState state = fixture.card.captureState();
	(*state.ram)[0] = 0x78u;
	(*state.ram)[1] = 0x56u;
	(*state.ram)[2] = 0x34u;
	(*state.ram)[3] = 0x12u;
	fixture.card.restoreState(state);
	require(invalidator.ranges.size() == 2u, "RAM restore invalidates one additional range");
	require(invalidator.ranges[1].first == MAPPED_KEY_OFFSET + bmsx::CART_RAM_BASE, "RAM restore starts at the socket RAM key");
	require(invalidator.ranges[1].second == MAPPED_KEY_OFFSET + bmsx::CART_RAM_BASE + 2048u, "RAM restore covers installed RAM only");
	require(fixture.card.readU32(bmsx::CART_RAM_BASE) == 0x12345678u, "RAM restore writes card-owned state");
}

void testMailboxRegistersSignalsAndState() {
	CardFixture fixture;
	const bmsx::u32 controlAddress = bmsx::CART_MMIO_BASE
		+ bmsx::CARTRIDGE_MAILBOX_CONTROL_OFFSET;
	const bmsx::u32 statusAddress = bmsx::CART_MMIO_BASE
		+ bmsx::CARTRIDGE_MAILBOX_STATUS_OFFSET;
	fixture.card.writeU32(
		bmsx::CART_MMIO_BASE + bmsx::CARTRIDGE_MAILBOX_DATA_OFFSET,
		0x11223344u
	);
	const bmsx::u32 firstEffects = fixture.card.writeU32(
		controlAddress,
		0x80000000u
			| bmsx::CARTRIDGE_MAILBOX_CONTROL_DREQ_READ
			| bmsx::CARTRIDGE_MAILBOX_CONTROL_IRQ_TRIGGER
	);
	require(
		firstEffects == (bmsx::CARTRIDGE_CARD_EFFECT_DREQ_CHANGED
			| bmsx::CARTRIDGE_CARD_EFFECT_IRQ_EDGE),
		"first control write reports the DREQ transition and IRQ edge"
	);
	require(
		fixture.card.readU32(controlAddress)
			== (0x80000000u | bmsx::CARTRIDGE_MAILBOX_CONTROL_DREQ_READ),
		"mailbox retains raw high control bits but not the IRQ strobe"
	);
	require(fixture.card.readU32(statusAddress) == bmsx::CARTRIDGE_MAILBOX_STATUS_IRQ_PENDING, "mailbox exposes its source latch");
	require(fixture.card.dreqLines() == bmsx::CARTRIDGE_CARD_DREQ_READ, "mailbox exposes its local read request line");
	require(
		fixture.card.writeU32(
			controlAddress,
			bmsx::CARTRIDGE_MAILBOX_CONTROL_DREQ_READ
				| bmsx::CARTRIDGE_MAILBOX_CONTROL_IRQ_TRIGGER
		) == 0u,
		"repeated strobe before local acknowledgement has no second edge"
	);

	fixture.card.writeU32(
		bmsx::CART_MMIO_BASE + bmsx::CARTRIDGE_MAILBOX_IRQ_ACK_OFFSET,
		1u
	);
	require(fixture.card.readU32(statusAddress) == 0u, "local acknowledgement clears the mailbox source latch");
	require(
		fixture.card.writeU32(
			controlAddress,
			bmsx::CARTRIDGE_MAILBOX_CONTROL_DREQ_READ
				| bmsx::CARTRIDGE_MAILBOX_CONTROL_IRQ_TRIGGER
		) == bmsx::CARTRIDGE_CARD_EFFECT_IRQ_EDGE,
		"strobe after local acknowledgement produces a new edge"
	);

	fixture.card.writeU32(bmsx::CART_RAM_BASE, 0xdeadbeefu);
	fixture.card.reset();
	require(fixture.card.readU32(bmsx::CART_RAM_BASE) == 0xdeadbeefu, "reset preserves cartridge RAM");
	require(fixture.card.readU32(bmsx::CART_MMIO_BASE + bmsx::CARTRIDGE_MAILBOX_DATA_OFFSET) == 0u, "reset clears mailbox data");
	require(fixture.card.dreqLines() == 0u, "reset clears mailbox request lines");
}

void testRomOnlyStateHasNoSyntheticDevices() {
	const std::array<bmsx::u8, 0> rom{};
	const bmsx::CartridgeCard card(
		bmsx::CartridgeCardMedia{rom, std::nullopt, false},
		MAPPED_KEY_OFFSET
	);
	const bmsx::CartridgeCardState state = card.captureState();
	require(!state.ram.has_value(), "ROM-only card has no synthetic RAM");
	require(!state.mailbox.has_value(), "ROM-only card has no synthetic mailbox state");
}

void testRamOnlyCardLeavesRomApertureUnbacked() {
	const bmsx::CartridgeCard card(
		bmsx::CartridgeCardMedia{std::nullopt, 16u, false},
		MAPPED_KEY_OFFSET
	);
	bmsx::Span<const bmsx::u8> view;
	require(card.readU32(bmsx::CART_ROM_BASE) == 0u, "RAM-only card leaves the ROM aperture unbacked");
	require(!card.bindRomByteView(bmsx::CART_ROM_BASE, 4u, view), "RAM-only card has no direct ROM byte view");
	require(card.readU32(bmsx::CART_RAM_BASE) == 0u, "RAM-only card still owns its RAM aperture");
}

} // namespace

int main() {
	testDirectMappedPagesAndSocketLocalKeys();
	testMappedWriteRangesRetainAllTouchedWatches();
	testEveryMappedSourceWordConsumesOnlyItsOwnBytes();
	testSingleWordConsumptionRetainsOtherGroups();
	testRomInstallAndRamRestoreInvalidateOwnedRegions();
	testMailboxRegistersSignalsAndState();
	testRomOnlyStateHasNoSyntheticDevices();
	testRamOnlyCardLeavesRomApertureUnbacked();
	return 0;
}
