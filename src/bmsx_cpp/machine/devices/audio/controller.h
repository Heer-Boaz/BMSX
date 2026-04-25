#pragma once

#include "audio/soundmaster.h"
#include "machine/memory/memory.h"
#include "subscription.h"

#include <cstdint>
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

	Memory& m_memory;
	SoundMaster& m_soundMaster;
	IrqController& m_irq;
	ScopedSubscription m_endedSubscription;
	uint32_t m_eventSequence = 0;

	void clearCommandLatch();
	void resetCommandLatch();
	void play();
	const Memory::AssetEntry& requireAudioEntry(uint32_t handle) const;
	AudioSlot readSlot() const;
	void startPlay(const std::string& id, AudioSlot slot, const SoundMasterResolvedPlayRequest& request);
	void stopSlot();
	void rampSlot();
	SoundMasterResolvedPlayRequest readResolvedPlayRequest() const;
	void emitSlotEvent(uint32_t kind, AudioSlot slot, uint32_t handle);
	void onVoiceEnded(const ActiveVoiceInfo& info);
};

} // namespace bmsx
