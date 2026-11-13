#include "machine/devices/dma/controller.h"

#include "common/compiler.h"

#include "machine/cpu/cpu.h"
#include "machine/devices/gx/gpu.h"
#include "machine/devices/irq/controller.h"
#include "spec/bmsx/memory_map.h"
#include "machine/memory/memory.h"
#include "machine/scheduler/device.h"

namespace bmsx {
namespace {
constexpr DmaEndpoint ReadEndpoints[] = {
	DmaEndpoint::Memory, DmaEndpoint::Memory, DmaEndpoint::GpuRead, DmaEndpoint::Memory,
	DmaEndpoint::ImgDecRead, DmaEndpoint::ImgDecRead, DmaEndpoint::Memory, DmaEndpoint::ApuRead,
};
constexpr DmaEndpoint WriteEndpoints[] = {
	DmaEndpoint::Memory, DmaEndpoint::GpuWrite, DmaEndpoint::Memory, DmaEndpoint::ImgDecWrite,
	DmaEndpoint::Memory, DmaEndpoint::GpuWrite, DmaEndpoint::ApuWrite, DmaEndpoint::Memory,
};
constexpr u32 EndpointAddresses[] = {
	IO_GX_GPU_GP0, IO_GX_GPU_GP0, IO_APU_TRANSFER_DATA, IO_APU_TRANSFER_DATA,
	IO_IMGDEC_DATA, IO_IMGDEC_DATA,
};
} // namespace

DmaController::DmaController(Memory& memory, CPU& cpu, IrqController& irq, DeviceScheduler& scheduler)
	: m_memory(memory)
	, m_cpu(cpu)
	, m_irq(irq)
	, m_scheduler(scheduler) {
	m_endpointCapacity[static_cast<u32>(DmaEndpoint::Memory)] = DMA_BURST_WORD_CAPACITY;
	for (u32 channel = 0u; channel < IO_DMA_CHANNEL_COUNT; channel += 1u) {
		m_memory.mapIoWrite(IO_DMA_CONTROLS[channel], this, &DmaController::onChannelConfigWriteThunk, IoWriteStorage::Device);
		m_memory.mapIoWrite(IO_DMA_READ_ADDRS[channel], this, &DmaController::onChannelConfigWriteThunk, IoWriteStorage::Device);
		m_memory.mapIoWrite(IO_DMA_WRITE_ADDRS[channel], this, &DmaController::onChannelConfigWriteThunk, IoWriteStorage::Device);
		m_memory.mapIoWrite(IO_DMA_TRANSFER_COUNTS[channel], this, &DmaController::onChannelConfigWriteThunk, IoWriteStorage::Device);
		m_memory.mapIoWrite(IO_DMA_TRIGGERS[channel], this, &DmaController::onTriggerWriteThunk, IoWriteStorage::Device);
	}
}

void DmaController::onChannelConfigWriteThunk(void* context, u32 address, u32 value, MappedBusSignals) {
	auto& controller = *static_cast<DmaController*>(context);
	const u32 channel = address >= IO_DMA1_READ_ADDR ? 1u : 0u;
	if (controller.busy(channel)) {
		return;
	}
	controller.m_memory.writeIoU32(address, value);
	auto& registers = controller.m_registers.channels[channel];
	if (address == IO_DMA_READ_ADDRS[channel]) {
		registers.readAddressWord = value;
	} else if (address == IO_DMA_WRITE_ADDRS[channel]) {
		registers.writeAddressWord = value;
	} else if (address == IO_DMA_CONTROLS[channel]) {
		registers.controlWord = value;
	} else {
		registers.transferCountWord = value;
	}
}

void DmaController::onTriggerWriteThunk(void* context, u32 address, u32 value, MappedBusSignals) {
	const u32 channel = address == IO_DMA_TRIGGERS[1] ? 1u : 0u;
	static_cast<DmaController*>(context)->onTriggerWrite(channel, value);
}

void DmaController::onTriggerWrite(u32 channel, u32 value) {
	if (m_supervisorQuiesceRequested || m_activeChannel == channel) {
		return;
	}
	if ((value & DMA_TRIGGER_STOP) != 0u) {
		finishChannel(channel, 0u);
		arbitrate(m_scheduler.currentNowCycles());
		return;
	}
	if ((value & DMA_TRIGGER_START) == 0u || busy(channel)) {
		return;
	}
	DmaChannelState& registers = m_registers.channels[channel];
	const u32 route = registers.controlWord & DMA_CONTROL_ROUTE_MASK;
	const bool gpuJob = registers.transferCountWord != 0u && (ReadEndpoints[route] == DmaEndpoint::GpuRead || WriteEndpoints[route] == DmaEndpoint::GpuWrite);
	if (gpuJob) m_gpu->synchronizeDmaStart();
	registers.statusWord = DMA_STATUS_BUSY;
	m_memory.writeIoU32(IO_DMA_STATUSES[channel], DMA_STATUS_BUSY);
	if (gpuJob) m_gpu->dmaRequestStarted();
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

void DmaController::setEndpointCapacity(DmaEndpoint endpoint, u32 words) {
	auto& capacity = m_endpointCapacity[static_cast<u32>(endpoint)];
	if (capacity == words) return;
	capacity = words;
	arbitrate(m_scheduler.currentNowCycles());
}

void DmaController::setEndpointRequests(DmaEndpoint first, u32 firstWords, DmaEndpoint second, u32 secondWords) {
	auto& a = m_endpointCapacity[static_cast<u32>(first)];
	auto& b = m_endpointCapacity[static_cast<u32>(second)];
	if (a == firstWords && b == secondWords) return;
	a = firstWords;
	b = secondWords;
	arbitrate(m_scheduler.currentNowCycles());
}

bool DmaController::ownsReadPort(u32 address) const {
	for (const auto& registers : m_registers.channels) {
		const auto endpoint = ReadEndpoints[registers.controlWord & DMA_CONTROL_ROUTE_MASK];
		if ((registers.statusWord & DMA_STATUS_BUSY) != 0u && endpoint != DmaEndpoint::Memory
			&& EndpointAddresses[static_cast<u32>(endpoint)] == address) return true;
	}
	return false;
}

bool DmaController::ownsWritePort(u32 address) const {
	for (const auto& registers : m_registers.channels) {
		const auto endpoint = WriteEndpoints[registers.controlWord & DMA_CONTROL_ROUTE_MASK];
		if ((registers.statusWord & DMA_STATUS_BUSY) != 0u && endpoint != DmaEndpoint::Memory
			&& EndpointAddresses[static_cast<u32>(endpoint)] == address) return true;
	}
	return false;
}

bool DmaController::hasAdmittedWriteBlock(u32 address) const {
	if (m_activeChannel == IO_DMA_CHANNEL_COUNT) return false;
	const auto endpoint = WriteEndpoints[m_registers.channels[m_activeChannel].controlWord & DMA_CONTROL_ROUTE_MASK];
	return endpoint != DmaEndpoint::Memory && EndpointAddresses[static_cast<u32>(endpoint)] == address;
}

void DmaController::reset() {
	clearLiveTransfer();
	m_endpointCapacity.fill(0);
	m_endpointCapacity[static_cast<u32>(DmaEndpoint::Memory)] = DMA_BURST_WORD_CAPACITY;
	m_supervisorQuiesceRequested = false;
	m_supervisorAdmissionQuiesceRequested = false;
	clearUserContext();
}

void DmaController::onService(i64) {
	const u32 channel = m_activeChannel;
	auto& registers = m_registers.channels[channel];
	const u32 control = registers.controlWord, route = control & DMA_CONTROL_ROUTE_MASK;
	const auto read = ReadEndpoints[route], write = WriteEndpoints[route];
	const u32 readStep = read == DmaEndpoint::Memory ? IO_WORD_SIZE : 0u;
	const u32 writeStep = write == DmaEndpoint::Memory ? IO_WORD_SIZE : 0u;
	const u32 readAddress = readStep != 0u ? registers.readAddressWord : EndpointAddresses[static_cast<u32>(read)];
	const u32 writeAddress = writeStep != 0u ? registers.writeAddressWord : EndpointAddresses[static_cast<u32>(write)];
	const MappedBusSignals readSignals = MAPPED_BUS_MASTER_DMA | (readStep != 0u ? MAPPED_BUS_DMA_MEMORY
		| mappedBusSignalsForCartridgeSlot((control >> DMA_CONTROL_READ_SLOT_SHIFT) & 1u) : 0u);
	const MappedBusSignals writeSignals = MAPPED_BUS_MASTER_DMA | (writeStep != 0u ? MAPPED_BUS_DMA_MEMORY
		| mappedBusSignalsForCartridgeSlot((control >> DMA_CONTROL_WRITE_SLOT_SHIFT) & 1u) : 0u);
	const u32 words = m_scheduledBlockWords;
	const i64 previousDeadline = m_serviceDeadline;
	m_scheduler.cancelDeviceService(DEVICE_SERVICE_DMA);
	m_serviceActive = true;
	m_memory.transferDmaBlock(readAddress, writeAddress, words, readStep, writeStep, readSignals, writeSignals);
	registers.readAddressWord += words * readStep;
	registers.writeAddressWord += words * writeStep;
	registers.transferCountWord -= words;
	m_memory.writeIoU32(IO_DMA_READ_ADDRS[channel], registers.readAddressWord);
	m_memory.writeIoU32(IO_DMA_WRITE_ADDRS[channel], registers.writeAddressWord);
	m_memory.writeIoU32(IO_DMA_TRANSFER_COUNTS[channel], registers.transferCountWord);
	m_serviceActive = false;
	clearAdmittedBlock();
	if (registers.transferCountWord == 0u) finishChannel(channel);
	arbitrate(previousDeadline);
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
	m_serviceDeadline = 0;
}

void DmaController::finishChannel(u32 channel, u32 status) {
	auto& registers = m_registers.channels[channel];
	const u32 route = registers.controlWord & DMA_CONTROL_ROUTE_MASK;
	registers.statusWord = status;
	m_memory.writeIoU32(IO_DMA_STATUSES[channel], status);
	if ((status & DMA_STATUS_DONE) != 0u) m_irq.raise(channel == 0u ? IRQ_DMA0_DONE : IRQ_DMA1_DONE);
	const auto read = ReadEndpoints[route], write = WriteEndpoints[route];
	if (read != DmaEndpoint::Memory) resumeCpuWriteIfPortReleased(EndpointAddresses[static_cast<u32>(read)]);
	if (write != DmaEndpoint::Memory) resumeCpuWriteIfPortReleased(EndpointAddresses[static_cast<u32>(write)]);
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
		const auto& registers = m_registers.channels[channel];
		const u32 control = registers.controlWord;
		const u32 route = control & DMA_CONTROL_ROUTE_MASK;
		const auto read = ReadEndpoints[route], write = WriteEndpoints[route];
		const u32 readAddress = read == DmaEndpoint::Memory ? registers.readAddressWord : EndpointAddresses[static_cast<u32>(read)];
		const u32 writeAddress = write == DmaEndpoint::Memory ? registers.writeAddressWord : EndpointAddresses[static_cast<u32>(write)];
		auto readCapacity = read, writeCapacity = write;
		if (read == DmaEndpoint::Memory && readAddress >= CART_MMIO_BASE && readAddress < CART_MMIO_END) {
			readCapacity = ((control >> DMA_CONTROL_READ_SLOT_SHIFT) & 1u) != 0u ? DmaEndpoint::Cartridge1Read : DmaEndpoint::Cartridge0Read;
		}
		if (write == DmaEndpoint::Memory && writeAddress >= CART_MMIO_BASE && writeAddress < CART_MMIO_END) {
			writeCapacity = ((control >> DMA_CONTROL_WRITE_SLOT_SHIFT) & 1u) != 0u ? DmaEndpoint::Cartridge1Write : DmaEndpoint::Cartridge0Write;
		}
		u32 words = std::min({registers.transferCountWord, DMA_BURST_WORD_CAPACITY,
			m_endpointCapacity[static_cast<u32>(readCapacity)], m_endpointCapacity[static_cast<u32>(writeCapacity)]});
		if (words == 0u) continue;
		const auto readRegion = m_memory.mappedRegion(readAddress);
		const auto writeRegion = m_memory.mappedRegion(writeAddress);
		if (read == DmaEndpoint::Memory) words = m_memory.mappedRegionWordSpan(readAddress, words, readRegion);
		if (write == DmaEndpoint::Memory) words = m_memory.mappedRegionWordSpan(writeAddress, words, writeRegion);
		if (words != 0u) {
			const i64 blockCycles = regionSpanCycles(readRegion, words) + regionSpanCycles(writeRegion, words);
			m_activeChannel = channel;
			m_scheduledBlockWords = words;
			m_serviceDeadline = anchorCycle + blockCycles;
			m_scheduler.scheduleDeviceService(DEVICE_SERVICE_DMA, m_serviceDeadline);
			m_scheduler.requestYieldForEarlierDeadline(m_scheduler.currentNowCycles());
			m_nextChannel = (channel + 1u) % IO_DMA_CHANNEL_COUNT;
			return;
		}
	}
	notifySupervisorBoundary();
}

i64 DmaController::regionSpanCycles(MemoryRegionKind region, u32 wordCount) const {
	switch (region) {
	case MemoryRegionKind::Ram:
		return static_cast<i64>(wordCount) * m_ramCyclesPerWord + m_ramBurstSetupCycles;
	case MemoryRegionKind::SystemRom:
		return static_cast<i64>(wordCount) * m_systemRomCyclesPerWord;
	case MemoryRegionKind::Cartridge:
		return static_cast<i64>(wordCount) * m_cartRomCyclesPerWord + m_cartRomBurstSetupCycles;
	case MemoryRegionKind::Io:
	case MemoryRegionKind::Other:
		return wordCount;
	}
	BMSX_UNREACHABLE();
}

bool DmaController::busy(u32 channel) const {
	return (m_registers.channels[channel].statusWord & DMA_STATUS_BUSY) != 0u;
}

void DmaController::notifySupervisorBoundary() {
	if (m_supervisorQuiesceRequested && supervisorQuiescent()) {
		m_scheduler.scheduleDeviceService(DEVICE_SERVICE_SYSTEM, m_scheduler.currentNowCycles());
	}
}

} // namespace bmsx
