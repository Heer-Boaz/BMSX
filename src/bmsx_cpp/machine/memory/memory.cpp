#include "machine/memory/memory.h"
#include "common/byte_hex_string.h"

#include <cstring>
#include <stdexcept>

namespace bmsx {

Memory::Memory()
	: m_ram(RAM_USED_END - RAM_BASE)
	, m_ioSlots(IO_SLOT_COUNT, valueNil())
	, m_ioReadHandlers(IO_SLOT_COUNT)
	, m_ioWriteHandlers(IO_SLOT_COUNT) {
}

void Memory::setSystemRom(const u8* data, size_t size) {
	if (size == 0) {
		m_systemRom = {};
		return;
	}
	m_systemRom = { data, size };
}

void Memory::setCartRom(const u8* data, size_t size) {
	if (size == 0) {
		m_cartRom = {};
		return;
	}
	m_cartRom = { data, size };
}

void Memory::setOverlayRom(u8* data, size_t size) {
	if (size == 0) {
		m_overlayRom = {};
		return;
	}
	m_overlayRom = { data, size };
}

size_t Memory::overlayRomSize() const {
	return m_overlayRom.size;
}

void Memory::setVramWriter(VramWriter* writer) {
	m_vramWriter = writer;
}

void Memory::mapIoRead(uint32_t addr, void* context, IoReadHandler handler) {
	m_ioReadHandlers[ioIndex(addr)] = { context, handler };
}

void Memory::mapIoWrite(uint32_t addr, void* context, IoWriteHandler handler) {
	m_ioWriteHandlers[ioIndex(addr)] = { context, handler };
}

std::vector<u8> Memory::dumpMutableRam() const {
	return m_ram;
}

void Memory::restoreMutableRam(const u8* data, size_t size) {
	if (size != m_ram.size()) {
		throw std::runtime_error("[Memory] RAM snapshot length mismatch.");
	}
	std::memcpy(m_ram.data(), data, size);
}

MemoryState Memory::captureState() const {
	MemoryState state;
	state.ioMemory = m_ioSlots;
	return state;
}

void Memory::restoreState(const MemoryState& state) {
	if (state.ioMemory.size() != IO_SLOT_COUNT) {
		throw std::runtime_error("[Memory] I/O snapshot slot count mismatch.");
	}
	m_ioSlots = state.ioMemory;
}

MemorySaveState Memory::captureSaveState() const {
	MemorySaveState state;
	state.ram = dumpMutableRam();
	return state;
}

void Memory::restoreSaveState(const MemorySaveState& state) {
	if (state.ram.size() != m_ram.size()) {
		throw std::runtime_error("[Memory] RAM snapshot length mismatch.");
	}
	std::memcpy(m_ram.data(), state.ram.data(), state.ram.size());
}

Value Memory::readValue(uint32_t addr) const {
	if (isIoAddress(addr)) {
		const size_t slot = ioIndex(addr);
		const IoReadBinding& binding = m_ioReadHandlers[slot];
		if (binding.handler != nullptr) {
			return binding.handler(binding.context, addr);
		}
		return m_ioSlots[slot];
	}
	if (addr < RAM_BASE) {
		return valueFromNumber(static_cast<double>(readU32FromRegion(addr)));
	}
	return valueFromNumber(static_cast<double>(readU32(addr)));
}

Value Memory::readMappedValue(uint32_t addr) const {
	if (isVramRange(addr, 4)) {
		return valueNumber(static_cast<double>(readMappedU32LE(addr)));
	}
	return readValue(addr);
}

void Memory::writeValue(uint32_t addr, Value value) {
	if (isIoAddress(addr)) {
		const size_t slot = ioIndex(addr);
		m_ioSlots[slot] = value;
		const IoWriteBinding& binding = m_ioWriteHandlers[slot];
		if (binding.handler != nullptr) {
			binding.handler(binding.context, addr, value);
		}
		return;
	}
	writeU32(addr, toU32(value));
}

void Memory::writeIoValue(uint32_t addr, Value value) {
	if (!isIoAddress(addr)) {
		throw std::runtime_error("I/O fault @ " + formatNumberAsHex(addr, 8) + ": invalid register.");
	}
	m_ioSlots[ioIndex(addr)] = value;
}

void Memory::writeMappedValue(uint32_t addr, Value value) {
	if (!isMappedWritableRange(addr, 4)) {
		throw std::runtime_error("Bus fault @ " + formatNumberAsHex(addr, 8) + ": write word.");
	}
	if (isVramRange(addr, 4)) {
		writeMappedU32LE(addr, toU32(value));
		return;
	}
	writeValue(addr, value);
}

u8 Memory::readU8(uint32_t addr) const {
	size_t offset = 0;
	const auto* region = readRegion(addr, 1, offset);
	return region[offset];
}

u8 Memory::readMappedU8(uint32_t addr) const {
	if (isVramRange(addr, 1)) {
		u8 value = 0;
		m_vramWriter->readVram(addr, &value, 1);
		return value;
	}
	if (isIoAddress(addr)) {
		const Value value = readValue(addr);
		// if (!valueIsNumber(value)) {
		// 	throw std::runtime_error("I/O read fault @ " + formatNumberAsHex(addr, 8) + ": non-numeric register.");
		// }
		return static_cast<u8>(toU32(value) & 0xffu);
	}
	if (isIoRegionRange(addr, 1)) {
		throw std::runtime_error("I/O read fault @ " + formatNumberAsHex(addr, 8) + ": unaligned.");
	}
	return readU8(addr);
}

void Memory::writeU8(uint32_t addr, u8 value) {
	size_t offset = 0;
	if (isVramRange(addr, 1)) {
		m_vramWriter->writeVram(addr, &value, 1);
		return;
	}
	auto* region = writeRegion(addr, 1, offset);
	region[offset] = value;
}

void Memory::writeMappedU8(uint32_t addr, u8 value) {
	if (!isMappedWritableRange(addr, 1)) {
		throw std::runtime_error("Bus fault @ " + formatNumberAsHex(addr, 8) + ": write byte.");
	}
	if (isIoAddress(addr)) {
		writeValue(addr, valueNumber(static_cast<double>(value)));
		return;
	}
	writeU8(addr, value);
}

uint32_t Memory::readIoU32(uint32_t addr) const {
	if (!isIoAddress(addr)) {
		throw std::runtime_error("I/O read fault @ " + formatNumberAsHex(addr, 8) + ": invalid register.");
	}
	const Value value = readValue(addr);
	// if (!valueIsNumber(value)) {
	// 	throw std::runtime_error("I/O read fault @ " + formatNumberAsHex(addr, 8) + ": non-numeric register.");
	// }
	return toU32(value);
}

int32_t Memory::readIoI32(uint32_t addr) const {
	return toI32(static_cast<double>(readIoU32(addr)));
}

uint32_t Memory::readU32(uint32_t addr) const {
	if (isVramRange(addr, 4)) {
		throw std::runtime_error("VRAM read fault @ " + formatNumberAsHex(addr, 8) + ": write-only len=4.");
	}
	if (addr < RAM_BASE) {
		return readU32FromRegion(addr);
	}
	const size_t offset = ramOffset(addr, 4);
	uint32_t value = 0;
	std::memcpy(&value, m_ram.data() + offset, sizeof(uint32_t));
	return value;
}

uint32_t Memory::readU32FromRegion(uint32_t addr) const {
	size_t offset = 0;
	const auto* region = readRegion(addr, 4, offset);
	return static_cast<uint32_t>(region[offset])
		| (static_cast<uint32_t>(region[offset + 1]) << 8)
		| (static_cast<uint32_t>(region[offset + 2]) << 16)
		| (static_cast<uint32_t>(region[offset + 3]) << 24);
}

uint32_t Memory::readMappedU16LE(uint32_t addr) const {
	const uint32_t b0 = static_cast<uint32_t>(readMappedU8(addr));
	const uint32_t b1 = static_cast<uint32_t>(readMappedU8(addr + 1));
	return b0 | (b1 << 8);
}

uint32_t Memory::readMappedU32LE(uint32_t addr) const {
	const uint32_t b0 = static_cast<uint32_t>(readMappedU8(addr));
	const uint32_t b1 = static_cast<uint32_t>(readMappedU8(addr + 1));
	const uint32_t b2 = static_cast<uint32_t>(readMappedU8(addr + 2));
	const uint32_t b3 = static_cast<uint32_t>(readMappedU8(addr + 3));
	return b0 | (b1 << 8) | (b2 << 16) | (b3 << 24);
}

float Memory::readMappedF32LE(uint32_t addr) const {
	const uint32_t bits = readMappedU32LE(addr);
	float value = 0.0f;
	std::memcpy(&value, &bits, sizeof(value));
	return value;
}

double Memory::readMappedF64LE(uint32_t addr) const {
	const uint64_t lo = static_cast<uint64_t>(readMappedU32LE(addr));
	const uint64_t hi = static_cast<uint64_t>(readMappedU32LE(addr + 4));
	const uint64_t bits = (hi << 32) | lo;
	double value = 0.0;
	std::memcpy(&value, &bits, sizeof(value));
	return value;
}

void Memory::writeU32(uint32_t addr, uint32_t value) {
	if (isVramRange(addr, 4)) {
		u8 bytes[4] = {
			static_cast<u8>(value & 0xffu),
			static_cast<u8>((value >> 8) & 0xffu),
			static_cast<u8>((value >> 16) & 0xffu),
			static_cast<u8>((value >> 24) & 0xffu),
		};
		m_vramWriter->writeVram(addr, bytes, 4);
		return;
	}
	const size_t offset = ramOffset(addr, 4);
	std::memcpy(m_ram.data() + offset, &value, sizeof(uint32_t));
}

void Memory::writeMappedU16LE(uint32_t addr, uint32_t value) {
	if (!isMappedWritableRange(addr, 2)) {
		throw std::runtime_error("Bus fault @ " + formatNumberAsHex(addr, 8) + ": write halfword.");
	}
	writeMappedU8(addr, static_cast<u8>(value & 0xffu));
	writeMappedU8(addr + 1, static_cast<u8>((value >> 8) & 0xffu));
}

void Memory::writeMappedU32LE(uint32_t addr, uint32_t value) {
	if (!isMappedWritableRange(addr, 4)) {
		throw std::runtime_error("Bus fault @ " + formatNumberAsHex(addr, 8) + ": write word.");
	}
	if (isIoAddress(addr)) {
		writeValue(addr, valueNumber(static_cast<double>(value)));
		return;
	}
	writeMappedU8(addr, static_cast<u8>(value & 0xffu));
	writeMappedU8(addr + 1, static_cast<u8>((value >> 8) & 0xffu));
	writeMappedU8(addr + 2, static_cast<u8>((value >> 16) & 0xffu));
	writeMappedU8(addr + 3, static_cast<u8>((value >> 24) & 0xffu));
}

void Memory::writeMappedF32LE(uint32_t addr, float value) {
	uint32_t bits = 0;
	std::memcpy(&bits, &value, sizeof(bits));
	writeMappedU32LE(addr, bits);
}

void Memory::writeMappedF64LE(uint32_t addr, double value) {
	if (!isMappedWritableRange(addr, 8)) {
		throw std::runtime_error("Bus fault @ " + formatNumberAsHex(addr, 8) + ": write doubleword.");
	}
	uint64_t bits = 0;
	std::memcpy(&bits, &value, sizeof(bits));
	writeMappedU32LE(addr, static_cast<uint32_t>(bits & 0xffffffffull));
	writeMappedU32LE(addr + 4, static_cast<uint32_t>(bits >> 32));
}

void Memory::writeBytes(uint32_t addr, const u8* data, size_t length) {
	size_t offset = 0;
	if (isVramRange(addr, length)) {
		m_vramWriter->writeVram(addr, data, length);
		return;
	}
	auto* region = writeRegion(addr, length, offset);
	std::memcpy(region + offset, data, length);
}

void Memory::readBytes(uint32_t addr, u8* out, size_t length) const {
	size_t offset = 0;
	const auto* region = readRegion(addr, length, offset);
	std::memcpy(out, region + offset, length);
}

const u8* Memory::readBytesView(uint32_t addr, size_t length) const {
	size_t offset = 0;
	const auto* region = readRegion(addr, length, offset);
	return region + offset;
}

bool Memory::isVramRange(uint32_t addr, size_t length) const {
	return isVramMappedRange(addr, length);
}

bool Memory::isReadableMainMemoryRange(uint32_t addr, size_t length) const {
	return isRangeWithinRegion(addr, length, SYSTEM_ROM_BASE, static_cast<uint32_t>(m_systemRom.size))
		|| (m_cartRom.data != nullptr && isRangeWithinRegion(addr, length, CART_ROM_BASE, static_cast<uint32_t>(m_cartRom.size)))
		|| (m_overlayRom.data != nullptr && isRangeWithinRegion(addr, length, OVERLAY_ROM_BASE, static_cast<uint32_t>(m_overlayRom.size)))
		|| isRangeWithinRegion(addr, length, RAM_BASE, RAM_USED_END - RAM_BASE);
}

bool Memory::isRamRange(uint32_t addr, size_t length) const {
	return isRangeWithinRegion(addr, length, RAM_BASE, RAM_USED_END - RAM_BASE);
}

void Memory::loadIoSlots(const std::vector<Value>& slots) {
	if (slots.size() != IO_SLOT_COUNT) {
		throw std::runtime_error("[Memory] I/O snapshot slot count mismatch.");
	}
	m_ioSlots = slots;
}

void Memory::clearIoSlots() {
	for (auto& slot : m_ioSlots) {
		slot = valueNil();
	}
}

bool Memory::isIoAddress(uint32_t addr) const {
	const uint32_t delta = addr - IO_BASE;
	if (delta >= IO_WORD_SIZE * IO_SLOT_COUNT) {
		return false;
	}
	return (delta % IO_WORD_SIZE) == 0;
}

bool Memory::isIoRegionRange(uint32_t addr, size_t length) const {
	return addr >= IO_BASE && addr + length <= IO_BASE + m_ioSlots.size() * IO_WORD_SIZE;
}

size_t Memory::ioIndex(uint32_t addr) const {
	const uint32_t delta = addr - IO_BASE;
	if ((delta % IO_WORD_SIZE) != 0) {
		throw std::runtime_error("I/O fault @ " + formatNumberAsHex(addr, 8) + ": unaligned.");
	}
	const size_t slot = static_cast<size_t>(delta / IO_WORD_SIZE);
	if (slot >= m_ioSlots.size()) {
		throw std::runtime_error("I/O fault @ " + formatNumberAsHex(addr, 8) + ": out of range.");
	}
	return slot;
}

bool Memory::isRangeWithinRegion(uint32_t addr, size_t length, uint32_t base, uint32_t size) const {
	return addr >= base && addr + length <= base + size;
}

bool Memory::isLuaReadOnlyIoAddress(uint32_t addr) const {
	switch (addr) {
		case IO_SYS_CART_BOOTREADY:
		case IO_SYS_HOST_FAULT_FLAGS:
		case IO_SYS_HOST_FAULT_STAGE:
		case IO_IRQ_FLAGS:
		case IO_DMA_STATUS:
		case IO_DMA_WRITTEN:
		case IO_GEO_STATUS:
		case IO_GEO_PROCESSED:
		case IO_GEO_FAULT:
		case IO_IMG_STATUS:
		case IO_IMG_WRITTEN:
		case IO_APU_STATUS:
		case IO_APU_EVENT_KIND:
		case IO_APU_EVENT_SLOT:
		case IO_APU_EVENT_SOURCE_ADDR:
		case IO_APU_EVENT_SEQ:
		case IO_VDP_RD_STATUS:
		case IO_VDP_RD_DATA:
		case IO_VDP_STATUS:
			return true;
		default:
			return false;
	}
}

bool Memory::isMappedWritableRange(uint32_t addr, size_t length) const {
	if (isIoRegionRange(addr, length)) {
		return length == IO_WORD_SIZE && isIoAddress(addr) && !isLuaReadOnlyIoAddress(addr);
	}
	if (isRangeWithinRegion(addr, length, SYSTEM_ROM_BASE, static_cast<uint32_t>(m_systemRom.size))) {
		return false;
	}
	if (m_cartRom.data != nullptr && isRangeWithinRegion(addr, length, CART_ROM_BASE, static_cast<uint32_t>(m_cartRom.size))) {
		return false;
	}
	if (m_overlayRom.data != nullptr && isRangeWithinRegion(addr, length, OVERLAY_ROM_BASE, static_cast<uint32_t>(m_overlayRom.size))) {
		return false;
	}
	if (isVramRange(addr, length)) {
		return true;
	}
	return addr >= RAM_BASE && addr + length <= RAM_USED_END;
}

size_t Memory::ramOffset(uint32_t addr, size_t length) const {
	if (addr < RAM_BASE || addr + length > RAM_USED_END) {
		throw std::runtime_error("Bus fault @ " + formatNumberAsHex(addr, 8) + ": RAM range len=" + std::to_string(length) + ".");
	}
	return static_cast<size_t>(addr - RAM_BASE);
}

const u8* Memory::readRegion(uint32_t addr, size_t length, size_t& outOffset) const {
	if (isVramRange(addr, length)) {
		throw std::runtime_error("VRAM read fault @ " + formatNumberAsHex(addr, 8) + ": write-only len=" + std::to_string(length) + ".");
	}
	if (m_systemRom.size > 0 && addr >= SYSTEM_ROM_BASE && addr + length <= SYSTEM_ROM_BASE + m_systemRom.size) {
		outOffset = static_cast<size_t>(addr - SYSTEM_ROM_BASE);
		return m_systemRom.data;
	}
	if (m_cartRom.size > 0 && addr >= CART_ROM_BASE && addr + length <= CART_ROM_BASE + m_cartRom.size) {
		outOffset = static_cast<size_t>(addr - CART_ROM_BASE);
		return m_cartRom.data;
	}
	if (m_overlayRom.size > 0 && addr >= OVERLAY_ROM_BASE && addr + length <= OVERLAY_ROM_BASE + m_overlayRom.size) {
		outOffset = static_cast<size_t>(addr - OVERLAY_ROM_BASE);
		return m_overlayRom.data;
	}
	outOffset = ramOffset(addr, length);
	return m_ram.data();
}

u8* Memory::writeRegion(uint32_t addr, size_t length, size_t& outOffset) {
	if (m_overlayRom.size > 0 && addr >= OVERLAY_ROM_BASE && addr + length <= OVERLAY_ROM_BASE + m_overlayRom.size) {
		outOffset = static_cast<size_t>(addr - OVERLAY_ROM_BASE);
		return m_overlayRom.data;
	}
	outOffset = ramOffset(addr, length);
	return m_ram.data();
}

} // namespace bmsx
