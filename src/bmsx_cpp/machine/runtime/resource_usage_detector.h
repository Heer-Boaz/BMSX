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

	Memory& m_memory;
	StringHandleTable& m_stringHandles;
	VDP& m_vdp;
};

}
