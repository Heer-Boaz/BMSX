#include "machine/devices/dma/controller.h"

#include "machine/bus/io.h"
#include "machine/cpu/cpu.h"
#include "machine/devices/gx/gpu.h"
#include "machine/devices/irq/controller.h"
#include "machine/memory/map.h"
#include "machine/memory/memory.h"
#include "machine/memory/region.h"
#include "machine/model_registry.h"
#include "machine/scheduler/budget.h"
#include "machine/scheduler/device.h"

#include <algorithm>

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
	m_scheduledBlockWords = 0u;
	m_serviceDeadline = 0;
	m_timingCarry = 0;
	m_memory.writeIoValue(IO_DMA_STATUS, valueNumber(static_cast<f64>(DMA_STATUS_BUSY)));
	if (m_memory.readIoU32(IO_DMA_TRANSFER_COUNT) == 0u) {
		finishTransfer();
		return;
	}
	if (requestAsserted()) {
		admitBlock(m_scheduler.currentNowCycles());
	}
}

void DmaController::setTiming(i64 cpuHz, i64 ramWordsPerSec, i64 ramRowReopenCycles, i64 romWaitCyclesPerWord, i64 nowCycles) {
	if (m_cpuHz == cpuHz
		&& m_ramWordsPerSec == ramWordsPerSec
		&& m_ramRowReopenCycles == ramRowReopenCycles
		&& m_romWaitCyclesPerWord == romWaitCyclesPerWord) {
		return;
	}
	m_cpuHz = cpuHz;
	m_ramWordsPerSec = ramWordsPerSec;
	m_ramRowReopenCycles = ramRowReopenCycles;
	m_romWaitCyclesPerWord = romWaitCyclesPerWord;
	m_timingCarry = 0;
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
	return busy()
		&& (m_memory.readIoU32(IO_DMA_READ_ADDR) == IO_APU_TRANSFER_DATA
			|| m_memory.readIoU32(IO_DMA_WRITE_ADDR) == IO_APU_TRANSFER_DATA);
}

void DmaController::reset() {
	m_scheduler.cancelDeviceService(DEVICE_SERVICE_DMA);
	m_timingCarry = 0;
	m_scheduledBlockWords = 0u;
	m_serviceDeadline = 0;
	m_gxGpuReadReady = false;
	m_gxGpuDmaWriteReady = false;
	m_gxGpuCpuWriteReady = false;
	m_gxGpuDmaDirection = 0u;
	m_apuDmaReadReady = false;
	m_apuDmaWriteReady = false;
	m_serviceActive = false;
	m_restorePending = false;
	m_supervisorQuiesceRequested = false;
	m_userReadAddressWord = 0u;
	m_userWriteAddressWord = 0u;
	m_userTransferCountWord = 0u;
	m_userControlWord = 0u;
	m_userStatusWord = 0u;
	m_userTimingCarry = 0;
	m_lastRamRowRead = DMA_RAM_ROW_NONE;
	m_lastRamRowWrite = DMA_RAM_ROW_NONE;
	m_memory.writeIoValue(IO_DMA_READ_ADDR, valueNumber(0.0));
	m_memory.writeIoValue(IO_DMA_WRITE_ADDR, valueNumber(0.0));
	m_memory.writeIoValue(IO_DMA_TRANSFER_COUNT, valueNumber(0.0));
	m_memory.writeIoValue(IO_DMA_CONTROL, valueNumber(0.0));
	m_memory.writeIoValue(IO_DMA_STATUS, valueNumber(0.0));
	m_memory.writeIoValue(IO_DMA_TRIGGER, valueNumber(0.0));
}

void DmaController::onService(i64) {
	const u32 admittedBlockWords = m_scheduledBlockWords;
	const i64 blockDeadline = m_serviceDeadline;
	m_scheduler.cancelDeviceService(DEVICE_SERVICE_DMA);
	m_scheduledBlockWords = 0u;
	m_serviceDeadline = 0;
	m_serviceActive = true;
	const u32 remainingAtService = m_memory.readIoU32(IO_DMA_TRANSFER_COUNT);
	const u32 blockWords = admittedBlockWords < remainingAtService ? admittedBlockWords : remainingAtService;
	for (u32 slot = 0u;
		slot < blockWords
			&& busy()
			&& m_memory.readIoU32(IO_DMA_TRANSFER_COUNT) != 0u;
		slot += 1u) {
		const u32 transferCount = m_memory.readIoU32(IO_DMA_TRANSFER_COUNT);
		const MappedBusSignals busSignals = MAPPED_BUS_MASTER_DMA
			| (slot + 1u == blockWords ? MAPPED_BUS_DMA_BLOCK_END : 0u);
		transferWord(transferCount, busSignals);
	}
	m_serviceActive = false;
	if (!busy()) {
		notifySupervisorBoundary();
		return;
	}
	if (m_memory.readIoU32(IO_DMA_TRANSFER_COUNT) == 0u) {
		finishTransfer();
		return;
	}
	if (!requestAsserted()) {
		if (!m_supervisorQuiesceRequested) {
			m_timingCarry = 0;
		}
		notifySupervisorBoundary();
		return;
	}
	admitBlock(blockDeadline);
}

void DmaController::transferWord(u32 transferCount, MappedBusSignals busSignals) {
	const u32 readAddress = m_memory.readIoU32(IO_DMA_READ_ADDR);
	const u32 writeAddress = m_memory.readIoU32(IO_DMA_WRITE_ADDR);
	const u32 control = m_memory.readIoU32(IO_DMA_CONTROL);
	const u32 word = m_memory.readMappedDmaU32LE(readAddress, busSignals);
	m_memory.writeMappedDmaU32LE(writeAddress, word, busSignals);
	m_memory.writeIoValue(
		IO_DMA_READ_ADDR,
		valueNumber(static_cast<f64>((control & DMA_CONTROL_READ_INCREMENT) != 0u ? readAddress + IO_WORD_SIZE : readAddress))
	);
	m_memory.writeIoValue(
		IO_DMA_WRITE_ADDR,
		valueNumber(static_cast<f64>((control & DMA_CONTROL_WRITE_INCREMENT) != 0u ? writeAddress + IO_WORD_SIZE : writeAddress))
	);
	m_memory.writeIoValue(IO_DMA_TRANSFER_COUNT, valueNumber(static_cast<f64>(transferCount - 1u)));
	if (((writeAddress == IO_GX_GPU_GP0 || writeAddress == IO_APU_TRANSFER_DATA)
			&& (control & DMA_CONTROL_WRITE_INCREMENT) != 0u)
		|| (readAddress == IO_APU_TRANSFER_DATA && (control & DMA_CONTROL_READ_INCREMENT) != 0u)) {
		resumeCpuPortWrites();
	}
}

void DmaController::finishTransfer() {
	m_scheduler.cancelDeviceService(DEVICE_SERVICE_DMA);
	m_scheduledBlockWords = 0u;
	m_serviceDeadline = 0;
	m_timingCarry = 0;
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
	state.timingCarry = m_timingCarry;
	state.scheduledBlockWords = m_scheduledBlockWords;
	state.scheduledBlockCycles = m_scheduledBlockWords == 0u ? 0 : m_serviceDeadline - m_scheduler.currentNowCycles();
	state.supervisorQuiesceRequested = m_supervisorQuiesceRequested;
	state.userReadAddressWord = m_userReadAddressWord;
	state.userWriteAddressWord = m_userWriteAddressWord;
	state.userTransferCountWord = m_userTransferCountWord;
	state.userControlWord = m_userControlWord;
	state.userStatusWord = m_userStatusWord;
	state.userTimingCarry = m_userTimingCarry;
	state.lastRamRowRead = m_lastRamRowRead;
	state.lastRamRowWrite = m_lastRamRowWrite;
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
	m_scheduledBlockWords = state.scheduledBlockWords;
	m_serviceDeadline = nowCycles + state.scheduledBlockCycles;
	m_serviceActive = false;
	m_restorePending = true;
	m_supervisorQuiesceRequested = state.supervisorQuiesceRequested;
	m_userReadAddressWord = state.userReadAddressWord;
	m_userWriteAddressWord = state.userWriteAddressWord;
	m_userTransferCountWord = state.userTransferCountWord;
	m_userControlWord = state.userControlWord;
	m_userStatusWord = state.userStatusWord;
	m_userTimingCarry = state.userTimingCarry;
	m_lastRamRowRead = state.lastRamRowRead;
	m_lastRamRowWrite = state.lastRamRowWrite;
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
	m_userTimingCarry = m_timingCarry;
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
	m_userTimingCarry = 0;
	m_supervisorQuiesceRequested = false;
}

void DmaController::leaveSupervisorContext() {
	clearLiveTransfer();
	m_memory.writeIoValue(IO_DMA_READ_ADDR, valueNumber(static_cast<f64>(m_userReadAddressWord)));
	m_memory.writeIoValue(IO_DMA_WRITE_ADDR, valueNumber(static_cast<f64>(m_userWriteAddressWord)));
	m_memory.writeIoValue(IO_DMA_TRANSFER_COUNT, valueNumber(static_cast<f64>(m_userTransferCountWord)));
	m_memory.writeIoValue(IO_DMA_CONTROL, valueNumber(static_cast<f64>(m_userControlWord)));
	m_memory.writeIoValue(IO_DMA_STATUS, valueNumber(static_cast<f64>(m_userStatusWord)));
	m_timingCarry = m_userTimingCarry;
	m_supervisorQuiesceRequested = false;
	m_userReadAddressWord = 0u;
	m_userWriteAddressWord = 0u;
	m_userTransferCountWord = 0u;
	m_userControlWord = 0u;
	m_userStatusWord = 0u;
	m_userTimingCarry = 0;
	requestInputChanged();
}

void DmaController::clearLiveTransfer() {
	m_scheduler.cancelDeviceService(DEVICE_SERVICE_DMA);
	m_timingCarry = 0;
	m_scheduledBlockWords = 0u;
	m_serviceDeadline = 0;
	m_serviceActive = false;
	m_restorePending = false;
	m_memory.writeIoValue(IO_DMA_READ_ADDR, valueNumber(0.0));
	m_memory.writeIoValue(IO_DMA_WRITE_ADDR, valueNumber(0.0));
	m_memory.writeIoValue(IO_DMA_TRANSFER_COUNT, valueNumber(0.0));
	m_memory.writeIoValue(IO_DMA_CONTROL, valueNumber(0.0));
	m_memory.writeIoValue(IO_DMA_STATUS, valueNumber(0.0));
	m_memory.writeIoValue(IO_DMA_TRIGGER, valueNumber(0.0));
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
	scheduleAdmittedBlock(anchorCycle, remaining < programmedBlockWords ? remaining : programmedBlockWords);
}

void DmaController::scheduleAdmittedBlock(i64 anchorCycle, u32 blockWords) {
	const u32 control = m_memory.readIoU32(IO_DMA_CONTROL);
	const u32 readStep = (control & DMA_CONTROL_READ_INCREMENT) != 0u ? IO_WORD_SIZE : 0u;
	const u32 writeStep = (control & DMA_CONTROL_WRITE_INCREMENT) != 0u ? IO_WORD_SIZE : 0u;

	// The RAM rate accrual below must land on the exact same total as one
	// bulk cyclesUntilBudgetUnits(..., N) call would for a side's whole RAM
	// word count -- calling it once per word with targetUnits=1 would pay its
	// "at least one cycle" scheduling floor on every single word instead of
	// once per batch, inflating fast-relative-to-cpuHz rates. carryAtBlockStart
	// and ramUnitsSoFar (shared by both sides, in program order) let each RAM
	// word's cost be recovered as a delta of cumulative cost via
	// cyclesForBudgetUnitsNoFloor, which telescopes back to the bulk total.
	const i64 carryAtBlockStart = m_timingCarry;
	i64 ramUnitsSoFar = 0;

	i64 blockCycles = 0;
	u32 readAddr = m_memory.readIoU32(IO_DMA_READ_ADDR);
	u32 writeAddr = m_memory.readIoU32(IO_DMA_WRITE_ADDR);
	for (u32 word = 0u; word < blockWords; word += 1u) {
		const MemoryRegionKind readKind = classifyMemoryRegion(readAddr);
		const MemoryRegionKind writeKind = classifyMemoryRegion(writeAddr);
		// Fly-by transfer: read and write share one bus slot, so the slower side
		// gates the word. The one exception is RAM<->RAM: a single-ported RAM
		// chip cannot serve two different addresses in the same cycle, so that
		// combination is the sum of two real bus cycles, not one shared slot.
		const i64 readCost = sideWordCycles(readAddr, readKind, m_lastRamRowRead, carryAtBlockStart, ramUnitsSoFar);
		const i64 writeCost = sideWordCycles(writeAddr, writeKind, m_lastRamRowWrite, carryAtBlockStart, ramUnitsSoFar);
		blockCycles += (readKind == MemoryRegionKind::Ram && writeKind == MemoryRegionKind::Ram)
			? (readCost + writeCost)
			: std::max(readCost, writeCost);
		readAddr += readStep;
		writeAddr += writeStep;
	}
	blockCycles = blockCycles <= 0 ? 1 : blockCycles;
	m_timingCarry = (m_ramWordsPerSec * cyclesForBudgetUnitsNoFloor(m_cpuHz, m_ramWordsPerSec, carryAtBlockStart, ramUnitsSoFar) + carryAtBlockStart) % m_cpuHz;

	m_scheduledBlockWords = blockWords;
	m_serviceDeadline = anchorCycle + blockCycles;
	m_scheduler.scheduleDeviceService(DEVICE_SERVICE_DMA, m_serviceDeadline);
}

i64 DmaController::ramBaseWordCycles(i64 carryAtBlockStart, i64& ramUnitsSoFar) {
	const i64 prevCumulative = cyclesForBudgetUnitsNoFloor(m_cpuHz, m_ramWordsPerSec, carryAtBlockStart, ramUnitsSoFar);
	ramUnitsSoFar += 1;
	const i64 cumulative = cyclesForBudgetUnitsNoFloor(m_cpuHz, m_ramWordsPerSec, carryAtBlockStart, ramUnitsSoFar);
	return cumulative - prevCumulative;
}

i64 DmaController::sideWordCycles(u32 address, MemoryRegionKind kind, u32& lastRow, i64 carryAtBlockStart, i64& ramUnitsSoFar) {
	switch (kind) {
	case MemoryRegionKind::Ram: {
		i64 cycles = ramBaseWordCycles(carryAtBlockStart, ramUnitsSoFar);
		const u32 row = (address - RAM_BASE) / (PSX_DMA_RAM_ROW_WORDS * IO_WORD_SIZE);
		if (row != lastRow) {
			cycles += m_ramRowReopenCycles;
			lastRow = row;
		}
		return cycles;
	}
	case MemoryRegionKind::SystemRom:
	case MemoryRegionKind::CartRom:
	case MemoryRegionKind::ProgramRom:
		return m_romWaitCyclesPerWord;
	default:
		return 0;
	}
}

void DmaController::requestInputChanged() {
	if (m_restorePending || m_serviceActive || !busy()) {
		return;
	}
	if (m_memory.readIoU32(IO_DMA_TRANSFER_COUNT) == 0u) {
		finishTransfer();
		return;
	}
	if (m_scheduledBlockWords != 0u) {
		return;
	}
	if (!requestAsserted()) {
		if (!m_supervisorQuiesceRequested) {
			m_timingCarry = 0;
		}
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
