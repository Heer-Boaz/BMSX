#include "machine/devices/audio/controller.h"

#include "machine/devices/audio/command_latch.h"

#include "machine/bus/io.h"
#include "machine/cpu/cpu.h"
#include "machine/devices/irq/controller.h"
#include "machine/scheduler/device.h"


namespace bmsx {
namespace {

constexpr DeviceStatusRegisters APU_DEVICE_STATUS_REGISTERS{
	IO_APU_STATUS,
	IO_APU_FAULT_CODE,
	IO_APU_FAULT_DETAIL,
	IO_APU_FAULT_ACK,
	APU_STATUS_FAULT,
	APU_FAULT_NONE,
};

} // namespace

AudioController::AudioController(Memory& memory, ApuOutputMixer& audioOutput, IrqController& irq, DeviceScheduler& scheduler)
	: m_memory(memory)
	, m_audioOutput(audioOutput)
	, m_scheduler(scheduler)
	, m_eventLatch(memory, irq)
	, m_fault(memory, APU_DEVICE_STATUS_REGISTERS)
	, m_selectedSlotLatch(memory, m_fault, m_slots)
	, m_activeSlots(memory, m_audioOutput, m_sourceDma, m_eventLatch, m_slots, m_selectedSlotLatch)
	, m_statusRegister(m_fault, m_slots, m_commandFifo, m_audioOutput.outputRing)
	, m_serviceClock(scheduler, m_commandFifo, m_slots)
	, m_commandIngress(memory, m_commandFifo, m_fault, m_serviceClock, scheduler)
	, m_queueStatusRegisters(m_commandFifo, m_audioOutput.outputRing)
	, m_commandExecutor(memory, m_audioOutput, scheduler, m_commandFifo, m_sourceDma, m_activeSlots, m_slots, m_selectedSlotLatch, m_fault, m_serviceClock) {
	m_memory.mapIoRead(IO_APU_STATUS, this, &AudioController::onStatusReadThunk);
	m_memory.mapIoWrite(IO_APU_CMD, &m_commandIngress, &ApuCommandIngress::writeThunk);
	m_memory.mapIoWrite(IO_APU_SLOT, this, &AudioController::onSlotWriteThunk);
	m_memory.mapIoRead(IO_APU_OUTPUT_QUEUED_FRAMES, &m_queueStatusRegisters, &ApuQueueStatusRegisters::readThunk);
	m_memory.mapIoRead(IO_APU_OUTPUT_FREE_FRAMES, &m_queueStatusRegisters, &ApuQueueStatusRegisters::readThunk);
	m_memory.mapIoRead(IO_APU_OUTPUT_CAPACITY_FRAMES, &m_queueStatusRegisters, &ApuQueueStatusRegisters::readThunk);
	m_memory.mapIoRead(IO_APU_CMD_QUEUED, &m_queueStatusRegisters, &ApuQueueStatusRegisters::readThunk);
	m_memory.mapIoRead(IO_APU_CMD_FREE, &m_queueStatusRegisters, &ApuQueueStatusRegisters::readThunk);
	m_memory.mapIoRead(IO_APU_CMD_CAPACITY, &m_queueStatusRegisters, &ApuQueueStatusRegisters::readThunk);
	for (uint32_t index = 0; index < APU_PARAMETER_REGISTER_COUNT; index += 1u) {
		m_memory.mapIoRead(IO_APU_SELECTED_SLOT_REG0 + index * IO_WORD_SIZE, &m_commandExecutor, &ApuCommandExecutor::selectedSlotRegisterReadThunk);
		m_memory.mapIoWrite(IO_APU_SELECTED_SLOT_REG0 + index * IO_WORD_SIZE, &m_commandExecutor, &ApuCommandExecutor::selectedSlotRegisterWriteThunk);
	}
	m_memory.mapIoWrite(IO_APU_FAULT_ACK, &m_fault, &DeviceStatusLatch::acknowledgeWriteThunk);
}

void AudioController::dispose() {
	m_serviceClock.reset();
	m_audioOutput.resetPlaybackState();
}

void AudioController::reset() {
	m_commandFifo.reset();
	m_slots.reset();
	m_sourceDma.reset();
	m_serviceClock.reset();
	m_audioOutput.resetPlaybackState();
	m_fault.resetStatus();
	clearApuCommandLatch(m_memory);
	m_eventLatch.reset();
	m_selectedSlotLatch.reset();
	m_activeSlots.writeActiveMask();
}

void AudioController::setTiming(int64_t cpuHz, int64_t nowCycles) {
	m_serviceClock.setCpuHz(cpuHz);
	if (m_slots.activeMask() == 0u && m_commandFifo.empty()) {
		m_serviceClock.clearBudget();
	}
	m_serviceClock.scheduleNext(nowCycles);
}

void AudioController::accrueCycles(int cycles, int64_t nowCycles) {
	if (m_slots.activeMask() == 0u || cycles <= 0) {
		return;
	}
	m_serviceClock.accrueCycles(cycles);
	m_serviceClock.scheduleNext(nowCycles);
}

void AudioController::onService(int64_t nowCycles) {
	if (!m_commandFifo.empty()) {
		m_commandExecutor.drainCommandFifo();
	}
	if (m_slots.activeMask() == 0u || !m_serviceClock.pendingSamples()) {
		m_serviceClock.scheduleNext(nowCycles);
		return;
	}
	m_activeSlots.advance(m_serviceClock.consumeSamples());
	m_serviceClock.scheduleNext(nowCycles);
}

// disable-next-line single_line_method_pattern -- memory-map callbacks require a C-style thunk back into the APU device instance.
void AudioController::onSlotWriteThunk(void* context, uint32_t, Value) {
	static_cast<AudioController*>(context)->m_selectedSlotLatch.refresh();
}

Value AudioController::onStatusReadThunk(void* context, uint32_t) {
	auto& controller = *static_cast<AudioController*>(context);
	return valueNumber(static_cast<double>(controller.m_statusRegister.read()));
}

} // namespace bmsx
