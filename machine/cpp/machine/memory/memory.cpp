#include "machine/memory/memory.h"

#include "common/compiler.h"
#include "common/endian.h"
#include "machine/devices/cartridge/controller.h"
#include "spec/bmsx/memory_map.h"

#include <cstring>
#include <array>

namespace bmsx {

namespace {

// Decode the physical IO word permissions once, not on every DMA/CPU write.
constexpr auto kReadOnlyIoSlots = [] {
	std::array<bool, IO_SLOT_COUNT> slots{};
	for (u32 address = IO_INP_KEYS; address < IO_INP_OUTPUT_PORT; address += IO_WORD_SIZE)
		slots[(address - IO_BASE) / IO_WORD_SIZE] = true;
	const u32 addresses[]{
		IO_SYS_BUS_FAULT_CODE,
		IO_SYS_BUS_FAULT_ADDR,
		IO_SYS_BUS_FAULT_ACCESS,
		IO_SYS_TIME_MS,
		IO_SYS_FRAME_MS_Q16,
		IO_SYS_CYCLES_PER_FRAME,
		IO_SYS_STATUS,
		IO_IRQ_FLAGS,
		IO_DMA0_STATUS,
		IO_DMA1_STATUS,
		IO_IMGDEC_STATUS,
		IO_IMGDEC_INPUT_WORDS_RECEIVED,
		IO_IMGDEC_DECODED_WORD_COUNT,
		IO_GEO_STATUS,
		IO_GEO_PROCESSED,
		IO_GEO_FAULT,
		IO_INP_STATUS,
		IO_INP_OUTPUT_STATUS,
		IO_APU_STATUS,
		IO_APU_FAULT_CODE,
		IO_APU_FAULT_DETAIL,
		IO_APU_EVENT_KIND,
		IO_APU_EVENT_SLOT,
		IO_APU_EVENT_SOURCE_ADDR,
		IO_APU_EVENT_SEQ,
		IO_APU_SELECTED_SOURCE_ADDR,
		IO_APU_ACTIVE_MASK,
		IO_CART_STATUS,
		IO_SYS_SUPERVISOR_FAULT_SEQUENCE,
		IO_SYS_SUPERVISOR_FAULT_CAUSE,
		IO_SYS_SUPERVISOR_FAULT_EPC,
		IO_SYS_SUPERVISOR_FAULT_BAD_ADDRESS,
		IO_SYS_SUPERVISOR_FAULT_LUA_REASON,
		IO_SYS_SUPERVISOR_FAULT_DOMAIN,
	};
	for (const u32 address : addresses) slots[(address - IO_BASE) / IO_WORD_SIZE] = true;
	return slots;
}();

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
constexpr uint32_t BUS_ACCESS_READ_F32 = BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_F32;
constexpr uint32_t BUS_ACCESS_READ_F64 = BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_F64;
constexpr uint32_t BUS_ACCESS_WRITE_U16 = BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_U16;
constexpr uint32_t BUS_ACCESS_WRITE_U32 = BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_U32;
constexpr uint32_t BUS_ACCESS_WRITE_F32 = BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_F32;
constexpr uint32_t BUS_ACCESS_WRITE_F64 = BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_F64;

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

Memory::Memory(const MemoryInit& init, u32 ramByteCount)
	: m_ram(ramByteCount)
	, m_ramBusEnd(RAM_BASE + ramByteCount)
	, m_ramPageWriteWatches(ramByteCount)
	, m_systemRom(init.systemRom)
	, m_cartridgeController(init.cartridgeSlots)
	, m_ioSlots(IO_SLOT_COUNT, 0u)
	, m_ioReadHandlers(IO_SLOT_COUNT)
	, m_ioWriteHandlers(IO_SLOT_COUNT) {
	m_ioWriteHandlers[IO_SYS_BUS_FAULT_ACK_SLOT] = { this, &Memory::onBusFaultAckWriteThunk };
	clearBusFault();
}

void Memory::installSystemRom(std::span<const u8> rom) {
	m_systemRom = Span<const u8>(rom);
	if (m_mappedPageInvalidator) {
		m_mappedPageInvalidator->invalidateMappedRange(
			SYSTEM_ROM_BASE,
			SYSTEM_ROM_BASE + SYSTEM_ROM_SIZE
		);
	}
}

void Memory::attachMappedPageInvalidator(MappedPageInvalidator& invalidator) {
	m_mappedPageInvalidator = &invalidator;
	m_cartridgeController.attachMappedPageInvalidator(invalidator);
}

void Memory::detachMappedPageInvalidator() {
	clearMappedPageWriteWatches();
	m_cartridgeController.detachMappedPageInvalidator();
	m_mappedPageInvalidator = nullptr;
}

void Memory::clearMappedPageWriteWatches() {
	m_ramPageWriteWatches.clear();
	m_cartridgeController.clearMappedPageWriteWatches();
}

void Memory::invalidateWatchedRamRecordWrite(u32 offset, u32 bytes) {
	invalidateRamWrite(offset, bytes);
}

void Memory::invalidateWatchedRamValueSlot(u32 word, u32 byte) {
	invalidateRamWrite(word, sizeof(u32));
	invalidateRamWrite(byte, 1u);
}

void Memory::setRamBusEnd(u32 end) {
	const u32 old = m_ramBusEnd;
	m_ramBusEnd = end;
	// The old range no longer supplies instruction words.
	if (end < old) m_ramPageWriteWatches.clearCodeRange(end - RAM_BASE, old - end);
	if (old != end && m_mappedPageInvalidator)
		m_mappedPageInvalidator->invalidateMappedRange(std::min(old, end), std::max(old, end));
}

void Memory::bindMappedPage(
	uint32_t addr,
	MappedBusSignals busSignals,
	MappedPageBinding& out
) {
	out.key = addr;
	out.readBytes = nullptr;
	out.writeWatch = {};
	if (addr < RAM_BASE) {
		out.cacheable = addr < SYSTEM_ROM_SIZE;
		if (static_cast<size_t>(addr) + MAPPED_PAGE_BYTE_SIZE <= m_systemRom.size()) {
			out.readBytes = m_systemRom.data() + addr;
		}
		return;
	}
	if (addr < CART_ROM_BASE) {
		if (addr < IO_BASE + m_ioSlots.size() * IO_WORD_SIZE) {
			out.cacheable = false;
			return;
		}
		const size_t offset = static_cast<size_t>(addr - RAM_BASE);
		if (offset < m_ram.size()) {
			out.cacheable = true;
			if (isRamRange(addr, MAPPED_PAGE_BYTE_SIZE)) {
				out.readBytes = m_ram.data() + offset;
			}
			m_ramPageWriteWatches.bind(offset, out);
			return;
		}
		out.cacheable = false;
		return;
	}
	if (addr < CART_BUS_END) {
		m_cartridgeController.bindMappedPage(addr, busSignals, out);
		return;
	}
	out.cacheable = false;
}

void Memory::mapIoRead(uint32_t addr, void* context, IoReadHandler handler) {
	const size_t slot = static_cast<size_t>((addr - IO_BASE) / IO_WORD_SIZE);
	m_ioReadHandlers[slot] = { context, handler };
	if (auto* prefix = findIoDmaPrefix(static_cast<int>(slot))) prefix->read = nullptr;
}

void Memory::mapIoWrite(uint32_t addr, void* context, IoWriteHandler handler, IoWriteStorage storage) {
	m_ioWriteStorage[(addr - IO_BASE) / IO_WORD_SIZE] = storage;
	IoWriteBinding& binding = m_ioWriteHandlers[static_cast<size_t>((addr - IO_BASE) / IO_WORD_SIZE)];
	binding.context = context;
	binding.handler = handler;
	if (auto* prefix = findIoDmaPrefix(static_cast<int>((addr - IO_BASE) / IO_WORD_SIZE))) prefix->write = nullptr;
}

void Memory::mapIoWriteReady(uint32_t addr, IoWriteReadyHandler handler) {
	const size_t slot = static_cast<size_t>((addr - IO_BASE) / IO_WORD_SIZE);
	m_ioWriteHandlers[slot].ready = handler;
	if (auto* prefix = findIoDmaPrefix(static_cast<int>(slot))) prefix->write = nullptr;
}

Memory::IoDmaPrefixBinding* Memory::findIoDmaPrefix(int slot) {
	for (auto& prefix : m_ioDmaPrefixes) if (prefix.slot == slot) return &prefix;
	return nullptr;
}

void Memory::mapIoDmaReadPrefix(u32 address, IoDmaReadPrefixHandler handler) {
	const int slot = static_cast<int>((address - IO_BASE) / IO_WORD_SIZE);
	if (auto* prefix = findIoDmaPrefix(slot)) prefix->read = handler;
	else if (handler != nullptr) m_ioDmaPrefixes.push_back({slot, handler, nullptr});
}

void Memory::mapIoDmaWritePrefix(u32 address, IoDmaWritePrefixHandler handler) {
	const int slot = static_cast<int>((address - IO_BASE) / IO_WORD_SIZE);
	if (auto* prefix = findIoDmaPrefix(slot)) prefix->write = handler;
	else if (handler != nullptr) m_ioDmaPrefixes.push_back({slot, nullptr, handler});
}

bool Memory::mappedWriteReady(uint32_t addr) {
	const int slot = ioAlignedSlot(addr);
	if (slot < 0) return true;
	IoWriteBinding& binding = m_ioWriteHandlers[static_cast<size_t>(slot)];
	return binding.ready == nullptr || binding.ready(binding.context, addr, MAPPED_BUS_MASTER_CPU);
}

u32 Memory::firstBlockedMappedWordWrite(uint32_t addr, uint32_t wordCount) {
	if (wordCount == 0u) return NO_BLOCKED_MAPPED_WRITE;
	const u64 lastAddress = static_cast<u64>(addr) + static_cast<u64>(wordCount - 1u) * IO_WORD_SIZE;
	const u64 ioEnd = static_cast<u64>(IO_BASE) + IO_SLOT_COUNT * IO_WORD_SIZE;
	if (lastAddress < IO_BASE || addr >= ioEnd) return NO_BLOCKED_MAPPED_WRITE;
	u32 writeAddress = addr < IO_BASE ? IO_BASE : addr;
	while (writeAddress <= lastAddress && writeAddress < ioEnd) {
		IoWriteBinding& binding = m_ioWriteHandlers[static_cast<size_t>((writeAddress - IO_BASE) / IO_WORD_SIZE)];
		if (binding.ready != nullptr && !binding.ready(binding.context, writeAddress, MAPPED_BUS_MASTER_CPU)) {
			return writeAddress;
		}
		writeAddress += IO_WORD_SIZE;
	}
	return NO_BLOCKED_MAPPED_WRITE;
}

MemorySaveState Memory::captureSaveState(std::vector<u8> ram) const {
	ram.assign(m_ram.begin(), m_ram.end());
	return {captureBusState(), std::move(ram)};
}

void Memory::restoreSaveState(const MemorySaveState& state) {
	std::memcpy(m_ram.data(), state.ram.data(), state.ram.size());
	restoreBusState(state);
}

MemoryBusState Memory::captureBusState() const {
	return {m_ramBusEnd, m_busFaultCode, m_busFaultAddr, m_busFaultAccess};
}

void Memory::restoreBusState(const MemoryBusState& state) {
	m_ramBusEnd = state.ramBusEnd;
	if (m_mappedPageInvalidator) {
		m_mappedPageInvalidator->invalidateMappedRange(
			RAM_BASE,
			static_cast<u64>(RAM_BASE) + m_ram.size()
		);
	}
	m_busFaultCode = state.busFaultCode;
	m_busFaultAddr = state.busFaultAddr;
	m_busFaultAccess = state.busFaultAccess;
	writeBusFaultSlots();
}

u8 Memory::readMainMemoryU8(uint32_t addr, uint32_t faultAccess) const {
	if (addr < RAM_BASE) {
		if (addr < SYSTEM_ROM_SIZE) {
			return addr < m_systemRom.size() ? m_systemRom[addr] : 0u;
		}
	} else if (addr < CART_ROM_BASE) {
		const size_t offset = static_cast<size_t>(addr - RAM_BASE);
		if (addr < m_ramBusEnd) {
			return m_ram[offset];
		}
	} else if (addr < CART_BUS_END) {
		return m_cartridgeController.readU8(addr, MAPPED_BUS_MASTER_CPU);
	}
	raiseBusFault(BUS_FAULT_UNMAPPED, addr, faultAccess);
	return 0;
}

u32 Memory::readIoSlot(int slot, uint32_t addr, MappedBusSignals busSignals) const {
	const IoReadBinding& binding = m_ioReadHandlers[static_cast<size_t>(slot)];
	if (binding.handler != nullptr) {
		return binding.handler(binding.context, addr, busSignals);
	}
	return m_ioSlots[static_cast<size_t>(slot)];
}

void Memory::writeIoSlot(int slot, uint32_t addr, u32 value, u32 faultAccess, MappedBusSignals busSignals) {
	const size_t slotIndex = static_cast<size_t>(slot);
	if (kReadOnlyIoSlots[slotIndex]) {
		raiseBusFault(BUS_FAULT_READ_ONLY, addr, faultAccess);
		return;
	}
	const IoWriteBinding& binding = m_ioWriteHandlers[slotIndex];
	if ((busSignals & MAPPED_BUS_MASTER_DMA) != 0u && binding.ready != nullptr
		&& !binding.ready(binding.context, addr, busSignals)) return;
	if (m_ioWriteStorage[slotIndex] == IoWriteStorage::Retained) m_ioSlots[slotIndex] = value;
	if (binding.handler != nullptr) {
		binding.handler(binding.context, addr, value, busSignals);
	}
}

bool Memory::writeRamU8(uint32_t addr, u8 value) {
	if (!isRamRange(addr, 1u)) return false;
	const size_t offset = addr - RAM_BASE;
	m_ram[offset] = value;
	m_ramPageWriteWatches.invalidateWrite(
		offset,
		1u,
		RAM_BASE,
		m_mappedPageInvalidator
	);
	return true;
}

bool Memory::writeRamWordLE(uint32_t addr, size_t byteLength, uint32_t value) {
	if (!isRamRange(addr, byteLength)) return false;
	const size_t offset = addr - RAM_BASE;
	if (byteLength == 2) {
		writeLE16(m_ram.data() + offset, value);
	} else {
		writeLE32(m_ram.data() + offset, value);
	}
	m_ramPageWriteWatches.invalidateWrite(
		offset,
		byteLength,
		RAM_BASE,
		m_mappedPageInvalidator
	);
	return true;
}

void Memory::clearIoSlots() {
	for (u32& value : m_ioSlots) {
		value = 0u;
	}
	clearBusFault();
}

void Memory::clearBusFault() {
	m_busFaultCode = BUS_FAULT_NONE;
	m_busFaultAddr = 0;
	m_busFaultAccess = 0;
	writeBusFaultSlots();
}

u32 Memory::readMappedWord(uint32_t addr) const {
	return readMappedBusU32LE(addr, MAPPED_BUS_MASTER_CPU, BUS_ACCESS_READ_WORD);
}

void Memory::writeIoU32(uint32_t addr, u32 value) {
	m_ioSlots[static_cast<size_t>((addr - IO_BASE) / IO_WORD_SIZE)] = value;
}

void Memory::writeMappedWord(uint32_t addr, u32 value) {
	writeMappedBusU32LE(addr, value, MAPPED_BUS_MASTER_CPU, BUS_ACCESS_WRITE_WORD);
}

u8 Memory::readU8(uint32_t addr) const {
	return readMainMemoryU8(addr, BUS_ACCESS_READ_U8);
}

u8 Memory::readMappedU8(uint32_t addr) const {
	const int slot = ioAlignedSlot(addr);
	if (slot >= 0) {
		return static_cast<u8>(readIoSlot(slot, addr, MAPPED_BUS_MASTER_CPU) & 0xffu);
	}
	if (isIoRegionRange(addr, 1)) {
		raiseBusFault(BUS_FAULT_UNALIGNED_IO, addr, BUS_ACCESS_READ_U8);
		return 0;
	}
	return readMainMemoryU8(addr, BUS_ACCESS_READ_U8);
}

void Memory::writeU8(uint32_t addr, u8 value) {
	if (addr < CART_ROM_BASE) {
		if (writeRamU8(addr, value)) {
			return;
		}
	} else if (addr < CART_BUS_END) {
		m_cartridgeController.writeU8(addr, value, MAPPED_BUS_MASTER_CPU);
		return;
	}
	raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_WRITE_U8);
}

void Memory::writeMappedU8(uint32_t addr, u8 value) {
	if (isIoRegionRange(addr, 1)) {
		raiseBusFault(BUS_FAULT_UNALIGNED_IO, addr, BUS_ACCESS_WRITE_U8);
		return;
	}
	if (addr < CART_ROM_BASE) {
		if (writeRamU8(addr, value)) {
			return;
		}
	} else if (addr < CART_BUS_END) {
		m_cartridgeController.writeU8(addr, value, MAPPED_BUS_MASTER_CPU);
		return;
	}
	raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_WRITE_U8);
}

uint32_t Memory::readIoU32(uint32_t addr) const {
	return readIoSlot(static_cast<int>((addr - IO_BASE) / IO_WORD_SIZE), addr, MAPPED_BUS_MASTER_CPU);
}

template<bool Count>
uint32_t Memory::readRawU32(uint32_t addr, MemoryWordCounters* counters) const {
	if (addr < RAM_BASE) {
		if (addr <= SYSTEM_ROM_SIZE - 4u) {
			if constexpr (Count) ++counters->systemRomWords;
			return readRomWindowU32LE(m_systemRom.data(), m_systemRom.size(), addr);
		}
	} else if (addr < CART_ROM_BASE) {
		const size_t offset = static_cast<size_t>(addr - RAM_BASE);
		if (isRamRange(addr, sizeof(u32))) {
			if constexpr (Count) ++counters->ramWords;
			return readLE32(m_ram.data() + offset);
		}
	} else if (addr <= CART_BUS_END - 4u) {
		if constexpr (Count) ++counters->cartridgeWords;
		return m_cartridgeController.readU32(addr, MAPPED_BUS_MASTER_CPU);
	}
	if constexpr (Count) ++counters->otherWords;
	raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_READ_U32);
	return 0;
}

uint32_t Memory::readU32(uint32_t addr) const {
	return readRawU32<false>(addr, nullptr);
}

uint32_t Memory::readCountedU32(uint32_t addr, MemoryWordCounters& counters) const {
	return readRawU32<true>(addr, &counters);
}

uint32_t Memory::readMappedU16LE(uint32_t addr) const {
	if (isIoRegionRange(addr, 2)) {
		raiseBusFault(BUS_FAULT_UNALIGNED_IO, addr, BUS_ACCESS_READ_U16);
		return 0;
	}
	if (addr < RAM_BASE) {
		if (addr <= SYSTEM_ROM_SIZE - 2u) {
			return readRomWindowU16LE(m_systemRom.data(), m_systemRom.size(), addr);
		}
	} else if (addr < CART_ROM_BASE) {
		const size_t offset = static_cast<size_t>(addr - RAM_BASE);
		if (isRamRange(addr, 2u)) {
			return readLE16(m_ram.data() + offset);
		}
	} else if (addr <= CART_BUS_END - 2u) {
		return m_cartridgeController.readU16(addr, MAPPED_BUS_MASTER_CPU);
	}
	raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_READ_U16);
	return 0;
}

uint32_t Memory::readMappedU32LE(uint32_t addr, uint32_t faultAccess) const {
	return readMappedBusU32LE(addr, MAPPED_BUS_MASTER_CPU, faultAccess);
}

uint32_t Memory::readMappedBusU32LE(
	uint32_t addr,
	MappedBusSignals busSignals,
	uint32_t faultAccess
) const {
	const int slot = ioAlignedSlot(addr);
	if (slot >= 0) {
		if ((busSignals & (MAPPED_BUS_INSTRUCTION_FETCH | MAPPED_BUS_DMA_MEMORY)) != 0u) {
			raiseBusFault(BUS_FAULT_UNMAPPED, addr, faultAccess);
			return 0u;
		}
		return readIoSlot(slot, addr, busSignals);
	}
	if (isIoRegionRange(addr, 4)) {
		raiseBusFault((busSignals & (MAPPED_BUS_INSTRUCTION_FETCH | MAPPED_BUS_DMA_MEMORY)) != 0u
			? BUS_FAULT_UNMAPPED : BUS_FAULT_UNALIGNED_IO, addr, faultAccess);
		return 0;
	}
	if (addr < RAM_BASE) {
		if (addr <= SYSTEM_ROM_SIZE - 4u) {
			return readRomWindowU32LE(m_systemRom.data(), m_systemRom.size(), addr);
		}
	} else if (addr < CART_ROM_BASE) {
		const size_t offset = static_cast<size_t>(addr - RAM_BASE);
		if (isRamRange(addr, 4u)) {
			return readLE32(m_ram.data() + offset);
		}
	} else if (addr <= CART_BUS_END - 4u) {
		if (addr >= CART_MMIO_BASE && (busSignals & MAPPED_BUS_INSTRUCTION_FETCH) != 0u) {
			raiseBusFault(BUS_FAULT_UNMAPPED, addr, faultAccess);
			return 0u;
		}
		return m_cartridgeController.readU32(addr, busSignals);
	}
	raiseBusFault(BUS_FAULT_UNMAPPED, addr, faultAccess);
	return 0;
}

float Memory::readMappedF32LE(uint32_t addr) const {
	const uint32_t bits = readMappedU32LE(addr, BUS_ACCESS_READ_F32);
	float value = 0.0f;
	std::memcpy(&value, &bits, sizeof(value));
	return value;
}

double Memory::readMappedF64LE(uint32_t addr) const {
	const uint32_t faultSequence = m_busFaultSequence;
	const uint64_t lo = static_cast<uint64_t>(readMappedU32LE(addr, BUS_ACCESS_READ_F64));
	if (m_busFaultSequence != faultSequence) {
		return 0.0;
	}
	const uint64_t hi = static_cast<uint64_t>(readMappedU32LE(addr + 4, BUS_ACCESS_READ_F64));
	if (m_busFaultSequence != faultSequence) {
		return 0.0;
	}
	const uint64_t bits = (hi << 32) | lo;
	double value = 0.0;
	std::memcpy(&value, &bits, sizeof(value));
	return value;
}

void Memory::writeU32(uint32_t addr, uint32_t value) {
	if (addr < CART_ROM_BASE) {
		if (writeRamWordLE(addr, 4, value)) {
			return;
		}
	} else if (addr <= CART_BUS_END - 4u) {
		m_cartridgeController.writeU32(addr, value, MAPPED_BUS_MASTER_CPU);
		return;
	}
	raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_WRITE_U32);
}

void Memory::countRawWriteU32(uint32_t addr, MemoryWordCounters& counters) const {
	if (addr < CART_ROM_BASE) {
		if (isRamRange(addr, IO_WORD_SIZE)) { ++counters.ramWords; return; }
		if (addr <= SYSTEM_ROM_SIZE - IO_WORD_SIZE) { ++counters.systemRomWords; return; }
	} else if (addr <= CART_BUS_END - IO_WORD_SIZE) {
		++counters.cartridgeWords;
		return;
	}
	++counters.otherWords;
}

void Memory::writeMappedU16LE(uint32_t addr, uint32_t value) {
	if (isIoRegionRange(addr, 2)) {
		raiseBusFault(BUS_FAULT_UNALIGNED_IO, addr, BUS_ACCESS_WRITE_U16);
		return;
	}
	if (addr < CART_ROM_BASE) {
		if (writeRamWordLE(addr, 2, value)) {
			return;
		}
	} else if (addr <= CART_BUS_END - 2u) {
		m_cartridgeController.writeU16(addr, value, MAPPED_BUS_MASTER_CPU);
		return;
	}
	raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_WRITE_U16);
}

void Memory::writeMappedU32LE(uint32_t addr, uint32_t value, uint32_t faultAccess) {
	writeMappedBusU32LE(addr, value, MAPPED_BUS_MASTER_CPU, faultAccess);
}

// Only declared end-silent FIFO ports may batch the prefix. Arbitrary MMIO
// retains per-word bus order, and every block's last read precedes its last write.
void Memory::transferDmaBlock(u32 readAddress, u32 writeAddress, u32 wordCount,
	u32 readStep, u32 writeStep, MappedBusSignals readSignals, MappedBusSignals writeSignals) {
	if (wordCount != 0u && readStep == IO_WORD_SIZE && writeStep == IO_WORD_SIZE) {
		const size_t bytes = static_cast<size_t>(wordCount) * IO_WORD_SIZE;
		Span<const u8> source;
		if (writeAddress >= IO_BASE + IO_SLOT_COUNT * IO_WORD_SIZE
			&& isRamRange(writeAddress, bytes)
			&& bindMappedReadView(readAddress, bytes, readSignals, source)) {
			const size_t destinationOffset = writeAddress - RAM_BASE;
			u8* destination = m_ram.data() + destinationOffset;
			for (size_t offset = 0; offset < bytes; offset += IO_WORD_SIZE) {
				writeLE32(destination + offset, readLE32(source.data_ + offset));
			}
			m_ramPageWriteWatches.invalidateWrite(destinationOffset, bytes, RAM_BASE, m_mappedPageInvalidator);
			return;
		}
	}
	const int readSlot = readStep == 0u && (readSignals & MAPPED_BUS_DMA_MEMORY) == 0u ? ioAlignedSlot(readAddress) : -1;
	const int writeSlot = writeStep == 0u && (writeSignals & MAPPED_BUS_DMA_MEMORY) == 0u ? ioAlignedSlot(writeAddress) : -1;
	auto* writePrefix = wordCount > 1u && writeSlot >= 0 ? findIoDmaPrefix(writeSlot) : nullptr;
	if (writePrefix != nullptr && writePrefix->write != nullptr
		&& !kReadOnlyIoSlots[static_cast<size_t>(writeSlot)]) {
		std::array<u32, DMA_BURST_WORD_CAPACITY> words;
		const u32 prefix = wordCount - 1u;
		auto* readPrefix = readSlot >= 0 ? findIoDmaPrefix(readSlot) : nullptr;
		bool prefixRead = false;
		if (readPrefix != nullptr && readPrefix->read != nullptr) {
			readPrefix->read(
				m_ioReadHandlers[static_cast<size_t>(readSlot)].context, readAddress, words.data(), prefix, readSignals);
			prefixRead = true;
		} else if (readStep == 0u || readStep == IO_WORD_SIZE) {
			Span<const u8> bytes;
			const u32 byteCount = readStep == 0u ? IO_WORD_SIZE : prefix * IO_WORD_SIZE;
			bool bound;
			if (readAddress >= IO_BASE + IO_SLOT_COUNT * IO_WORD_SIZE && isRamRange(readAddress, byteCount)) {
				bytes.data_ = m_ram.data() + (readAddress - RAM_BASE);
				bound = true;
			} else {
				bound = bindRomByteView(readAddress, byteCount, m_cartridgeController.selectedSlot(readSignals), bytes);
			}
			if (bound) {
				for (u32 i = 0u; i < prefix; ++i) words[i] = readLE32(bytes.data_ + i * readStep);
				prefixRead = true;
			}
		}
		if (prefixRead) {
			writePrefix->write(
				m_ioWriteHandlers[static_cast<size_t>(writeSlot)].context, writeAddress, words.data(), prefix, writeSignals);
			readAddress += prefix * readStep;
			wordCount = 1u;
		}
	}
	if (readSlot >= 0 && writeSlot >= 0) {
		for (u32 i = 0u; i < wordCount; ++i) {
			const MappedBusSignals end = i + 1u == wordCount ? MAPPED_BUS_DMA_BLOCK_END : 0u;
			const u32 word = readIoSlot(readSlot, readAddress, readSignals | end);
			writeIoSlot(writeSlot, writeAddress, word, BUS_ACCESS_WRITE_U32, writeSignals | end);
		}
		return;
	}
	if (writeSlot >= 0) {
		for (u32 i = 0u; i < wordCount; ++i) {
			const MappedBusSignals end = i + 1u == wordCount ? MAPPED_BUS_DMA_BLOCK_END : 0u;
			const u32 word = readMappedBusU32LE(readAddress, readSignals | end);
			writeIoSlot(writeSlot, writeAddress, word, BUS_ACCESS_WRITE_U32, writeSignals | end);
			readAddress += readStep;
		}
		return;
	}
	if (readSlot >= 0) {
		for (u32 i = 0u; i < wordCount; ++i) {
			const MappedBusSignals end = i + 1u == wordCount ? MAPPED_BUS_DMA_BLOCK_END : 0u;
			const u32 word = readIoSlot(readSlot, readAddress, readSignals | end);
			writeMappedBusU32LE(writeAddress, word, writeSignals | end);
			writeAddress += writeStep;
		}
		return;
	}
	for (u32 i = 0u; i < wordCount; ++i) {
		const MappedBusSignals end = i + 1u == wordCount ? MAPPED_BUS_DMA_BLOCK_END : 0u;
		const u32 word = readMappedBusU32LE(readAddress, readSignals | end);
		writeMappedBusU32LE(writeAddress, word, writeSignals | end);
		readAddress += readStep;
		writeAddress += writeStep;
	}
}

void Memory::writeMappedBusU32LE(uint32_t addr, uint32_t value, MappedBusSignals busSignals, uint32_t faultAccess) {
	const int slot = ioAlignedSlot(addr);
	if (slot >= 0) {
		if ((busSignals & MAPPED_BUS_DMA_MEMORY) != 0u) {
			raiseBusFault(BUS_FAULT_UNMAPPED, addr, faultAccess);
			return;
		}
		writeIoSlot(slot, addr, value, faultAccess, busSignals);
		return;
	}
	if (isIoRegionRange(addr, 4)) {
		raiseBusFault((busSignals & MAPPED_BUS_DMA_MEMORY) != 0u
			? BUS_FAULT_UNMAPPED : BUS_FAULT_UNALIGNED_IO, addr, faultAccess);
		return;
	}
	if (addr < CART_ROM_BASE) {
		if (writeRamWordLE(addr, 4, value)) {
			return;
		}
	} else if (addr <= CART_BUS_END - 4u) {
		m_cartridgeController.writeU32(addr, value, busSignals);
		return;
	}
	raiseBusFault(BUS_FAULT_UNMAPPED, addr, faultAccess);
}

void Memory::writeMappedF32LE(uint32_t addr, float value) {
	uint32_t bits = 0;
	std::memcpy(&bits, &value, sizeof(bits));
	writeMappedU32LE(addr, bits, BUS_ACCESS_WRITE_F32);
}

void Memory::writeMappedF64LE(uint32_t addr, double value) {
	uint64_t bits = 0;
	std::memcpy(&bits, &value, sizeof(bits));
	const uint32_t faultSequence = m_busFaultSequence;
	writeMappedU32LE(addr, static_cast<uint32_t>(bits & 0xffffffffull), BUS_ACCESS_WRITE_F64);
	if (m_busFaultSequence != faultSequence) {
		return;
	}
	writeMappedU32LE(addr + 4, static_cast<uint32_t>(bits >> 32), BUS_ACCESS_WRITE_F64);
}

void Memory::writeBytes(uint32_t addr, const u8* data, size_t length) {
	if (isRamRange(addr, length)) {
		const size_t offset = addr - RAM_BASE;
		std::memcpy(m_ram.data() + offset, data, length);
		m_ramPageWriteWatches.invalidateWrite(offset, length, RAM_BASE, m_mappedPageInvalidator);
		return;
	}
	raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_U8);
}

void Memory::readBytes(uint32_t addr, u8* out, size_t length) const {
	if (addr < RAM_BASE) {
		if (length <= SYSTEM_ROM_SIZE && addr <= SYSTEM_ROM_SIZE - length) {
			readRomWindowBytes(m_systemRom.data(), m_systemRom.size(), addr, out, length);
			return;
		}
	} else if (addr < CART_ROM_BASE) {
		const size_t offset = static_cast<size_t>(addr - RAM_BASE);
		if (isRamRange(addr, length)) {
			std::memcpy(out, m_ram.data() + offset, length);
			return;
		}
	} else if (
		length <= CART_BUS_END - CART_ROM_BASE
		&& static_cast<size_t>(addr - CART_ROM_BASE) <= CART_BUS_END - CART_ROM_BASE - length
	) {
		m_cartridgeController.readBytes(addr, out, length);
		return;
	}
	std::memset(out, 0, length);
	raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_U8);
}

bool Memory::isReadableMainMemoryRange(uint32_t addr, size_t length) const {
	if (addr < RAM_BASE) {
		return length <= SYSTEM_ROM_SIZE && addr <= SYSTEM_ROM_SIZE - length;
	}
	if (addr < CART_ROM_BASE) {
		return isRamRange(addr, length);
	}
	return length <= CART_BUS_END - CART_ROM_BASE
		&& static_cast<size_t>(addr - CART_ROM_BASE) <= CART_BUS_END - CART_ROM_BASE - length;
}

bool Memory::bindRomByteView(uint32_t addr, size_t length, u32 cartridgeSlot, Span<const u8>& out) const {
	size_t offset = 0;
	if (length > 0u && addressRangeOffset(addr, SYSTEM_ROM_BASE, m_systemRom.size(), length, offset)) {
		out.data_ = m_systemRom.data() + offset;
		out.size_ = length;
		return true;
	}
	if (addressRangeWithin(addr, CART_ROM_BASE, CART_ROM_SIZE, length)) {
		return m_cartridgeController.bindRomByteView(cartridgeSlot, addr, length, out);
	}
	return false;
}

bool Memory::bindMappedReadView(uint32_t addr, size_t length, MappedBusSignals busSignals, Span<const u8>& out) const {
	if (addr < RAM_BASE) return bindRomByteView(addr, length, 0u, out);
	if (addr < CART_ROM_BASE) {
		const u32 ioEnd = IO_BASE + static_cast<u32>(m_ioSlots.size()) * IO_WORD_SIZE;
		if (length == 0u || !isRamRange(addr, length)
			|| (addr < ioEnd && (addr >= IO_BASE || length > IO_BASE - addr))) return false;
		out = Span<const u8>(m_ram.data() + (addr - RAM_BASE), length);
		return true;
	}
	return addr < CART_BUS_END && m_cartridgeController.bindMappedReadView(addr, length, busSignals, out);
}

bool Memory::isRamRange(uint32_t addr, size_t length) const {
	return addr >= RAM_BASE && addr <= m_ramBusEnd && length <= m_ramBusEnd - addr;
}

MemoryRegionKind Memory::mappedRegion(uint32_t addr) const {
	if (isIoRegionRange(addr, IO_WORD_SIZE)) {
		return MemoryRegionKind::Io;
	}
	if (addr < RAM_BASE) {
		return addr <= SYSTEM_ROM_SIZE - IO_WORD_SIZE ? MemoryRegionKind::SystemRom : MemoryRegionKind::Other;
	}
	if (addr < CART_ROM_BASE) {
		return isRamRange(addr, IO_WORD_SIZE) ? MemoryRegionKind::Ram : MemoryRegionKind::Other;
	}
	return addr <= CART_BUS_END - IO_WORD_SIZE ? MemoryRegionKind::Cartridge : MemoryRegionKind::Other;
}

u32 Memory::mappedRegionWordSpan(u32 addr, u32 wordLimit, MemoryRegionKind region) const {
	constexpr u64 systemRomEnd = static_cast<u64>(SYSTEM_ROM_BASE) + SYSTEM_ROM_SIZE;
	const u64 ioEnd = static_cast<u64>(IO_BASE) + IO_SLOT_COUNT * IO_WORD_SIZE;
	const u64 ramEnd = m_ramBusEnd;
	u64 boundary;
	switch (region) {
	case MemoryRegionKind::SystemRom:
		boundary = systemRomEnd;
		break;
	case MemoryRegionKind::Cartridge:
		boundary = addr < CART_ROM_END
			? CART_ROM_END
			: addr < CART_RAM_END ? CART_RAM_END : CART_MMIO_END;
		break;
	case MemoryRegionKind::Io:
		boundary = ioEnd;
		break;
	case MemoryRegionKind::Ram:
		boundary = ramEnd;
		break;
	case MemoryRegionKind::Other:
		boundary = addr < systemRomEnd
			? systemRomEnd
			: addr < IO_BASE
				? IO_BASE
				: addr < ioEnd
					? ioEnd
					: addr < ramEnd
						? ramEnd
						: addr < CART_ROM_BASE
							? CART_ROM_BASE
							: addr < CART_BUS_END ? CART_BUS_END : (u64{1} << ADDRESS_BITS);
		break;
	default:
		BMSX_UNREACHABLE();
	}
	const u64 regionWords = (boundary - addr + (IO_WORD_SIZE - 1u)) / IO_WORD_SIZE;
	return regionWords < wordLimit ? static_cast<u32>(regionWords) : wordLimit;
}

void Memory::onBusFaultAckWriteThunk(void* context, uint32_t addr, u32 value, MappedBusSignals) {
	Memory* memory = static_cast<Memory*>(context);
	memory->onBusFaultAckWrite(addr, value);
}

void Memory::onBusFaultAckWrite(uint32_t addr, u32 value) {
	(void)addr;
	if (value != 0u) {
		clearBusFault();
	}
}

void Memory::raiseBusFault(uint32_t code, uint32_t addr, uint32_t access) const {
	m_busFaultSequence += 1u;
	if (m_busFaultCode != BUS_FAULT_NONE) {
		return;
	}
	m_busFaultCode = code;
	m_busFaultAddr = addr;
	m_busFaultAccess = access;
	writeBusFaultSlots();
}

void Memory::writeBusFaultSlots() const {
	m_ioSlots[IO_SYS_BUS_FAULT_CODE_SLOT] = m_busFaultCode;
	m_ioSlots[IO_SYS_BUS_FAULT_ADDR_SLOT] = m_busFaultAddr;
	m_ioSlots[IO_SYS_BUS_FAULT_ACCESS_SLOT] = m_busFaultAccess;
	m_ioSlots[IO_SYS_BUS_FAULT_ACK_SLOT] = 0u;
}

bool Memory::isIoRegionRange(uint32_t addr, size_t length) const {
	return addressRangeWithin(addr, IO_BASE, m_ioSlots.size() * IO_WORD_SIZE, length);
}


} // namespace bmsx
