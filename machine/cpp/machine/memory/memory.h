#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <span>
#include <vector>

#include "machine/devices/cartridge/controller.h"
#include "machine/memory/bus_signals.h"
#include "machine/memory/mapped_page.h"
#include "spec/bmsx/io.h"
#include "spec/bmsx/memory_map.h"
#include "common/primitives.h"

namespace bmsx {

enum class MemoryRegionKind { Ram, SystemRom, Cartridge, Io, Other };

struct MemorySaveState {
	std::vector<u8> ram;
	uint32_t busFaultCode = BUS_FAULT_NONE;
	uint32_t busFaultAddr = 0;
	uint32_t busFaultAccess = 0;
};

struct MemoryInit {
	std::span<const u8> systemRom;
	CartridgeSocketMediaPair cartridgeSlots;
};

constexpr u32 NO_BLOCKED_MAPPED_WRITE = 0xffffffffu;

enum class IoWriteStorage : u8 { Retained, Device };

class Memory {
public:
	using IoReadHandler = u32 (*)(void* context, uint32_t addr, MappedBusSignals busSignals);
	using IoWriteHandler = void (*)(void* context, uint32_t addr, u32 value, MappedBusSignals busSignals);
	using IoWriteReadyHandler = bool (*)(void* context, uint32_t addr, MappedBusSignals busSignals);
	// Prefix callbacks perform only end-silent FIFO/latch/counter operations.
	// The final word always uses the ordinary read -> ready -> write bus path.
	using IoDmaReadPrefixHandler = void (*)(void*, u32 address, u32* words, u32 count, MappedBusSignals);
	using IoDmaWritePrefixHandler = void (*)(void*, u32 address, const u32* words, u32 count, MappedBusSignals);

	Memory(const MemoryInit& init, u32 ramByteCount);

	CartridgeController& cartridgeController() { return m_cartridgeController; }
	const CartridgeController& cartridgeController() const { return m_cartridgeController; }
	u8* ramData() { return m_ram.data(); }
	size_t ramByteCount() const { return m_ram.size(); }
	void installSystemRom(std::span<const u8> rom);
	void attachMappedPageInvalidator(MappedPageInvalidator& invalidator);
	void detachMappedPageInvalidator();
	void clearMappedPageWriteWatches();
	void bindMappedPage(uint32_t addr, MappedBusSignals busSignals, MappedPageBinding& out);
	void mapIoRead(uint32_t addr, void* context, IoReadHandler handler);
	template <auto Method, typename TObject>
	void mapIoRead(uint32_t addr, TObject& object) {
		mapIoRead(addr, &object, &readMember<Method, TObject>);
	}
	void mapIoWrite(uint32_t addr, void* context, IoWriteHandler handler, IoWriteStorage storage = IoWriteStorage::Retained);
	void mapIoWriteReady(uint32_t addr, IoWriteReadyHandler handler);
	template <auto Method, typename TObject>
	void mapIoWrite(uint32_t addr, TObject& object) {
		mapIoWrite(addr, &object, &writeMember<Method, TObject>);
	}
	void mapIoDmaReadPrefix(u32 address, IoDmaReadPrefixHandler handler);
	void mapIoDmaWritePrefix(u32 address, IoDmaWritePrefixHandler handler);
	bool mappedWriteReady(uint32_t addr);
	u32 firstBlockedMappedWordWrite(uint32_t addr, uint32_t wordCount);
	uint32_t readBusFaultSequence() const { return m_busFaultSequence; }

	u32 readMappedWord(uint32_t addr) const;
	void writeIoU32(uint32_t addr, u32 value);
	void writeMappedWord(uint32_t addr, u32 value);

	u8 readU8(uint32_t addr) const;
	u8 readMappedU8(uint32_t addr) const;
	void writeU8(uint32_t addr, u8 value);
	void writeMappedU8(uint32_t addr, u8 value);

	uint32_t readIoU32(uint32_t addr) const;
	uint32_t readU32(uint32_t addr) const;
	uint32_t readMappedU16LE(uint32_t addr) const;
	uint32_t readMappedU32LE(uint32_t addr, uint32_t faultAccess = BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_U32) const;
	uint32_t readMappedBusU32LE(
		uint32_t addr,
		MappedBusSignals busSignals,
		uint32_t faultAccess = BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_U32
	) const;
	uint32_t readMappedBusU32BE(
		uint32_t addr,
		MappedBusSignals busSignals,
		uint32_t faultAccess = BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_U32
	) const;
	uint32_t readMappedDmaU32LE(uint32_t addr, MappedBusSignals busSignals) const;
	float readMappedF32LE(uint32_t addr) const;
	double readMappedF64LE(uint32_t addr) const;
	void writeU32(uint32_t addr, uint32_t value);
	void writeMappedU16LE(uint32_t addr, uint32_t value);
	void writeMappedU32LE(uint32_t addr, uint32_t value, uint32_t faultAccess = BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_U32);
	void writeMappedDmaU32LE(uint32_t addr, uint32_t value, MappedBusSignals busSignals);
	void transferDmaBlock(u32 readAddress, u32 writeAddress, u32 wordCount,
		u32 readStep, u32 writeStep, MappedBusSignals readSignals, MappedBusSignals writeSignals);
	void writeMappedF32LE(uint32_t addr, float value);
	void writeMappedF64LE(uint32_t addr, double value);

	void writeBytes(uint32_t addr, const u8* data, size_t length);
	void readBytes(uint32_t addr, u8* out, size_t length) const;
	bool isReadableMainMemoryRange(uint32_t addr, size_t length) const;
	bool bindRomByteView(uint32_t addr, size_t length, u32 cartridgeSlot, Span<const u8>& out) const;
	bool bindMappedReadView(uint32_t addr, size_t length, MappedBusSignals busSignals, Span<const u8>& out) const;
	bool isRamRange(uint32_t addr, size_t length) const;
	MemoryRegionKind mappedRegion(uint32_t addr) const;
	u32 mappedRegionWordSpan(u32 addr, u32 wordLimit, MemoryRegionKind region) const;

	MemorySaveState captureSaveState(std::vector<u8> ram = {}) const;
	void restoreSaveState(const MemorySaveState& state);
	void clearIoSlots();
	void clearBusFault();
private:
	struct IoReadBinding {
		void* context = nullptr;
		IoReadHandler handler = nullptr;
	};
	struct IoWriteBinding {
		void* context = nullptr;
		IoWriteHandler handler = nullptr;
		IoWriteReadyHandler ready = nullptr;
	};
	std::array<IoWriteStorage, IO_SLOT_COUNT> m_ioWriteStorage{};
	struct IoDmaPrefixBinding {
		int slot;
		IoDmaReadPrefixHandler read = nullptr;
		IoDmaWritePrefixHandler write = nullptr;
	};
	std::span<const u8> m_systemRom;
	CartridgeController m_cartridgeController;
	std::vector<u8> m_ram;
	MappedPageWriteWatches m_ramPageWriteWatches;
	MappedPageInvalidator* m_mappedPageInvalidator = nullptr;
	mutable std::vector<u32> m_ioSlots;
	std::vector<IoReadBinding> m_ioReadHandlers;
	std::vector<IoWriteBinding> m_ioWriteHandlers;
	std::vector<IoDmaPrefixBinding> m_ioDmaPrefixes;
	IoDmaPrefixBinding* findIoDmaPrefix(int slot);
	mutable uint32_t m_busFaultCode = BUS_FAULT_NONE;
	mutable uint32_t m_busFaultAddr = 0;
	mutable uint32_t m_busFaultAccess = 0;
	mutable uint32_t m_busFaultSequence = 0;

	bool isIoRegionRange(uint32_t addr, size_t length) const;
	int ioAlignedSlot(uint32_t addr) const {
		const uint32_t delta = addr - IO_BASE;
		if (delta >= IO_SLOT_COUNT * IO_WORD_SIZE || (delta & (IO_WORD_SIZE - 1u)) != 0u) {
			return -1;
		}
		return static_cast<int>(delta / IO_WORD_SIZE);
	}
	u32 readIoSlot(int slot, uint32_t addr, MappedBusSignals busSignals) const;
	void writeIoSlot(int slot, uint32_t addr, u32 value, MappedBusSignals busSignals);
	void writeMappedBusU32LE(uint32_t addr, uint32_t value, uint32_t faultAccess, MappedBusSignals busSignals);
	bool writeRamU8(uint32_t addr, u8 value);
	bool writeRamWordLE(uint32_t addr, size_t byteLength, uint32_t value);
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
	u8 readMainMemoryU8(uint32_t addr, uint32_t faultAccess) const;
	void writeBusFaultSlots() const;
};

} // namespace bmsx
