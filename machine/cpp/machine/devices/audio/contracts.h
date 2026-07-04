#pragma once

#include <cstddef>
#include <cstdint>
#include <array>

namespace bmsx {

constexpr uint32_t APU_SAMPLE_RATE_HZ = 44100U;
constexpr uint32_t APU_RATE_STEP_Q16_ONE = 0x10000U;
constexpr uint32_t APU_GAIN_Q12_ONE = 0x1000U;
constexpr uint32_t APU_OUTPUT_QUEUE_CAPACITY_FRAMES = 16384U;
constexpr uint32_t APU_OUTPUT_QUEUE_CAPACITY_SAMPLES = APU_OUTPUT_QUEUE_CAPACITY_FRAMES * 2U;
constexpr uint32_t APU_COMMAND_FIFO_CAPACITY = 16U;

constexpr uint32_t APU_CMD_NONE = 0U;
constexpr uint32_t APU_CMD_PLAY = 1U;
constexpr uint32_t APU_CMD_STOP_SLOT = 2U;
constexpr uint32_t APU_CMD_SET_SLOT_GAIN = 3U;

constexpr uint32_t APU_SLOT_COUNT = 16U;
constexpr uint32_t APU_SLOT_INDEX_MASK = APU_SLOT_COUNT - 1U;
constexpr uint32_t APU_SLOT_PHASE_IDLE = 0U;
constexpr uint32_t APU_SLOT_PHASE_PLAYING = 1U;
constexpr uint32_t APU_SLOT_PHASE_FADING = 2U;
constexpr uint32_t APU_GENERATOR_NONE = 0U;
constexpr uint32_t APU_GENERATOR_SQUARE = 1U;
constexpr uint32_t APU_PARAMETER_REGISTER_COUNT = 21U;
constexpr uint32_t APU_PARAMETER_SOURCE_ADDR_INDEX = 0U;
constexpr uint32_t APU_PARAMETER_SOURCE_BYTES_INDEX = 1U;
constexpr uint32_t APU_PARAMETER_SOURCE_SAMPLE_RATE_HZ_INDEX = 2U;
constexpr uint32_t APU_PARAMETER_SOURCE_CHANNELS_INDEX = 3U;
constexpr uint32_t APU_PARAMETER_SOURCE_BITS_PER_SAMPLE_INDEX = 4U;
constexpr uint32_t APU_PARAMETER_SOURCE_FRAME_COUNT_INDEX = 5U;
constexpr uint32_t APU_PARAMETER_SOURCE_DATA_OFFSET_INDEX = 6U;
constexpr uint32_t APU_PARAMETER_SOURCE_DATA_BYTES_INDEX = 7U;
constexpr uint32_t APU_PARAMETER_SOURCE_LOOP_START_SAMPLE_INDEX = 8U;
constexpr uint32_t APU_PARAMETER_SOURCE_LOOP_END_SAMPLE_INDEX = 9U;
constexpr uint32_t APU_PARAMETER_SLOT_INDEX = 10U;
constexpr uint32_t APU_PARAMETER_RATE_STEP_Q16_INDEX = 11U;
constexpr uint32_t APU_PARAMETER_GAIN_Q12_INDEX = 12U;
constexpr uint32_t APU_PARAMETER_START_SAMPLE_INDEX = 13U;
constexpr uint32_t APU_PARAMETER_FILTER_KIND_INDEX = 14U;
constexpr uint32_t APU_PARAMETER_FILTER_FREQ_HZ_INDEX = 15U;
constexpr uint32_t APU_PARAMETER_FILTER_Q_MILLI_INDEX = 16U;
constexpr uint32_t APU_PARAMETER_FILTER_GAIN_MILLIDB_INDEX = 17U;
constexpr uint32_t APU_PARAMETER_FADE_SAMPLES_INDEX = 18U;
constexpr uint32_t APU_PARAMETER_GENERATOR_KIND_INDEX = 19U;
constexpr uint32_t APU_PARAMETER_GENERATOR_DUTY_Q12_INDEX = 20U;
constexpr uint32_t APU_SLOT_REGISTER_WORD_COUNT = APU_SLOT_COUNT * APU_PARAMETER_REGISTER_COUNT;
constexpr uint32_t APU_COMMAND_FIFO_REGISTER_WORD_COUNT = APU_COMMAND_FIFO_CAPACITY * APU_PARAMETER_REGISTER_COUNT;

constexpr auto apuSlotRegisterWordIndex(uint32_t slot, uint32_t parameterIndex) -> std::size_t {
	return (static_cast<std::size_t>(slot) * APU_PARAMETER_REGISTER_COUNT) + parameterIndex;
}

constexpr uint32_t APU_STATUS_FAULT = 1U << 0U;
constexpr uint32_t APU_STATUS_SELECTED_SLOT_ACTIVE = 1U << 1U;
constexpr uint32_t APU_STATUS_BUSY = 1U << 2U;
constexpr uint32_t APU_STATUS_OUTPUT_EMPTY = 1U << 3U;
constexpr uint32_t APU_STATUS_OUTPUT_FULL = 1U << 4U;
constexpr uint32_t APU_STATUS_CMD_FIFO_EMPTY = 1U << 5U;
constexpr uint32_t APU_STATUS_CMD_FIFO_FULL = 1U << 6U;

constexpr uint32_t APU_FAULT_NONE = 0U;
constexpr uint32_t APU_FAULT_BAD_CMD = 0x0001U;
constexpr uint32_t APU_FAULT_SOURCE_BYTES = 0x0101U;
constexpr uint32_t APU_FAULT_SOURCE_RANGE = 0x0102U;
constexpr uint32_t APU_FAULT_SOURCE_SAMPLE_RATE = 0x0103U;
constexpr uint32_t APU_FAULT_SOURCE_CHANNELS = 0x0104U;
constexpr uint32_t APU_FAULT_SOURCE_FRAME_COUNT = 0x0105U;
constexpr uint32_t APU_FAULT_SOURCE_DATA_RANGE = 0x0106U;
constexpr uint32_t APU_FAULT_SOURCE_BIT_DEPTH = 0x0107U;
constexpr uint32_t APU_FAULT_UNSUPPORTED_FORMAT = 0x0201U;

constexpr uint32_t APU_FILTER_NONE = 0U;
constexpr uint32_t APU_FILTER_LOWPASS = 1U;
constexpr uint32_t APU_FILTER_HIGHPASS = 2U;
constexpr uint32_t APU_FILTER_BANDPASS = 3U;
constexpr uint32_t APU_FILTER_NOTCH = 4U;
constexpr uint32_t APU_FILTER_ALLPASS = 5U;
constexpr uint32_t APU_FILTER_PEAKING = 6U;
constexpr uint32_t APU_FILTER_LOWSHELF = 7U;
constexpr uint32_t APU_FILTER_HIGHSHELF = 8U;

constexpr uint32_t APU_EVENT_NONE = 0U;
constexpr uint32_t APU_EVENT_SLOT_ENDED = 1U;

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

constexpr auto advanceApuPlaybackCursorQ16(int64_t cursorQ16, int64_t samples, int64_t rateStepQ16, uint32_t sourceSampleRateHz) -> int64_t {
	return cursorQ16 + (samples * rateStepQ16 * static_cast<int64_t>(sourceSampleRateHz) / static_cast<int64_t>(APU_SAMPLE_RATE_HZ));
}

} // namespace bmsx
