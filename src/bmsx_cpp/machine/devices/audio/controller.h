#pragma once

#include "machine/memory/memory.h"
#include "rompack/assets.h"
#include "subscription.h"

#include <cstdint>
#include <string>

namespace bmsx {

class SoundMaster;
class IrqController;
struct ActiveVoiceInfo;
struct ModulationInput;

class AudioController {
public:
	AudioController(Memory& memory, SoundMaster& soundMaster, IrqController& irq);
	~AudioController() = default;

	void reset();
	void onCommandWrite();

private:
	static void onCommandWriteThunk(void* context, uint32_t addr, Value value);

	Memory& m_memory;
	SoundMaster& m_soundMaster;
	IrqController& m_irq;
	ScopedSubscription m_sfxEnded;
	ScopedSubscription m_musicEnded;
	ScopedSubscription m_uiEnded;
	uint32_t m_eventSequence = 0;

	void play();
	void playMusic(const std::string& id);
	void stopChannel();
	ModulationInput readModulationParams() const;
	void onVoiceEnded(AudioType type, const ActiveVoiceInfo& info);
};

} // namespace bmsx
