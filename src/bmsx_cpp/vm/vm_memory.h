#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

#include "cpu.h"
#include "memory_map.h"
#include "vm_io.h"
#include "../core/types.h"

namespace bmsx {

class VmMemory {
public:
	VmMemory();

	void setEngineRom(const u8* data, size_t size);
	void setCartRom(const u8* data, size_t size);
	void setOverlayRom(const u8* data, size_t size);

	Value readValue(uint32_t addr) const;
	void writeValue(uint32_t addr, Value value);

	u8 readU8(uint32_t addr) const;
	void writeU8(uint32_t addr, u8 value);

	uint32_t readU32(uint32_t addr) const;
	void writeU32(uint32_t addr, uint32_t value);

	void writeBytes(uint32_t addr, const u8* data, size_t length);
	void readBytes(uint32_t addr, u8* out, size_t length) const;

	const std::vector<Value>& ioSlots() const { return m_ioSlots; }
	void loadIoSlots(const std::vector<Value>& slots);
	void clearIoSlots();

private:
	std::vector<u8> m_engineRom;
	std::vector<u8> m_cartRom;
	std::vector<u8> m_overlayRom;
	std::vector<u8> m_ram;
	std::vector<Value> m_ioSlots;

	bool isIoAddress(uint32_t addr) const;
	size_t ioIndex(uint32_t addr) const;
	size_t ramOffset(uint32_t addr, size_t length) const;
	uint32_t readU32FromRegion(uint32_t addr) const;
	const std::vector<u8>& readRegion(uint32_t addr, size_t length, size_t& outOffset) const;
	std::vector<u8>& writeRegion(uint32_t addr, size_t length, size_t& outOffset);
};

} // namespace bmsx
