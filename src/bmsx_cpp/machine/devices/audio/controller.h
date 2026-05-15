#pragma once

#include "machine/devices/audio/active_slots.h"
#include "machine/devices/audio/command_executor.h"
#include "machine/devices/audio/command_fifo.h"
#include "machine/devices/audio/command_ingress.h"
#include "machine/devices/audio/contracts.h"
#include "machine/devices/audio/event_latch.h"
#include "machine/devices/audio/output.h"
#include "machine/devices/audio/queue_status_registers.h"
#include "machine/devices/audio/save_state.h"
#include "machine/devices/audio/selected_slot_latch.h"
#include "machine/devices/audio/service_clock.h"
#include "machine/devices/audio/source.h"
#include "machine/devices/audio/slot_bank.h"
#include "machine/devices/audio/status_register.h"
#include "machine/devices/device_status.h"
#include "machine/memory/memory.h"


namespace bmsx {

class ApuOutputMixer;
class IrqController;
class DeviceScheduler;

class AudioController {
public:
	AudioController(Memory& memory, ApuOutputMixer& audioOutput, IrqController& irq, DeviceScheduler& scheduler);
	~AudioController() = default;

	void reset();
	void dispose();
	void setTiming(int64_t cpuHz, int64_t nowCycles);
	void accrueCycles(int cycles, int64_t nowCycles);
	void onService(int64_t nowCycles);
	AudioControllerState captureState() const;
	void restoreState(const AudioControllerState& state, int64_t nowCycles);

private:
	static void onSlotWriteThunk(void* context, uint32_t addr, Value value);
	static Value onStatusReadThunk(void* context, uint32_t addr);

	Memory& m_memory;
	ApuOutputMixer& m_audioOutput;
	DeviceScheduler& m_scheduler;
	ApuEventLatch m_eventLatch;
	ApuCommandFifo m_commandFifo;
	ApuSlotBank m_slots;
	DeviceStatusLatch m_fault;
	ApuSelectedSlotLatch m_selectedSlotLatch;
	ApuSourceDma m_sourceDma;
	ApuActiveSlots m_activeSlots;
	ApuStatusRegister m_statusRegister;
	ApuServiceClock m_serviceClock;
	ApuCommandIngress m_commandIngress;
	ApuQueueStatusRegisters m_queueStatusRegisters;
	ApuCommandExecutor m_commandExecutor;

};

} // namespace bmsx
