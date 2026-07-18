#pragma once

#include "machine/memory/memory.h"

namespace bmsx {

class CPU;
class DeviceScheduler;
class DmaController;
class GeometryController;
class GxGpu;
class IrqController;

constexpr u8 SYSTEM_SUPERVISOR_PHASE_USER = 0u;
constexpr u8 SYSTEM_SUPERVISOR_PHASE_ENTRY_QUIESCE = 1u;
constexpr u8 SYSTEM_SUPERVISOR_PHASE_ENTRY_VECTOR = 2u;
constexpr u8 SYSTEM_SUPERVISOR_PHASE_ACTIVE = 3u;
constexpr u8 SYSTEM_SUPERVISOR_PHASE_LEAVING = 4u;

struct SystemControllerState {
	bool resetRequested = false;
	u8 supervisorPhase = SYSTEM_SUPERVISOR_PHASE_USER;
	bool supervisorResumable = false;
	bool supervisorExitRequested = false;
};

class SystemController {
public:
	SystemController(
		Memory& memory,
		CPU& cpu,
		DeviceScheduler& scheduler,
		IrqController& irq,
		DmaController& dma,
		GeometryController& geometry,
		GxGpu& gpu);
	void reset();
	void requestSupervisorLineEdge();
	void onService();
	bool cpuHeld() const { return m_supervisorPhase == SYSTEM_SUPERVISOR_PHASE_LEAVING; }
	bool takeResetRequest();
	SystemControllerState captureState() const;
	void restoreState(const SystemControllerState& state);
	void postLoad();

private:
	Value readStatus(u32 address);
	void writeControl(u32 address, Value value);
	void enterSupervisor();
	void enterSupervisorFault();
	void beginSupervisorLeave();
	u32 statusWord() const;
	void writeStatusIo();

	Memory& m_memory;
	CPU& m_cpu;
	DeviceScheduler& m_scheduler;
	IrqController& m_irq;
	DmaController& m_dma;
	GeometryController& m_geometry;
	GxGpu& m_gpu;
	bool m_resetRequested = false;
	u8 m_supervisorPhase = SYSTEM_SUPERVISOR_PHASE_USER;
	bool m_supervisorResumable = false;
	bool m_supervisorExitRequested = false;
};

} // namespace bmsx
