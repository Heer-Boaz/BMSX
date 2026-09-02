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
	m_rom->bytes = rom;
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
	out.writeWatch = nullptr;
	if (address < CART_RAM_BASE) {
		out.cacheable = true;
		const size_t offset = static_cast<size_t>(address - CART_ROM_BASE);
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

CartridgeCardState CartridgeCard::captureState() const {
	CartridgeCardState state;
	if (m_ram) {
		state.ram = m_ram->bytes;
	}
	if (m_mailbox) {
		state.mailbox = m_mailbox->captureState();
	}
	return state;
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

u8 CartridgeCard::readU8(u32 address) const {
	if (address < CART_RAM_BASE) {
		const size_t offset = static_cast<size_t>(address - CART_ROM_BASE);
		return m_rom && offset < m_rom->bytes.size() ? m_rom->bytes[offset] : 0u;
	}
	if (address < CART_MMIO_BASE) {
		const size_t offset = static_cast<size_t>(address - CART_RAM_BASE);
		return m_ram && offset < m_ram->bytes.size() ? m_ram->bytes[offset] : 0u;
	}
	const u32 word = readMmioWord(address - CART_MMIO_BASE);
	return static_cast<u8>(word >> ((address & 3u) << 3u));
}

u32 CartridgeCard::readU16(u32 address) const {
	if (address < CART_RAM_BASE) {
		return m_rom
			? readU16From(m_rom->bytes, static_cast<size_t>(address - CART_ROM_BASE))
			: 0u;
	}
	if (address < CART_MMIO_BASE) {
		return m_ram
			? readU16From(m_ram->bytes, static_cast<size_t>(address - CART_RAM_BASE))
			: 0u;
	}
	const u32 word = readMmioWord(address - CART_MMIO_BASE);
	return (word >> ((address & 2u) << 3u)) & 0xffffu;
}

u32 CartridgeCard::readU32(u32 address) const {
	if (address < CART_RAM_BASE) {
		return m_rom
			? readU32From(m_rom->bytes, static_cast<size_t>(address - CART_ROM_BASE))
			: 0u;
	}
	if (address < CART_MMIO_BASE) {
		return m_ram
			? readU32From(m_ram->bytes, static_cast<size_t>(address - CART_RAM_BASE))
			: 0u;
	}
	return readMmioWord(address - CART_MMIO_BASE);
}

void CartridgeCard::writeU8(u32 address, u8 value) {
	if (address < CART_RAM_BASE || address >= CART_MMIO_BASE) return;
	const size_t offset = static_cast<size_t>(address - CART_RAM_BASE);
	if (m_ram && offset < m_ram->bytes.size()) {
		m_ram->bytes[offset] = value;
		m_ram->pageWriteWatches.invalidateWrite(
			offset,
			1u,
			CART_RAM_BASE + m_mappedKeyOffset,
			m_mappedPageInvalidator
		);
	}
}

void CartridgeCard::writeU16(u32 address, u32 value) {
	if (address < CART_RAM_BASE || address >= CART_MMIO_BASE) return;
	const size_t offset = static_cast<size_t>(address - CART_RAM_BASE);
	if (m_ram && offset + 2u <= m_ram->bytes.size()) {
		writeLE16(m_ram->bytes.data() + offset, static_cast<u16>(value));
		m_ram->pageWriteWatches.invalidateWrite(
			offset,
			2u,
			CART_RAM_BASE + m_mappedKeyOffset,
			m_mappedPageInvalidator
		);
	}
}

u32 CartridgeCard::writeU32(u32 address, u32 value) {
	if (address >= CART_RAM_BASE && address < CART_MMIO_BASE) {
		const size_t offset = static_cast<size_t>(address - CART_RAM_BASE);
		if (m_ram && offset + 4u <= m_ram->bytes.size()) {
			writeLE32(m_ram->bytes.data() + offset, value);
			m_ram->pageWriteWatches.invalidateWrite(
				offset,
				4u,
				CART_RAM_BASE + m_mappedKeyOffset,
				m_mappedPageInvalidator
			);
		}
		return 0u;
	}
	if (address >= CART_MMIO_BASE && m_mailbox) {
		return m_mailbox->writeWord(address - CART_MMIO_BASE, value);
	}
	return 0u;
}

void CartridgeCard::readBytes(u32 address, u8* out, size_t length) const {
	if (address < CART_RAM_BASE && static_cast<u64>(address) + length <= CART_RAM_BASE) {
		if (m_rom) {
			readByteRun(
				m_rom->bytes,
				static_cast<size_t>(address - CART_ROM_BASE),
				out,
				length
			);
		} else {
			std::memset(out, 0, length);
		}
		return;
	}
	if (address >= CART_RAM_BASE && static_cast<u64>(address) + length <= CART_MMIO_BASE) {
		if (m_ram) {
			readByteRun(
				m_ram->bytes,
				static_cast<size_t>(address - CART_RAM_BASE),
				out,
				length
			);
		} else {
			std::memset(out, 0, length);
		}
		return;
	}
	for (size_t index = 0; index < length; ++index) {
		out[index] = readU8(address + static_cast<u32>(index));
	}
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

u32 CartridgeCard::dreqLines() const {
	return m_mailbox ? m_mailbox->dreqLines() : 0u;
}

u32 CartridgeCard::readMmioWord(u32 offset) const {
	return m_mailbox ? m_mailbox->readWord(offset) : 0u;
}

u32 CartridgeCard::readU16From(std::span<const u8> bytes, size_t offset) {
	if (offset + 2u <= bytes.size()) return readLE16(bytes.data() + offset);
	return offset < bytes.size() ? bytes[offset] : 0u;
}

u32 CartridgeCard::readU32From(std::span<const u8> bytes, size_t offset) {
	if (offset + 4u <= bytes.size()) return readLE32(bytes.data() + offset);
	if (offset >= bytes.size()) return 0u;
	u32 word = bytes[offset];
	if (offset + 1u < bytes.size()) word |= static_cast<u32>(bytes[offset + 1u]) << 8u;
	if (offset + 2u < bytes.size()) word |= static_cast<u32>(bytes[offset + 2u]) << 16u;
	return word;
}

void CartridgeCard::readByteRun(
	std::span<const u8> bytes,
	size_t offset,
	u8* out,
	size_t length
) {
	const size_t available = offset < bytes.size()
		? std::min(length, bytes.size() - offset)
		: 0u;
	if (available != 0u) {
		std::memcpy(out, bytes.data() + offset, available);
	}
	if (available != length) {
		std::memset(out + available, 0, length - available);
	}
}

} // namespace bmsx
