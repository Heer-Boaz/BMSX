#pragma once

#include "machine/devices/cartridge/contracts.h"
#include "machine/devices/cartridge/mailbox.h"
#include "machine/memory/mapped_page.h"

#include <optional>
#include <span>
#include <vector>

namespace bmsx {

class CartridgeCard {
public:
	CartridgeCard(const CartridgeCardMedia& media, u64 mappedKeyOffset);

	size_t ramByteCount() const {
		return m_ram ? m_ram->bytes.size() : 0u;
	}
	void installRom(std::span<const u8> rom);
	void attachMappedPageInvalidator(MappedPageInvalidator& invalidator);
	void detachMappedPageInvalidator();
	void clearMappedPageWriteWatches();
	void bindMappedPage(u32 address, MappedPageBinding& out);
	void reset();
	CartridgeCardState captureState() const;
	void restoreState(const CartridgeCardState& state);
	u8 readU8(u32 address) const;
	u32 readU16(u32 address) const;
	u32 readU32(u32 address) const;
	void writeU8(u32 address, u8 value);
	void writeU16(u32 address, u32 value);
	u32 writeU32(u32 address, u32 value);
	void readBytes(u32 address, u8* out, size_t length) const;
	bool bindRomByteView(u32 address, size_t length, Span<const u8>& out) const;
	u32 dreqLines() const;

private:
	struct RomRegion {
		std::span<const u8> bytes;
	};
	struct RamRegion {
		explicit RamRegion(size_t byteCount)
			: bytes(byteCount)
			, pageWriteWatches(byteCount) {}

		std::vector<u8> bytes;
		MappedPageWriteWatches pageWriteWatches;
	};

	static u32 readU16From(std::span<const u8> bytes, size_t offset);
	static u32 readU32From(std::span<const u8> bytes, size_t offset);
	static void readByteRun(
		std::span<const u8> bytes,
		size_t offset,
		u8* out,
		size_t length
	);
	u32 readMmioWord(u32 offset) const;

	std::optional<RomRegion> m_rom;
	std::optional<RamRegion> m_ram;
	u64 m_mappedKeyOffset;
	std::optional<CartridgeMailbox> m_mailbox;
	MappedPageInvalidator* m_mappedPageInvalidator = nullptr;
};

} // namespace bmsx
