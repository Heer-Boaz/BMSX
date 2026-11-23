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
	const Span<const u8>* romStorage() const { return m_rom ? &m_rom->bytes : nullptr; }
	void attachMappedPageInvalidator(MappedPageInvalidator& invalidator);
	void detachMappedPageInvalidator();
	void clearMappedPageWriteWatches();
	void bindMappedPage(u32 address, MappedPageBinding& out);
	void reset();
	CartridgeCardState captureState(CartridgeCardState storage = {}) const;
	void restoreState(const CartridgeCardState& state);
	std::optional<u32> readU8(u32 address) const;
	std::optional<u32> readU16(u32 address) const;
	std::optional<u32> readU32(u32 address) const;
	bool writeU8(u32 address, u8 value);
	bool writeU16(u32 address, u32 value);
	std::optional<u32> writeU32(u32 address, u32 value);
	bool hasMailbox() const { return m_mailbox.has_value(); }
	bool bindRomByteView(u32 address, size_t length, Span<const u8>& out) const;
	bool bindMappedReadView(u32 address, size_t length, Span<const u8>& out) const;
	u32 dreqLines() const;

private:
	struct RomRegion {
		Span<const u8> bytes;
	};
	struct RamRegion {
		explicit RamRegion(size_t byteCount)
			: bytes(byteCount)
			, pageWriteWatches(byteCount) {}

		std::vector<u8> bytes;
		MappedPageWriteWatches pageWriteWatches;
	};

	template<size_t Width> std::optional<u32> readScalar(u32 address) const;
	template<size_t Width> bool writeRamScalar(u32 address, u32 value);

	std::optional<RomRegion> m_rom;
	std::optional<RamRegion> m_ram;
	u64 m_mappedKeyOffset;
	std::optional<CartridgeMailbox> m_mailbox;
	MappedPageInvalidator* m_mappedPageInvalidator = nullptr;
};

} // namespace bmsx
