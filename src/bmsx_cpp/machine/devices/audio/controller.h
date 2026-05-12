#pragma once

#include "audio/soundmaster.h"
#include "machine/bus/io.h"
#include "machine/devices/device_status.h"
#include "machine/memory/memory.h"
#include "common/subscription.h"

#include <cstdint>
#include <string>

namespace bmsx {

class SoundMaster;
class IrqController;

struct AudioControllerState {
	uint32_t eventSequence = 0;
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
	static void onFaultAckWriteThunk(void* context, uint32_t addr, Value value);

	Memory& m_memory;
	SoundMaster& m_soundMaster;
	IrqController& m_irq;
	ScopedSubscription m_endedSubscription;
	uint32_t m_eventSequence = 0;
	DeviceStatusLatch m_fault;

	void clearCommandLatch();
	void resetCommandLatch();
	void play();
	bool readAudioSource(SoundMasterAudioSource& source) const;
	bool readSlot(AudioSlot& slot) const;
	void startPlay(const SoundMasterAudioSource& source, AudioSlot slot, const SoundMasterResolvedPlayRequest& request);
	void stopSlot();
	void rampSlot();
	SoundMasterResolvedPlayRequest readResolvedPlayRequest(const SoundMasterAudioSource& source) const;
	void emitSlotEvent(uint32_t kind, AudioSlot slot, uint32_t sourceAddr);
};

} // namespace bmsx
