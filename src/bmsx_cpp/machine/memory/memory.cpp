#include "machine/memory/memory.h"
#include "common/byte_hex_string.h"
#include "common/endian.h"

#include <cstring>
#include <stdexcept>

namespace bmsx {

namespace {

constexpr size_t IO_SYS_BUS_FAULT_CODE_SLOT = (IO_SYS_BUS_FAULT_CODE - IO_BASE) / IO_WORD_SIZE;
constexpr size_t IO_SYS_BUS_FAULT_ADDR_SLOT = (IO_SYS_BUS_FAULT_ADDR - IO_BASE) / IO_WORD_SIZE;
constexpr size_t IO_SYS_BUS_FAULT_ACCESS_SLOT = (IO_SYS_BUS_FAULT_ACCESS - IO_BASE) / IO_WORD_SIZE;
constexpr size_t IO_SYS_BUS_FAULT_ACK_SLOT = (IO_SYS_BUS_FAULT_ACK - IO_BASE) / IO_WORD_SIZE;
constexpr uint32_t BUS_ACCESS_READ_WORD = BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_WORD;
constexpr uint32_t BUS_ACCESS_WRITE_WORD = BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_WORD;
constexpr uint32_t BUS_ACCESS_READ_U8 = BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_U8;
constexpr uint32_t BUS_ACCESS_WRITE_U8 = BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_U8;
constexpr uint32_t BUS_ACCESS_READ_U16 = BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_U16;
constexpr uint32_t BUS_ACCESS_READ_U32 = BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_U32;
constexpr uint32_t BUS_ACCESS_WRITE_U16 = BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_U16;
constexpr uint32_t BUS_ACCESS_WRITE_U32 = BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_U32;

inline bool addressRangeOffset(uint32_t addr, uint32_t base, size_t size, size_t length, size_t& outOffset) {
	if (addr < base || length > size) {
		return false;
	}
	const size_t offset = static_cast<size_t>(addr - base);
	if (offset > size - length) {
		return false;
	}
	outOffset = offset;
	return true;
}

inline bool addressRangeWithin(uint32_t addr, uint32_t base, size_t size, size_t length) {
	size_t offset = 0;
	return addressRangeOffset(addr, base, size, length, offset);
}

} // namespace

Memory::Memory()
	: m_ram(RAM_END - RAM_BASE)
	, m_ioSlots(IO_SLOT_COUNT, valueNil())
	, m_ioReadHandlers(IO_SLOT_COUNT)
	, m_ioWriteHandlers(IO_SLOT_COUNT) {
	m_ioWriteHandlers[IO_SYS_BUS_FAULT_ACK_SLOT] = { this, &Memory::onBusFaultAckWriteThunk };
	clearBusFault();
}

Memory::Memory(const MemoryInit& init)
	: m_systemRom{ init.systemRom.data, init.systemRom.size }
	, m_cartRom{ init.cartRom.data, init.cartRom.size }
	, m_programCode()
	, m_overlayRom{ init.overlayRom.data, init.overlayRom.size }
	, m_ram(RAM_END - RAM_BASE)
	, m_ioSlots(IO_SLOT_COUNT, valueNil())
	, m_ioReadHandlers(IO_SLOT_COUNT)
	, m_ioWriteHandlers(IO_SLOT_COUNT) {
	m_ioWriteHandlers[IO_SYS_BUS_FAULT_ACK_SLOT] = { this, &Memory::onBusFaultAckWriteThunk };
	clearBusFault();
}

size_t Memory::getOverlayRomSize() const {
	return m_overlayRom.size;
}

void Memory::setVramWriter(VramWriter* writer) {
	m_vramWriter = writer;
}

void Memory::mapIoRead(uint32_t addr, void* context, IoReadHandler handler) {
	const int slot = requireIoAlignedSlot(addr);
	m_ioReadHandlers[static_cast<size_t>(slot)] = { context, handler };
}

void Memory::mapIoWrite(uint32_t addr, void* context, IoWriteHandler handler) {
	const int slot = requireIoAlignedSlot(addr);
	m_ioWriteHandlers[static_cast<size_t>(slot)] = { context, handler };
}

void Memory::setProgramCode(const u8* data, size_t size) {
	if (size > PROGRAM_ROM_SIZE) {
		throw std::runtime_error("[Memory] Program ROM exceeds mapped range.");
	}
	m_programCode = { data, size };
}

MemorySaveState Memory::captureSaveState() const {
	MemorySaveState state;
	state.ram = m_ram;
	state.busFaultCode = m_busFaultCode;
	state.busFaultAddr = m_busFaultAddr;
	state.busFaultAccess = m_busFaultAccess;
	return state;
}

void Memory::restoreSaveState(const MemorySaveState& state) {
	if (state.ram.size() != m_ram.size()) {
		throw std::runtime_error("[Memory] RAM snapshot length mismatch.");
	}
	std::memcpy(m_ram.data(), state.ram.data(), state.ram.size());
	m_busFaultCode = state.busFaultCode;
	m_busFaultAddr = state.busFaultAddr;
	m_busFaultAccess = state.busFaultAccess;
	writeBusFaultSlots();
}

u8 Memory::readMainMemoryU8(uint32_t addr, uint32_t faultAccess) const {
	if (isProgramCodeReadableRange(addr, 1)) {
		return m_programCode.data[static_cast<size_t>(addr - PROGRAM_ROM_BASE)];
	}
	if (addr >= SYSTEM_ROM_BASE && addr < SYSTEM_ROM_BASE + m_systemRom.size) {
		return m_systemRom.data[static_cast<size_t>(addr - SYSTEM_ROM_BASE)];
	}
	if (m_cartRom.data != nullptr && addr >= CART_ROM_BASE && addr < CART_ROM_BASE + m_cartRom.size) {
		return m_cartRom.data[static_cast<size_t>(addr - CART_ROM_BASE)];
	}
	if (m_overlayRom.data != nullptr && addr >= OVERLAY_ROM_BASE && addr < OVERLAY_ROM_BASE + m_overlayRom.size) {
		return m_overlayRom.data[static_cast<size_t>(addr - OVERLAY_ROM_BASE)];
	}
	if (addr >= RAM_BASE) {
		const size_t offset = static_cast<size_t>(addr - RAM_BASE);
		if (offset < m_ram.size()) {
			return m_ram[offset];
		}
	}
	raiseBusFault(BUS_FAULT_UNMAPPED, addr, faultAccess);
	return 0;
}

void Memory::writeVramU16LE(uint32_t addr, uint32_t value) {
	u8 bytes[2] = {0, 0};
	writeLE16(bytes, value);
	m_vramWriter->writeVram(addr, bytes, 2);
}

void Memory::writeVramU32LE(uint32_t addr, uint32_t value) {
	u8 bytes[4] = {0, 0, 0, 0};
	writeLE32(bytes, value);
	m_vramWriter->writeVram(addr, bytes, 4);
}

Value Memory::readIoSlotValue(int slot, uint32_t addr) const {
	const IoReadBinding& binding = m_ioReadHandlers[static_cast<size_t>(slot)];
	if (binding.handler != nullptr) {
		return binding.handler(binding.context, addr);
	}
	return m_ioSlots[static_cast<size_t>(slot)];
}

void Memory::writeIoSlotValue(int slot, uint32_t addr, Value value) {
	const size_t slotIndex = static_cast<size_t>(slot);
	m_ioSlots[slotIndex] = value;
	const IoWriteBinding& binding = m_ioWriteHandlers[slotIndex];
	if (binding.handler != nullptr) {
		binding.handler(binding.context, addr, value);
	}
}

int Memory::requireIoAlignedSlot(uint32_t addr) const {
	const int slot = ioAlignedSlot(addr);
	if (slot < 0) {
		throw std::runtime_error("I/O fault @ " + formatNumberAsHex(addr, 8) + ": invalid register.");
	}
	return slot;
}

bool Memory::writeRamU8(uint32_t addr, u8 value) {
	if (addr < RAM_BASE) {
		return false;
	}
	const size_t offset = static_cast<size_t>(addr - RAM_BASE);
	if (offset >= m_ram.size()) {
		return false;
	}
	m_ram[offset] = value;
	return true;
}

bool Memory::writeRamWordLE(uint32_t addr, size_t byteLength, uint32_t value) {
	if (addr < RAM_BASE) {
		return false;
	}
	const size_t offset = static_cast<size_t>(addr - RAM_BASE);
	if (offset + byteLength > m_ram.size()) {
		return false;
	}
	if (byteLength == 2) {
		writeLE16(m_ram.data() + offset, value);
	} else {
		writeLE32(m_ram.data() + offset, value);
	}
	return true;
}

void Memory::markRoots(GcHeap& heap) const {
	for (const Value& value : m_ioSlots) {
		heap.markValue(value);
	}
}

void Memory::clearIoSlots() {
	for (Value& value : m_ioSlots) {
		value = valueNil();
	}
	clearBusFault();
}

void Memory::clearBusFault() {
	m_busFaultCode = BUS_FAULT_NONE;
	m_busFaultAddr = 0;
	m_busFaultAccess = 0;
	writeBusFaultSlots();
}

Value Memory::readValue(uint32_t addr) const {
	const int slot = ioAlignedSlot(addr);
	if (slot >= 0) {
		return readIoSlotValue(slot, addr);
	}
	if (addressRangeWithin(addr, PROGRAM_ROM_BASE, PROGRAM_ROM_SIZE, 4)) {
		return valueNumber(static_cast<double>(readProgramCodeWord(addr)));
	}
	if (addr < RAM_BASE) {
		return valueFromNumber(static_cast<double>(readU32FromRegion(addr)));
	}
	return valueFromNumber(static_cast<double>(readU32(addr)));
}

Value Memory::readMappedValue(uint32_t addr) const {
	if (isVramMappedContiguousRange(addr, 4)) {
		u8 bytes[4] = {0, 0, 0, 0};
		m_vramWriter->readVram(addr, bytes, 4);
		return valueNumber(static_cast<double>(readLE32(bytes)));
	}
	if (isVramMappedRange(addr, 4)) {
		raiseBusFault(BUS_FAULT_VRAM_RANGE, addr, BUS_ACCESS_READ_WORD);
		return valueNumber(0.0);
	}
	const int slot = ioAlignedSlot(addr);
	if (slot >= 0) {
		return readIoSlotValue(slot, addr);
	}
	if (isIoRegionRange(addr, 4)) {
		raiseBusFault(BUS_FAULT_UNALIGNED_IO, addr, BUS_ACCESS_READ_WORD);
		return valueNumber(0.0);
	}
	if (addressRangeWithin(addr, PROGRAM_ROM_BASE, PROGRAM_ROM_SIZE, 4)) {
		return valueNumber(static_cast<double>(readProgramCodeWord(addr)));
	}
	const u8* region = nullptr;
	size_t offset = 0;
	if (addressRangeOffset(addr, SYSTEM_ROM_BASE, m_systemRom.size, 4, offset)) {
		region = m_systemRom.data;
	} else if (m_cartRom.data != nullptr && addressRangeOffset(addr, CART_ROM_BASE, m_cartRom.size, 4, offset)) {
		region = m_cartRom.data;
	} else if (m_overlayRom.data != nullptr && addressRangeOffset(addr, OVERLAY_ROM_BASE, m_overlayRom.size, 4, offset)) {
		region = m_overlayRom.data;
	} else if (addr >= RAM_BASE) {
		offset = static_cast<size_t>(addr - RAM_BASE);
		if (offset + 4 > m_ram.size()) {
			raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_READ_WORD);
			return valueNumber(0.0);
		}
		region = m_ram.data();
	} else {
		raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_READ_WORD);
		return valueNumber(0.0);
	}
	return valueNumber(static_cast<double>(readLE32(region + offset)));
}

void Memory::writeValue(uint32_t addr, Value value) {
	const int slot = ioAlignedSlot(addr);
	if (slot >= 0) {
		writeIoSlotValue(slot, addr, value);
		return;
	}
	writeU32(addr, toU32(value));
}

void Memory::writeIoValue(uint32_t addr, Value value) {
	const int slot = ioAlignedSlot(addr);
	if (slot < 0) {
		raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_WRITE_WORD);
		return;
	}
	m_ioSlots[static_cast<size_t>(slot)] = value;
}

void Memory::writeMappedValue(uint32_t addr, Value value) {
	const int slot = ioAlignedSlot(addr);
	if (slot >= 0) {
		if (isLuaReadOnlyIoAddress(addr)) {
			raiseBusFault(BUS_FAULT_READ_ONLY, addr, BUS_ACCESS_WRITE_WORD);
			return;
		}
		writeIoSlotValue(slot, addr, value);
		return;
	}
	if (isIoRegionRange(addr, 4)) {
		raiseBusFault(BUS_FAULT_UNALIGNED_IO, addr, BUS_ACCESS_WRITE_WORD);
		return;
	}
	if (isVramMappedContiguousRange(addr, 4)) {
		const uint32_t word = toU32(value);
		writeVramU32LE(addr, word);
		return;
	}
	if (isVramMappedRange(addr, 4)) {
		raiseBusFault(BUS_FAULT_VRAM_RANGE, addr, BUS_ACCESS_WRITE_WORD);
		return;
	}
	if (writeRamWordLE(addr, 4, toU32(value))) {
		return;
	}
	raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_WRITE_WORD);
}

u8 Memory::readU8(uint32_t addr) const {
	if (isVramMappedRange(addr, 1)) {
		raiseBusFault(BUS_FAULT_VRAM_RANGE, addr, BUS_ACCESS_READ_U8);
		return 0;
	}
	return readMainMemoryU8(addr, BUS_ACCESS_READ_U8);
}

u8 Memory::readMappedU8(uint32_t addr) const {
	if (isVramMappedRange(addr, 1)) {
		u8 value = 0;
		m_vramWriter->readVram(addr, &value, 1);
		return value;
	}
	const int slot = ioAlignedSlot(addr);
	if (slot >= 0) {
		return static_cast<u8>(toU32(readIoSlotValue(slot, addr)) & 0xffu);
	}
	if (isIoRegionRange(addr, 1)) {
		raiseBusFault(BUS_FAULT_UNALIGNED_IO, addr, BUS_ACCESS_READ_U8);
		return 0;
	}
	return readMainMemoryU8(addr, BUS_ACCESS_READ_U8);
}

void Memory::writeU8(uint32_t addr, u8 value) {
	if (isVramMappedRange(addr, 1)) {
		m_vramWriter->writeVram(addr, &value, 1);
		return;
	}
	if (m_overlayRom.data != nullptr && addr >= OVERLAY_ROM_BASE && addr < OVERLAY_ROM_BASE + m_overlayRom.size) {
		m_overlayRom.data[static_cast<size_t>(addr - OVERLAY_ROM_BASE)] = value;
		return;
	}
	if (writeRamU8(addr, value)) {
		return;
	}
	raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_WRITE_U8);
}

void Memory::writeMappedU8(uint32_t addr, u8 value) {
	if (isIoRegionRange(addr, 1)) {
		raiseBusFault(BUS_FAULT_UNALIGNED_IO, addr, BUS_ACCESS_WRITE_U8);
		return;
	}
	if (isVramMappedRange(addr, 1)) {
		m_vramWriter->writeVram(addr, &value, 1);
		return;
	}
	if (writeRamU8(addr, value)) {
		return;
	}
	raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_WRITE_U8);
}

uint32_t Memory::readIoU32(uint32_t addr) const {
	const int slot = ioAlignedSlot(addr);
	if (slot < 0) {
		raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_READ_U32);
		return 0;
	}
	return toU32(readIoSlotValue(slot, addr));
}

int32_t Memory::readIoI32(uint32_t addr) const {
	const int slot = ioAlignedSlot(addr);
	if (slot < 0) {
		raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_READ_U32);
		return 0;
	}
	return static_cast<int32_t>(toU32(readIoSlotValue(slot, addr)));
}

uint32_t Memory::readU32(uint32_t addr) const {
	if (isVramMappedRange(addr, 4)) {
		raiseBusFault(BUS_FAULT_VRAM_RANGE, addr, BUS_ACCESS_READ_U32);
		return 0;
	}
	if (addressRangeWithin(addr, PROGRAM_ROM_BASE, PROGRAM_ROM_SIZE, 4)) {
		return readProgramCodeWord(addr);
	}
	if (addr < RAM_BASE) {
		return readU32FromRegion(addr);
	}
	const size_t offset = static_cast<size_t>(addr - RAM_BASE);
	if (offset + sizeof(uint32_t) > m_ram.size()) {
		raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_READ_U32);
		return 0;
	}
	return readLE32(m_ram.data() + offset);
}

uint32_t Memory::readU32FromRegion(uint32_t addr) const {
	const u8* region = nullptr;
	size_t offset = 0;
	if (isProgramCodeReadableRange(addr, 4)) {
		region = m_programCode.data;
		offset = static_cast<size_t>(addr - PROGRAM_ROM_BASE);
	} else if (addressRangeOffset(addr, SYSTEM_ROM_BASE, m_systemRom.size, 4, offset)) {
		region = m_systemRom.data;
	} else if (m_cartRom.data != nullptr && addressRangeOffset(addr, CART_ROM_BASE, m_cartRom.size, 4, offset)) {
		region = m_cartRom.data;
	} else if (m_overlayRom.data != nullptr && addressRangeOffset(addr, OVERLAY_ROM_BASE, m_overlayRom.size, 4, offset)) {
		region = m_overlayRom.data;
	} else {
		raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_READ_U32);
		return 0;
	}
	return readLE32(region + offset);
}

uint32_t Memory::readMappedU16LE(uint32_t addr) const {
	if (isVramMappedContiguousRange(addr, 2)) {
		u8 bytes[2] = {0, 0};
		m_vramWriter->readVram(addr, bytes, 2);
		return readLE16(bytes);
	}
	if (isVramMappedRange(addr, 2)) {
		raiseBusFault(BUS_FAULT_VRAM_RANGE, addr, BUS_ACCESS_READ_U16);
		return 0;
	}
	if (isIoRegionRange(addr, 2)) {
		raiseBusFault(BUS_FAULT_UNALIGNED_IO, addr, BUS_ACCESS_READ_U16);
		return 0;
	}
	const u8* region = nullptr;
	size_t offset = 0;
	if (isProgramCodeReadableRange(addr, 2)) {
		region = m_programCode.data;
		offset = static_cast<size_t>(addr - PROGRAM_ROM_BASE);
	} else if (addressRangeOffset(addr, SYSTEM_ROM_BASE, m_systemRom.size, 2, offset)) {
		region = m_systemRom.data;
	} else if (m_cartRom.data != nullptr && addressRangeOffset(addr, CART_ROM_BASE, m_cartRom.size, 2, offset)) {
		region = m_cartRom.data;
	} else if (m_overlayRom.data != nullptr && addressRangeOffset(addr, OVERLAY_ROM_BASE, m_overlayRom.size, 2, offset)) {
		region = m_overlayRom.data;
	} else if (addr >= RAM_BASE) {
		offset = static_cast<size_t>(addr - RAM_BASE);
		if (offset + 2 > m_ram.size()) {
			raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_READ_U16);
			return 0;
		}
		region = m_ram.data();
	} else {
		raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_READ_U16);
		return 0;
	}
	return readLE16(region + offset);
}

uint32_t Memory::readMappedU32LE(uint32_t addr) const {
	if (isVramMappedContiguousRange(addr, 4)) {
		u8 bytes[4] = {0, 0, 0, 0};
		m_vramWriter->readVram(addr, bytes, 4);
		return readLE32(bytes);
	}
	if (isVramMappedRange(addr, 4)) {
		raiseBusFault(BUS_FAULT_VRAM_RANGE, addr, BUS_ACCESS_READ_U32);
		return 0;
	}
	const int slot = ioAlignedSlot(addr);
	if (slot >= 0) {
		return toU32(readIoSlotValue(slot, addr));
	}
	if (isIoRegionRange(addr, 4)) {
		raiseBusFault(BUS_FAULT_UNALIGNED_IO, addr, BUS_ACCESS_READ_U32);
		return 0;
	}
	const u8* region = nullptr;
	size_t offset = 0;
	if (isProgramCodeReadableRange(addr, 4)) {
		region = m_programCode.data;
		offset = static_cast<size_t>(addr - PROGRAM_ROM_BASE);
	} else if (addressRangeOffset(addr, SYSTEM_ROM_BASE, m_systemRom.size, 4, offset)) {
		region = m_systemRom.data;
	} else if (m_cartRom.data != nullptr && addressRangeOffset(addr, CART_ROM_BASE, m_cartRom.size, 4, offset)) {
		region = m_cartRom.data;
	} else if (m_overlayRom.data != nullptr && addressRangeOffset(addr, OVERLAY_ROM_BASE, m_overlayRom.size, 4, offset)) {
		region = m_overlayRom.data;
	} else if (addr >= RAM_BASE) {
		offset = static_cast<size_t>(addr - RAM_BASE);
		if (offset + 4 > m_ram.size()) {
			raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_READ_U32);
			return 0;
		}
		region = m_ram.data();
	} else {
		raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_READ_U32);
		return 0;
	}
	return readLE32(region + offset);
}

float Memory::readMappedF32LE(uint32_t addr) const {
	if (!isMappedReadableRange(addr, 4)) {
		const uint32_t code = isIoRegionRange(addr, 4)
			? BUS_FAULT_UNALIGNED_IO
			: (isVramMappedRange(addr, 4) ? BUS_FAULT_VRAM_RANGE : BUS_FAULT_UNMAPPED);
		raiseBusFault(code, addr, BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_F32);
		return 0.0f;
	}
	const uint32_t bits = readMappedU32LE(addr);
	float value = 0.0f;
	std::memcpy(&value, &bits, sizeof(value));
	return value;
}

double Memory::readMappedF64LE(uint32_t addr) const {
	if (!isMappedReadableRange(addr, 8)) {
		const uint32_t code = isIoRegionRange(addr, 8)
			? BUS_FAULT_UNALIGNED_IO
			: (isVramMappedRange(addr, 8) ? BUS_FAULT_VRAM_RANGE : BUS_FAULT_UNMAPPED);
		raiseBusFault(code, addr, BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_F64);
		return 0.0;
	}
	const uint64_t lo = static_cast<uint64_t>(readMappedU32LE(addr));
	const uint64_t hi = static_cast<uint64_t>(readMappedU32LE(addr + 4));
	const uint64_t bits = (hi << 32) | lo;
	double value = 0.0;
	std::memcpy(&value, &bits, sizeof(value));
	return value;
}

void Memory::writeU32(uint32_t addr, uint32_t value) {
	if (isVramMappedRange(addr, 4)) {
		writeVramU32LE(addr, value);
		return;
	}
	if (!writeRamWordLE(addr, 4, value)) {
		raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_WRITE_U32);
		return;
	}
}

void Memory::writeMappedU16LE(uint32_t addr, uint32_t value) {
	if (isIoRegionRange(addr, 2)) {
		raiseBusFault(BUS_FAULT_UNALIGNED_IO, addr, BUS_ACCESS_WRITE_U16);
		return;
	}
	if (isVramMappedContiguousRange(addr, 2)) {
		writeVramU16LE(addr, value);
		return;
	}
	if (isVramMappedRange(addr, 2)) {
		raiseBusFault(BUS_FAULT_VRAM_RANGE, addr, BUS_ACCESS_WRITE_U16);
		return;
	}
	if (writeRamWordLE(addr, 2, value)) {
		return;
	}
	raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_WRITE_U16);
}

void Memory::writeMappedU32LE(uint32_t addr, uint32_t value) {
	const int slot = ioAlignedSlot(addr);
	if (slot >= 0) {
		if (isLuaReadOnlyIoAddress(addr)) {
			raiseBusFault(BUS_FAULT_READ_ONLY, addr, BUS_ACCESS_WRITE_U32);
			return;
		}
		const Value word = valueNumber(static_cast<double>(value));
		writeIoSlotValue(slot, addr, word);
		return;
	}
	if (isIoRegionRange(addr, 4)) {
		raiseBusFault(BUS_FAULT_UNALIGNED_IO, addr, BUS_ACCESS_WRITE_U32);
		return;
	}
	if (isVramMappedContiguousRange(addr, 4)) {
		writeVramU32LE(addr, value);
		return;
	}
	if (isVramMappedRange(addr, 4)) {
		raiseBusFault(BUS_FAULT_VRAM_RANGE, addr, BUS_ACCESS_WRITE_U32);
		return;
	}
	if (writeRamWordLE(addr, 4, value)) {
		return;
	}
	raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_WRITE_U32);
}

void Memory::writeMappedF32LE(uint32_t addr, float value) {
	if (!isMappedWritableRange(addr, 4)) {
		const uint32_t code = isIoRegionRange(addr, 4)
			? (ioAlignedSlot(addr) >= 0 ? BUS_FAULT_READ_ONLY : BUS_FAULT_UNALIGNED_IO)
			: (isVramMappedRange(addr, 4) ? BUS_FAULT_VRAM_RANGE : BUS_FAULT_UNMAPPED);
		raiseBusFault(code, addr, BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_F32);
		return;
	}
	uint32_t bits = 0;
	std::memcpy(&bits, &value, sizeof(bits));
	writeMappedU32LE(addr, bits);
}

void Memory::writeMappedF64LE(uint32_t addr, double value) {
	if (!isMappedWritableRange(addr, 8)) {
		const uint32_t code = isIoRegionRange(addr, 8)
			? BUS_FAULT_UNALIGNED_IO
			: (isVramMappedRange(addr, 8) ? BUS_FAULT_VRAM_RANGE : BUS_FAULT_UNMAPPED);
		raiseBusFault(code, addr, BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_F64);
		return;
	}
	uint64_t bits = 0;
	std::memcpy(&bits, &value, sizeof(bits));
	writeMappedU32LE(addr, static_cast<uint32_t>(bits & 0xffffffffull));
	writeMappedU32LE(addr + 4, static_cast<uint32_t>(bits >> 32));
}

bool Memory::writeBytes(uint32_t addr, const u8* data, size_t length) {
	if (isVramMappedRange(addr, length)) {
		m_vramWriter->writeVram(addr, data, length);
		return true;
	}
	size_t offset = 0;
	if (m_overlayRom.data != nullptr && addressRangeOffset(addr, OVERLAY_ROM_BASE, m_overlayRom.size, length, offset)) {
		std::memcpy(m_overlayRom.data + offset, data, length);
		return true;
	}
	if (addr >= RAM_BASE) {
		offset = static_cast<size_t>(addr - RAM_BASE);
		if (offset + length <= m_ram.size()) {
			std::memcpy(m_ram.data() + offset, data, length);
			return true;
		}
	}
	raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_U8);
	return false;
}

bool Memory::readBytes(uint32_t addr, u8* out, size_t length) const {
	if (isVramMappedRange(addr, length)) {
		std::memset(out, 0, length);
		raiseBusFault(BUS_FAULT_VRAM_RANGE, addr, BUS_ACCESS_READ_U8);
		return false;
	}
	size_t offset = 0;
	if (isProgramCodeReadableRange(addr, length)) {
		std::memcpy(out, m_programCode.data + static_cast<size_t>(addr - PROGRAM_ROM_BASE), length);
		return true;
	}
	if (addressRangeOffset(addr, SYSTEM_ROM_BASE, m_systemRom.size, length, offset)) {
		std::memcpy(out, m_systemRom.data + offset, length);
		return true;
	}
	if (m_cartRom.data != nullptr && addressRangeOffset(addr, CART_ROM_BASE, m_cartRom.size, length, offset)) {
		std::memcpy(out, m_cartRom.data + offset, length);
		return true;
	}
	if (m_overlayRom.data != nullptr && addressRangeOffset(addr, OVERLAY_ROM_BASE, m_overlayRom.size, length, offset)) {
		std::memcpy(out, m_overlayRom.data + offset, length);
		return true;
	}
	if (addr >= RAM_BASE) {
		offset = static_cast<size_t>(addr - RAM_BASE);
		if (offset + length <= m_ram.size()) {
			std::memcpy(out, m_ram.data() + offset, length);
			return true;
		}
	}
	std::memset(out, 0, length);
	raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_U8);
	return false;
}

bool Memory::isReadableMainMemoryRange(uint32_t addr, size_t length) const {
	const bool isReadableRam = addr >= RAM_BASE
		&& length <= m_ram.size()
		&& static_cast<size_t>(addr - RAM_BASE) <= m_ram.size() - length;
	return isProgramCodeReadableRange(addr, length)
		|| isRangeWithinRegion(addr, length, SYSTEM_ROM_BASE, static_cast<uint32_t>(m_systemRom.size))
		|| (m_cartRom.data != nullptr && isRangeWithinRegion(addr, length, CART_ROM_BASE, static_cast<uint32_t>(m_cartRom.size)))
		|| (m_overlayRom.data != nullptr && isRangeWithinRegion(addr, length, OVERLAY_ROM_BASE, static_cast<uint32_t>(m_overlayRom.size)))
		|| isReadableRam;
}

bool Memory::isRamRange(uint32_t addr, size_t length) const {
	return addr >= RAM_BASE
		&& length <= m_ram.size()
		&& static_cast<size_t>(addr - RAM_BASE) <= m_ram.size() - length;
}

void Memory::onBusFaultAckWriteThunk(void* context, uint32_t addr, Value value) {
	Memory* memory = static_cast<Memory*>(context);
	memory->onBusFaultAckWrite(addr, value);
}

void Memory::onBusFaultAckWrite(uint32_t addr, Value value) {
	(void)addr;
	if (toU32(value) != 0u) {
		clearBusFault();
	}
}

void Memory::raiseBusFault(uint32_t code, uint32_t addr, uint32_t access) const {
	if (m_busFaultCode != BUS_FAULT_NONE) {
		return;
	}
	m_busFaultCode = code;
	m_busFaultAddr = addr;
	m_busFaultAccess = access;
	writeBusFaultSlots();
}

void Memory::writeBusFaultSlots() const {
	m_ioSlots[IO_SYS_BUS_FAULT_CODE_SLOT] = valueNumber(static_cast<double>(m_busFaultCode));
	m_ioSlots[IO_SYS_BUS_FAULT_ADDR_SLOT] = valueNumber(static_cast<double>(m_busFaultAddr));
	m_ioSlots[IO_SYS_BUS_FAULT_ACCESS_SLOT] = valueNumber(static_cast<double>(m_busFaultAccess));
	m_ioSlots[IO_SYS_BUS_FAULT_ACK_SLOT] = valueNumber(0.0);
}

bool Memory::isIoRegionRange(uint32_t addr, size_t length) const {
	return addressRangeWithin(addr, IO_BASE, m_ioSlots.size() * IO_WORD_SIZE, length);
}

bool Memory::isRangeWithinRegion(uint32_t addr, size_t length, uint32_t base, uint32_t size) const {
	return addressRangeWithin(addr, base, static_cast<size_t>(size), length);
}

bool Memory::isLuaReadOnlyIoAddress(uint32_t addr) const {
	switch (addr) {
		case IO_SYS_BUS_FAULT_CODE:
		case IO_SYS_BUS_FAULT_ADDR:
		case IO_SYS_BUS_FAULT_ACCESS:
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
		case IO_APU_FAULT_CODE:
		case IO_APU_FAULT_DETAIL:
		case IO_APU_EVENT_KIND:
		case IO_APU_EVENT_SLOT:
		case IO_APU_EVENT_SOURCE_ADDR:
		case IO_APU_EVENT_SEQ:
		case IO_VDP_RD_STATUS:
		case IO_VDP_RD_DATA:
		case IO_VDP_STATUS:
		case IO_VDP_FAULT_CODE:
		case IO_VDP_FAULT_DETAIL:
			return true;
		default:
			return false;
	}
}

bool Memory::isMappedWritableRange(uint32_t addr, size_t length) const {
	if (isIoRegionRange(addr, length)) {
		return length == IO_WORD_SIZE && ioAlignedSlot(addr) >= 0 && !isLuaReadOnlyIoAddress(addr);
	}
	if (addressRangeWithin(addr, PROGRAM_ROM_BASE, PROGRAM_ROM_SIZE, length)) {
		return false;
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
	if (isVramMappedRange(addr, length)) {
		return isVramMappedContiguousRange(addr, length);
	}
	return addr >= RAM_BASE
		&& length <= m_ram.size()
		&& static_cast<size_t>(addr - RAM_BASE) <= m_ram.size() - length;
}

bool Memory::isMappedReadableRange(uint32_t addr, size_t length) const {
	if (isIoRegionRange(addr, length)) {
		return length == IO_WORD_SIZE && ioAlignedSlot(addr) >= 0;
	}
	if (isProgramCodeReadableRange(addr, length)) {
		return true;
	}
	if (isRangeWithinRegion(addr, length, SYSTEM_ROM_BASE, static_cast<uint32_t>(m_systemRom.size))) {
		return true;
	}
	if (m_cartRom.data != nullptr && isRangeWithinRegion(addr, length, CART_ROM_BASE, static_cast<uint32_t>(m_cartRom.size))) {
		return true;
	}
	if (m_overlayRom.data != nullptr && isRangeWithinRegion(addr, length, OVERLAY_ROM_BASE, static_cast<uint32_t>(m_overlayRom.size))) {
		return true;
	}
	if (isVramMappedRange(addr, length)) {
		return isVramMappedContiguousRange(addr, length);
	}
	return addr >= RAM_BASE
		&& length <= m_ram.size()
		&& static_cast<size_t>(addr - RAM_BASE) <= m_ram.size() - length;
}

bool Memory::isProgramCodeReadableRange(uint32_t addr, size_t length) const {
	return m_programCode.data != nullptr
		&& addressRangeWithin(addr, PROGRAM_ROM_BASE, m_programCode.size, length);
}

uint32_t Memory::readProgramCodeWord(uint32_t addr) const {
	if (!isProgramCodeReadableRange(addr, 4)) {
		return 0;
	}
	const size_t offset = static_cast<size_t>(addr - PROGRAM_ROM_BASE);
	const u8* code = m_programCode.data;
	return (static_cast<uint32_t>(code[offset]) << 24)
		| (static_cast<uint32_t>(code[offset + 1]) << 16)
		| (static_cast<uint32_t>(code[offset + 2]) << 8)
		| static_cast<uint32_t>(code[offset + 3]);
}

} // namespace bmsx
