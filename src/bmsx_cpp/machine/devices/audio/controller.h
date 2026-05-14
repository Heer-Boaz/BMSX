#pragma once

#include "machine/devices/audio/contracts.h"
#include "machine/devices/audio/output.h"
#include "machine/devices/audio/save_state.h"
#include "machine/devices/audio/source.h"
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
	IrqController& m_irq;
	DeviceScheduler& m_scheduler;
	uint32_t m_eventSequence = 0;
	std::array<uint32_t, APU_COMMAND_FIFO_CAPACITY> m_commandFifoCommands{};
	std::array<uint32_t, APU_COMMAND_FIFO_REGISTER_WORD_COUNT> m_commandFifoRegisterWords{};
	uint32_t m_commandFifoReadIndex = 0;
	uint32_t m_commandFifoWriteIndex = 0;
	uint32_t m_commandFifoCount = 0;
	ApuParameterRegisterWords m_commandDispatchRegisterWords{};
	ApuParameterRegisterWords m_slotRegisterDispatchWords{};
	uint32_t m_activeSlotMask = 0;
	std::array<uint32_t, APU_SLOT_COUNT> m_slotPhases{};
	std::array<uint32_t, APU_SLOT_REGISTER_WORD_COUNT> m_slotRegisterWords{};
	ApuSourceDma m_sourceDma;
	std::array<int64_t, APU_SLOT_COUNT> m_slotPlaybackCursorQ16{};
	std::array<uint32_t, APU_SLOT_COUNT> m_slotFadeSamplesRemaining{};
	std::array<uint32_t, APU_SLOT_COUNT> m_slotFadeSamplesTotal{};
	std::array<ApuVoiceId, APU_SLOT_COUNT> m_slotVoiceIds{};
	ApuVoiceId m_nextVoiceId = 1;
	int64_t m_cpuHz = APU_SAMPLE_RATE_HZ;
	int64_t m_sampleCarry = 0;
	int64_t m_availableSamples = 0;
	DeviceStatusLatch m_fault;

	void clearCommandLatch();
	void resetCommandLatch();
	void resetCommandFifo();
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
	bool advanceSlotCursor(ApuAudioSlot slot, int64_t samples);
	void scheduleNextService(int64_t nowCycles);
	void updateSelectedSlotActiveStatus();
	Value onStatusRead() const;
	Value onSelectedSlotRegisterRead(uint32_t addr) const;
	void onSelectedSlotRegisterWrite(uint32_t addr, Value value);
	void writeSlotRegisterWord(ApuAudioSlot slot, uint32_t parameterIndex, uint32_t word);
};

} // namespace bmsx
