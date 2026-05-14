#pragma once

#include "common/types.h"
#include "machine/devices/audio/contracts.h"

#include <array>
#include <vector>

namespace bmsx {

using ApuSlotSourceBytes = std::array<std::vector<u8>, APU_SLOT_COUNT>;

struct ApuBiquadFilterState {
	bool enabled = false;
	f32 b0 = 1.0f;
	f32 b1 = 0.0f;
	f32 b2 = 0.0f;
	f32 a1 = 0.0f;
	f32 a2 = 0.0f;
	f32 l1 = 0.0f;
	f32 l2 = 0.0f;
	f32 r1 = 0.0f;
	f32 r2 = 0.0f;
};

struct ApuBadpDecoderSaveState {
	std::array<i32, 2> predictors{};
	std::array<i32, 2> stepIndices{};
	u32 nextFrame = 0;
	u32 blockEnd = 0;
	u32 blockFrames = 0;
	u32 blockFrameIndex = 0;
	u32 payloadOffset = 0;
	u32 nibbleCursor = 0;
	i64 decodedFrame = -1;
	i32 decodedLeft = 0;
	i32 decodedRight = 0;
};

struct ApuOutputVoiceState {
	ApuAudioSlot slot = 0;
	f64 position = 0.0;
	f64 step = 0.0;
	f32 gain = 1.0f;
	f32 targetGain = 1.0f;
	f64 gainRampRemaining = 0.0;
	f64 stopAfter = -1.0;
	i32 filterSampleRate = 0;
	ApuBiquadFilterState filter;
	ApuBadpDecoderSaveState badp;
};

struct ApuOutputState {
	std::vector<ApuOutputVoiceState> voices;
};

struct AudioControllerState {
	std::array<uint32_t, APU_PARAMETER_REGISTER_COUNT> registerWords{};
	std::array<uint32_t, APU_COMMAND_FIFO_CAPACITY> commandFifoCommands{};
	std::array<uint32_t, APU_COMMAND_FIFO_REGISTER_WORD_COUNT> commandFifoRegisterWords{};
	uint32_t commandFifoReadIndex = 0;
	uint32_t commandFifoWriteIndex = 0;
	uint32_t commandFifoCount = 0;
	uint32_t eventSequence = 0;
	uint32_t eventKind = APU_EVENT_NONE;
	uint32_t eventSlot = 0;
	uint32_t eventSourceAddr = 0;
	std::array<uint32_t, APU_SLOT_COUNT> slotPhases{};
	std::array<uint32_t, APU_SLOT_REGISTER_WORD_COUNT> slotRegisterWords{};
	ApuSlotSourceBytes slotSourceBytes{};
	std::array<int64_t, APU_SLOT_COUNT> slotPlaybackCursorQ16{};
	std::array<uint32_t, APU_SLOT_COUNT> slotFadeSamplesRemaining{};
	std::array<uint32_t, APU_SLOT_COUNT> slotFadeSamplesTotal{};
	ApuOutputState output;
	int64_t sampleCarry = 0;
	int64_t availableSamples = 0;
	uint32_t apuStatus = 0;
	uint32_t apuFaultCode = APU_FAULT_NONE;
	uint32_t apuFaultDetail = 0;
};

} // namespace bmsx
