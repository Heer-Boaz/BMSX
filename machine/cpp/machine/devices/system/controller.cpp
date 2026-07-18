#include "machine/devices/system/controller.h"

#include "machine/bus/io.h"
#include "machine/cpu/cpu.h"
#include "machine/devices/dma/controller.h"
#include "machine/devices/geometry/controller.h"
#include "machine/devices/gx/gpu.h"
#include "machine/devices/irq/controller.h"
#include "machine/scheduler/device.h"

namespace bmsx {

SystemController::SystemController(
	Memory& memory,
	CPU& cpu,
	DeviceScheduler& scheduler,
	IrqController& irq,
	DmaController& dma,
	GeometryController& geometry,
	GxGpu& gpu)
	: m_memory(memory)
	, m_cpu(cpu)
	, m_scheduler(scheduler)
	, m_irq(irq)
	, m_dma(dma)
	, m_geometry(geometry)
	, m_gpu(gpu) {
	memory.mapIoWrite<&SystemController::writeControl>(IO_SYS_CONTROL, *this);
	memory.mapIoRead<&SystemController::readStatus>(IO_SYS_STATUS, *this);
}

void SystemController::reset() {
	m_scheduler.cancelDeviceService(DEVICE_SERVICE_SYSTEM);
	m_resetRequested = false;
	m_supervisorPhase = SYSTEM_SUPERVISOR_PHASE_USER;
	m_supervisorResumable = false;
	m_supervisorExitRequested = false;
	m_memory.writeIoValue(IO_SYS_CONTROL, valueNumber(0.0));
	writeStatusIo();
}

Value SystemController::readStatus([[maybe_unused]] u32 address) {
	return valueNumber(static_cast<f64>(statusWord()));
}

void SystemController::writeControl([[maybe_unused]] u32 address, Value value) {
	const u32 control = toU32(value);
	if ((control & SYS_CONTROL_RESET) != 0u) {
		m_resetRequested = true;
		m_cpu.requestYield();
	}
	if (!m_cpu.isUserMode()) {
		if ((control & SYS_CONTROL_SUPERVISOR_ENTER) != 0u) {
			enterSupervisor();
		}
		if ((control & SYS_CONTROL_SUPERVISOR_FAULT) != 0u) {
			enterSupervisorFault();
		}
		if ((control & SYS_CONTROL_SUPERVISOR_LEAVE) != 0u) {
			beginSupervisorLeave();
		}
	}
	m_memory.writeIoValue(IO_SYS_CONTROL, valueNumber(0.0));
}

void SystemController::requestSupervisorLineEdge() {
	if (m_supervisorPhase == SYSTEM_SUPERVISOR_PHASE_USER) {
		m_supervisorPhase = SYSTEM_SUPERVISOR_PHASE_ENTRY_QUIESCE;
		m_supervisorResumable = true;
		m_supervisorExitRequested = false;
		m_gpu.beginSupervisorQuiesce();
		m_dma.beginSupervisorQuiesce();
		m_geometry.beginSupervisorQuiesce();
		writeStatusIo();
		m_scheduler.scheduleDeviceService(DEVICE_SERVICE_SYSTEM, m_scheduler.currentNowCycles());
		return;
	}
	if (m_supervisorPhase == SYSTEM_SUPERVISOR_PHASE_ACTIVE && m_supervisorResumable) {
		m_supervisorExitRequested = true;
		writeStatusIo();
	}
}

void SystemController::onService() {
	if (m_supervisorPhase == SYSTEM_SUPERVISOR_PHASE_ENTRY_QUIESCE) {
		if (!m_gpu.supervisorQuiescent()
			|| !m_dma.supervisorQuiescent()
			|| !m_geometry.supervisorQuiescent()) {
			return;
		}
		m_supervisorPhase = SYSTEM_SUPERVISOR_PHASE_ENTRY_VECTOR;
		m_cpu.abortStalledMemoryWrite();
		m_cpu.requestNonMaskableInterrupt();
		writeStatusIo();
		return;
	}
	if (m_supervisorPhase == SYSTEM_SUPERVISOR_PHASE_LEAVING) {
		if (!m_gpu.supervisorQuiescent()
			|| !m_dma.supervisorQuiescent()
			|| !m_geometry.supervisorQuiescent()) {
			return;
		}
		m_gpu.leaveSupervisorContext();
		m_dma.leaveSupervisorContext();
		m_geometry.leaveSupervisorContext();
		m_irq.leaveSupervisorContext();
		m_supervisorPhase = SYSTEM_SUPERVISOR_PHASE_USER;
		m_supervisorResumable = false;
		m_supervisorExitRequested = false;
		writeStatusIo();
	}
}

void SystemController::enterSupervisor() {
	if (m_supervisorPhase != SYSTEM_SUPERVISOR_PHASE_ENTRY_VECTOR) {
		return;
	}
	// Bank the user IRQ latch before resetting the supervisor GPU context;
	// GP1 reset acknowledges the GPU line in the active IRQ bank.
	m_irq.enterSupervisorContext();
	m_dma.enterSupervisorContext();
	m_gpu.enterSupervisorContext();
	m_supervisorResumable = true;
	m_supervisorPhase = SYSTEM_SUPERVISOR_PHASE_ACTIVE;
	m_supervisorExitRequested = false;
	writeStatusIo();
}

void SystemController::enterSupervisorFault() {
	if (m_supervisorPhase == SYSTEM_SUPERVISOR_PHASE_LEAVING) {
		return;
	}
	m_cpu.cancelNonMaskableInterrupt();
	m_dma.enterSupervisorFaultContext();
	m_gpu.enterSupervisorFaultContext();
	m_geometry.enterSupervisorFaultContext();
	m_irq.enterSupervisorFaultContext();
	m_supervisorPhase = SYSTEM_SUPERVISOR_PHASE_ACTIVE;
	m_supervisorResumable = false;
	m_supervisorExitRequested = false;
	writeStatusIo();
}

void SystemController::beginSupervisorLeave() {
	if (m_supervisorPhase != SYSTEM_SUPERVISOR_PHASE_ACTIVE || !m_supervisorResumable) {
		return;
	}
	m_supervisorPhase = SYSTEM_SUPERVISOR_PHASE_LEAVING;
	m_supervisorExitRequested = false;
	m_gpu.beginSupervisorQuiesce();
	m_dma.beginSupervisorQuiesce();
	m_geometry.beginSupervisorQuiesce();
	writeStatusIo();
	m_scheduler.scheduleDeviceService(DEVICE_SERVICE_SYSTEM, m_scheduler.currentNowCycles());
}

bool SystemController::takeResetRequest() {
	const bool requested = m_resetRequested;
	m_resetRequested = false;
	return requested;
}

SystemControllerState SystemController::captureState() const {
	return {
		m_resetRequested,
		m_supervisorPhase,
		m_supervisorResumable,
		m_supervisorExitRequested,
	};
}

void SystemController::restoreState(const SystemControllerState& state) {
	m_resetRequested = state.resetRequested;
	m_supervisorPhase = state.supervisorPhase;
	m_supervisorResumable = state.supervisorResumable;
	m_supervisorExitRequested = state.supervisorExitRequested;
	m_memory.writeIoValue(IO_SYS_CONTROL, valueNumber(0.0));
	writeStatusIo();
}

void SystemController::postLoad() {
	if (m_supervisorPhase == SYSTEM_SUPERVISOR_PHASE_ENTRY_QUIESCE
		|| m_supervisorPhase == SYSTEM_SUPERVISOR_PHASE_LEAVING) {
		m_scheduler.scheduleDeviceService(DEVICE_SERVICE_SYSTEM, m_scheduler.currentNowCycles());
	}
}

u32 SystemController::statusWord() const {
	u32 status = 0u;
	if (m_supervisorPhase != SYSTEM_SUPERVISOR_PHASE_USER) {
		status |= SYS_STATUS_SUPERVISOR_ACTIVE;
	}
	if (m_supervisorExitRequested) {
		status |= SYS_STATUS_SUPERVISOR_EXIT_REQUESTED;
	}
	if (m_supervisorResumable) {
		status |= SYS_STATUS_SUPERVISOR_RESUMABLE;
	}
	return status;
}

void SystemController::writeStatusIo() {
	m_memory.writeIoValue(IO_SYS_STATUS, valueNumber(static_cast<f64>(statusWord())));
}

} // namespace bmsx
