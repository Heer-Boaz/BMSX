#include "machine/devices/dma/controller.h"

#include "machine/bus/io.h"
#include "machine/cpu/cpu.h"
#include "machine/devices/gx/gpu.h"
#include "machine/devices/irq/controller.h"
#include "machine/memory/map.h"
#include "machine/memory/memory.h"
#include "machine/scheduler/device.h"

namespace bmsx {

DmaController::DmaController(Memory& memory, CPU& cpu, IrqController& irq, DeviceScheduler& scheduler)
	: m_memory(memory)
	, m_cpu(cpu)
	, m_irq(irq)
	, m_scheduler(scheduler) {
	m_memory.mapIoWrite(IO_DMA_CONTROL, this, &DmaController::onControlWriteThunk);
	m_memory.mapIoWrite(IO_DMA_READ_ADDR, this, &DmaController::onAddressWriteThunk);
	m_memory.mapIoWrite(IO_DMA_WRITE_ADDR, this, &DmaController::onAddressWriteThunk);
	m_memory.mapIoWrite(IO_DMA_TRIGGER, this, &DmaController::onTriggerWriteThunk);
	m_memory.mapIoWriteReady(IO_DMA_TRIGGER, &DmaController::triggerWriteReadyThunk);
}

bool DmaController::triggerWriteReadyThunk(void* context, u32) {
	return !static_cast<DmaController*>(context)->m_supervisorQuiesceRequested;
}

void DmaController::onControlWriteThunk(void* context, u32, Value, MappedBusSignals) {
	static_cast<DmaController*>(context)->requestInputChanged();
}

void DmaController::onAddressWriteThunk(void* context, u32, Value, MappedBusSignals) {
	static_cast<DmaController*>(context)->resumeCpuPortWrites();
}

void DmaController::onTriggerWriteThunk(void* context, u32, u64 value, MappedBusSignals) {
	static_cast<DmaController*>(context)->onTriggerWrite(toU32(value));
}

void DmaController::onTriggerWrite(u32 value) {
	m_memory.writeIoValue(IO_DMA_TRIGGER, valueNumber(0.0));
	if ((value & DMA_TRIGGER_START) == 0u || busy()) {
		return;
	}
	m_scheduler.cancelDeviceService(DEVICE_SERVICE_DMA);
	clearAdmittedBlock();
	m_memory.writeIoValue(IO_DMA_STATUS, valueNumber(static_cast<f64>(DMA_STATUS_BUSY)));
	if (m_memory.readIoU32(IO_DMA_TRANSFER_COUNT) == 0u) {
		finishTransfer();
		return;
	}
	if (requestAsserted()) {
		admitBlock(m_scheduler.currentNowCycles());
	}
}

void DmaController::setTiming(i64 ramCyclesPerWord, i64 ramBurstSetupCycles, i64 systemRomCyclesPerWord, i64 cartRomCyclesPerWord, i64 cartRomBurstSetupCycles, i64 nowCycles) {
	if (m_ramCyclesPerWord == ramCyclesPerWord
		&& m_ramBurstSetupCycles == ramBurstSetupCycles
		&& m_systemRomCyclesPerWord == systemRomCyclesPerWord
		&& m_cartRomCyclesPerWord == cartRomCyclesPerWord
		&& m_cartRomBurstSetupCycles == cartRomBurstSetupCycles) {
		return;
	}
	m_ramCyclesPerWord = ramCyclesPerWord;
	m_ramBurstSetupCycles = ramBurstSetupCycles;
	m_systemRomCyclesPerWord = systemRomCyclesPerWord;
	m_cartRomCyclesPerWord = cartRomCyclesPerWord;
	m_cartRomBurstSetupCycles = cartRomBurstSetupCycles;
	// Admission latches the current block's completion edge. New timing starts
	// with the next block rather than replaying elapsed bus time.
	if (m_scheduledBlockWords != 0u) {
		return;
	}
	if (busy() && requestAsserted()) {
		if (m_memory.readIoU32(IO_DMA_TRANSFER_COUNT) == 0u) {
			finishTransfer();
		} else {
			admitBlock(nowCycles);
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
	resumeCpuPortWrites();
}

void DmaController::setGxGpuDmaDirection(u32 direction) {
	if (m_gxGpuDmaDirection == direction) {
		return;
	}
	m_gxGpuDmaDirection = direction;
	requestInputChanged();
}

void DmaController::setApuDmaReadReady(bool ready) {
	if (m_apuDmaReadReady == ready) {
		return;
	}
	m_apuDmaReadReady = ready;
	requestInputChanged();
}

void DmaController::setApuDmaWriteReady(bool ready) {
	if (m_apuDmaWriteReady == ready) {
		return;
	}
	m_apuDmaWriteReady = ready;
	requestInputChanged();
}

bool DmaController::isGxGpuCpuPortWriteReady() const {
	return m_gxGpuCpuWriteReady && !ownsGxGpuWritePort();
}

bool DmaController::ownsApuDataPort() const {
	if (m_scheduledBlockWords != 0u) {
		return m_scheduledReadAddressWord == IO_APU_TRANSFER_DATA
			|| m_scheduledWriteAddressWord == IO_APU_TRANSFER_DATA;
	}
	return busy()
		&& (m_memory.readIoU32(IO_DMA_READ_ADDR) == IO_APU_TRANSFER_DATA
			|| m_memory.readIoU32(IO_DMA_WRITE_ADDR) == IO_APU_TRANSFER_DATA);
}

void DmaController::reset() {
	clearLiveTransfer();
	m_gxGpuReadReady = false;
	m_gxGpuDmaWriteReady = false;
	m_gxGpuCpuWriteReady = false;
	m_gxGpuDmaDirection = 0u;
	m_apuDmaReadReady = false;
	m_apuDmaWriteReady = false;
	m_supervisorQuiesceRequested = false;
	m_userReadAddressWord = 0u;
	m_userWriteAddressWord = 0u;
	m_userTransferCountWord = 0u;
	m_userControlWord = 0u;
	m_userStatusWord = 0u;
}

void DmaController::onService(i64) {
	const u32 blockWords = m_scheduledBlockWords;
	u32 readAddress = m_scheduledReadAddressWord;
	u32 writeAddress = m_scheduledWriteAddressWord;
	u32 transferCount = m_scheduledTransferCountWord;
	const u32 control = m_scheduledControlWord;
	const u32 readStep = (control & DMA_CONTROL_READ_INCREMENT) != 0u ? IO_WORD_SIZE : 0u;
	const u32 writeStep = (control & DMA_CONTROL_WRITE_INCREMENT) != 0u ? IO_WORD_SIZE : 0u;
	const i64 blockDeadline = m_serviceDeadline;
	m_scheduler.cancelDeviceService(DEVICE_SERVICE_DMA);
	m_serviceActive = true;
	for (u32 slot = 0u; slot < blockWords; slot += 1u) {
		const MappedBusSignals busSignals = MAPPED_BUS_MASTER_DMA
			| (slot + 1u == blockWords ? MAPPED_BUS_DMA_BLOCK_END : 0u);
		const u32 nextReadAddress = readAddress + readStep;
		const u32 nextWriteAddress = writeAddress + writeStep;
		const u32 nextTransferCount = transferCount - 1u;
		const u32 word = m_memory.readMappedDmaU32LE(readAddress, busSignals);
		m_memory.writeMappedDmaU32LE(writeAddress, word, busSignals);
		m_memory.writeIoValue(IO_DMA_READ_ADDR, valueNumber(static_cast<f64>(nextReadAddress)));
		m_memory.writeIoValue(IO_DMA_WRITE_ADDR, valueNumber(static_cast<f64>(nextWriteAddress)));
		m_memory.writeIoValue(IO_DMA_TRANSFER_COUNT, valueNumber(static_cast<f64>(nextTransferCount)));
		const bool writePortAdvanced = writeStep != 0u
			&& (writeAddress == IO_GX_GPU_GP0 || writeAddress == IO_APU_TRANSFER_DATA);
		const bool readPortAdvanced = readStep != 0u && readAddress == IO_APU_TRANSFER_DATA;
		if (writePortAdvanced) {
			m_scheduledWriteAddressWord = nextWriteAddress;
		}
		if (readPortAdvanced) {
			m_scheduledReadAddressWord = nextReadAddress;
		}
		if (writePortAdvanced || readPortAdvanced) {
			resumeCpuPortWrites();
		}
		readAddress = nextReadAddress;
		writeAddress = nextWriteAddress;
		transferCount = nextTransferCount;
	}
	m_serviceActive = false;
	clearAdmittedBlock();
	if (transferCount == 0u) {
		finishTransfer();
		return;
	}
	if (!requestAsserted()) {
		notifySupervisorBoundary();
		return;
	}
	admitBlock(blockDeadline);
}

void DmaController::finishTransfer() {
	m_memory.writeIoValue(IO_DMA_STATUS, valueNumber(static_cast<f64>(DMA_STATUS_DONE)));
	m_irq.raise(IRQ_DMA_DONE);
	resumeCpuPortWrites();
	notifySupervisorBoundary();
}

DmaControllerState DmaController::captureState() const {
	DmaControllerState state;
	state.readAddressWord = m_memory.readIoU32(IO_DMA_READ_ADDR);
	state.writeAddressWord = m_memory.readIoU32(IO_DMA_WRITE_ADDR);
	state.transferCountWord = m_memory.readIoU32(IO_DMA_TRANSFER_COUNT);
	state.controlWord = m_memory.readIoU32(IO_DMA_CONTROL);
	state.statusWord = m_memory.readIoU32(IO_DMA_STATUS);
	state.scheduledBlockWords = m_scheduledBlockWords;
	state.scheduledBlockCycles = m_scheduledBlockWords == 0u ? 0 : m_serviceDeadline - m_scheduler.currentNowCycles();
	state.scheduledReadAddressWord = m_scheduledReadAddressWord;
	state.scheduledWriteAddressWord = m_scheduledWriteAddressWord;
	state.scheduledTransferCountWord = m_scheduledTransferCountWord;
	state.scheduledControlWord = m_scheduledControlWord;
	state.supervisorQuiesceRequested = m_supervisorQuiesceRequested;
	state.userReadAddressWord = m_userReadAddressWord;
	state.userWriteAddressWord = m_userWriteAddressWord;
	state.userTransferCountWord = m_userTransferCountWord;
	state.userControlWord = m_userControlWord;
	state.userStatusWord = m_userStatusWord;
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
	m_scheduledBlockWords = state.scheduledBlockWords;
	m_scheduledReadAddressWord = state.scheduledReadAddressWord;
	m_scheduledWriteAddressWord = state.scheduledWriteAddressWord;
	m_scheduledTransferCountWord = state.scheduledTransferCountWord;
	m_scheduledControlWord = state.scheduledControlWord;
	m_serviceDeadline = nowCycles + state.scheduledBlockCycles;
	m_serviceActive = false;
	m_restorePending = true;
	m_supervisorQuiesceRequested = state.supervisorQuiesceRequested;
	m_userReadAddressWord = state.userReadAddressWord;
	m_userWriteAddressWord = state.userWriteAddressWord;
	m_userTransferCountWord = state.userTransferCountWord;
	m_userControlWord = state.userControlWord;
	m_userStatusWord = state.userStatusWord;
}

void DmaController::postLoad() {
	m_restorePending = false;
	if (m_scheduledBlockWords != 0u) {
		m_scheduler.scheduleDeviceService(DEVICE_SERVICE_DMA, m_serviceDeadline);
	}
	resumeCpuPortWrites();
}

void DmaController::beginSupervisorQuiesce() {
	m_supervisorQuiesceRequested = true;
	requestInputChanged();
	notifySupervisorBoundary();
}

bool DmaController::hasAdmittedGxGpuWriteBlock() const {
	return m_scheduledBlockWords != 0u && ownsGxGpuWritePort();
}

void DmaController::enterSupervisorContext() {
	m_userReadAddressWord = m_memory.readIoU32(IO_DMA_READ_ADDR);
	m_userWriteAddressWord = m_memory.readIoU32(IO_DMA_WRITE_ADDR);
	m_userTransferCountWord = m_memory.readIoU32(IO_DMA_TRANSFER_COUNT);
	m_userControlWord = m_memory.readIoU32(IO_DMA_CONTROL);
	m_userStatusWord = m_memory.readIoU32(IO_DMA_STATUS);
	clearLiveTransfer();
	m_supervisorQuiesceRequested = false;
}

void DmaController::enterSupervisorFaultContext() {
	clearLiveTransfer();
	m_userReadAddressWord = 0u;
	m_userWriteAddressWord = 0u;
	m_userTransferCountWord = 0u;
	m_userControlWord = 0u;
	m_userStatusWord = 0u;
	m_supervisorQuiesceRequested = false;
}

void DmaController::leaveSupervisorContext() {
	clearLiveTransfer();
	m_memory.writeIoValue(IO_DMA_READ_ADDR, valueNumber(static_cast<f64>(m_userReadAddressWord)));
	m_memory.writeIoValue(IO_DMA_WRITE_ADDR, valueNumber(static_cast<f64>(m_userWriteAddressWord)));
	m_memory.writeIoValue(IO_DMA_TRANSFER_COUNT, valueNumber(static_cast<f64>(m_userTransferCountWord)));
	m_memory.writeIoValue(IO_DMA_CONTROL, valueNumber(static_cast<f64>(m_userControlWord)));
	m_memory.writeIoValue(IO_DMA_STATUS, valueNumber(static_cast<f64>(m_userStatusWord)));
	m_supervisorQuiesceRequested = false;
	m_userReadAddressWord = 0u;
	m_userWriteAddressWord = 0u;
	m_userTransferCountWord = 0u;
	m_userControlWord = 0u;
	m_userStatusWord = 0u;
	requestInputChanged();
}

void DmaController::clearLiveTransfer() {
	m_scheduler.cancelDeviceService(DEVICE_SERVICE_DMA);
	clearAdmittedBlock();
	m_serviceActive = false;
	m_restorePending = false;
	m_memory.writeIoValue(IO_DMA_READ_ADDR, valueNumber(0.0));
	m_memory.writeIoValue(IO_DMA_WRITE_ADDR, valueNumber(0.0));
	m_memory.writeIoValue(IO_DMA_TRANSFER_COUNT, valueNumber(0.0));
	m_memory.writeIoValue(IO_DMA_CONTROL, valueNumber(0.0));
	m_memory.writeIoValue(IO_DMA_STATUS, valueNumber(0.0));
	m_memory.writeIoValue(IO_DMA_TRIGGER, valueNumber(0.0));
}

void DmaController::clearAdmittedBlock() {
	m_scheduledBlockWords = 0u;
	m_scheduledReadAddressWord = 0u;
	m_scheduledWriteAddressWord = 0u;
	m_scheduledTransferCountWord = 0u;
	m_scheduledControlWord = 0u;
	m_serviceDeadline = 0;
}

void DmaController::notifySupervisorBoundary() {
	if (m_supervisorQuiesceRequested && supervisorQuiescent()) {
		m_scheduler.scheduleDeviceService(DEVICE_SERVICE_SYSTEM, m_scheduler.currentNowCycles());
	}
}

void DmaController::admitBlock(i64 anchorCycle) {
	const u32 remaining = m_memory.readIoU32(IO_DMA_TRANSFER_COUNT);
	const u32 control = m_memory.readIoU32(IO_DMA_CONTROL);
	const u32 programmedBlockWords = ((control & DMA_CONTROL_BLOCK_WORDS_MASK) >> DMA_CONTROL_BLOCK_WORDS_SHIFT) + 1u;
	const u32 blockWords = remaining < programmedBlockWords ? remaining : programmedBlockWords;
	const u32 readAddress = m_memory.readIoU32(IO_DMA_READ_ADDR);
	const u32 writeAddress = m_memory.readIoU32(IO_DMA_WRITE_ADDR);
	const MemoryRegionKind readRegion = m_memory.mappedRegion(readAddress);
	const MemoryRegionKind writeRegion = m_memory.mappedRegion(writeAddress);
	i64 blockCycles;
	if (readRegion == MemoryRegionKind::Ram && writeRegion == MemoryRegionKind::Ram) {
		blockCycles = 2 * (static_cast<i64>(blockWords) * m_ramCyclesPerWord + m_ramBurstSetupCycles);
	} else {
		const i64 ramBlockCycles = readRegion == MemoryRegionKind::Ram || writeRegion == MemoryRegionKind::Ram
			? static_cast<i64>(blockWords) * m_ramCyclesPerWord + m_ramBurstSetupCycles
			: 0;
		const i64 cartRomBlockCycles = readRegion == MemoryRegionKind::CartRom || writeRegion == MemoryRegionKind::CartRom
			? static_cast<i64>(blockWords) * m_cartRomCyclesPerWord + m_cartRomBurstSetupCycles
			: 0;
		const i64 readCycles = readRegion == MemoryRegionKind::Ram
			? ramBlockCycles
			: readRegion == MemoryRegionKind::SystemRom
				? static_cast<i64>(blockWords) * m_systemRomCyclesPerWord
				: readRegion == MemoryRegionKind::CartRom ? cartRomBlockCycles : 0;
		const i64 writeCycles = writeRegion == MemoryRegionKind::Ram
			? ramBlockCycles
			: writeRegion == MemoryRegionKind::SystemRom
				? static_cast<i64>(blockWords) * m_systemRomCyclesPerWord
				: writeRegion == MemoryRegionKind::CartRom ? cartRomBlockCycles : 0;
		blockCycles = readCycles > writeCycles ? readCycles : writeCycles;
	}
	if (blockCycles == 0) {
		blockCycles = 1;
	}
	m_scheduledBlockWords = blockWords;
	m_scheduledReadAddressWord = readAddress;
	m_scheduledWriteAddressWord = writeAddress;
	m_scheduledTransferCountWord = remaining;
	m_scheduledControlWord = control;
	m_serviceDeadline = anchorCycle + blockCycles;
	m_scheduler.scheduleDeviceService(DEVICE_SERVICE_DMA, m_serviceDeadline);
}

void DmaController::requestInputChanged() {
	if (m_restorePending || m_serviceActive || !busy()) {
		return;
	}
	if (m_scheduledBlockWords != 0u) {
		return;
	}
	if (m_memory.readIoU32(IO_DMA_TRANSFER_COUNT) == 0u) {
		finishTransfer();
		return;
	}
	if (!requestAsserted()) {
		notifySupervisorBoundary();
		return;
	}
	admitBlock(m_scheduler.currentNowCycles());
}

bool DmaController::requestAsserted() const {
	const u32 request = m_memory.readIoU32(IO_DMA_CONTROL) & DMA_CONTROL_REQUEST_MASK;
	if (m_supervisorQuiesceRequested
		&& request != DMA_CONTROL_REQUEST_GX_WRITE
		&& request != DMA_CONTROL_REQUEST_GX_READ) {
		return false;
	}
	switch (request) {
	case DMA_CONTROL_REQUEST_FORCE:
		return true;
	case DMA_CONTROL_REQUEST_GX_WRITE:
		return (m_gxGpuDmaDirection == GX_GPU_DMA_DIRECTION_CPU_TO_GP0
			|| m_gxGpuDmaDirection == GX_GPU_DMA_DIRECTION_FIFO)
			&& m_gxGpuDmaWriteReady;
	case DMA_CONTROL_REQUEST_GX_READ:
		return m_gxGpuDmaDirection == GX_GPU_DMA_DIRECTION_GPUREAD_TO_CPU && m_gxGpuReadReady;
	case DMA_CONTROL_REQUEST_APU_WRITE:
		return m_apuDmaWriteReady;
	case DMA_CONTROL_REQUEST_APU_READ:
		return m_apuDmaReadReady;
	default:
		return false;
	}
}

bool DmaController::busy() const {
	return (m_memory.readIoU32(IO_DMA_STATUS) & DMA_STATUS_BUSY) != 0u;
}

bool DmaController::ownsGxGpuWritePort() const {
	if (m_scheduledBlockWords != 0u) {
		return m_scheduledWriteAddressWord == IO_GX_GPU_GP0;
	}
	return busy() && m_memory.readIoU32(IO_DMA_WRITE_ADDR) == IO_GX_GPU_GP0;
}

void DmaController::resumeCpuPortWrites() {
	if (m_gxGpuCpuWriteReady && !ownsGxGpuWritePort()) {
		m_cpu.resumeMemoryWrite(IO_GX_GPU_GP0);
	}
	if (!ownsApuDataPort()) {
		m_cpu.resumeMemoryWrite(IO_APU_TRANSFER_DATA);
	}
}

} // namespace bmsx
