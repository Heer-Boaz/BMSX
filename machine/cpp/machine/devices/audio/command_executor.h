#pragma once

#include "common/primitives.h"
#include "machine/devices/audio/contracts.h"
#include "machine/devices/audio/source.h"
#include "machine/memory/bus_signals.h"

namespace bmsx {

class ApuActiveSlots;
class ApuCommandFifo;
class ApuOutputMixer;
class ApuSampleMemory;
class ApuSelectedSlotLatch;
class ApuServiceClock;
class ApuSlotBank;
class DeviceScheduler;
class DeviceStatusLatch;
class Memory;
struct ApuOutputVoiceState;

class ApuCommandExecutor final {
public:
	ApuCommandExecutor(Memory& memory,
		ApuOutputMixer& audioOutput,
		DeviceScheduler& scheduler,
		ApuCommandFifo& commandFifo,
		ApuSampleMemory& sampleMemory,
		ApuActiveSlots& activeSlots,
		ApuSlotBank& slots,
		ApuSelectedSlotLatch& selectedSlotLatch,
		DeviceStatusLatch& fault,
		ApuServiceClock& serviceClock,
		const ApuParameterRegisterWords& commandRegisterWords);

	void drainCommandFifo();
	void restoreOutputVoice(const ApuOutputVoiceState& state);
	static u32 selectedSlotRegisterReadThunk(void* context, u32 addr, MappedBusSignals busSignals);
	static void selectedSlotRegisterWriteThunk(void* context, u32 addr, u32 value, MappedBusSignals busSignals);

private:
	Memory& m_memory;
	ApuOutputMixer& m_audioOutput;
	DeviceScheduler& m_scheduler;
	ApuCommandFifo& m_commandFifo;
	ApuSampleMemory& m_sampleMemory;
	ApuActiveSlots& m_activeSlots;
	ApuSlotBank& m_slots;
	ApuSelectedSlotLatch& m_selectedSlotLatch;
	DeviceStatusLatch& m_fault;
	ApuServiceClock& m_serviceClock;
	const ApuParameterRegisterWords& m_commandRegisterWords;
	ApuParameterRegisterWords m_commandDispatchRegisterWords{};
	ApuParameterRegisterWords m_slotRegisterDispatchWords{};
	ApuAudioSource m_source{};
	ApuSourceByteView m_sourceView;

	void executeCommand(u32 command, const ApuParameterRegisterWords& registerWords);
	void play(const ApuParameterRegisterWords& registerWords);
	void startPlay(const ApuAudioSource& source, ApuAudioSlot slot, const ApuParameterRegisterWords& registerWords);
	void stopSlot(const ApuParameterRegisterWords& registerWords);
	void setSlotGain(const ApuParameterRegisterWords& registerWords);
	void writeSlotRegisterWord(ApuAudioSlot slot, u32 parameterIndex, u32 word);
	bool bindSource(const ApuAudioSource& source, u32 cartridgeSlot);
};

} // namespace bmsx
