#pragma once

#include "common/primitives.h"
#include "machine/cpu/cpu.h"
#include "machine/devices/audio/contracts.h"

namespace bmsx {

class ApuActiveSlots;
class ApuCommandFifo;
class ApuOutputMixer;
class ApuSelectedSlotLatch;
class ApuServiceClock;
class ApuSlotBank;
class ApuSourceDma;
class DeviceScheduler;
class DeviceStatusLatch;
class Memory;

class ApuCommandExecutor final {
public:
	ApuCommandExecutor(Memory& memory,
		ApuOutputMixer& audioOutput,
		DeviceScheduler& scheduler,
		ApuCommandFifo& commandFifo,
		ApuSourceDma& sourceDma,
		ApuActiveSlots& activeSlots,
		ApuSlotBank& slots,
		ApuSelectedSlotLatch& selectedSlotLatch,
		DeviceStatusLatch& fault,
		ApuServiceClock& serviceClock);

	void drainCommandFifo();
	bool replayHostOutput(ApuAudioSlot slot, ApuVoiceId voiceId);
	Value onSelectedSlotRegisterRead(u32 addr) const;
	void onSelectedSlotRegisterWrite(u32 addr, Value value);
	static Value selectedSlotRegisterReadThunk(void* context, u32 addr);
	static void selectedSlotRegisterWriteThunk(void* context, u32 addr, Value value);

private:
	Memory& m_memory;
	ApuOutputMixer& m_audioOutput;
	DeviceScheduler& m_scheduler;
	ApuCommandFifo& m_commandFifo;
	ApuSourceDma& m_sourceDma;
	ApuActiveSlots& m_activeSlots;
	ApuSlotBank& m_slots;
	ApuSelectedSlotLatch& m_selectedSlotLatch;
	DeviceStatusLatch& m_fault;
	ApuServiceClock& m_serviceClock;
	ApuParameterRegisterWords m_commandDispatchRegisterWords{};
	ApuParameterRegisterWords m_slotRegisterDispatchWords{};

	void executeCommand(u32 command, const ApuParameterRegisterWords& registerWords);
	bool readSlot(const ApuParameterRegisterWords& registerWords, ApuAudioSlot& slot) const;
	void play(const ApuParameterRegisterWords& registerWords);
	void startPlay(const ApuAudioSource& source, ApuAudioSlot slot, const ApuParameterRegisterWords& registerWords);
	void stopSlot(const ApuParameterRegisterWords& registerWords);
	void setSlotGain(const ApuParameterRegisterWords& registerWords);
	bool replaceSlotSourceDma(ApuAudioSlot slot, const ApuAudioSource& source);
	void writeSlotRegisterWord(ApuAudioSlot slot, u32 parameterIndex, u32 word);
	bool playOutputVoice(ApuAudioSlot slot, ApuVoiceId voiceId, const ApuAudioSource& source, const ApuParameterRegisterWords& registerWords, u32 fadeSamples);
	const ApuParameterRegisterWords& fadeOutputRegisterWords(ApuAudioSlot slot, const ApuParameterRegisterWords& registerWords);
};

} // namespace bmsx
