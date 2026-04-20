#include "machine/runtime/resource_usage_detector.h"

namespace bmsx {

ResourceUsageDetector::ResourceUsageDetector(Memory& memory, StringHandleTable& stringHandles, VDP& vdp)
	: m_memory(memory)
	, m_stringHandles(stringHandles)
	, m_vdp(vdp) {}

}
