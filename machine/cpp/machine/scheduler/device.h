#pragma once
#if defined(BMSX_DIAGNOSTIC_CPU_TIMING)
#include "machine/scheduler/diagnostic_cpu_timing.h"
#endif
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
#include "machine/cpu/diagnostic_execution_profile.h"
#endif

#include "common/primitives.h"

#include <array>
#include <cstdint>
#include <vector>

namespace bmsx {

class CPU;
enum class RunResult;

constexpr uint8_t DEVICE_SERVICE_GEO = 1;
constexpr uint8_t DEVICE_SERVICE_DMA = 2;
constexpr uint8_t DEVICE_SERVICE_APU = 3;
constexpr uint8_t DEVICE_SERVICE_GPU = 4;
constexpr uint8_t DEVICE_SERVICE_APU_TRANSFER = 5;
constexpr uint8_t DEVICE_SERVICE_SYSTEM = 6;
constexpr uint8_t DEVICE_SERVICE_GTE = 7;
constexpr uint8_t DEVICE_SERVICE_IMGDEC = 8;
// Equal-cycle device edges are serviced in device-kind order, independently
// of shared data-bus ownership.
constexpr uint8_t DeviceServiceKindCount = DEVICE_SERVICE_IMGDEC + 1;

class DeviceScheduler {
public:
	explicit DeviceScheduler(CPU& cpu);

	i64 nowCycles() const { return m_schedulerNowCycles; }
	void setNowCycles(i64 nowCycles);
	void reset();
	i64 currentNowCycles() const;
	void requestYieldForEarlierDeadline(i64 deadlineCycles);
	bool isCpuSliceActive() const { return m_schedulerSliceActive; }
	void beginCpuSlice(int sliceBudget) {
		m_schedulerSliceActive = true;
		m_activeSliceBaseCycle = m_schedulerNowCycles;
		m_activeSliceBudgetCycles = sliceBudget;
		m_activeSliceTargetCycle = m_schedulerNowCycles + sliceBudget;
	}
	void endCpuSlice() { m_schedulerSliceActive = false; }
	RunResult runCpuSlice(int targetDepth, int sliceBudget, u32 targetThread = 0u);
	void advanceTo(i64 nowCycles);
	i64 nextDeadline();
	bool hasDueTimer();
	uint8_t popDueTimer();
	void scheduleDeviceService(uint8_t deviceKind, i64 deadlineCycles);
	void cancelDeviceService(uint8_t deviceKind);

#if defined(BMSX_DIAGNOSTIC_CPU_TIMING)
	// Cumulative host lifetime; reset/restore do not rewind diagnostic clocks.
	DiagnosticCpuTiming diagnosticCpuTiming;
#endif

#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
	// Host-only cumulative diagnostics. Unlike the frame CPU budget, these
	// include only CPU::runUntilDepth consumption, not DMA/MMIO wait loops.
	u64 diagnosticCpuSliceCount = 0;
	i64 diagnosticCpuSliceConsumedCycles = 0;
	i64 diagnosticNativeOriginCycles = 0;
	i64 diagnosticInterpreterRuntimeCycles = 0;
	DiagnosticOpcodeCounts diagnosticNativeOpcodes;
	DiagnosticOpcodeCounts diagnosticInterpreterOpcodes;
#endif

private:
	static uint32_t nextTimerGeneration(uint32_t value);

	void clearTimerHeap();
	void pushTimer(i64 deadline, uint8_t deviceKind, uint32_t generation);
	void removeTopTimer();
	void discardStaleTopTimers();

	CPU& m_cpu;
	i64 m_schedulerNowCycles = 0;
	bool m_schedulerSliceActive = false;
	i64 m_activeSliceBaseCycle = 0;
	int m_activeSliceBudgetCycles = 0;
	i64 m_activeSliceTargetCycle = 0;
	std::vector<i64> m_timerDeadlines;
	std::vector<uint8_t> m_timerDeviceKinds;
	std::vector<uint32_t> m_timerGenerations;
	std::array<uint32_t, static_cast<size_t>(DeviceServiceKindCount)> m_deviceServiceTimerGeneration{};
};

} // namespace bmsx
