#pragma once

#include <cstddef>
#include <cstdint>
#include <array>

namespace bmsx {

constexpr uint32_t APU_SAMPLE_RATE_HZ = 44100u;
constexpr uint32_t APU_RATE_STEP_Q16_ONE = 0x10000u;
constexpr uint32_t APU_GAIN_Q12_ONE = 0x1000u;
constexpr uint32_t APU_OUTPUT_QUEUE_CAPACITY_FRAMES = 16384u;
constexpr uint32_t APU_OUTPUT_QUEUE_CAPACITY_SAMPLES = APU_OUTPUT_QUEUE_CAPACITY_FRAMES * 2u;
constexpr uint32_t APU_COMMAND_FIFO_CAPACITY = 16u;

constexpr uint32_t APU_CMD_NONE = 0u;
constexpr uint32_t APU_CMD_PLAY = 1u;
constexpr uint32_t APU_CMD_STOP_SLOT = 2u;
constexpr uint32_t APU_CMD_SET_SLOT_GAIN = 3u;

constexpr uint32_t APU_SLOT_COUNT = 16u;
constexpr uint32_t APU_SLOT_PHASE_IDLE = 0u;
constexpr uint32_t APU_SLOT_PHASE_PLAYING = 1u;
constexpr uint32_t APU_SLOT_PHASE_FADING = 2u;
constexpr uint32_t APU_GENERATOR_NONE = 0u;
constexpr uint32_t APU_GENERATOR_SQUARE = 1u;
constexpr uint32_t APU_PARAMETER_REGISTER_COUNT = 21u;
constexpr uint32_t APU_PARAMETER_SOURCE_ADDR_INDEX = 0u;
constexpr uint32_t APU_PARAMETER_SOURCE_BYTES_INDEX = 1u;
constexpr uint32_t APU_PARAMETER_SOURCE_SAMPLE_RATE_HZ_INDEX = 2u;
constexpr uint32_t APU_PARAMETER_SOURCE_CHANNELS_INDEX = 3u;
constexpr uint32_t APU_PARAMETER_SOURCE_BITS_PER_SAMPLE_INDEX = 4u;
constexpr uint32_t APU_PARAMETER_SOURCE_FRAME_COUNT_INDEX = 5u;
constexpr uint32_t APU_PARAMETER_SOURCE_DATA_OFFSET_INDEX = 6u;
constexpr uint32_t APU_PARAMETER_SOURCE_DATA_BYTES_INDEX = 7u;
constexpr uint32_t APU_PARAMETER_SOURCE_LOOP_START_SAMPLE_INDEX = 8u;
constexpr uint32_t APU_PARAMETER_SOURCE_LOOP_END_SAMPLE_INDEX = 9u;
constexpr uint32_t APU_PARAMETER_SLOT_INDEX = 10u;
constexpr uint32_t APU_PARAMETER_RATE_STEP_Q16_INDEX = 11u;
constexpr uint32_t APU_PARAMETER_GAIN_Q12_INDEX = 12u;
constexpr uint32_t APU_PARAMETER_START_SAMPLE_INDEX = 13u;
constexpr uint32_t APU_PARAMETER_FILTER_KIND_INDEX = 14u;
constexpr uint32_t APU_PARAMETER_FILTER_FREQ_HZ_INDEX = 15u;
constexpr uint32_t APU_PARAMETER_FILTER_Q_MILLI_INDEX = 16u;
constexpr uint32_t APU_PARAMETER_FILTER_GAIN_MILLIDB_INDEX = 17u;
constexpr uint32_t APU_PARAMETER_FADE_SAMPLES_INDEX = 18u;
constexpr uint32_t APU_PARAMETER_GENERATOR_KIND_INDEX = 19u;
constexpr uint32_t APU_PARAMETER_GENERATOR_DUTY_Q12_INDEX = 20u;
constexpr uint32_t APU_SLOT_REGISTER_WORD_COUNT = APU_SLOT_COUNT * APU_PARAMETER_REGISTER_COUNT;
constexpr uint32_t APU_COMMAND_FIFO_REGISTER_WORD_COUNT = APU_COMMAND_FIFO_CAPACITY * APU_PARAMETER_REGISTER_COUNT;

constexpr std::size_t apuSlotRegisterWordIndex(uint32_t slot, uint32_t parameterIndex) {
	return static_cast<std::size_t>(slot) * APU_PARAMETER_REGISTER_COUNT + parameterIndex;
}

constexpr uint32_t APU_STATUS_FAULT = 1u << 0u;
constexpr uint32_t APU_STATUS_SELECTED_SLOT_ACTIVE = 1u << 1u;
constexpr uint32_t APU_STATUS_BUSY = 1u << 2u;
constexpr uint32_t APU_STATUS_OUTPUT_EMPTY = 1u << 3u;
constexpr uint32_t APU_STATUS_OUTPUT_FULL = 1u << 4u;
constexpr uint32_t APU_STATUS_CMD_FIFO_EMPTY = 1u << 5u;
constexpr uint32_t APU_STATUS_CMD_FIFO_FULL = 1u << 6u;

constexpr uint32_t APU_FAULT_NONE = 0u;
constexpr uint32_t APU_FAULT_BAD_CMD = 0x0001u;
constexpr uint32_t APU_FAULT_BAD_SLOT = 0x0002u;
constexpr uint32_t APU_FAULT_CMD_FIFO_FULL = 0x0003u;
constexpr uint32_t APU_FAULT_SOURCE_BYTES = 0x0101u;
constexpr uint32_t APU_FAULT_SOURCE_RANGE = 0x0102u;
constexpr uint32_t APU_FAULT_SOURCE_SAMPLE_RATE = 0x0103u;
constexpr uint32_t APU_FAULT_SOURCE_CHANNELS = 0x0104u;
constexpr uint32_t APU_FAULT_SOURCE_FRAME_COUNT = 0x0105u;
constexpr uint32_t APU_FAULT_SOURCE_DATA_RANGE = 0x0106u;
constexpr uint32_t APU_FAULT_SOURCE_BIT_DEPTH = 0x0107u;
constexpr uint32_t APU_FAULT_UNSUPPORTED_FORMAT = 0x0201u;
constexpr uint32_t APU_FAULT_OUTPUT_METADATA = 0x0202u;
constexpr uint32_t APU_FAULT_OUTPUT_DATA_RANGE = 0x0203u;
constexpr uint32_t APU_FAULT_OUTPUT_PLAYBACK_RATE = 0x0204u;
constexpr uint32_t APU_FAULT_OUTPUT_BLOCK = 0x0205u;

constexpr uint32_t APU_FILTER_NONE = 0u;
constexpr uint32_t APU_FILTER_LOWPASS = 1u;
constexpr uint32_t APU_FILTER_HIGHPASS = 2u;
constexpr uint32_t APU_FILTER_BANDPASS = 3u;
constexpr uint32_t APU_FILTER_NOTCH = 4u;
constexpr uint32_t APU_FILTER_ALLPASS = 5u;
constexpr uint32_t APU_FILTER_PEAKING = 6u;
constexpr uint32_t APU_FILTER_LOWSHELF = 7u;
constexpr uint32_t APU_FILTER_HIGHSHELF = 8u;

constexpr uint32_t APU_EVENT_NONE = 0u;
constexpr uint32_t APU_EVENT_SLOT_ENDED = 1u;

using ApuVoiceId = uint64_t;
using ApuAudioSlot = uint32_t;
using ApuSlotPhase = uint32_t;
using ApuParameterRegisterWords = std::array<uint32_t, APU_PARAMETER_REGISTER_COUNT>;

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

constexpr int64_t advanceApuPlaybackCursorQ16(int64_t cursorQ16, int64_t samples, int64_t rateStepQ16, uint32_t sourceSampleRateHz) {
	return cursorQ16 + samples * rateStepQ16 * static_cast<int64_t>(sourceSampleRateHz) / static_cast<int64_t>(APU_SAMPLE_RATE_HZ);
}

} // namespace bmsx
