#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

#include "machine/cpu/cpu.h"
#include "machine/memory/map.h"
#include "machine/bus/io.h"
#include "common/primitives.h"

namespace bmsx {

struct MemoryState {
	std::vector<Value> ioMemory;
};

struct MemorySaveState {
	std::vector<u8> ram;
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

	void setSystemRom(const u8* data, size_t size);
	void setCartRom(const u8* data, size_t size);
		void setOverlayRom(u8* data, size_t size);
		size_t overlayRomSize() const;
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

	void writeBytes(uint32_t addr, const u8* data, size_t length);
	void readBytes(uint32_t addr, u8* out, size_t length) const;
	const u8* readBytesView(uint32_t addr, size_t length) const;
	bool isVramRange(uint32_t addr, size_t length) const;
	bool isReadableMainMemoryRange(uint32_t addr, size_t length) const;
	bool isRamRange(uint32_t addr, size_t length) const;

	std::vector<u8> dumpMutableRam() const;
	void restoreMutableRam(const u8* data, size_t size);
	MemoryState captureState() const;
	void restoreState(const MemoryState& state);
	MemorySaveState captureSaveState() const;
	void restoreSaveState(const MemorySaveState& state);

	const std::vector<Value>& ioSlots() const { return m_ioSlots; }
	void loadIoSlots(const std::vector<Value>& slots);
	void clearIoSlots();

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
		std::vector<Value> m_ioSlots;
		std::vector<IoReadBinding> m_ioReadHandlers;
		std::vector<IoWriteBinding> m_ioWriteHandlers;
		VramWriter* m_vramWriter = nullptr;

	bool isIoAddress(uint32_t addr) const;
	bool isIoRegionRange(uint32_t addr, size_t length) const;
	size_t ioIndex(uint32_t addr) const;
	size_t ramOffset(uint32_t addr, size_t length) const;
	bool isProgramRomRange(uint32_t addr, size_t length) const;
	bool isProgramCodeReadableRange(uint32_t addr, size_t length) const;
	uint32_t readProgramCodeWord(uint32_t addr) const;
	uint32_t readU32FromRegion(uint32_t addr) const;
	const u8* readRegion(uint32_t addr, size_t length, size_t& outOffset) const;
	u8* writeRegion(uint32_t addr, size_t length, size_t& outOffset);
	bool isRangeWithinRegion(uint32_t addr, size_t length, uint32_t base, uint32_t size) const;
	bool isLuaReadOnlyIoAddress(uint32_t addr) const;
	bool isMappedWritableRange(uint32_t addr, size_t length) const;
};

} // namespace bmsx
