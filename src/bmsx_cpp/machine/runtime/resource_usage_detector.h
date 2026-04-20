#pragma once

#include "machine/memory/memory.h"
#include "machine/memory/map.h"
#include "machine/memory/string_memory.h"
#include "machine/devices/vdp/vdp.h"
#include <cstdint>

namespace bmsx {

class ResourceUsageDetector {
public:
	ResourceUsageDetector(Memory& memory, StringHandleTable& stringHandles, VDP& vdp);

	uint32_t baseRamUsedBytes() const;
	uint32_t ramUsedBytes() const;
	uint32_t vramUsedBytes() const;
	uint32_t vramTotalBytes() const { return m_vdp.trackedTotalVramBytes(); }

private:
	Memory& m_memory;
	StringHandleTable& m_stringHandles;
	VDP& m_vdp;
};

}
