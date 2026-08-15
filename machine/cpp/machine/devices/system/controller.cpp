#include "machine/devices/system/controller.h"

#include "spec/bmsx/io.h"
#include "machine/cpu/cpu.h"
#include "machine/devices/audio/controller.h"
#include "machine/devices/dma/controller.h"
#include "machine/devices/geometry/controller.h"
#include "machine/devices/gx/gpu.h"
#include "machine/devices/irq/controller.h"
#include "machine/devices/imgdec/controller.h"
#include "machine/scheduler/device.h"

namespace bmsx {

SystemController::SystemController(
	Memory& memory,
	CPU& cpu,
	DeviceScheduler& scheduler,
	IrqController& irq,
	DmaController& dma,
	GeometryController& geometry,
	GxGpu& gpu,
	ImgDecController& imgDec,
	AudioController& audio,
	i64 cpuHz)
	: m_memory(memory)
	, m_cpu(cpu)
	, m_scheduler(scheduler)
	, m_irq(irq)
	, m_dma(dma)
	, m_geometry(geometry)
	, m_gpu(gpu)
	, m_imgDec(imgDec)
	, m_audio(audio)
	, m_cpuHz(cpuHz) {
	memory.mapIoWrite<&SystemController::writeControl>(IO_SYS_CONTROL, *this);
	memory.mapIoRead<&SystemController::readStatus>(IO_SYS_STATUS, *this);
	memory.mapIoRead<&SystemController::readTimeMilliseconds>(IO_SYS_TIME_MS, *this);
	memory.mapIoRead<&SystemController::readFrameMillisecondsQ16>(IO_SYS_FRAME_MS_Q16, *this);
	memory.mapIoRead<&SystemController::readCyclesPerFrame>(IO_SYS_CYCLES_PER_FRAME, *this);
}

void SystemController::reset() {
	m_scheduler.cancelDeviceService(DEVICE_SERVICE_SYSTEM);
	m_resetRequested = false;
	m_supervisorPhase = SYSTEM_SUPERVISOR_PHASE_USER;
	m_supervisorTransitionTarget = SYSTEM_SUPERVISOR_TARGET_USER;
	m_supervisorResumable = false;
	m_supervisorExitRequested = false;
	m_audio.setVoiceClockHeld(false, m_scheduler.currentNowCycles());
	m_memory.writeIoU32(IO_SYS_CONTROL, 0u);
	m_memory.writeIoU32(IO_SYS_SUPERVISOR_FAULT_SEQUENCE, 0u);
	m_memory.writeIoU32(IO_SYS_SUPERVISOR_FAULT_CAUSE, 0u);
	m_memory.writeIoU32(IO_SYS_SUPERVISOR_FAULT_EPC, 0u);
	m_memory.writeIoU32(IO_SYS_SUPERVISOR_FAULT_BAD_ADDRESS, 0u);
	m_memory.writeIoU32(IO_SYS_SUPERVISOR_FAULT_LUA_REASON, 0u);
	m_memory.writeIoU32(IO_SYS_SUPERVISOR_FAULT_DOMAIN, 0u);
	writeStatusIo();
}

f64 SystemController::elapsedMilliseconds() const {
	return static_cast<f64>(m_scheduler.currentNowCycles()) * 1000.0 / static_cast<f64>(m_cpuHz);
}

u32 SystemController::readStatus([[maybe_unused]] u32 address) {
	return statusWord();
}

u32 SystemController::readTimeMilliseconds([[maybe_unused]] u32 address) const {
	const u64 cycles = static_cast<u64>(m_scheduler.currentNowCycles());
	const u64 cpuHz = static_cast<u64>(m_cpuHz);
	return static_cast<u32>((cycles / cpuHz) * 1000u + ((cycles % cpuHz) * 1000u) / cpuHz);
}

u32 SystemController::readFrameMillisecondsQ16([[maybe_unused]] u32 address) const {
	return m_gpu.readPcrtcTiming().frameDurationMillisecondsQ16;
}

u32 SystemController::readCyclesPerFrame([[maybe_unused]] u32 address) const {
	return static_cast<u32>(m_gpu.readPcrtcTiming().nextVblankCycleBudget);
}

void SystemController::writeControl([[maybe_unused]] u32 address, u32 value) {
	if ((value & SYS_CONTROL_RESET) != 0u) {
		m_resetRequested = true;
		m_cpu.requestYield();
	}
	if (!m_cpu.isUserMode()) {
		if ((value & SYS_CONTROL_SUPERVISOR_ENTER) != 0u) {
			activateSupervisorContext();
		}
		if ((value & SYS_CONTROL_SUPERVISOR_FAULT) != 0u) {
			enterSupervisorFault();
		}
		if ((value & SYS_CONTROL_SUPERVISOR_FAULT_PUBLISH) != 0u) {
			publishSupervisorFault();
		}
		if ((value & SYS_CONTROL_SUPERVISOR_LEAVE) != 0u) {
			beginSupervisorLeave();
		}
	}
	m_memory.writeIoU32(IO_SYS_CONTROL, 0u);
}

void SystemController::requestSupervisorLineEdge() {
	if (m_supervisorPhase == SYSTEM_SUPERVISOR_PHASE_USER) {
		m_audio.setVoiceClockHeld(true, m_scheduler.currentNowCycles());
		m_supervisorPhase = SYSTEM_SUPERVISOR_PHASE_ENTRY_PRODUCER_QUIESCE;
		m_supervisorTransitionTarget = SYSTEM_SUPERVISOR_TARGET_SUPERVISOR;
		m_supervisorResumable = false;
		m_gpu.beginSupervisorControlQuiesce();
		m_dma.beginSupervisorControlQuiesce();
		m_geometry.beginSupervisorQuiesce();
		m_imgDec.beginSupervisorQuiesce();
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
	if (m_supervisorPhase == SYSTEM_SUPERVISOR_PHASE_ENTRY_PRODUCER_QUIESCE) {
		if (!m_geometry.supervisorQuiescent()
			|| !m_imgDec.supervisorQuiescent()) {
			return;
		}
		m_dma.beginSupervisorQuiesce();
		m_supervisorPhase = SYSTEM_SUPERVISOR_PHASE_BUS_QUIESCE;
		writeStatusIo();
	}
	if (m_supervisorPhase == SYSTEM_SUPERVISOR_PHASE_BUS_QUIESCE) {
		if (!m_dma.supervisorQuiescent()) {
			return;
		}
		m_supervisorPhase = SYSTEM_SUPERVISOR_PHASE_GPU_QUIESCE;
		m_gpu.beginSupervisorQuiesce();
		writeStatusIo();
	}
	if (m_supervisorPhase == SYSTEM_SUPERVISOR_PHASE_GPU_QUIESCE) {
		if (!m_gpu.supervisorQuiescent()) {
			return;
		}
		if (m_supervisorTransitionTarget == SYSTEM_SUPERVISOR_TARGET_SUPERVISOR) {
			m_supervisorPhase = SYSTEM_SUPERVISOR_PHASE_ENTRY_VECTOR;
			m_cpu.abortStalledMemoryWrite();
			m_cpu.requestNonMaskableInterrupt();
			writeStatusIo();
			return;
		}
		if (m_supervisorTransitionTarget == SYSTEM_SUPERVISOR_TARGET_FAULT) {
			m_supervisorPhase = SYSTEM_SUPERVISOR_PHASE_ENTRY_VECTOR;
			activateSupervisorContext();
			return;
		}
		m_dma.leaveSupervisorContext();
		m_gpu.leaveSupervisorContext();
		m_geometry.leaveSupervisorContext();
		m_imgDec.leaveSupervisorContext();
		m_irq.leaveSupervisorContext();
		m_supervisorPhase = SYSTEM_SUPERVISOR_PHASE_USER;
		m_supervisorTransitionTarget = SYSTEM_SUPERVISOR_TARGET_USER;
		m_supervisorResumable = false;
		m_audio.setVoiceClockHeld(false, m_scheduler.currentNowCycles());
		writeStatusIo();
	}
}

void SystemController::activateSupervisorContext() {
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
	m_supervisorTransitionTarget = SYSTEM_SUPERVISOR_TARGET_SUPERVISOR;
	writeStatusIo();
}

void SystemController::enterSupervisorFault() {
	m_memory.writeIoU32(IO_SYS_SUPERVISOR_FAULT_CAUSE, m_cpu.readCauseWord());
	m_memory.writeIoU32(IO_SYS_SUPERVISOR_FAULT_EPC, m_cpu.readEpcWord());
	m_memory.writeIoU32(IO_SYS_SUPERVISOR_FAULT_BAD_ADDRESS, m_cpu.readBadAddressWord());
	m_memory.writeIoU32(IO_SYS_SUPERVISOR_FAULT_LUA_REASON, m_cpu.readLuaFaultReasonWord());
	m_memory.writeIoU32(IO_SYS_SUPERVISOR_FAULT_DOMAIN, m_cpu.readExceptionDomainWord());
	if (m_supervisorPhase == SYSTEM_SUPERVISOR_PHASE_ACTIVE) {
		return;
	}
	m_cpu.cancelNonMaskableInterrupt();
	if (m_supervisorPhase == SYSTEM_SUPERVISOR_PHASE_USER) {
		m_audio.setVoiceClockHeld(true, m_scheduler.currentNowCycles());
		m_supervisorPhase = SYSTEM_SUPERVISOR_PHASE_ENTRY_PRODUCER_QUIESCE;
		m_gpu.beginSupervisorControlQuiesce();
		m_dma.beginSupervisorControlQuiesce();
		m_geometry.beginSupervisorQuiesce();
		m_imgDec.beginSupervisorQuiesce();
	}
	m_supervisorTransitionTarget = SYSTEM_SUPERVISOR_TARGET_FAULT;
	m_supervisorResumable = false;
	writeStatusIo();
	m_scheduler.scheduleDeviceService(DEVICE_SERVICE_SYSTEM, m_scheduler.currentNowCycles());
	m_cpu.requestYield();
}

void SystemController::publishSupervisorFault() {
	m_memory.writeIoU32(
		IO_SYS_SUPERVISOR_FAULT_SEQUENCE,
		m_memory.readIoU32(IO_SYS_SUPERVISOR_FAULT_SEQUENCE) + 1u
	);
}

void SystemController::beginSupervisorLeave() {
	if (m_supervisorPhase != SYSTEM_SUPERVISOR_PHASE_ACTIVE || !m_supervisorResumable) {
		return;
	}
	m_supervisorPhase = SYSTEM_SUPERVISOR_PHASE_BUS_QUIESCE;
	m_supervisorTransitionTarget = SYSTEM_SUPERVISOR_TARGET_USER;
	m_supervisorExitRequested = false;
	m_gpu.beginSupervisorControlQuiesce();
	m_dma.beginSupervisorControlQuiesce();
	m_dma.beginSupervisorQuiesce();
	writeStatusIo();
	m_scheduler.scheduleDeviceService(DEVICE_SERVICE_SYSTEM, m_scheduler.currentNowCycles());
	m_cpu.requestYield();
}

bool SystemController::takeResetRequest() {
	const bool requested = m_resetRequested;
	m_resetRequested = false;
	return requested;
}

SystemControllerState SystemController::captureState() const {
	SystemControllerState state;
	state.resetRequested = m_resetRequested;
	state.supervisorPhase = m_supervisorPhase;
	state.supervisorTransitionTarget = m_supervisorTransitionTarget;
	state.supervisorResumable = m_supervisorResumable;
	state.supervisorExitRequested = m_supervisorExitRequested;
	state.supervisorFaultSequenceWord = m_memory.readIoU32(IO_SYS_SUPERVISOR_FAULT_SEQUENCE);
	state.supervisorFaultCauseWord = m_memory.readIoU32(IO_SYS_SUPERVISOR_FAULT_CAUSE);
	state.supervisorFaultEpcWord = m_memory.readIoU32(IO_SYS_SUPERVISOR_FAULT_EPC);
	state.supervisorFaultBadAddressWord = m_memory.readIoU32(IO_SYS_SUPERVISOR_FAULT_BAD_ADDRESS);
	state.supervisorFaultLuaReasonWord = m_memory.readIoU32(IO_SYS_SUPERVISOR_FAULT_LUA_REASON);
	state.supervisorFaultDomainWord = m_memory.readIoU32(IO_SYS_SUPERVISOR_FAULT_DOMAIN);
	return state;
}

void SystemController::restoreState(const SystemControllerState& state) {
	m_resetRequested = state.resetRequested;
	m_supervisorPhase = state.supervisorPhase;
	m_supervisorTransitionTarget = state.supervisorTransitionTarget;
	m_supervisorResumable = state.supervisorResumable;
	m_supervisorExitRequested = state.supervisorExitRequested;
	m_audio.setVoiceClockHeld(
		m_supervisorPhase != SYSTEM_SUPERVISOR_PHASE_USER,
		m_scheduler.currentNowCycles()
	);
	m_memory.writeIoU32(IO_SYS_CONTROL, 0u);
	m_memory.writeIoU32(IO_SYS_SUPERVISOR_FAULT_SEQUENCE, state.supervisorFaultSequenceWord);
	m_memory.writeIoU32(IO_SYS_SUPERVISOR_FAULT_CAUSE, state.supervisorFaultCauseWord);
	m_memory.writeIoU32(IO_SYS_SUPERVISOR_FAULT_EPC, state.supervisorFaultEpcWord);
	m_memory.writeIoU32(IO_SYS_SUPERVISOR_FAULT_BAD_ADDRESS, state.supervisorFaultBadAddressWord);
	m_memory.writeIoU32(IO_SYS_SUPERVISOR_FAULT_LUA_REASON, state.supervisorFaultLuaReasonWord);
	m_memory.writeIoU32(IO_SYS_SUPERVISOR_FAULT_DOMAIN, state.supervisorFaultDomainWord);
	writeStatusIo();
}

void SystemController::postLoad() {
	if (m_supervisorPhase == SYSTEM_SUPERVISOR_PHASE_ENTRY_PRODUCER_QUIESCE
		|| m_supervisorPhase == SYSTEM_SUPERVISOR_PHASE_BUS_QUIESCE
		|| m_supervisorPhase == SYSTEM_SUPERVISOR_PHASE_GPU_QUIESCE) {
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
	m_memory.writeIoU32(IO_SYS_STATUS, statusWord());
}

} // namespace bmsx
