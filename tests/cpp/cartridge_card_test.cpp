#include "machine/devices/cartridge/card.h"
#include "machine/devices/cartridge/signals.h"
#include "spec/bmsx/cartridge.h"
#include "spec/bmsx/memory_map.h"

#include <array>
#include <stdexcept>
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
	void invalidateMappedPage(bmsx::u64 key) override {
		pages.push_back(key);
	}

	void invalidateMappedRange(bmsx::u64 firstKey, bmsx::u64 endKey) override {
		ranges.emplace_back(firstKey, endKey);
	}

	std::vector<bmsx::u64> pages;
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
	require(ramBinding.writeWatch != nullptr, "RAM page exposes its write watch");
	*ramBinding.writeWatch = 1u;
	fixture.card.writeU32(bmsx::CART_RAM_BASE, 0xaabbccddu);
	require(fixture.card.readU32(bmsx::CART_RAM_BASE) == 0xaabbccddu, "RAM scalar datapath sees the mapped bytes");
	require(invalidator.pages.size() == 1u, "first watched RAM write invalidates once");
	require(invalidator.pages[0] == MAPPED_KEY_OFFSET + bmsx::CART_RAM_BASE, "RAM invalidation uses the socket-local key");

	fixture.card.writeU32(bmsx::CART_RAM_BASE, 0x55667788u);
	require(invalidator.pages.size() == 1u, "unwatched repeated write does not invalidate again");
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
	testRomInstallAndRamRestoreInvalidateOwnedRegions();
	testMailboxRegistersSignalsAndState();
	testRomOnlyStateHasNoSyntheticDevices();
	testRamOnlyCardLeavesRomApertureUnbacked();
	return 0;
}
