#pragma once

#include "memory.h"
#include "memory_map.h"
#include "string_memory.h"
#include "vdp.h"
#include <cstdint>

namespace bmsx {

class ResourceUsageDetector {
public:
	ResourceUsageDetector(Memory& memory, StringHandleTable& stringHandles, VDP& vdp);

	uint32_t baseRamUsedBytes() const { return computeBaseRamUsedBytes(); }
	uint32_t ramUsedBytes() const;
	uint32_t vramUsedBytes() const;
	uint32_t vramTotalBytes() const { return m_vdp.trackedTotalVramBytes(); }

private:
	uint32_t computeBaseRamUsedBytes() const;

	Memory& m_memory;
	StringHandleTable& m_stringHandles;
	VDP& m_vdp;
};

}
