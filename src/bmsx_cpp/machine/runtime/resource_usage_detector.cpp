#include "machine/runtime/resource_usage_detector.h"
#include "machine/memory/lua_heap_usage.h"

namespace bmsx {

ResourceUsageDetector::ResourceUsageDetector(Memory& memory, StringHandleTable& stringHandles, VDP& vdp)
	: m_memory(memory)
	, m_stringHandles(stringHandles)
	, m_vdp(vdp) {}

uint32_t ResourceUsageDetector::baseRamUsedBytes() const {
	return IO_REGION_SIZE
		+ (STRING_HANDLE_COUNT * STRING_HANDLE_ENTRY_SIZE)
		+ m_stringHandles.usedHeapBytes()
		+ m_memory.usedAssetTableBytes()
		+ m_memory.usedAssetDataBytes();
}

uint32_t ResourceUsageDetector::ramUsedBytes() const {
	return baseRamUsedBytes() + static_cast<uint32_t>(trackedLuaHeapBytes());
}

uint32_t ResourceUsageDetector::vramUsedBytes() const {
	return m_vdp.trackedUsedVramBytes();
}

}
