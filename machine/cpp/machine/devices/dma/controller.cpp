#include "machine/devices/dma/controller.h"

#include "machine/bus/io.h"
#include "machine/cpu/cpu.h"
#include "machine/devices/gx/gpu.h"
#include "machine/devices/irq/controller.h"
#include "machine/memory/map.h"
#include "machine/memory/memory.h"
#include "machine/scheduler/budget.h"
#include "machine/scheduler/device.h"

namespace bmsx {

DmaController::DmaController(Memory& memory, CPU& cpu, IrqController& irq, DeviceScheduler& scheduler)
	: m_memory(memory)
	, m_cpu(cpu)
	, m_irq(irq)
	, m_scheduler(scheduler) {
	m_memory.mapIoWrite(IO_DMA_CONTROL, this, &DmaController::onControlWriteThunk);
	m_memory.mapIoWrite(IO_DMA_WRITE_ADDR, this, &DmaController::onWriteAddressWriteThunk);
	m_memory.mapIoWrite(IO_DMA_TRIGGER, this, &DmaController::onTriggerWriteThunk);
}

void DmaController::onControlWriteThunk(void* context, u32, Value) {
	static_cast<DmaController*>(context)->requestInputChanged();
}

void DmaController::onWriteAddressWriteThunk(void* context, u32, Value) {
	static_cast<DmaController*>(context)->resumeGxGpuCpuWrite();
}

void DmaController::onTriggerWriteThunk(void* context, u32, u64 value) {
	static_cast<DmaController*>(context)->onTriggerWrite(toU32(value));
}

void DmaController::onTriggerWrite(u32 value) {
	m_memory.writeIoValue(IO_DMA_TRIGGER, valueNumber(0.0));
	if ((value & DMA_TRIGGER_START) == 0u || busy()) {
		return;
	}
	m_scheduler.cancelDeviceService(DEVICE_SERVICE_DMA);
	m_scheduledGrantWords = 0u;
	m_serviceDeadline = 0;
	m_timingCarry = 0;
	m_memory.writeIoValue(IO_DMA_STATUS, valueNumber(static_cast<f64>(DMA_STATUS_BUSY)));
	if (m_memory.readIoU32(IO_DMA_TRANSFER_COUNT) == 0u) {
		finishTransfer();
		return;
	}
	if (requestAsserted()) {
		scheduleGrant(m_scheduler.currentNowCycles());
	}
}

void DmaController::setTiming(i64 cpuHz, i64 wordsPerSec, i64 nowCycles) {
	if (m_cpuHz == cpuHz && m_wordsPerSec == wordsPerSec) {
		return;
	}
	m_cpuHz = cpuHz;
	m_wordsPerSec = wordsPerSec;
	cancelGrant();
	if (busy() && requestAsserted()) {
		if (m_memory.readIoU32(IO_DMA_TRANSFER_COUNT) == 0u) {
			finishTransfer();
		} else {
			scheduleGrant(nowCycles);
		}
	}
}

void DmaController::setGxGpuReadReady(bool ready) {
	if (m_gxGpuReadReady == ready) {
		return;
	}
	m_gxGpuReadReady = ready;
	requestInputChanged();
}

void DmaController::setGxGpuDmaWriteReady(bool ready) {
	if (m_gxGpuDmaWriteReady == ready) {
		return;
	}
	m_gxGpuDmaWriteReady = ready;
	requestInputChanged();
}

void DmaController::setGxGpuCpuWriteReady(bool ready) {
	if (m_gxGpuCpuWriteReady == ready) {
		return;
	}
	m_gxGpuCpuWriteReady = ready;
	resumeGxGpuCpuWrite();
}

void DmaController::setGxGpuDmaDirection(u32 direction) {
	if (m_gxGpuDmaDirection == direction) {
		return;
	}
	m_gxGpuDmaDirection = direction;
	requestInputChanged();
}

bool DmaController::isGxGpuCpuPortWriteReady() const {
	return m_gxGpuCpuWriteReady && !ownsGxGpuWritePort();
}

void DmaController::reset() {
	m_scheduler.cancelDeviceService(DEVICE_SERVICE_DMA);
	m_timingCarry = 0;
	m_scheduledGrantWords = 0u;
	m_serviceDeadline = 0;
	m_gxGpuReadReady = false;
	m_gxGpuDmaWriteReady = false;
	m_gxGpuCpuWriteReady = false;
	m_gxGpuDmaDirection = 0u;
	m_serviceActive = false;
	m_restorePending = false;
	m_memory.writeIoValue(IO_DMA_READ_ADDR, valueNumber(0.0));
	m_memory.writeIoValue(IO_DMA_WRITE_ADDR, valueNumber(0.0));
	m_memory.writeIoValue(IO_DMA_TRANSFER_COUNT, valueNumber(0.0));
	m_memory.writeIoValue(IO_DMA_CONTROL, valueNumber(0.0));
	m_memory.writeIoValue(IO_DMA_STATUS, valueNumber(0.0));
	m_memory.writeIoValue(IO_DMA_TRIGGER, valueNumber(0.0));
}

void DmaController::onService(i64) {
	const u32 grantWords = m_scheduledGrantWords;
	const i64 grantDeadline = m_serviceDeadline;
	m_scheduler.cancelDeviceService(DEVICE_SERVICE_DMA);
	m_scheduledGrantWords = 0u;
	m_serviceDeadline = 0;
	m_serviceActive = true;
	for (u32 slot = 0u;
		slot < grantWords
			&& busy()
			&& m_memory.readIoU32(IO_DMA_TRANSFER_COUNT) != 0u
			&& requestAsserted();
		slot += 1u) {
		transferWord();
	}
	m_serviceActive = false;
	if (!busy()) {
		return;
	}
	if (m_memory.readIoU32(IO_DMA_TRANSFER_COUNT) == 0u) {
		finishTransfer();
		return;
	}
	if (!requestAsserted()) {
		m_timingCarry = 0;
		return;
	}
	scheduleGrant(grantDeadline);
}

void DmaController::transferWord() {
	const u32 readAddress = m_memory.readIoU32(IO_DMA_READ_ADDR);
	const u32 writeAddress = m_memory.readIoU32(IO_DMA_WRITE_ADDR);
	const u32 transferCount = m_memory.readIoU32(IO_DMA_TRANSFER_COUNT);
	const u32 control = m_memory.readIoU32(IO_DMA_CONTROL);
	const u32 word = m_memory.readMappedU32LE(readAddress);
	m_memory.writeMappedU32LE(writeAddress, word);
	m_memory.writeIoValue(
		IO_DMA_READ_ADDR,
		valueNumber(static_cast<f64>((control & DMA_CONTROL_READ_INCREMENT) != 0u ? readAddress + IO_WORD_SIZE : readAddress))
	);
	m_memory.writeIoValue(
		IO_DMA_WRITE_ADDR,
		valueNumber(static_cast<f64>((control & DMA_CONTROL_WRITE_INCREMENT) != 0u ? writeAddress + IO_WORD_SIZE : writeAddress))
	);
	m_memory.writeIoValue(IO_DMA_TRANSFER_COUNT, valueNumber(static_cast<f64>(transferCount - 1u)));
	if (writeAddress == IO_GX_GPU_GP0 && (control & DMA_CONTROL_WRITE_INCREMENT) != 0u) {
		resumeGxGpuCpuWrite();
	}
}

void DmaController::finishTransfer() {
	m_scheduler.cancelDeviceService(DEVICE_SERVICE_DMA);
	m_scheduledGrantWords = 0u;
	m_serviceDeadline = 0;
	m_timingCarry = 0;
	m_memory.writeIoValue(IO_DMA_STATUS, valueNumber(static_cast<f64>(DMA_STATUS_DONE)));
	m_irq.raise(IRQ_DMA_DONE);
	resumeGxGpuCpuWrite();
}

DmaControllerState DmaController::captureState() const {
	DmaControllerState state;
	state.readAddressWord = m_memory.readIoU32(IO_DMA_READ_ADDR);
	state.writeAddressWord = m_memory.readIoU32(IO_DMA_WRITE_ADDR);
	state.transferCountWord = m_memory.readIoU32(IO_DMA_TRANSFER_COUNT);
	state.controlWord = m_memory.readIoU32(IO_DMA_CONTROL);
	state.statusWord = m_memory.readIoU32(IO_DMA_STATUS);
	state.timingCarry = m_timingCarry;
	state.scheduledGrantWords = m_scheduledGrantWords;
	state.scheduledGrantCycles = m_scheduledGrantWords == 0u ? 0 : m_serviceDeadline - m_scheduler.currentNowCycles();
	return state;
}

void DmaController::restoreState(const DmaControllerState& state, i64 nowCycles) {
	m_scheduler.cancelDeviceService(DEVICE_SERVICE_DMA);
	m_memory.writeIoValue(IO_DMA_READ_ADDR, valueNumber(static_cast<f64>(state.readAddressWord)));
	m_memory.writeIoValue(IO_DMA_WRITE_ADDR, valueNumber(static_cast<f64>(state.writeAddressWord)));
	m_memory.writeIoValue(IO_DMA_TRANSFER_COUNT, valueNumber(static_cast<f64>(state.transferCountWord)));
	m_memory.writeIoValue(IO_DMA_CONTROL, valueNumber(static_cast<f64>(state.controlWord)));
	m_memory.writeIoValue(IO_DMA_STATUS, valueNumber(static_cast<f64>(state.statusWord)));
	m_memory.writeIoValue(IO_DMA_TRIGGER, valueNumber(0.0));
	m_timingCarry = state.timingCarry;
	m_scheduledGrantWords = state.scheduledGrantWords;
	m_serviceDeadline = nowCycles + state.scheduledGrantCycles;
	m_serviceActive = false;
	m_restorePending = true;
}

void DmaController::postLoad() {
	m_restorePending = false;
	if (m_scheduledGrantWords != 0u) {
		if (requestAsserted()) {
			m_scheduler.scheduleDeviceService(DEVICE_SERVICE_DMA, m_serviceDeadline);
		} else {
			cancelGrant();
		}
	}
	resumeGxGpuCpuWrite();
}

void DmaController::scheduleGrant(i64 anchorCycle) {
	const u32 remaining = m_memory.readIoU32(IO_DMA_TRANSFER_COUNT);
	const u32 grantWords = remaining < DMA_SERVICE_GRANT_WORDS ? remaining : DMA_SERVICE_GRANT_WORDS;
	const i64 grantCycles = cyclesUntilBudgetUnits(m_cpuHz, m_wordsPerSec, m_timingCarry, grantWords);
	m_timingCarry = (m_wordsPerSec * grantCycles + m_timingCarry) % m_cpuHz;
	m_scheduledGrantWords = grantWords;
	m_serviceDeadline = anchorCycle + grantCycles;
	m_scheduler.scheduleDeviceService(DEVICE_SERVICE_DMA, m_serviceDeadline);
}

void DmaController::cancelGrant() {
	m_scheduler.cancelDeviceService(DEVICE_SERVICE_DMA);
	m_scheduledGrantWords = 0u;
	m_serviceDeadline = 0;
	m_timingCarry = 0;
}

void DmaController::requestInputChanged() {
	if (m_restorePending || !busy()) {
		return;
	}
	if (!requestAsserted()) {
		cancelGrant();
		return;
	}
	if (m_memory.readIoU32(IO_DMA_TRANSFER_COUNT) == 0u) {
		finishTransfer();
		return;
	}
	if (!m_serviceActive && m_scheduledGrantWords == 0u) {
		scheduleGrant(m_scheduler.currentNowCycles());
	}
}

bool DmaController::requestAsserted() const {
	switch (m_memory.readIoU32(IO_DMA_CONTROL) & DMA_CONTROL_REQUEST_MASK) {
	case DMA_CONTROL_REQUEST_FORCE:
		return true;
	case DMA_CONTROL_REQUEST_GX_WRITE:
		return (m_gxGpuDmaDirection == GX_GPU_DMA_DIRECTION_CPU_TO_GP0
			|| m_gxGpuDmaDirection == GX_GPU_DMA_DIRECTION_FIFO)
			&& m_gxGpuDmaWriteReady;
	case DMA_CONTROL_REQUEST_GX_READ:
		return m_gxGpuDmaDirection == GX_GPU_DMA_DIRECTION_GPUREAD_TO_CPU && m_gxGpuReadReady;
	default:
		return false;
	}
}

bool DmaController::busy() const {
	return (m_memory.readIoU32(IO_DMA_STATUS) & DMA_STATUS_BUSY) != 0u;
}

bool DmaController::ownsGxGpuWritePort() const {
	return busy() && m_memory.readIoU32(IO_DMA_WRITE_ADDR) == IO_GX_GPU_GP0;
}

void DmaController::resumeGxGpuCpuWrite() {
	if (m_gxGpuCpuWriteReady && !ownsGxGpuWritePort()) {
		m_cpu.resumeMemoryWrite(IO_GX_GPU_GP0);
	}
}

} // namespace bmsx
