#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <span>
#include <vector>

#include "machine/devices/cartridge/controller.h"
#include "machine/memory/bus_signals.h"
#include "machine/memory/mapped_page.h"
#include "machine/memory/word_counters.h"
#include "spec/bmsx/io.h"
#include "spec/bmsx/memory_map.h"
#include "common/primitives.h"
#include "common/endian.h"

namespace bmsx {

enum class RamAperture : u8 { Bus, CpuData, SystemData };

enum class MemoryRegionKind { Ram, SystemRom, Cartridge, Io, Other };

struct MemoryBusState {
	u32 ramBusEnd = 0;
	uint32_t busFaultCode = BUS_FAULT_NONE;
	uint32_t busFaultAddr = 0;
	uint32_t busFaultAccess = 0;
};

struct MemorySaveState : MemoryBusState {
	std::vector<u8> ram;
};

struct MemoryInit {
	std::span<const u8> systemRom;
	CartridgeSocketMediaPair cartridgeSlots;
};

constexpr u32 NO_BLOCKED_MAPPED_WRITE = 0xffffffffu;

enum class IoWriteStorage : u8 { Retained, Device };

// Local handlers only mutate device state: no fault, CPU observation, IRQ, scheduler
// notification or mapping change. Readiness is checked separately.
enum class IoWriteEffect : u8 { Machine, DeviceLocal };

class Memory {
public:
	using IoReadHandler = u32 (*)(void* context, uint32_t addr, MappedBusSignals busSignals);
	using IoWriteHandler = void (*)(void* context, uint32_t addr, u32 value, MappedBusSignals busSignals);
	using IoWriteReadyHandler = bool (*)(void* context, uint32_t addr, MappedBusSignals busSignals);
	// Prefix callbacks perform only end-silent FIFO/latch/counter operations.
	// The final word always uses the ordinary read -> ready -> write bus path.
	// A source lends the contiguous, scheduler-admitted prefix until the
	// synchronous sink returns. The sink does not retain the backing.
	using IoDmaReadPrefixHandler = const u32* (*)(void* context, u32 count);
	using IoDmaWritePrefixHandler = void (*)(void* context, const u32* words, u32 count);
	using IoDmaMappedWritePrefixHandler = void (*)(void*, Span<const u8> littleEndianBytes);

	Memory(const MemoryInit& init, u32 ramByteCount);

	CartridgeController& cartridgeController() { return m_cartridgeController; }
	const CartridgeController& cartridgeController() const { return m_cartridgeController; }
	u8* ramData() { return m_ram.data(); }
	size_t ramByteCount() const { return m_ram.size(); }
	MappedPageWriteWatches& ramWriteWatches() { return m_ramPageWriteWatches; }
	const MappedPageWriteWatches& ramWriteWatches() const { return m_ramPageWriteWatches; }

	// The CPU record port addresses physical RAM, including bytes under MMIO.
	u32 readRamRecordWord(u32 address) const {
		return readLE32(m_ram.data() + (address & RAM_RECORD_WORD_MASK));
	}
	void writeRamRecordWord(u32 address, u32 value) {
		const u32 offset = address & RAM_RECORD_WORD_MASK;
		writeLE32(m_ram.data() + offset, value);
		if (m_ramPageWriteWatches.groupData()[offset >> MAPPED_PAGE_BYTE_SHIFT] != 0u)
			invalidateWatchedRamRecordWrite(offset, sizeof(u32));
	}
	void writeRamRecordPair(u32 address, u32 first, u32 second) {
		const u32 offset = address & (MAIN_RAM_SIZE - 2 * sizeof(u32));
		writeLE32(m_ram.data() + offset, first);
		writeLE32(m_ram.data() + offset + sizeof(u32), second);
		if (m_ramPageWriteWatches.groupData()[offset >> MAPPED_PAGE_BYTE_SHIFT] != 0u)
			invalidateWatchedRamRecordWrite(offset, 2 * sizeof(u32));
	}
	u8 readRamRecordByte(u32 address) const { return m_ram[address & (MAIN_RAM_SIZE - 1u)]; }
	void writeRamRecordByte(u32 address, u8 value) {
		const u32 offset = address & (MAIN_RAM_SIZE - 1u);
		m_ram[offset] = value;
		if (m_ramPageWriteWatches.groupData()[offset >> MAPPED_PAGE_BYTE_SHIFT] != 0u)
			invalidateWatchedRamRecordWrite(offset, 1u);
	}
	// The record port can mirror into public RAM. Only public writes can
	// retire decoded code; physical observers also see private writes.
	void invalidateRamWrite(size_t offset, size_t byteLength) {
		m_ramPageWriteWatches.invalidateWrite(offset, byteLength, RAM_BASE, m_mappedPageInvalidator, RAM_BASE + offset < m_ramBusEnd);
	}
	// A linear value slot writes one aligned payload word and one tag byte.
	// Only marked pages need the exact port/aperture and word-watch handling.
	void invalidateRamValueSlot(const void* payload, const u8* tag) {
		const auto* base = m_ram.data();
		const auto word = static_cast<u32>(reinterpret_cast<const u8*>(payload) - base);
		const auto byte = static_cast<u32>(tag - base);
		const auto* groups = m_ramPageWriteWatches.groupData();
		if ((groups[word >> MAPPED_PAGE_BYTE_SHIFT] | groups[byte >> MAPPED_PAGE_BYTE_SHIFT]) != 0u)
			invalidateWatchedRamValueSlot(word, byte);
	}
	const Span<const u8>& systemRomStorage() const { return m_systemRom; }
	void installSystemRom(std::span<const u8> rom);
	void attachMappedPageInvalidator(MappedPageInvalidator& invalidator);
	void detachMappedPageInvalidator();
	u32 ramBusEnd() const { return m_ramBusEnd; }
	const u32* ramBusEndAddress() const { return &m_ramBusEnd; }
	void setRamBusEnd(u32 end);
	void clearMappedPageWriteWatches();
	void bindMappedPage(uint32_t addr, MappedBusSignals busSignals, MappedPageBinding& out);
	void mapIoRead(uint32_t addr, void* context, IoReadHandler handler);
	template <auto Method, typename TObject>
	void mapIoRead(uint32_t addr, TObject& object) {
		mapIoRead(addr, &object, &readMember<Method, TObject>);
	}
	void mapIoWrite(uint32_t addr, void* context, IoWriteHandler handler, IoWriteStorage storage = IoWriteStorage::Retained, IoWriteEffect effect = IoWriteEffect::Machine);
	void mapIoWriteReady(uint32_t addr, IoWriteReadyHandler handler);
	template <auto Method, typename TObject>
	void mapIoWrite(uint32_t addr, TObject& object, IoWriteEffect effect = IoWriteEffect::Machine) {
		mapIoWrite(addr, &object, &writeMember<Method, TObject>, IoWriteStorage::Retained, effect);
	}
	void mapIoDmaReadPrefix(u32 address, IoDmaReadPrefixHandler handler);
	void mapIoDmaWritePrefix(u32 address, IoDmaWritePrefixHandler handler);
	void mapIoDmaMappedWritePrefix(u32 address, IoDmaMappedWritePrefixHandler handler);
	bool mappedWriteReady(uint32_t addr);
	bool tryWriteLocalIoWord(u32 address, u32 value);
	u32 firstBlockedMappedWordWrite(uint32_t addr, uint32_t wordCount);
	uint32_t readBusFaultSequence() const { return m_busFaultSequence; }

	u32 readMappedWord(uint32_t addr, RamAperture aperture = RamAperture::CpuData) const;
	void writeIoU32(uint32_t addr, u32 value);
	void writeMappedWord(uint32_t addr, u32 value, RamAperture aperture = RamAperture::CpuData);

	u8 readU8(uint32_t addr) const;
	u8 readMappedU8(uint32_t addr, RamAperture aperture = RamAperture::CpuData) const;
	void writeU8(uint32_t addr, u8 value);
	void writeMappedU8(uint32_t addr, u8 value, RamAperture aperture = RamAperture::CpuData);

	uint32_t readIoU32(uint32_t addr) const;
	uint32_t readU32(uint32_t addr) const;
	uint32_t readCountedU32(uint32_t addr, MemoryWordCounters& counters) const;
	uint32_t readMappedU16LE(uint32_t addr, RamAperture aperture = RamAperture::CpuData) const;
	uint32_t readMappedU32LE(uint32_t addr, uint32_t faultAccess = BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_U32, RamAperture aperture = RamAperture::CpuData) const;
	uint32_t readMappedBusU32LE(
		uint32_t addr,
		MappedBusSignals busSignals,
		uint32_t faultAccess = BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_U32,
		RamAperture aperture = RamAperture::Bus
	) const;
	float readMappedF32LE(uint32_t addr) const;
	double readMappedF64LE(uint32_t addr, RamAperture aperture = RamAperture::CpuData) const;
	void writeU32(uint32_t addr, uint32_t value);
	void countRawWriteU32(uint32_t addr, MemoryWordCounters& counters) const;
	void writeMappedU16LE(uint32_t addr, uint32_t value, RamAperture aperture = RamAperture::CpuData);
	void writeMappedU32LE(uint32_t addr, uint32_t value, uint32_t faultAccess = BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_U32, RamAperture aperture = RamAperture::CpuData);
	void writeMappedBusU32LE(uint32_t addr, uint32_t value, MappedBusSignals busSignals, uint32_t faultAccess = BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_U32, RamAperture aperture = RamAperture::Bus);
	void transferDmaBlock(u32 readAddress, u32 writeAddress, u32 wordCount,
		u32 readStep, u32 writeStep, MappedBusSignals readSignals, MappedBusSignals writeSignals);
	void writeMappedF32LE(uint32_t addr, float value);
	void writeMappedF64LE(uint32_t addr, double value, RamAperture aperture = RamAperture::CpuData);
	const u8* readMappedValue(u32 addr, RamAperture aperture = RamAperture::CpuData) const;
	bool writeMappedValue(u32 addr, u32 payload, u8 tag, RamAperture aperture = RamAperture::CpuData);

	void writeBytes(uint32_t addr, const u8* data, size_t length);
	void readBytes(uint32_t addr, u8* out, size_t length) const;
	bool isReadableMainMemoryRange(uint32_t addr, size_t length) const;
	bool bindRomByteView(uint32_t addr, size_t length, u32 cartridgeSlot, Span<const u8>& out) const;
	// Borrow contiguous backing for a complete transfer through the mapped bus.
	bool bindMappedReadView(uint32_t addr, size_t length, MappedBusSignals busSignals, Span<const u8>& out) const;
	bool isRamRange(uint32_t addr, size_t length, bool physical = false) const;
	MemoryRegionKind mappedRegion(uint32_t addr) const;
	u32 mappedRegionWordSpan(u32 addr, u32 wordLimit, MemoryRegionKind region) const;

	MemorySaveState captureSaveState(std::vector<u8> ram = {}) const;
	void restoreSaveState(const MemorySaveState& state);
	MemoryBusState captureBusState() const;
	void restoreBusState(const MemoryBusState& state);
	void clearIoSlots();
	void clearBusFault();
private:
	template<bool Count> uint32_t readRawU32(uint32_t addr, MemoryWordCounters* counters) const;
	struct IoReadBinding {
		void* context = nullptr;
		IoReadHandler handler = nullptr;
	};
	struct IoWriteBinding {
		void* context = nullptr;
		IoWriteHandler handler = nullptr;
		IoWriteReadyHandler ready = nullptr;
	};
	struct IoDmaPrefixBinding {
		int slot;
		IoDmaReadPrefixHandler read = nullptr;
		IoDmaWritePrefixHandler write = nullptr;
		IoDmaMappedWritePrefixHandler mappedWrite = nullptr;
	};
	// Keep the physical RAM port within ARM's immediate load range. The
	// MMIO slot table is too large to place before these fields.
	std::vector<u8> m_ram;
	u32 m_ramBusEnd;
	MappedPageWriteWatches m_ramPageWriteWatches;
	MappedPageInvalidator* m_mappedPageInvalidator = nullptr;
	Span<const u8> m_systemRom;
	CartridgeController m_cartridgeController;
	mutable std::vector<u32> m_ioSlots;
	std::vector<IoReadBinding> m_ioReadHandlers;
	std::vector<IoWriteBinding> m_ioWriteHandlers;
	std::vector<IoDmaPrefixBinding> m_ioDmaPrefixes;
	IoDmaPrefixBinding* findIoDmaPrefix(int slot);
	// Keep aperture dispatch and code/history handling out of unmarked stores
	// even in the LTO ARM core.
	BMSX_NOINLINE void invalidateWatchedRamRecordWrite(u32 offset, u32 bytes);
	BMSX_NOINLINE void invalidateWatchedRamValueSlot(u32 word, u32 byte);
	mutable uint32_t m_busFaultCode = BUS_FAULT_NONE;
	mutable uint32_t m_busFaultAddr = 0;
	mutable uint32_t m_busFaultAccess = 0;
	mutable uint32_t m_busFaultSequence = 0;
	struct IoWritePolicy { IoWriteStorage storage : 1; IoWriteEffect effect : 1; };
	std::array<IoWritePolicy, IO_SLOT_COUNT> m_ioWritePolicy{};

	bool isIoRegionRange(uint32_t addr, size_t length) const;
	bool admitsRamTransfer(u32 addr, size_t bytes, RamAperture aperture) const;
	bool admitsMappedValue(u32 addr, RamAperture aperture) const;
	int ioAlignedSlot(uint32_t addr) const {
		const uint32_t delta = addr - IO_BASE;
		if (delta >= IO_SLOT_COUNT * IO_WORD_SIZE || (delta & (IO_WORD_SIZE - 1u)) != 0u) {
			return -1;
		}
		return static_cast<int>(delta / IO_WORD_SIZE);
	}
	u32 readIoSlot(int slot, uint32_t addr, MappedBusSignals busSignals) const;
	void writeIoSlot(int slot, uint32_t addr, u32 value, u32 faultAccess, MappedBusSignals busSignals);
	bool writeRamU8(uint32_t addr, u8 value, RamAperture aperture = RamAperture::Bus);
	bool writeRamWordLE(uint32_t addr, size_t byteLength, uint32_t value, RamAperture aperture = RamAperture::Bus);
	template <auto Method, typename TObject>
	static u32 readMember(void* context, uint32_t addr, MappedBusSignals) {
		return (static_cast<TObject*>(context)->*Method)(addr);
	}
	template <auto Method, typename TObject>
	static void writeMember(void* context, uint32_t addr, u32 value, MappedBusSignals) {
		(static_cast<TObject*>(context)->*Method)(addr, value);
	}
	static void onBusFaultAckWriteThunk(void* context, uint32_t addr, u32 value, MappedBusSignals busSignals);
	void onBusFaultAckWrite(uint32_t addr, u32 value);
	void raiseBusFault(uint32_t code, uint32_t addr, uint32_t access) const;
	u8 readMainMemoryU8(uint32_t addr, uint32_t faultAccess, RamAperture aperture = RamAperture::Bus) const;
	const u8* readBankedCartridgeBytes(u32 address, size_t length, RamAperture aperture) const;
	void writeBusFaultSlots() const;
};

} // namespace bmsx
