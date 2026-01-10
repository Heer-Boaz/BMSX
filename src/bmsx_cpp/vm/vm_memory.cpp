#include "vm_memory.h"

#include <cstring>
#include <stdexcept>

namespace bmsx {

VmMemory::VmMemory()
	: m_ram(RAM_USED_END - RAM_BASE)
	, m_ioSlots(VM_IO_SLOT_COUNT, valueNil()) {
}

void VmMemory::setEngineRom(const u8* data, size_t size) {
	if (!data || size == 0) {
		m_engineRom.clear();
		return;
	}
	m_engineRom.assign(data, data + size);
}

void VmMemory::setCartRom(const u8* data, size_t size) {
	if (!data || size == 0) {
		m_cartRom.clear();
		return;
	}
	m_cartRom.assign(data, data + size);
}

void VmMemory::setOverlayRom(const u8* data, size_t size) {
	if (!data || size == 0) {
		m_overlayRom.clear();
		return;
	}
	m_overlayRom.assign(data, data + size);
}

Value VmMemory::readValue(uint32_t addr) const {
	if (isIoAddress(addr)) {
		return m_ioSlots[ioIndex(addr)];
	}
	if (addr < RAM_BASE) {
		return valueFromNumber(static_cast<double>(readU32FromRegion(addr)));
	}
	return valueFromNumber(static_cast<double>(readU32(addr)));
}

void VmMemory::writeValue(uint32_t addr, Value value) {
	if (isIoAddress(addr)) {
		m_ioSlots[ioIndex(addr)] = value;
		return;
	}
	if (!valueIsNumber(value)) {
		throw std::runtime_error("[VmMemory] STORE_MEM expects a number outside IO space.");
	}
	writeU32(addr, static_cast<uint32_t>(asNumber(value)));
}

u8 VmMemory::readU8(uint32_t addr) const {
	size_t offset = 0;
	const auto& region = readRegion(addr, 1, offset);
	return region[offset];
}

void VmMemory::writeU8(uint32_t addr, u8 value) {
	size_t offset = 0;
	auto& region = writeRegion(addr, 1, offset);
	region[offset] = value;
}

uint32_t VmMemory::readU32(uint32_t addr) const {
	const size_t offset = ramOffset(addr, 4);
	uint32_t value = 0;
	std::memcpy(&value, m_ram.data() + offset, sizeof(uint32_t));
	return value;
}

uint32_t VmMemory::readU32FromRegion(uint32_t addr) const {
	size_t offset = 0;
	const auto& region = readRegion(addr, 4, offset);
	return static_cast<uint32_t>(region[offset])
		| (static_cast<uint32_t>(region[offset + 1]) << 8)
		| (static_cast<uint32_t>(region[offset + 2]) << 16)
		| (static_cast<uint32_t>(region[offset + 3]) << 24);
}

void VmMemory::writeU32(uint32_t addr, uint32_t value) {
	const size_t offset = ramOffset(addr, 4);
	std::memcpy(m_ram.data() + offset, &value, sizeof(uint32_t));
}

void VmMemory::writeBytes(uint32_t addr, const u8* data, size_t length) {
	size_t offset = 0;
	auto& region = writeRegion(addr, length, offset);
	std::memcpy(region.data() + offset, data, length);
}

void VmMemory::readBytes(uint32_t addr, u8* out, size_t length) const {
	size_t offset = 0;
	const auto& region = readRegion(addr, length, offset);
	std::memcpy(out, region.data() + offset, length);
}

void VmMemory::loadIoSlots(const std::vector<Value>& slots) {
	m_ioSlots = slots;
	if (m_ioSlots.size() < VM_IO_SLOT_COUNT) {
		m_ioSlots.resize(VM_IO_SLOT_COUNT, valueNil());
	}
}

void VmMemory::clearIoSlots() {
	for (auto& slot : m_ioSlots) {
		slot = valueNil();
	}
}

bool VmMemory::isIoAddress(uint32_t addr) const {
	const uint32_t delta = addr - IO_BASE;
	if (delta >= IO_WORD_SIZE * VM_IO_SLOT_COUNT) {
		return false;
	}
	return (delta % IO_WORD_SIZE) == 0;
}

size_t VmMemory::ioIndex(uint32_t addr) const {
	const uint32_t delta = addr - IO_BASE;
	if ((delta % IO_WORD_SIZE) != 0) {
		throw std::runtime_error("[VmMemory] Unaligned IO address.");
	}
	const size_t slot = static_cast<size_t>(delta / IO_WORD_SIZE);
	if (slot >= m_ioSlots.size()) {
		throw std::runtime_error("[VmMemory] IO address out of range.");
	}
	return slot;
}

size_t VmMemory::ramOffset(uint32_t addr, size_t length) const {
	if (addr < RAM_BASE || addr + length > RAM_USED_END) {
		throw std::runtime_error("[VmMemory] Address out of RAM bounds.");
	}
	return static_cast<size_t>(addr - RAM_BASE);
}

const std::vector<u8>& VmMemory::readRegion(uint32_t addr, size_t length, size_t& outOffset) const {
	if (!m_engineRom.empty() && addr >= ENGINE_ROM_BASE && addr + length <= ENGINE_ROM_BASE + m_engineRom.size()) {
		outOffset = static_cast<size_t>(addr - ENGINE_ROM_BASE);
		return m_engineRom;
	}
	if (!m_cartRom.empty() && addr >= CART_ROM_BASE && addr + length <= CART_ROM_BASE + m_cartRom.size()) {
		outOffset = static_cast<size_t>(addr - CART_ROM_BASE);
		return m_cartRom;
	}
	if (!m_overlayRom.empty() && addr >= OVERLAY_ROM_BASE && addr + length <= OVERLAY_ROM_BASE + m_overlayRom.size()) {
		outOffset = static_cast<size_t>(addr - OVERLAY_ROM_BASE);
		return m_overlayRom;
	}
	outOffset = ramOffset(addr, length);
	return m_ram;
}

std::vector<u8>& VmMemory::writeRegion(uint32_t addr, size_t length, size_t& outOffset) {
	if (!m_overlayRom.empty() && addr >= OVERLAY_ROM_BASE && addr + length <= OVERLAY_ROM_BASE + m_overlayRom.size()) {
		outOffset = static_cast<size_t>(addr - OVERLAY_ROM_BASE);
		return m_overlayRom;
	}
	outOffset = ramOffset(addr, length);
	return m_ram;
}

} // namespace bmsx
