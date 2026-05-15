#pragma once

#include "machine/devices/geometry/contracts.h"
#include "machine/devices/geometry/overlap2d.h"
#include "machine/devices/geometry/sat2.h"
#include "machine/devices/geometry/job.h"
#include "machine/devices/geometry/save_state.h"
#include "machine/devices/geometry/xform2.h"
#include "machine/memory/memory.h"
#include "machine/scheduler/device.h"

#include <cstdint>
#include <optional>

namespace bmsx {

class IrqController;

class GeometryController {
public:
	GeometryController(
		Memory& memory,
		IrqController& irq,
		DeviceScheduler& scheduler
	);

	void setTiming(int64_t cpuHz, int64_t workUnitsPerSec, int64_t nowCycles);
	void accrueCycles(int cycles, int64_t nowCycles);
	bool hasPendingWork() const;
	uint32_t getPendingWorkUnits() const;
	void onService(int64_t nowCycles);
	void reset();
	GeometryControllerState captureState() const;
	void restoreState(const GeometryControllerState& state, int64_t nowCycles);
	void onCtrlWrite(int64_t nowCycles);

private:
	static void onCommandWriteThunk(void* context, uint32_t addr, Value value);
	static void onCtrlWriteThunk(void* context, uint32_t addr, Value value);
	static void onFaultAckWriteThunk(void* context, uint32_t addr, Value value);

	using GeoJob = GeometryJobState;
	void onCommandDoorbell(int64_t nowCycles, uint32_t command);
	void tryStart(int64_t nowCycles, uint32_t command);
	void scheduleNextService(int64_t nowCycles);
	void onFaultAckWrite(Value value);
	void completeRecord(GeoJob& job);
	void finishSuccess(uint32_t processed);
	void finishError(uint32_t code, uint32_t recordIndex, bool signalIrq = true);
	void finishRejected(uint32_t code);

	int64_t m_cpuHz = 1;
	int64_t m_workUnitsPerSec = 1;
	int64_t m_workCarry = 0;
	uint32_t m_availableWorkUnits = 0;
	GeometryControllerPhase m_phase = GeometryControllerPhase::Idle;
	std::optional<GeoJob> m_activeJob;
	Memory& m_memory;
	IrqController& m_irq;
	DeviceScheduler& m_scheduler;
	GeometryXform2Unit m_xform2;
	GeometrySat2Unit m_sat2;
	GeometryOverlap2dUnit m_overlap2d;
};

} // namespace bmsx
