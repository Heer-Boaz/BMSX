#include "machine/devices/system/controller.h"

#include "common/utf8.h"
#include "spec/bmsx/io.h"
#include "machine/cpu/cpu.h"
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
	i64 cpuHz)
	: m_memory(memory)
	, m_cpu(cpu)
	, m_scheduler(scheduler)
	, m_irq(irq)
	, m_dma(dma)
	, m_geometry(geometry)
	, m_gpu(gpu)
	, m_imgDec(imgDec)
	, m_cpuHz(cpuHz) {
	memory.mapIoWrite<&SystemController::writeControl>(IO_SYS_CONTROL, *this);
	memory.mapIoRead<&SystemController::readStatus>(IO_SYS_STATUS, *this);
	memory.mapIoRead<&SystemController::readTimeMilliseconds>(IO_SYS_TIME_MS, *this);
	memory.mapIoRead<&SystemController::readFrameMilliseconds>(IO_SYS_FRAME_MS, *this);
	memory.mapIoRead<&SystemController::readCyclesPerFrame>(IO_SYS_CYCLES_PER_FRAME, *this);
	memory.mapIoRead<&SystemController::readPrintChar>(IO_SYS_PRINT_CHAR, *this);
	memory.mapIoWrite<&SystemController::writePrintChar>(IO_SYS_PRINT_CHAR, *this);
	memory.mapIoRead<&SystemController::readPrintByteCount>(IO_SYS_PRINT_FLUSH, *this);
	memory.mapIoWrite<&SystemController::flushPrintLine>(IO_SYS_PRINT_FLUSH, *this);
}

void SystemController::reset() {
	m_scheduler.cancelDeviceService(DEVICE_SERVICE_SYSTEM);
	m_resetRequested = false;
	m_supervisorPhase = SYSTEM_SUPERVISOR_PHASE_USER;
	m_supervisorTransitionTarget = SYSTEM_SUPERVISOR_TARGET_USER;
	m_supervisorResumable = false;
	m_supervisorExitRequested = false;
	m_printBuffer.fill(0u);
	m_printReadIndex = 0u;
	m_printByteCount = 0u;
	clearHostOutput();
	m_memory.writeIoValue(IO_SYS_CONTROL, valueNumber(0.0));
	writeStatusIo();
}

f64 SystemController::elapsedMilliseconds() const {
	return static_cast<f64>(m_scheduler.currentNowCycles()) * 1000.0 / static_cast<f64>(m_cpuHz);
}

Value SystemController::readStatus([[maybe_unused]] u32 address) {
	return valueNumber(static_cast<f64>(statusWord()));
}

Value SystemController::readTimeMilliseconds([[maybe_unused]] u32 address) const {
	const u64 cycles = static_cast<u64>(m_scheduler.currentNowCycles());
	const u64 cpuHz = static_cast<u64>(m_cpuHz);
	return valueNumber(static_cast<f64>(
		static_cast<u32>((cycles / cpuHz) * 1000u + ((cycles % cpuHz) * 1000u) / cpuHz)
	));
}

Value SystemController::readFrameMilliseconds([[maybe_unused]] u32 address) const {
	return valueNumber(m_gpu.readPcrtcTiming().frameDurationMs);
}

Value SystemController::readCyclesPerFrame([[maybe_unused]] u32 address) const {
	return valueNumber(static_cast<f64>(m_gpu.readPcrtcTiming().nextVblankCycleBudget));
}

Value SystemController::readPrintChar([[maybe_unused]] u32 address) {
	if (m_printByteCount == 0u) {
		return valueNumber(0.0);
	}
	const u8 value = m_printBuffer[m_printReadIndex];
	m_printReadIndex = (m_printReadIndex + 1u) & (SYS_PRINT_BUFFER_BYTES - 1u);
	m_printByteCount -= 1u;
	return valueNumber(static_cast<f64>(value));
}

Value SystemController::readPrintByteCount([[maybe_unused]] u32 address) const {
	return valueNumber(static_cast<f64>(m_printByteCount));
}

void SystemController::writePrintChar([[maybe_unused]] u32 address, Value value) {
	const u32 codepoint = toU32(value);
	const u32 byteCount = encodeUtf8Codepoint(codepoint, m_printEncodingBytes);
	appendRingByte(static_cast<u8>(codepoint <= 0xFFu ? codepoint : static_cast<u32>('?')));
	if (!reserveHostOutputBytes(byteCount)) {
		return;
	}
	for (u32 index = 0u; index < byteCount; ++index) {
		appendHostOutputByte(m_printEncodingBytes[index]);
	}
}

void SystemController::flushPrintLine([[maybe_unused]] u32 address, [[maybe_unused]] Value value) {
	appendRingByte(static_cast<u8>('\n'));
	if (reserveHostOutputBytes(1u)) {
		appendHostOutputByte(static_cast<u8>('\n'));
		m_hostOutputCompleteByteCount = m_hostOutputByteCount;
	}
	m_hostOutputLineOverflowed = false;
}

bool SystemController::reserveHostOutputBytes(u32 byteCount) {
	if (m_hostOutputLineOverflowed) {
		return false;
	}
	if (m_hostOutputByteCount + byteCount <= SYS_PRINT_BUFFER_BYTES) {
		return true;
	}
	m_hostOutputByteCount = m_hostOutputCompleteByteCount;
	m_hostOutputLineOverflowed = true;
	return false;
}

void SystemController::clearHostOutput() {
	m_hostOutputReadIndex = 0u;
	m_hostOutputByteCount = 0u;
	m_hostOutputCompleteByteCount = 0u;
	m_hostOutputLineOverflowed = false;
}

void SystemController::appendHostOutputByte(u8 value) {
	m_hostOutputBuffer[(m_hostOutputReadIndex + m_hostOutputByteCount) & (SYS_PRINT_BUFFER_BYTES - 1u)] = value;
	m_hostOutputByteCount += 1u;
}

u8 SystemController::readHostOutputByte() {
	const u8 value = m_hostOutputBuffer[m_hostOutputReadIndex];
	m_hostOutputReadIndex = (m_hostOutputReadIndex + 1u) & (SYS_PRINT_BUFFER_BYTES - 1u);
	m_hostOutputByteCount -= 1u;
	m_hostOutputCompleteByteCount -= 1u;
	return value;
}

void SystemController::appendRingByte(u8 value) {
	if (m_printByteCount == SYS_PRINT_BUFFER_BYTES) {
		m_printReadIndex = (m_printReadIndex + 1u) & (SYS_PRINT_BUFFER_BYTES - 1u);
		m_printByteCount -= 1u;
	}
	m_printBuffer[(m_printReadIndex + m_printByteCount) & (SYS_PRINT_BUFFER_BYTES - 1u)] = value;
	m_printByteCount += 1u;
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
		m_supervisorPhase = SYSTEM_SUPERVISOR_PHASE_ENTRY_PRODUCER_QUIESCE;
		m_supervisorTransitionTarget = SYSTEM_SUPERVISOR_TARGET_SUPERVISOR;
		m_supervisorResumable = true;
		m_supervisorExitRequested = false;
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
		m_dma.leaveSupervisorContext();
		m_gpu.leaveSupervisorContext();
		m_geometry.leaveSupervisorContext();
		m_imgDec.leaveSupervisorContext();
		m_irq.leaveSupervisorContext();
		m_supervisorPhase = SYSTEM_SUPERVISOR_PHASE_USER;
		m_supervisorTransitionTarget = SYSTEM_SUPERVISOR_TARGET_USER;
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
	m_supervisorTransitionTarget = SYSTEM_SUPERVISOR_TARGET_SUPERVISOR;
	m_supervisorExitRequested = false;
	writeStatusIo();
}

void SystemController::enterSupervisorFault() {
	if (m_supervisorTransitionTarget == SYSTEM_SUPERVISOR_TARGET_USER
		&& (m_supervisorPhase == SYSTEM_SUPERVISOR_PHASE_BUS_QUIESCE
			|| m_supervisorPhase == SYSTEM_SUPERVISOR_PHASE_GPU_QUIESCE)) {
		return;
	}
	m_cpu.cancelNonMaskableInterrupt();
	m_dma.enterSupervisorFaultContext();
	m_imgDec.enterSupervisorFaultContext();
	m_gpu.enterSupervisorFaultContext();
	m_geometry.enterSupervisorFaultContext();
	m_irq.enterSupervisorFaultContext();
	m_supervisorPhase = SYSTEM_SUPERVISOR_PHASE_ACTIVE;
	m_supervisorTransitionTarget = SYSTEM_SUPERVISOR_TARGET_SUPERVISOR;
	m_supervisorResumable = false;
	m_supervisorExitRequested = false;
	writeStatusIo();
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
	state.printBuffer = m_printBuffer;
	state.printReadIndex = m_printReadIndex;
	state.printByteCount = m_printByteCount;
	return state;
}

void SystemController::restoreState(const SystemControllerState& state) {
	m_resetRequested = state.resetRequested;
	m_supervisorPhase = state.supervisorPhase;
	m_supervisorTransitionTarget = state.supervisorTransitionTarget;
	m_supervisorResumable = state.supervisorResumable;
	m_supervisorExitRequested = state.supervisorExitRequested;
	m_printBuffer = state.printBuffer;
	m_printReadIndex = state.printReadIndex;
	m_printByteCount = state.printByteCount;
	clearHostOutput();
	m_memory.writeIoValue(IO_SYS_CONTROL, valueNumber(0.0));
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
	m_memory.writeIoValue(IO_SYS_STATUS, valueNumber(static_cast<f64>(statusWord())));
}

} // namespace bmsx
