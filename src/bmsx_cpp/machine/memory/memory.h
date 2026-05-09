#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

#include "machine/cpu/cpu.h"
#include "machine/memory/map.h"
#include "machine/bus/io.h"
#include "common/primitives.h"

namespace bmsx {

struct MemorySaveState {
	std::vector<u8> ram;
	uint32_t busFaultCode = BUS_FAULT_NONE;
	uint32_t busFaultAddr = 0;
	uint32_t busFaultAccess = 0;
};

struct MemoryInit {
	struct RomSpan {
		const u8* data = nullptr;
		size_t size = 0;
	};
	struct MutableRomSpan {
		u8* data = nullptr;
		size_t size = 0;
	};
	RomSpan systemRom;
	RomSpan cartRom;
	MutableRomSpan overlayRom;
};

class Memory {
public:
		class VramWriter {
		public:
			virtual ~VramWriter() = default;
			virtual void writeVram(uint32_t addr, const u8* data, size_t length) = 0;
			virtual void readVram(uint32_t addr, u8* out, size_t length) const = 0;
		};
		using IoReadHandler = Value (*)(void* context, uint32_t addr);
		using IoWriteHandler = void (*)(void* context, uint32_t addr, Value value);

	Memory();
	explicit Memory(const MemoryInit& init);

		size_t getOverlayRomSize() const;
	void setVramWriter(VramWriter* writer);
	void mapIoRead(uint32_t addr, void* context, IoReadHandler handler);
	void mapIoWrite(uint32_t addr, void* context, IoWriteHandler handler);
	void setProgramCode(const u8* data, size_t size);

	Value readValue(uint32_t addr) const;
	Value readMappedValue(uint32_t addr) const;
	void writeValue(uint32_t addr, Value value);
	void writeIoValue(uint32_t addr, Value value);
	void writeMappedValue(uint32_t addr, Value value);

	u8 readU8(uint32_t addr) const;
	u8 readMappedU8(uint32_t addr) const;
	void writeU8(uint32_t addr, u8 value);
	void writeMappedU8(uint32_t addr, u8 value);

	uint32_t readIoU32(uint32_t addr) const;
	int32_t readIoI32(uint32_t addr) const;
	uint32_t readU32(uint32_t addr) const;
	uint32_t readMappedU16LE(uint32_t addr) const;
	uint32_t readMappedU32LE(uint32_t addr) const;
	float readMappedF32LE(uint32_t addr) const;
	double readMappedF64LE(uint32_t addr) const;
	void writeU32(uint32_t addr, uint32_t value);
	void writeMappedU16LE(uint32_t addr, uint32_t value);
	void writeMappedU32LE(uint32_t addr, uint32_t value);
	void writeMappedF32LE(uint32_t addr, float value);
	void writeMappedF64LE(uint32_t addr, double value);

		bool writeBytes(uint32_t addr, const u8* data, size_t length);
		bool readBytes(uint32_t addr, u8* out, size_t length) const;
	bool isVramRange(uint32_t addr, size_t length) const;
	bool isReadableMainMemoryRange(uint32_t addr, size_t length) const;
	bool isRamRange(uint32_t addr, size_t length) const;

	std::vector<u8> dumpMutableRam() const;
	void restoreMutableRam(const u8* data, size_t size);
	MemorySaveState captureSaveState() const;
	void restoreSaveState(const MemorySaveState& state);
	void clearIoSlots();
	void clearBusFault();
	void markRoots(GcHeap& heap) const;

private:
	struct RomSpan {
		const u8* data = nullptr;
		size_t size = 0;
	};
		struct MutableRomSpan {
			u8* data = nullptr;
			size_t size = 0;
		};
		struct IoReadBinding {
			void* context = nullptr;
			IoReadHandler handler = nullptr;
		};
		struct IoWriteBinding {
			void* context = nullptr;
			IoWriteHandler handler = nullptr;
		};
		RomSpan m_systemRom;
		RomSpan m_cartRom;
		RomSpan m_programCode;
		MutableRomSpan m_overlayRom;
		std::vector<u8> m_ram;
		mutable std::vector<Value> m_ioSlots;
		std::vector<IoReadBinding> m_ioReadHandlers;
		std::vector<IoWriteBinding> m_ioWriteHandlers;
		VramWriter* m_vramWriter = nullptr;
		mutable uint32_t m_busFaultCode = BUS_FAULT_NONE;
		mutable uint32_t m_busFaultAddr = 0;
		mutable uint32_t m_busFaultAccess = 0;

	bool isIoRegionRange(uint32_t addr, size_t length) const;
	int ioAlignedSlot(uint32_t addr) const {
		const uint32_t delta = addr - IO_BASE;
		if (delta >= IO_SLOT_COUNT * IO_WORD_SIZE || (delta & (IO_WORD_SIZE - 1u)) != 0u) {
			return -1;
		}
		return static_cast<int>(delta / IO_WORD_SIZE);
	}
	bool isProgramCodeReadableRange(uint32_t addr, size_t length) const;
	uint32_t readProgramCodeWord(uint32_t addr) const;
	uint32_t readU32FromRegion(uint32_t addr) const;
	bool isRangeWithinRegion(uint32_t addr, size_t length, uint32_t base, uint32_t size) const;
	bool isLuaReadOnlyIoAddress(uint32_t addr) const;
	bool isMappedWritableRange(uint32_t addr, size_t length) const;
	bool isMappedReadableRange(uint32_t addr, size_t length) const;
	static void onBusFaultAckWriteThunk(void* context, uint32_t addr, Value value);
	void onBusFaultAckWrite(uint32_t addr, Value value);
	void raiseBusFault(uint32_t code, uint32_t addr, uint32_t access) const;
	void writeBusFaultSlots() const;
};

} // namespace bmsx
