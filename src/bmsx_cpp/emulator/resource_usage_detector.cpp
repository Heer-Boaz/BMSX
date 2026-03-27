#include "resource_usage_detector.h"

namespace bmsx {

ResourceUsageDetector::ResourceUsageDetector(CPU& cpu, Memory& memory, StringHandleTable& stringHandles, VDP& vdp, RootCollector collectRoots)
	: m_cpu(cpu)
	, m_memory(memory)
	, m_stringHandles(stringHandles)
	, m_vdp(vdp)
	, m_collectRoots(std::move(collectRoots)) {
	reset();
}

void ResourceUsageDetector::reset() {
	m_ramUsedBytes = computeBaseRamUsedBytes();
	m_vramUsedBytes = m_vdp.trackedUsedVramBytes();
	m_lastRamSampleTick = -1;
	m_lastVramSampleTick = -1;
	m_wasVisibleLastTick = false;
}

void ResourceUsageDetector::refresh(int64_t lastTickSequence, bool visible) {
	if (!visible) {
		m_wasVisibleLastTick = false;
		return;
	}
	if (!m_wasVisibleLastTick) {
		m_wasVisibleLastTick = true;
		m_lastRamSampleTick = lastTickSequence;
		m_lastVramSampleTick = -1;
	}
	if (
		m_lastVramSampleTick < 0
		|| (lastTickSequence - m_lastVramSampleTick) >= VRAM_REFRESH_INTERVAL_TICKS
	) {
		m_vramUsedBytes = m_vdp.trackedUsedVramBytes();
		m_lastVramSampleTick = lastTickSequence;
	}
	if ((lastTickSequence - m_lastRamSampleTick) < RAM_REFRESH_INTERVAL_TICKS) {
		return;
	}
	m_ramUsedBytes = computeTrackedRamUsedBytes();
	m_lastRamSampleTick = lastTickSequence;
}

uint32_t ResourceUsageDetector::computeBaseRamUsedBytes() const {
	return IO_REGION_SIZE
		+ (STRING_HANDLE_COUNT * STRING_HANDLE_ENTRY_SIZE)
		+ m_stringHandles.usedHeapBytes()
		+ m_memory.usedAssetTableBytes()
		+ m_memory.usedAssetDataBytes();
}

uint32_t ResourceUsageDetector::computeTrackedRamUsedBytes() const {
	std::vector<Value> extraRoots;
	m_collectRoots(extraRoots);
	return computeBaseRamUsedBytes() + static_cast<uint32_t>(m_cpu.trackedHeapBytes(extraRoots));
}

}
