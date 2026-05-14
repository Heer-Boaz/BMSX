#pragma once

#include "audio/soundmaster.h"
#include "machine/devices/audio/contracts.h"
#include "machine/devices/device_status.h"
#include "machine/memory/memory.h"
#include "common/subscription.h"

#include <array>
#include <cstdint>
#include <string>

namespace bmsx {

class SoundMaster;
class IrqController;

struct AudioControllerState {
	std::array<uint32_t, APU_PARAMETER_REGISTER_COUNT> registerWords{};
	uint32_t eventSequence = 0;
	uint32_t eventKind = APU_EVENT_NONE;
	uint32_t eventSlot = 0;
	uint32_t eventSourceAddr = 0;
	uint32_t activeSlotMask = 0;
	std::array<uint32_t, APU_SLOT_REGISTER_WORD_COUNT> slotRegisterWords{};
	uint32_t apuStatus = 0;
	uint32_t apuFaultCode = APU_FAULT_NONE;
	uint32_t apuFaultDetail = 0;
};

class AudioController {
public:
	AudioController(Memory& memory, SoundMaster& soundMaster, IrqController& irq);
	~AudioController() = default;

	void reset();
	void onCommandWrite();
	AudioControllerState captureState() const;
	void restoreState(const AudioControllerState& state);

private:
	static void onCommandWriteThunk(void* context, uint32_t addr, Value value);
	static void onSlotWriteThunk(void* context, uint32_t addr, Value value);
	static void onFaultAckWriteThunk(void* context, uint32_t addr, Value value);
	static Value onStatusReadThunk(void* context, uint32_t addr);
	static Value onSelectedSlotRegisterReadThunk(void* context, uint32_t addr);

	Memory& m_memory;
	SoundMaster& m_soundMaster;
	IrqController& m_irq;
	ScopedSubscription m_endedSubscription;
	uint32_t m_eventSequence = 0;
	uint32_t m_pendingSlotMask = 0;
	uint32_t m_activeSlotMask = 0;
	std::array<uint64_t, APU_SLOT_COUNT> m_slotPlayGenerations{};
	std::array<uint32_t, APU_SLOT_REGISTER_WORD_COUNT> m_slotRegisterWords{};
	std::array<VoiceId, APU_SLOT_COUNT> m_slotVoiceIds{};
	DeviceStatusLatch m_fault;

	void clearCommandLatch();
	void resetCommandLatch();
	void play();
	std::array<uint32_t, APU_PARAMETER_REGISTER_COUNT> captureParameterRegisterWords() const;
	bool readAudioSource(SoundMasterAudioSource& source) const;
	bool readSlot(AudioSlot& slot) const;
	void startPlay(const SoundMasterAudioSource& source, AudioSlot slot, const SoundMasterResolvedPlayRequest& request, const std::array<uint32_t, APU_PARAMETER_REGISTER_COUNT>& registerWords);
	void stopSlot();
	void rampSlot();
	SoundMasterResolvedPlayRequest readResolvedPlayRequest(const SoundMasterAudioSource& source) const;
	void emitSlotEvent(uint32_t kind, AudioSlot slot, VoiceId voiceId, uint32_t sourceAddr);
	void setSlotActive(AudioSlot slot, const std::array<uint32_t, APU_PARAMETER_REGISTER_COUNT>& registerWords, VoiceId voiceId);
	void stopSlotActive(AudioSlot slot);
	void updateSelectedSlotActiveStatus();
	Value onStatusRead() const;
	Value onSelectedSlotRegisterRead(uint32_t addr) const;
};

} // namespace bmsx
