#pragma once

#include "machine/devices/audio/command_fifo.h"
#include "machine/devices/audio/contracts.h"
#include "machine/devices/audio/event_latch.h"
#include "machine/devices/audio/output.h"
#include "machine/devices/audio/save_state.h"
#include "machine/devices/audio/selected_slot_latch.h"
#include "machine/devices/audio/service_clock.h"
#include "machine/devices/audio/source.h"
#include "machine/devices/audio/slot_bank.h"
#include "machine/devices/audio/status_register.h"
#include "machine/devices/device_status.h"
#include "machine/memory/memory.h"

#include <array>
#include <cstdint>
#include <vector>

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
	void onCommandWrite();
	void setTiming(int64_t cpuHz, int64_t nowCycles);
	void accrueCycles(int cycles, int64_t nowCycles);
	void onService(int64_t nowCycles);
	AudioControllerState captureState() const;
	void restoreState(const AudioControllerState& state, int64_t nowCycles);

private:
	static void onCommandWriteThunk(void* context, uint32_t addr, Value value);
	static void onSlotWriteThunk(void* context, uint32_t addr, Value value);
	static void onFaultAckWriteThunk(void* context, uint32_t addr, Value value);
	static Value onStatusReadThunk(void* context, uint32_t addr);
	static Value onOutputQueuedFramesReadThunk(void* context, uint32_t addr);
	static Value onOutputFreeFramesReadThunk(void* context, uint32_t addr);
	static Value onOutputCapacityFramesReadThunk(void* context, uint32_t addr);
	static Value onCommandQueuedReadThunk(void* context, uint32_t addr);
	static Value onCommandFreeReadThunk(void* context, uint32_t addr);
	static Value onCommandCapacityReadThunk(void* context, uint32_t addr);
	static Value onSelectedSlotRegisterReadThunk(void* context, uint32_t addr);
	static void onSelectedSlotRegisterWriteThunk(void* context, uint32_t addr, Value value);

	Memory& m_memory;
	ApuOutputMixer& m_audioOutput;
	DeviceScheduler& m_scheduler;
	ApuEventLatch m_eventLatch;
	ApuCommandFifo m_commandFifo;
	ApuParameterRegisterWords m_commandDispatchRegisterWords{};
	ApuParameterRegisterWords m_slotRegisterDispatchWords{};
	ApuSlotBank m_slots;
	DeviceStatusLatch m_fault;
	ApuSelectedSlotLatch m_selectedSlotLatch;
	ApuStatusRegister m_statusRegister;
	ApuServiceClock m_serviceClock;
	ApuSourceDma m_sourceDma;

	bool enqueueCommand(uint32_t command);
	void drainCommandFifo();
	void executeCommand(uint32_t command, const ApuParameterRegisterWords& registerWords);
	void play(const ApuParameterRegisterWords& registerWords);
		bool readSlot(const ApuParameterRegisterWords& registerWords, ApuAudioSlot& slot) const;
		void startPlay(const ApuAudioSource& source, ApuAudioSlot slot, const ApuParameterRegisterWords& registerWords);
		bool playOutputVoice(ApuAudioSlot slot, ApuVoiceId voiceId, const ApuAudioSource& source, const ApuParameterRegisterWords& registerWords, u32 fadeSamples);
		const ApuParameterRegisterWords& fadeOutputRegisterWords(ApuAudioSlot slot, const ApuParameterRegisterWords& registerWords);
		bool replaceSlotSourceDma(ApuAudioSlot slot, const ApuAudioSource& source);
		void stopSlot(const ApuParameterRegisterWords& registerWords);
		void setSlotGain(const ApuParameterRegisterWords& registerWords);
		void emitSlotEvent(uint32_t kind, ApuAudioSlot slot, ApuVoiceId voiceId, uint32_t sourceAddr);
	void setSlotActive(ApuAudioSlot slot, const ApuParameterRegisterWords& registerWords, ApuVoiceId voiceId);
	void stopSlotActive(ApuAudioSlot slot);
	void setSlotPhase(ApuAudioSlot slot, ApuSlotPhase phase);
	bool replayHostOutput(ApuAudioSlot slot, ApuVoiceId voiceId);
	void advanceActiveSlots(int64_t samples);
	Value onSelectedSlotRegisterRead(uint32_t addr) const;
	void onSelectedSlotRegisterWrite(uint32_t addr, Value value);
	void writeSlotRegisterWord(ApuAudioSlot slot, uint32_t parameterIndex, uint32_t word);
};

} // namespace bmsx
