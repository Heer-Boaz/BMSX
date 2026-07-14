#include "machine/memory/memory.h"
#include "common/endian.h"

#include <cstring>

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

inline uint32_t readRomWindowU16LE(const u8* data, size_t size, size_t offset) {
	if (offset + 2u <= size) {
		return readLE16(data + offset);
	}
	if (offset >= size) {
		return 0u;
	}
	return static_cast<uint32_t>(data[offset]);
}

inline uint32_t readRomWindowU32LE(const u8* data, size_t size, size_t offset) {
	if (offset + 4u <= size) {
		return readLE32(data + offset);
	}
	if (offset >= size) {
		return 0u;
	}
	uint32_t value = static_cast<uint32_t>(data[offset]);
	const size_t remaining = size - offset;
	if (remaining >= 2u) {
		value |= static_cast<uint32_t>(data[offset + 1u]) << 8u;
	}
	if (remaining >= 3u) {
		value |= static_cast<uint32_t>(data[offset + 2u]) << 16u;
	}
	return value;
}

inline void readRomWindowBytes(const u8* data, size_t size, size_t offset, u8* out, size_t length) {
	if (offset >= size) {
		std::memset(out, 0, length);
		return;
	}
	const size_t available = size - offset;
	if (length <= available) {
		std::memcpy(out, data + offset, length);
		return;
	}
	std::memcpy(out, data + offset, available);
	std::memset(out + available, 0, length - available);
}

} // namespace

Memory::Memory(const MemoryInit& init)
	: m_systemRom{ init.systemRom.data, init.systemRom.size }
	, m_cartRom{ init.cartRom.data, init.cartRom.size }
	, m_programRom{ nullptr, 0 }
	, m_programTextByteLength(0)
	, m_ram(RAM_END - RAM_BASE)
	, m_ioSlots(IO_SLOT_COUNT, valueNil())
	, m_ioReadHandlers(IO_SLOT_COUNT)
	, m_ioWriteHandlers(IO_SLOT_COUNT) {
	m_ioWriteHandlers[IO_SYS_BUS_FAULT_ACK_SLOT] = { this, &Memory::onBusFaultAckWriteThunk };
	clearBusFault();
}


void Memory::mapIoRead(uint32_t addr, void* context, IoReadHandler handler) {
	m_ioReadHandlers[static_cast<size_t>((addr - IO_BASE) / IO_WORD_SIZE)] = { context, handler };
}

void Memory::mapIoWrite(uint32_t addr, void* context, IoWriteHandler handler) {
	IoWriteBinding& binding = m_ioWriteHandlers[static_cast<size_t>((addr - IO_BASE) / IO_WORD_SIZE)];
	binding.context = context;
	binding.handler = handler;
}

void Memory::mapIoWriteReady(uint32_t addr, IoWriteReadyHandler handler) {
	m_ioWriteHandlers[static_cast<size_t>((addr - IO_BASE) / IO_WORD_SIZE)].ready = handler;
}

bool Memory::mappedWriteReady(uint32_t addr) {
	const int slot = ioAlignedSlot(addr);
	if (slot < 0) return true;
	IoWriteBinding& binding = m_ioWriteHandlers[static_cast<size_t>(slot)];
	return binding.ready == nullptr || binding.ready(binding.context, addr);
}

void Memory::setProgramRom(const u8* data, size_t size, size_t textByteLength) {
	m_programRom = { data, size };
	m_programTextByteLength = textByteLength;
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
	std::memcpy(m_ram.data(), state.ram.data(), state.ram.size());
	m_busFaultCode = state.busFaultCode;
	m_busFaultAddr = state.busFaultAddr;
	m_busFaultAccess = state.busFaultAccess;
	writeBusFaultSlots();
}

u8 Memory::readMainMemoryU8(uint32_t addr, uint32_t faultAccess) const {
	if (isProgramRomReadableRange(addr, 1)) {
		const size_t offset = static_cast<size_t>(addr - PROGRAM_ROM_BASE);
		return offset < m_programRom.size ? m_programRom.data[offset] : 0u;
	}
	if (addr >= SYSTEM_ROM_BASE && addr < SYSTEM_ROM_BASE + SYSTEM_ROM_SIZE) {
		const size_t offset = static_cast<size_t>(addr - SYSTEM_ROM_BASE);
		return offset < m_systemRom.size ? m_systemRom.data[offset] : 0u;
	}
	if (addr >= CART_ROM_BASE && addr < CART_ROM_BASE + CART_ROM_SIZE) {
		const size_t offset = static_cast<size_t>(addr - CART_ROM_BASE);
		return offset < m_cartRom.size ? m_cartRom.data[offset] : 0u;
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
		return valueNumber(static_cast<double>(readProgramRomWord(addr)));
	}
	if (addr < RAM_BASE) {
		return valueFromNumber(static_cast<double>(readSystemOrCartRomU32(addr)));
	}
	return valueFromNumber(static_cast<double>(readU32(addr)));
}

Value Memory::readMappedValue(uint32_t addr) const {
	const int slot = ioAlignedSlot(addr);
	if (slot >= 0) {
		return readIoSlotValue(slot, addr);
	}
	if (isIoRegionRange(addr, 4)) {
		raiseBusFault(BUS_FAULT_UNALIGNED_IO, addr, BUS_ACCESS_READ_WORD);
		return valueNumber(0.0);
	}
	if (addressRangeWithin(addr, PROGRAM_ROM_BASE, PROGRAM_ROM_SIZE, 4)) {
		return valueNumber(static_cast<double>(readProgramRomWord(addr)));
	}
	size_t offset = 0;
	if (addressRangeOffset(addr, SYSTEM_ROM_BASE, SYSTEM_ROM_SIZE, 4, offset)) {
		return valueNumber(static_cast<double>(readRomWindowU32LE(m_systemRom.data, m_systemRom.size, offset)));
	} else if (addressRangeOffset(addr, CART_ROM_BASE, CART_ROM_SIZE, 4, offset)) {
		return valueNumber(static_cast<double>(readRomWindowU32LE(m_cartRom.data, m_cartRom.size, offset)));
	} else if (addr >= RAM_BASE) {
		offset = static_cast<size_t>(addr - RAM_BASE);
		if (offset + 4 > m_ram.size()) {
			raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_READ_WORD);
			return valueNumber(0.0);
		}
		return valueNumber(static_cast<double>(readLE32(m_ram.data() + offset)));
	} else {
		raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_READ_WORD);
		return valueNumber(0.0);
	}
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
	m_ioSlots[static_cast<size_t>((addr - IO_BASE) / IO_WORD_SIZE)] = value;
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
	if (writeRamWordLE(addr, 4, toU32(value))) {
		return;
	}
	raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_WRITE_WORD);
}

u8 Memory::readU8(uint32_t addr) const {
	return readMainMemoryU8(addr, BUS_ACCESS_READ_U8);
}

u8 Memory::readMappedU8(uint32_t addr) const {
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
	if (writeRamU8(addr, value)) {
		return;
	}
	raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_WRITE_U8);
}

uint32_t Memory::readIoU32(uint32_t addr) const {
	return toU32(readIoSlotValue(static_cast<int>((addr - IO_BASE) / IO_WORD_SIZE), addr));
}

int32_t Memory::readIoI32(uint32_t addr) const {
	return static_cast<int32_t>(toU32(readIoSlotValue(static_cast<int>((addr - IO_BASE) / IO_WORD_SIZE), addr)));
}

uint32_t Memory::readU32(uint32_t addr) const {
	if (addressRangeWithin(addr, PROGRAM_ROM_BASE, PROGRAM_ROM_SIZE, 4)) {
		return readProgramRomWord(addr);
	}
	if (addr < RAM_BASE) {
		return readSystemOrCartRomU32(addr);
	}
	const size_t offset = static_cast<size_t>(addr - RAM_BASE);
	if (offset + sizeof(uint32_t) > m_ram.size()) {
		raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_READ_U32);
		return 0;
	}
	return readLE32(m_ram.data() + offset);
}

uint32_t Memory::readSystemOrCartRomU32(uint32_t addr) const {
	size_t offset = 0;
	if (addressRangeOffset(addr, SYSTEM_ROM_BASE, SYSTEM_ROM_SIZE, 4, offset)) {
		return readRomWindowU32LE(m_systemRom.data, m_systemRom.size, offset);
	} else if (addressRangeOffset(addr, CART_ROM_BASE, CART_ROM_SIZE, 4, offset)) {
		return readRomWindowU32LE(m_cartRom.data, m_cartRom.size, offset);
	} else {
		raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_READ_U32);
		return 0;
	}
}

uint32_t Memory::readMappedU16LE(uint32_t addr) const {
	if (isIoRegionRange(addr, 2)) {
		raiseBusFault(BUS_FAULT_UNALIGNED_IO, addr, BUS_ACCESS_READ_U16);
		return 0;
	}
	size_t offset = 0;
	if (isProgramRomReadableRange(addr, 2)) {
		return readRomWindowU16LE(m_programRom.data, m_programRom.size, static_cast<size_t>(addr - PROGRAM_ROM_BASE));
	} else if (addressRangeOffset(addr, SYSTEM_ROM_BASE, SYSTEM_ROM_SIZE, 2, offset)) {
		return readRomWindowU16LE(m_systemRom.data, m_systemRom.size, offset);
	} else if (addressRangeOffset(addr, CART_ROM_BASE, CART_ROM_SIZE, 2, offset)) {
		return readRomWindowU16LE(m_cartRom.data, m_cartRom.size, offset);
	} else if (addr >= RAM_BASE) {
		offset = static_cast<size_t>(addr - RAM_BASE);
		if (offset + 2 > m_ram.size()) {
			raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_READ_U16);
			return 0;
		}
		return readLE16(m_ram.data() + offset);
	} else {
		raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_READ_U16);
		return 0;
	}
}

uint32_t Memory::readMappedU32LE(uint32_t addr) const {
	const int slot = ioAlignedSlot(addr);
	if (slot >= 0) {
		return toU32(readIoSlotValue(slot, addr));
	}
	if (isIoRegionRange(addr, 4)) {
		raiseBusFault(BUS_FAULT_UNALIGNED_IO, addr, BUS_ACCESS_READ_U32);
		return 0;
	}
	size_t offset = 0;
	if (isProgramRomReadableRange(addr, 4)) {
		return readRomWindowU32LE(m_programRom.data, m_programRom.size, static_cast<size_t>(addr - PROGRAM_ROM_BASE));
	} else if (addressRangeOffset(addr, SYSTEM_ROM_BASE, SYSTEM_ROM_SIZE, 4, offset)) {
		return readRomWindowU32LE(m_systemRom.data, m_systemRom.size, offset);
	} else if (addressRangeOffset(addr, CART_ROM_BASE, CART_ROM_SIZE, 4, offset)) {
		return readRomWindowU32LE(m_cartRom.data, m_cartRom.size, offset);
	} else if (addr >= RAM_BASE) {
		offset = static_cast<size_t>(addr - RAM_BASE);
		if (offset + 4 > m_ram.size()) {
			raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_READ_U32);
			return 0;
		}
		return readLE32(m_ram.data() + offset);
	} else {
		raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_READ_U32);
		return 0;
	}
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
	if (writeRamWordLE(addr, 4, value)) {
		return;
	}
	raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_WRITE_U32);
}

void Memory::writeMappedF32LE(uint32_t addr, float value) {
	uint32_t bits = 0;
	std::memcpy(&bits, &value, sizeof(bits));
	writeMappedU32LE(addr, bits);
}

void Memory::writeMappedF64LE(uint32_t addr, double value) {
	uint64_t bits = 0;
	std::memcpy(&bits, &value, sizeof(bits));
	writeMappedU32LE(addr, static_cast<uint32_t>(bits & 0xffffffffull));
	writeMappedU32LE(addr + 4, static_cast<uint32_t>(bits >> 32));
}

void Memory::writeBytes(uint32_t addr, const u8* data, size_t length) {
	size_t offset = 0;
	if (addr >= RAM_BASE) {
		offset = static_cast<size_t>(addr - RAM_BASE);
		if (offset + length <= m_ram.size()) {
			std::memcpy(m_ram.data() + offset, data, length);
			return;
		}
	}
	raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_U8);
}

void Memory::readBytes(uint32_t addr, u8* out, size_t length) const {
	size_t offset = 0;
	if (isProgramRomReadableRange(addr, length)) {
		readRomWindowBytes(m_programRom.data, m_programRom.size, static_cast<size_t>(addr - PROGRAM_ROM_BASE), out, length);
		return;
	}
	if (addressRangeOffset(addr, SYSTEM_ROM_BASE, SYSTEM_ROM_SIZE, length, offset)) {
		readRomWindowBytes(m_systemRom.data, m_systemRom.size, offset, out, length);
		return;
	}
	if (addressRangeOffset(addr, CART_ROM_BASE, CART_ROM_SIZE, length, offset)) {
		readRomWindowBytes(m_cartRom.data, m_cartRom.size, offset, out, length);
		return;
	}
	if (addr >= RAM_BASE) {
		offset = static_cast<size_t>(addr - RAM_BASE);
		if (offset + length <= m_ram.size()) {
			std::memcpy(out, m_ram.data() + offset, length);
			return;
		}
	}
	std::memset(out, 0, length);
	raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_U8);
}

bool Memory::isReadableMainMemoryRange(uint32_t addr, size_t length) const {
	const bool isReadableRam = addr >= RAM_BASE
		&& length <= m_ram.size()
		&& static_cast<size_t>(addr - RAM_BASE) <= m_ram.size() - length;
	return isProgramRomReadableRange(addr, length)
		|| isRangeWithinRegion(addr, length, SYSTEM_ROM_BASE, SYSTEM_ROM_SIZE)
		|| (isRangeWithinRegion(addr, length, CART_ROM_BASE, CART_ROM_SIZE))
		|| isReadableRam;
}

bool Memory::isImmutableMainMemoryRange(uint32_t addr, size_t length) const {
	return length > 0u
		&& (isRangeWithinRegion(addr, length, SYSTEM_ROM_BASE, static_cast<uint32_t>(m_systemRom.size))
			|| isRangeWithinRegion(addr, length, CART_ROM_BASE, static_cast<uint32_t>(m_cartRom.size)));
}

bool Memory::bindImmutableMainMemoryView(uint32_t addr, size_t length, Span<const u8>& out) const {
	size_t offset = 0;
	if (length > 0u && addressRangeOffset(addr, SYSTEM_ROM_BASE, m_systemRom.size, length, offset)) {
		out.data_ = m_systemRom.data + offset;
		out.size_ = length;
		return true;
	}
	if (length > 0u && addressRangeOffset(addr, CART_ROM_BASE, m_cartRom.size, length, offset)) {
		out.data_ = m_cartRom.data + offset;
		out.size_ = length;
		return true;
	}
	return false;
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
	if (addr >= IO_INP_KEYS && addr < IO_INP_OUTPUT_PORT) {
		return true; // latched keyboard/pointer/pad snapshot words
	}
	switch (addr) {
		case IO_SYS_BUS_FAULT_CODE:
		case IO_SYS_BUS_FAULT_ADDR:
		case IO_SYS_BUS_FAULT_ACCESS:
		case IO_SYS_HOST_FAULT_FLAGS:
		case IO_SYS_HOST_FAULT_STAGE:
		case IO_SYS_TIME_MS:
		case IO_SYS_FRAME_MS:
		case IO_SYS_CYCLES_PER_FRAME:
		case IO_IRQ_FLAGS:
		case IO_DMA_STATUS:
		case IO_GEO_STATUS:
		case IO_GEO_PROCESSED:
		case IO_GEO_FAULT:
		case IO_INP_STATUS:
		case IO_INP_OUTPUT_STATUS:
		case IO_APU_STATUS:
		case IO_APU_FAULT_CODE:
		case IO_APU_FAULT_DETAIL:
		case IO_APU_EVENT_KIND:
		case IO_APU_EVENT_SLOT:
		case IO_APU_EVENT_SOURCE_ADDR:
		case IO_APU_EVENT_SEQ:
		case IO_APU_SELECTED_SOURCE_ADDR:
		case IO_APU_ACTIVE_MASK:
			return true;
		default:
			return false;
	}
}

bool Memory::isProgramRomReadableRange(uint32_t addr, size_t length) const {
	return addressRangeWithin(addr, PROGRAM_ROM_BASE, PROGRAM_ROM_SIZE, length);
}

uint32_t Memory::readProgramRomWord(uint32_t addr) const {
	const size_t offset = static_cast<size_t>(addr - PROGRAM_ROM_BASE);
	if (offset >= m_programRom.size) {
		return 0;
	}
	if (offset >= m_programTextByteLength) {
		return readRomWindowU32LE(m_programRom.data, m_programRom.size, offset);
	}
	const u8* code = m_programRom.data;
	return ((offset < m_programRom.size ? static_cast<uint32_t>(code[offset]) : 0u) << 24u)
		| ((offset + 1u < m_programRom.size ? static_cast<uint32_t>(code[offset + 1u]) : 0u) << 16u)
		| ((offset + 2u < m_programRom.size ? static_cast<uint32_t>(code[offset + 2u]) : 0u) << 8u)
		| (offset + 3u < m_programRom.size ? static_cast<uint32_t>(code[offset + 3u]) : 0u);
}

} // namespace bmsx
