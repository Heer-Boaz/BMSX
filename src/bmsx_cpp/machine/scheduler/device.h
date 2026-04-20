#pragma once

#include "core/primitives.h"

#include <array>
#include <cstdint>
#include <vector>

namespace bmsx {

class CPU;

enum TimerKind : uint8_t {
	TimerKindVblankBegin = 1,
	TimerKindVblankEnd = 2,
	TimerKindDeviceService = 3,
};

enum DeviceServiceKind : uint8_t {
	DeviceServiceGeo = 1,
	DeviceServiceDma = 2,
	DeviceServiceImg = 3,
	DeviceServiceVdp = 4,
	DeviceServiceKindCount = 5,
};

class DeviceScheduler {
public:
	explicit DeviceScheduler(CPU& cpu);

	i64 nowCycles() const { return m_schedulerNowCycles; }
	void setNowCycles(i64 nowCycles);
	void reset();
	i64 currentNowCycles() const;
	void beginCpuSlice(int sliceBudget);
	void endCpuSlice();
	void advanceTo(i64 nowCycles);
	i64 nextDeadline();
	bool hasDueTimer();
	uint16_t popDueTimer();
	void scheduleVblankTimer(uint8_t timerKind, i64 deadlineCycles);
	void scheduleDeviceService(uint8_t deviceKind, i64 deadlineCycles);
	void cancelDeviceService(uint8_t deviceKind);

private:
	static uint32_t nextTimerGeneration(uint32_t value);

	void clearTimerHeap();
	void pushTimer(i64 deadline, uint8_t kind, uint8_t payload, uint32_t generation);
	void removeTopTimer();
	bool isTimerCurrent(uint8_t kind, uint8_t payload, uint32_t generation) const;
	void discardStaleTopTimers();
	void requestYieldForEarlierDeadline(i64 deadlineCycles);

	CPU& m_cpu;
	i64 m_schedulerNowCycles = 0;
	bool m_schedulerSliceActive = false;
	i64 m_activeSliceBaseCycle = 0;
	int m_activeSliceBudgetCycles = 0;
	i64 m_activeSliceTargetCycle = 0;
	std::vector<i64> m_timerDeadlines;
	std::vector<uint8_t> m_timerKinds;
	std::vector<uint8_t> m_timerPayloads;
	std::vector<uint32_t> m_timerGenerations;
	size_t m_timerCount = 0;
	uint32_t m_vblankEnterTimerGeneration = 0;
	uint32_t m_vblankEndTimerGeneration = 0;
	std::array<uint32_t, static_cast<size_t>(DeviceServiceKindCount)> m_deviceServiceTimerGeneration{};
};

} // namespace bmsx
