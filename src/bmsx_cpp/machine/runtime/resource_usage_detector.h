#pragma once

#include "machine/memory/map.h"
#include "machine/memory/string_memory.h"
#include "machine/devices/vdp/vdp.h"
#include <cstdint>

namespace bmsx {

class ResourceUsageDetector {
public:
	ResourceUsageDetector(StringHandleTable& stringHandles, VDP& vdp);

	StringHandleTable& m_stringHandles;
	VDP& m_vdp;
};

}
