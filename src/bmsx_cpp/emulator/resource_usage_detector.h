#pragma once

#include "cpu.h"
#include "memory.h"
#include "memory_map.h"
#include "string_memory.h"
#include "vdp.h"
#include <cstdint>
#include <functional>
#include <vector>

namespace bmsx {

class ResourceUsageDetector {
public:
	using RootCollector = std::function<void(std::vector<Value>&)>;

	ResourceUsageDetector(CPU& cpu, Memory& memory, StringHandleTable& stringHandles, VDP& vdp, RootCollector collectRoots);

	void reset();
	void refresh(int64_t lastTickSequence, bool visible);
	uint32_t ramUsedBytes() const { return m_ramUsedBytes; }
	uint32_t vramUsedBytes() const { return m_vramUsedBytes; }
	uint32_t vramTotalBytes() const { return m_vdp.trackedTotalVramBytes(); }

private:
	static constexpr int64_t RAM_REFRESH_INTERVAL_TICKS = 60;
	static constexpr int64_t VRAM_REFRESH_INTERVAL_TICKS = 15;

	uint32_t computeBaseRamUsedBytes() const;
	uint32_t computeTrackedRamUsedBytes() const;

	CPU& m_cpu;
	Memory& m_memory;
	StringHandleTable& m_stringHandles;
	VDP& m_vdp;
	RootCollector m_collectRoots;
	uint32_t m_ramUsedBytes = 0;
	uint32_t m_vramUsedBytes = 0;
	int64_t m_lastRamSampleTick = -1;
	int64_t m_lastVramSampleTick = -1;
	bool m_wasVisibleLastTick = false;
};

}
