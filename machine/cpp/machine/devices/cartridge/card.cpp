#include "machine/devices/cartridge/card.h"

#include "common/endian.h"
#include "spec/bmsx/memory_map.h"

#include <algorithm>
#include <cstring>

namespace bmsx {

CartridgeCard::CartridgeCard(
	const CartridgeCardMedia& media,
	u64 mappedKeyOffset
)
	: m_mappedKeyOffset(mappedKeyOffset) {
	if (media.rom) {
		m_rom.emplace(RomRegion{*media.rom});
	}
	if (media.ramByteCount) {
		m_ram.emplace(*media.ramByteCount);
	}
	if (media.mailboxPresent) {
		m_mailbox.emplace();
	}
}

void CartridgeCard::installRom(std::span<const u8> rom) {
	m_rom->bytes = Span<const u8>(rom);
	if (m_mappedPageInvalidator) {
		m_mappedPageInvalidator->invalidateMappedRange(
			CART_ROM_BASE + m_mappedKeyOffset,
			CART_ROM_END + m_mappedKeyOffset
		);
	}
}

void CartridgeCard::attachMappedPageInvalidator(
	MappedPageInvalidator& invalidator
) {
	m_mappedPageInvalidator = &invalidator;
}

void CartridgeCard::detachMappedPageInvalidator() {
	m_mappedPageInvalidator = nullptr;
}

void CartridgeCard::clearMappedPageWriteWatches() {
	if (m_ram) m_ram->pageWriteWatches.clear();
}

void CartridgeCard::bindMappedPage(u32 address, MappedPageBinding& out) {
	out.key = address + m_mappedKeyOffset;
	out.readBytes = nullptr;
	out.writeWatch = {};
	if (address < CART_RAM_BASE) {
		const size_t offset = static_cast<size_t>(address - CART_ROM_BASE);
		out.cacheable = m_rom && offset + sizeof(u32) <= m_rom->bytes.size();
		if (m_rom && offset + MAPPED_PAGE_BYTE_SIZE <= m_rom->bytes.size()) {
			out.readBytes = m_rom->bytes.data() + offset;
		}
		return;
	}
	if (address < CART_MMIO_BASE) {
		const size_t offset = static_cast<size_t>(address - CART_RAM_BASE);
		if (m_ram && offset < m_ram->bytes.size()) {
			out.cacheable = true;
			if (offset + MAPPED_PAGE_BYTE_SIZE <= m_ram->bytes.size()) {
				out.readBytes = m_ram->bytes.data() + offset;
			}
			m_ram->pageWriteWatches.bind(offset, out);
			return;
		}
	}
	out.cacheable = false;
}

void CartridgeCard::reset() {
	if (m_mailbox) m_mailbox->reset();
}

CartridgeCardState CartridgeCard::captureState(CartridgeCardState storage) const {
	if (m_ram) {
		if (!storage.ram) storage.ram.emplace();
		storage.ram->assign(m_ram->bytes.begin(), m_ram->bytes.end());
	}
	if (m_mailbox) {
		storage.mailbox = m_mailbox->captureState();
	}
	return storage;
}

void CartridgeCard::restoreState(const CartridgeCardState& state) {
	if (state.ram.has_value() != m_ram.has_value()) {
		throw BMSX_RUNTIME_ERROR("Cartridge RAM state does not match the inserted card.");
	}
	if (m_ram && state.ram->size() != m_ram->bytes.size()) {
		throw BMSX_RUNTIME_ERROR("Cartridge RAM size does not match the inserted card.");
	}
	if (state.mailbox.has_value() != m_mailbox.has_value()) {
		throw BMSX_RUNTIME_ERROR("Cartridge mailbox state does not match the inserted card.");
	}
	if (m_ram) {
		std::copy(state.ram->begin(), state.ram->end(), m_ram->bytes.begin());
	}
	if (m_ram && m_mappedPageInvalidator) {
		m_mappedPageInvalidator->invalidateMappedRange(
			CART_RAM_BASE + m_mappedKeyOffset,
			CART_RAM_BASE + m_mappedKeyOffset + m_ram->bytes.size()
		);
	}
	if (m_mailbox) {
		m_mailbox->restoreState(*state.mailbox);
	}
}

template<size_t Width>
std::optional<u32> CartridgeCard::readScalar(u32 address) const {
	if (address < CART_MMIO_BASE) {
		Span<const u8> bytes;
		if (!bindMappedReadView(address, Width, bytes)) return {};
		if constexpr (Width == 1u) return bytes[0];
		if constexpr (Width == 2u) return readLE16(bytes.data());
		return readLE32(bytes.data());
	}
	if (!m_mailbox) return {};
	const u32 word = m_mailbox->readWord(address - CART_MMIO_BASE);
	if constexpr (Width == 1u) return (word >> ((address & 3u) << 3u)) & 0xffu;
	if constexpr (Width == 2u) return (word >> ((address & 2u) << 3u)) & 0xffffu;
	return word;
}

std::optional<u32> CartridgeCard::readU8(u32 address) const { return readScalar<1u>(address); }
std::optional<u32> CartridgeCard::readU16(u32 address) const { return readScalar<2u>(address); }
std::optional<u32> CartridgeCard::readU32(u32 address) const { return readScalar<4u>(address); }

template<size_t Width>
bool CartridgeCard::writeRamScalar(u32 address, u32 value) {
	const size_t offset = address - CART_RAM_BASE;
	if (!m_ram || offset + Width > m_ram->bytes.size()) return false;
	auto* bytes = m_ram->bytes.data() + offset;
	if constexpr (Width == 1u) *bytes = static_cast<u8>(value);
	else if constexpr (Width == 2u) writeLE16(bytes, static_cast<u16>(value));
	else writeLE32(bytes, value);
	m_ram->pageWriteWatches.invalidateWrite(offset, Width, CART_RAM_BASE + m_mappedKeyOffset, m_mappedPageInvalidator);
	return true;
}

bool CartridgeCard::writeU8(u32 address, u8 value) {
	if (address >= CART_MMIO_BASE) return m_mailbox.has_value();
	if (address >= CART_RAM_BASE) return writeRamScalar<1u>(address, value);
	Span<const u8> bytes;
	return bindRomByteView(address, 1u, bytes);
}

bool CartridgeCard::writeU16(u32 address, u32 value) {
	if (address >= CART_MMIO_BASE) return m_mailbox.has_value();
	if (address >= CART_RAM_BASE) return writeRamScalar<2u>(address, value);
	Span<const u8> bytes;
	return bindRomByteView(address, 2u, bytes);
}

std::optional<u32> CartridgeCard::writeU32(u32 address, u32 value) {
	if (address >= CART_MMIO_BASE) {
		if (!m_mailbox) return {};
		return m_mailbox->writeWord(address - CART_MMIO_BASE, value);
	}
	if (address >= CART_RAM_BASE) {
		if (!writeRamScalar<4u>(address, value)) return {};
	} else {
		Span<const u8> bytes;
		if (!bindRomByteView(address, 4u, bytes)) return {};
	}
	return 0u;
}

bool CartridgeCard::bindRomByteView(
	u32 address,
	size_t length,
	Span<const u8>& out
) const {
	const size_t offset = static_cast<size_t>(address - CART_ROM_BASE);
	if (!m_rom || length == 0u || offset >= m_rom->bytes.size() || length > m_rom->bytes.size() - offset) {
		return false;
	}
	out = Span<const u8>(m_rom->bytes.data() + offset, length);
	return true;
}

bool CartridgeCard::bindMappedReadView(u32 address, size_t length, Span<const u8>& out) const {
	if (address < CART_RAM_BASE) return bindRomByteView(address, length, out);
	const size_t offset = static_cast<size_t>(address - CART_RAM_BASE);
	if (address >= CART_MMIO_BASE || !m_ram || length == 0u
		|| offset >= m_ram->bytes.size() || length > m_ram->bytes.size() - offset) return false;
	out = Span<const u8>(m_ram->bytes.data() + offset, length);
	return true;
}

u32 CartridgeCard::dreqLines() const {
	return m_mailbox ? m_mailbox->dreqLines() : 0u;
}

} // namespace bmsx
