#include "machine/runtime/resource_usage_detector.h"

namespace bmsx {

ResourceUsageDetector::ResourceUsageDetector(StringHandleTable& stringHandles, VDP& vdp)
	: m_stringHandles(stringHandles)
	, m_vdp(vdp) {}

}
