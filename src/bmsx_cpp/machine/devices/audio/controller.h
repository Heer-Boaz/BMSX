#pragma once

#include "audio/soundmaster.h"
#include "machine/memory/memory.h"
#include "rompack/assets.h"
#include "subscription.h"

#include <array>
#include <cstdint>
#include <deque>
#include <string>

namespace bmsx {

class SoundMaster;
class IrqController;
struct ActiveVoiceInfo;

class AudioController {
public:
	AudioController(Memory& memory, SoundMaster& soundMaster, IrqController& irq);
	~AudioController() = default;

	void reset();
	void onCommandWrite();

private:
	static void onCommandWriteThunk(void* context, uint32_t addr, Value value);

	struct QueuedAudioPlay {
		uint32_t handle = 0;
		std::string id;
		SoundMasterResolvedPlayRequest request;
	};

	Memory& m_memory;
	SoundMaster& m_soundMaster;
	IrqController& m_irq;
	ScopedSubscription m_sfxEnded;
	ScopedSubscription m_musicEnded;
	ScopedSubscription m_uiEnded;
	uint32_t m_eventSequence = 0;
	std::array<uint32_t, 3> m_activeHandleByType{};
	std::array<VoiceId, 3> m_activeVoiceByType{};
	std::array<std::deque<QueuedAudioPlay>, 3> m_queuedByType;

	void clearCommandLatch();
	void resetCommandLatch();
	void play();
	void queuePlay();
	void startPlay(uint32_t handle, const std::string& id, AudioType channel, const SoundMasterResolvedPlayRequest& request);
	void startMusicTransitionFromApu(const std::string& id);
	void stopChannel();
	SoundMasterResolvedPlayRequest readResolvedPlayRequest() const;
	void onVoiceEnded(AudioType type, const ActiveVoiceInfo& info);
};

} // namespace bmsx
