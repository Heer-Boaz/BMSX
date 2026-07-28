#pragma once

#include "spec/audio/apu.h"

#include <cstddef>
#include <cstdint>
#include <array>

namespace bmsx {

using ApuAudioSlot = uint32_t;
using ApuSlotPhase = uint32_t;
using ApuParameterRegisterWords = std::array<uint32_t, APU_PARAMETER_REGISTER_COUNT>;

constexpr uint32_t APU_SLOT_PHASE_IDLE = 0u;
constexpr uint32_t APU_SLOT_PHASE_PLAYING = 1u;
constexpr uint32_t APU_SLOT_PHASE_FADING = 2u;

struct ApuAudioSource {
	uint32_t sourceAddr = 0;
	uint32_t sourceBytes = 0;
	uint32_t sampleRateHz = 0;
	uint32_t channels = 0;
	uint32_t bitsPerSample = 0;
	uint32_t frameCount = 0;
	uint32_t dataOffset = 0;
	uint32_t dataBytes = 0;
	uint32_t loopStartSample = 0;
	uint32_t loopEndSample = 0;
	uint32_t generatorKind = 0;
	uint32_t generatorDutyQ12 = 0;
};

} // namespace bmsx
