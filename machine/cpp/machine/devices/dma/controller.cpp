#include "machine/devices/dma/controller.h"

#include "machine/cpu/cpu.h"
#include "machine/devices/irq/controller.h"
#include "spec/bmsx/memory_map.h"
#include "machine/memory/memory.h"
#include "machine/scheduler/device.h"

namespace bmsx {

DmaController::DmaController(Memory& memory, CPU& cpu, IrqController& irq, DeviceScheduler& scheduler)
	: m_memory(memory)
	, m_cpu(cpu)
	, m_irq(irq)
	, m_scheduler(scheduler) {
	for (u32 channel = 0u; channel < IO_DMA_CHANNEL_COUNT; channel += 1u) {
		m_memory.mapIoWrite(IO_DMA_CONTROLS[channel], this, &DmaController::onChannelConfigWriteThunk);
		m_memory.mapIoWrite(IO_DMA_READ_ADDRS[channel], this, &DmaController::onAddressWriteThunk);
		m_memory.mapIoWrite(IO_DMA_WRITE_ADDRS[channel], this, &DmaController::onAddressWriteThunk);
		m_memory.mapIoWrite(IO_DMA_TRANSFER_COUNTS[channel], this, &DmaController::onChannelConfigWriteThunk);
		m_memory.mapIoWrite(IO_DMA_TRIGGERS[channel], this, &DmaController::onTriggerWriteThunk);
		m_memory.mapIoWriteReady(IO_DMA_TRIGGERS[channel], &DmaController::triggerWriteReadyThunk);
	}
}

bool DmaController::triggerWriteReadyThunk(void* context, u32, MappedBusSignals) {
	return !static_cast<DmaController*>(context)->m_supervisorQuiesceRequested;
}

void DmaController::onAddressWriteThunk(void* context, u32 address, u32 value, MappedBusSignals) {
	auto& controller = *static_cast<DmaController*>(context);
	const u32 channel = address == IO_DMA_READ_ADDRS[1] || address == IO_DMA_WRITE_ADDRS[1] ? 1u : 0u;
	DmaChannelState& registers = controller.m_registers.channels[channel];
	if (address == IO_DMA_READ_ADDRS[channel]) {
		registers.readAddressWord = value;
	} else {
		registers.writeAddressWord = value;
	}
	if (!controller.m_cpu.isMemoryWriteBlocked()) {
		return;
	}
	controller.resumeCpuWriteIfPortReleased(controller.m_cpu.stalledMemoryWriteAddress());
}

void DmaController::onChannelConfigWriteThunk(void* context, u32 address, u32 value, MappedBusSignals) {
	auto& controller = *static_cast<DmaController*>(context);
	const u32 channel = address == IO_DMA_CONTROLS[1] || address == IO_DMA_TRANSFER_COUNTS[1] ? 1u : 0u;
	DmaChannelState& registers = controller.m_registers.channels[channel];
	if (address == IO_DMA_CONTROLS[channel]) {
		registers.controlWord = value;
	} else {
		registers.transferCountWord = value;
	}
	controller.arbitrate(controller.m_scheduler.currentNowCycles());
}

void DmaController::onTriggerWriteThunk(void* context, u32 address, u32 value, MappedBusSignals) {
	const u32 channel = address == IO_DMA_TRIGGERS[1] ? 1u : 0u;
	static_cast<DmaController*>(context)->onTriggerWrite(channel, value);
}

void DmaController::onTriggerWrite(u32 channel, u32 value) {
	m_memory.writeIoU32(IO_DMA_TRIGGERS[channel], 0u);
	if ((value & DMA_TRIGGER_START) == 0u || busy(channel)) {
		return;
	}
	DmaChannelState& registers = m_registers.channels[channel];
	registers.statusWord = DMA_STATUS_BUSY;
	m_memory.writeIoU32(IO_DMA_STATUSES[channel], DMA_STATUS_BUSY);
	if (registers.transferCountWord == 0u) {
		finishChannel(channel);
	}
	arbitrate(m_scheduler.currentNowCycles());
}

void DmaController::setTiming(
	i64 ramCyclesPerWord,
	i64 ramBurstSetupCycles,
	i64 systemRomCyclesPerWord,
	i64 cartRomCyclesPerWord,
	i64 cartRomBurstSetupCycles,
	i64 nowCycles
) {
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
	if (m_activeChannel == IO_DMA_CHANNEL_COUNT) {
		arbitrate(nowCycles);
	}
}

void DmaController::setRequestLines(u32 mask, u32 asserted) {
	const u32 next = (m_requestLines & ~mask) | (asserted & mask);
	if (next == m_requestLines) {
		return;
	}
	m_requestLines = next;
	arbitrate(m_scheduler.currentNowCycles());
}

bool DmaController::ownsReadPort(u32 address) const {
	for (u32 channel = 0u; channel < IO_DMA_CHANNEL_COUNT; channel += 1u) {
		if (busy(channel) && channelReadAddress(channel) == address) {
			return true;
		}
	}
	return false;
}

bool DmaController::ownsWritePort(u32 address) const {
	for (u32 channel = 0u; channel < IO_DMA_CHANNEL_COUNT; channel += 1u) {
		if (busy(channel) && channelWriteAddress(channel) == address) {
			return true;
		}
	}
	return false;
}

bool DmaController::hasAdmittedWriteBlock(u32 address) const {
	return m_activeChannel != IO_DMA_CHANNEL_COUNT
		&& m_scheduledWriteAddressWord == address;
}

void DmaController::reset() {
	clearLiveTransfer();
	m_requestLines = 0u;
	m_supervisorQuiesceRequested = false;
	m_supervisorAdmissionQuiesceRequested = false;
	clearUserContext();
}

void DmaController::onService(i64) {
	const u32 channel = m_activeChannel;
	const u32 blockWords = m_scheduledBlockWords;
	u32 readAddress = m_scheduledReadAddressWord;
	u32 writeAddress = m_scheduledWriteAddressWord;
	const u32 releasedReadAddress = readAddress;
	const u32 releasedWriteAddress = writeAddress;
	u32 transferCount = m_scheduledTransferCountWord;
	const u32 control = m_scheduledControlWord;
	const u32 readStep = (control & DMA_CONTROL_READ_INCREMENT) != 0u ? IO_WORD_SIZE : 0u;
	const u32 writeStep = (control & DMA_CONTROL_WRITE_INCREMENT) != 0u ? IO_WORD_SIZE : 0u;
	const u32 readRequest = (control & DMA_CONTROL_READ_REQUEST_MASK) >> DMA_CONTROL_READ_REQUEST_SHIFT;
	const u32 writeRequest = (control & DMA_CONTROL_WRITE_REQUEST_MASK) >> DMA_CONTROL_WRITE_REQUEST_SHIFT;
	const MappedBusSignals readBusSignals = MAPPED_BUS_MASTER_DMA | cartridgeSlotSignals(readRequest);
	const MappedBusSignals writeBusSignals = MAPPED_BUS_MASTER_DMA | cartridgeSlotSignals(writeRequest);
	const i64 previousBlockDeadline = m_serviceDeadline;
	m_scheduler.cancelDeviceService(DEVICE_SERVICE_DMA);
	m_serviceActive = true;
	for (u32 slot = 0u; slot < blockWords; slot += 1u) {
		const MappedBusSignals blockEnd = slot + 1u == blockWords ? MAPPED_BUS_DMA_BLOCK_END : 0u;
		const u32 word = m_memory.readMappedDmaU32LE(readAddress, readBusSignals | blockEnd);
		m_memory.writeMappedDmaU32LE(writeAddress, word, writeBusSignals | blockEnd);
		readAddress += readStep;
		writeAddress += writeStep;
		transferCount -= 1u;
	}
	DmaChannelState& registers = m_registers.channels[channel];
	registers.readAddressWord = readAddress;
	registers.writeAddressWord = writeAddress;
	registers.transferCountWord = transferCount;
	m_memory.writeIoU32(IO_DMA_READ_ADDRS[channel], readAddress);
	m_memory.writeIoU32(IO_DMA_WRITE_ADDRS[channel], writeAddress);
	m_memory.writeIoU32(IO_DMA_TRANSFER_COUNTS[channel], transferCount);
	m_serviceActive = false;
	clearAdmittedBlock();
	resumeCpuWriteIfPortReleased(releasedReadAddress);
	if (releasedWriteAddress != releasedReadAddress) {
		resumeCpuWriteIfPortReleased(releasedWriteAddress);
	}
	if (transferCount == 0u) {
		finishChannel(channel);
	}
	arbitrate(previousBlockDeadline);
}

DmaControllerState DmaController::captureState() const {
	DmaControllerState state;
	state.channels = m_registers.channels;
	state.userChannels = m_userRegisters.channels;
	state.activeChannel = m_activeChannel;
	state.nextChannel = m_nextChannel;
	state.scheduledBlockWords = m_scheduledBlockWords;
	state.scheduledBlockCycles = m_scheduledBlockWords == 0u
		? 0
		: m_serviceDeadline - m_scheduler.currentNowCycles();
	state.scheduledReadAddressWord = m_scheduledReadAddressWord;
	state.scheduledWriteAddressWord = m_scheduledWriteAddressWord;
	state.scheduledTransferCountWord = m_scheduledTransferCountWord;
	state.scheduledControlWord = m_scheduledControlWord;
	state.supervisorQuiesceRequested = m_supervisorQuiesceRequested;
	state.supervisorAdmissionQuiesceRequested = m_supervisorAdmissionQuiesceRequested;
	state.userNextChannel = m_userNextChannel;
	return state;
}

void DmaController::restoreState(const DmaControllerState& state, i64 nowCycles) {
	m_scheduler.cancelDeviceService(DEVICE_SERVICE_DMA);
	m_registers.channels = state.channels;
	m_registers.mirror(m_memory);
	m_userRegisters.channels = state.userChannels;
	m_activeChannel = state.activeChannel;
	m_nextChannel = state.nextChannel;
	m_scheduledBlockWords = state.scheduledBlockWords;
	m_scheduledReadAddressWord = state.scheduledReadAddressWord;
	m_scheduledWriteAddressWord = state.scheduledWriteAddressWord;
	m_scheduledTransferCountWord = state.scheduledTransferCountWord;
	m_scheduledControlWord = state.scheduledControlWord;
	m_serviceDeadline = nowCycles + state.scheduledBlockCycles;
	m_serviceActive = false;
	m_restorePending = true;
	m_supervisorQuiesceRequested = state.supervisorQuiesceRequested;
	m_supervisorAdmissionQuiesceRequested = state.supervisorAdmissionQuiesceRequested;
	m_userNextChannel = state.userNextChannel;
}

void DmaController::postLoad() {
	m_restorePending = false;
	if (m_activeChannel != IO_DMA_CHANNEL_COUNT) {
		m_scheduler.scheduleDeviceService(DEVICE_SERVICE_DMA, m_serviceDeadline);
	} else {
		arbitrate(m_scheduler.currentNowCycles());
	}
}

void DmaController::beginSupervisorControlQuiesce() {
	m_supervisorQuiesceRequested = true;
}

void DmaController::beginSupervisorQuiesce() {
	m_supervisorQuiesceRequested = true;
	m_supervisorAdmissionQuiesceRequested = true;
	notifySupervisorBoundary();
}

void DmaController::enterSupervisorContext() {
	m_userRegisters.channels = m_registers.channels;
	m_userNextChannel = m_nextChannel;
	clearLiveTransfer();
	m_supervisorQuiesceRequested = false;
	m_supervisorAdmissionQuiesceRequested = false;
}

void DmaController::leaveSupervisorContext() {
	clearLiveTransfer();
	m_registers.channels = m_userRegisters.channels;
	m_registers.mirror(m_memory);
	m_nextChannel = m_userNextChannel;
	m_supervisorQuiesceRequested = false;
	m_supervisorAdmissionQuiesceRequested = false;
	clearUserContext();
	arbitrate(m_scheduler.currentNowCycles());
}

void DmaController::clearLiveTransfer() {
	m_scheduler.cancelDeviceService(DEVICE_SERVICE_DMA);
	clearAdmittedBlock();
	m_nextChannel = 0u;
	m_serviceActive = false;
	m_restorePending = false;
	m_registers.clear();
	m_registers.mirror(m_memory);
}

void DmaController::clearUserContext() {
	m_userRegisters.clear();
	m_userNextChannel = 0u;
}

void DmaController::clearAdmittedBlock() {
	m_activeChannel = IO_DMA_CHANNEL_COUNT;
	m_scheduledBlockWords = 0u;
	m_scheduledReadAddressWord = 0u;
	m_scheduledWriteAddressWord = 0u;
	m_scheduledTransferCountWord = 0u;
	m_scheduledControlWord = 0u;
	m_serviceDeadline = 0;
}

void DmaController::finishChannel(u32 channel) {
	const u32 readAddress = channelReadAddress(channel);
	const u32 writeAddress = channelWriteAddress(channel);
	m_registers.channels[channel].statusWord = DMA_STATUS_DONE;
	m_memory.writeIoU32(IO_DMA_STATUSES[channel], DMA_STATUS_DONE);
	m_irq.raise(channel == 0u ? IRQ_DMA0_DONE : IRQ_DMA1_DONE);
	resumeCpuWriteIfPortReleased(readAddress);
	if (writeAddress != readAddress) {
		resumeCpuWriteIfPortReleased(writeAddress);
	}
}

void DmaController::resumeCpuWriteIfPortReleased(u32 address) {
	if (m_cpu.isMemoryWriteBlocked()
		&& m_cpu.stalledMemoryWriteAddress() == address
		&& !ownsReadPort(address)
		&& !ownsWritePort(address)) {
		m_cpu.resumeMemoryWrite(address);
	}
}

void DmaController::arbitrate(i64 anchorCycle) {
	if (m_restorePending || m_serviceActive || m_activeChannel != IO_DMA_CHANNEL_COUNT) {
		return;
	}
	if (m_supervisorAdmissionQuiesceRequested) {
		notifySupervisorBoundary();
		return;
	}
	for (u32 offset = 0u; offset < IO_DMA_CHANNEL_COUNT; offset += 1u) {
		const u32 channel = (m_nextChannel + offset) % IO_DMA_CHANNEL_COUNT;
		if (!busy(channel)) {
			continue;
		}
		if (m_registers.channels[channel].transferCountWord == 0u) {
			finishChannel(channel);
			continue;
		}
		if (requestAsserted(channel)) {
			admitBlock(channel, anchorCycle);
			m_nextChannel = (channel + 1u) % IO_DMA_CHANNEL_COUNT;
			return;
		}
	}
	notifySupervisorBoundary();
}

void DmaController::admitBlock(u32 channel, i64 anchorCycle) {
	const DmaChannelState& registers = m_registers.channels[channel];
	const u32 remaining = registers.transferCountWord;
	const u32 control = registers.controlWord;
	const u32 programmedBlockWords = ((control & DMA_CONTROL_BLOCK_WORDS_MASK) >> DMA_CONTROL_BLOCK_WORDS_SHIFT) + 1u;
	const u32 blockWords = remaining < programmedBlockWords ? remaining : programmedBlockWords;
	const u32 readStep = (control & DMA_CONTROL_READ_INCREMENT) != 0u ? IO_WORD_SIZE : 0u;
	const u32 writeStep = (control & DMA_CONTROL_WRITE_INCREMENT) != 0u ? IO_WORD_SIZE : 0u;
	u32 readAddress = registers.readAddressWord;
	u32 writeAddress = registers.writeAddressWord;
	MemoryRegionKind readRegion = m_memory.mappedRegion(readAddress);
	MemoryRegionKind writeRegion = m_memory.mappedRegion(writeAddress);
	u32 readRegionWords = readStep == 0u
		? blockWords
		: m_memory.mappedRegionWordSpan(readAddress, blockWords, readRegion);
	u32 writeRegionWords = writeStep == 0u
		? blockWords
		: m_memory.mappedRegionWordSpan(writeAddress, blockWords, writeRegion);
	bool readRegionStart = true;
	bool writeRegionStart = true;
	u32 wordsRemaining = blockWords;
	i64 blockCycles = 0;
	while (wordsRemaining != 0u) {
		const u32 spanWords = readRegionWords < writeRegionWords ? readRegionWords : writeRegionWords;
		const i64 readCycles = regionSpanCycles(readRegion, spanWords, readRegionStart);
		const i64 writeCycles = regionSpanCycles(writeRegion, spanWords, writeRegionStart);
		blockCycles += readRegion == writeRegion
			&& (readRegion == MemoryRegionKind::Ram || readRegion == MemoryRegionKind::Cartridge)
			? readCycles + writeCycles
			: readCycles > writeCycles ? readCycles : writeCycles;
		wordsRemaining -= spanWords;
		readRegionWords -= spanWords;
		writeRegionWords -= spanWords;
		readRegionStart = false;
		writeRegionStart = false;
		readAddress += spanWords * readStep;
		writeAddress += spanWords * writeStep;
		if (wordsRemaining != 0u && readRegionWords == 0u) {
			readRegion = m_memory.mappedRegion(readAddress);
			readRegionWords = m_memory.mappedRegionWordSpan(readAddress, wordsRemaining, readRegion);
			readRegionStart = true;
		}
		if (wordsRemaining != 0u && writeRegionWords == 0u) {
			writeRegion = m_memory.mappedRegion(writeAddress);
			writeRegionWords = m_memory.mappedRegionWordSpan(writeAddress, wordsRemaining, writeRegion);
			writeRegionStart = true;
		}
	}
	if (blockCycles == 0) {
		blockCycles = 1;
	}
	m_activeChannel = channel;
	m_scheduledBlockWords = blockWords;
	m_scheduledReadAddressWord = registers.readAddressWord;
	m_scheduledWriteAddressWord = registers.writeAddressWord;
	m_scheduledTransferCountWord = remaining;
	m_scheduledControlWord = control;
	m_serviceDeadline = anchorCycle + blockCycles;
	m_scheduler.scheduleDeviceService(DEVICE_SERVICE_DMA, m_serviceDeadline);
}

i64 DmaController::regionSpanCycles(MemoryRegionKind region, u32 wordCount, bool regionStart) const {
	switch (region) {
	case MemoryRegionKind::Ram:
		return static_cast<i64>(wordCount) * m_ramCyclesPerWord + (regionStart ? m_ramBurstSetupCycles : 0);
	case MemoryRegionKind::SystemRom:
		return static_cast<i64>(wordCount) * m_systemRomCyclesPerWord;
	case MemoryRegionKind::Cartridge:
		return static_cast<i64>(wordCount) * m_cartRomCyclesPerWord + (regionStart ? m_cartRomBurstSetupCycles : 0);
	case MemoryRegionKind::Io:
	case MemoryRegionKind::Other:
		return 0;
	}
	__builtin_unreachable();
}

bool DmaController::requestAsserted(u32 channel) const {
	const u32 control = m_registers.channels[channel].controlWord;
	const u32 readRequest = (control & DMA_CONTROL_READ_REQUEST_MASK) >> DMA_CONTROL_READ_REQUEST_SHIFT;
	const u32 writeRequest = (control & DMA_CONTROL_WRITE_REQUEST_MASK) >> DMA_CONTROL_WRITE_REQUEST_SHIFT;
	return requestLineAsserted(readRequest) && requestLineAsserted(writeRequest);
}

bool DmaController::requestLineAsserted(u32 request) const {
	if (request == DMA_REQUEST_FORCE) {
		return true;
	}
	if (request == DMA_REQUEST_DISABLED) {
		return false;
	}
	return (m_requestLines & (1u << request)) != 0u;
}

MappedBusSignals DmaController::cartridgeSlotSignals(u32 request) {
	switch (request) {
	case DMA_REQUEST_CARTRIDGE_SLOT0_READ:
	case DMA_REQUEST_CARTRIDGE_SLOT0_WRITE:
		return mappedBusSignalsForCartridgeSlot(0u);
	case DMA_REQUEST_CARTRIDGE_SLOT1_READ:
	case DMA_REQUEST_CARTRIDGE_SLOT1_WRITE:
		return mappedBusSignalsForCartridgeSlot(1u);
	default:
		return 0u;
	}
}

bool DmaController::busy(u32 channel) const {
	return (m_registers.channels[channel].statusWord & DMA_STATUS_BUSY) != 0u;
}

u32 DmaController::channelReadAddress(u32 channel) const {
	return channel == m_activeChannel
		? m_scheduledReadAddressWord
		: m_registers.channels[channel].readAddressWord;
}

u32 DmaController::channelWriteAddress(u32 channel) const {
	return channel == m_activeChannel
		? m_scheduledWriteAddressWord
		: m_registers.channels[channel].writeAddressWord;
}

void DmaController::notifySupervisorBoundary() {
	if (m_supervisorQuiesceRequested && supervisorQuiescent()) {
		m_scheduler.scheduleDeviceService(DEVICE_SERVICE_SYSTEM, m_scheduler.currentNowCycles());
	}
}

} // namespace bmsx
