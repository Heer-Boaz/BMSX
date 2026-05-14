#pragma once

#include <cstddef>
#include <cstdint>

namespace bmsx {

constexpr uint32_t APU_SAMPLE_RATE_HZ = 44100u;
constexpr uint32_t APU_RATE_STEP_Q16_ONE = 0x10000u;
constexpr uint32_t APU_GAIN_Q12_ONE = 0x1000u;

constexpr uint32_t APU_CMD_NONE = 0u;
constexpr uint32_t APU_CMD_PLAY = 1u;
constexpr uint32_t APU_CMD_STOP_SLOT = 2u;
constexpr uint32_t APU_CMD_RAMP_SLOT = 3u;

constexpr uint32_t APU_SLOT_COUNT = 16u;
constexpr uint32_t APU_PARAMETER_REGISTER_COUNT = 20u;
constexpr uint32_t APU_PARAMETER_SOURCE_ADDR_INDEX = 0u;
constexpr uint32_t APU_PARAMETER_SLOT_INDEX = 10u;
constexpr uint32_t APU_SLOT_REGISTER_WORD_COUNT = APU_SLOT_COUNT * APU_PARAMETER_REGISTER_COUNT;

constexpr std::size_t apuSlotRegisterWordIndex(uint32_t slot, uint32_t parameterIndex) {
	return static_cast<std::size_t>(slot) * APU_PARAMETER_REGISTER_COUNT + parameterIndex;
}

constexpr uint32_t APU_STATUS_FAULT = 1u << 0u;
constexpr uint32_t APU_STATUS_SELECTED_SLOT_ACTIVE = 1u << 1u;
constexpr uint32_t APU_STATUS_BUSY = 1u << 2u;

constexpr uint32_t APU_FAULT_NONE = 0u;
constexpr uint32_t APU_FAULT_BAD_CMD = 0x0001u;
constexpr uint32_t APU_FAULT_BAD_SLOT = 0x0002u;
constexpr uint32_t APU_FAULT_SOURCE_BYTES = 0x0101u;
constexpr uint32_t APU_FAULT_SOURCE_RANGE = 0x0102u;
constexpr uint32_t APU_FAULT_SOURCE_SAMPLE_RATE = 0x0103u;
constexpr uint32_t APU_FAULT_SOURCE_CHANNELS = 0x0104u;
constexpr uint32_t APU_FAULT_SOURCE_FRAME_COUNT = 0x0105u;
constexpr uint32_t APU_FAULT_SOURCE_DATA_RANGE = 0x0106u;
constexpr uint32_t APU_FAULT_SOURCE_BIT_DEPTH = 0x0107u;
constexpr uint32_t APU_FAULT_RUNTIME_UNAVAILABLE = 0x0201u;
constexpr uint32_t APU_FAULT_PLAYBACK_REJECTED = 0x0202u;

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

} // namespace bmsx
