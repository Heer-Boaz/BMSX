#pragma once

#include "common/types.h"
#include "machine/devices/audio/command_fifo.h"
#include "machine/devices/audio/contracts.h"
#include "spec/audio/apu.h"

#include <array>
#include <vector>

namespace bmsx {

struct ApuBiquadFilterState {
	i32 l1 = 0;
	i32 l2 = 0;
	i32 r1 = 0;
	i32 r2 = 0;
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
	i16 decodedLeft = 0;
	i16 decodedRight = 0;
	i64 previousDecodedFrame = -1;
	i16 previousDecodedLeft = 0;
	i16 previousDecodedRight = 0;
};

struct ApuOutputVoiceState {
	ApuAudioSlot slot = 0;
	u32 sourceCartridgeSlot = 0;
	i64 cursorQ16 = 0;
	i32 phaseRemainder = 0;
	i32 gainQ12 = APU_GAIN_Q12_ONE;
	i32 fadeStepQ12 = 0;
	i32 fadeStepRemainder = 0;
	u32 fadeError = 0;
	u32 fadeSamplesRemaining = 0;
	u32 fadeSamplesTotal = 0;
	ApuBiquadFilterState filter;
	ApuBadpDecoderSaveState badp;
};

struct ApuOutputState {
	std::vector<ApuOutputVoiceState> voices;
};

struct ApuSampleTransferState {
	u32 transferAddressWord = 0;
	u32 transferDataWord = 0;
	u32 transferControlWord = 0;
	u32 currentAddress = 0;
	std::array<u32, APU_TRANSFER_FIFO_WORD_CAPACITY> fifoWords{};
	u32 fifoReadIndex = 0;
	u32 fifoWriteIndex = 0;
	u32 fifoCount = 0;
	i64 timingCarry = 0;
	u32 scheduledWords = 0;
	i64 scheduledCycles = 0;
};

struct AudioControllerState {
	std::array<uint32_t, APU_PARAMETER_REGISTER_COUNT> registerWords{};
	ApuCommandFifoState commandFifo;
	uint32_t eventSequence = 0;
	uint32_t eventKind = APU_EVENT_NONE;
	uint32_t eventSlot = 0;
	uint32_t eventSourceAddr = 0;
	std::array<uint32_t, APU_SLOT_COUNT> slotPhases{};
	std::array<uint32_t, APU_SLOT_REGISTER_WORD_COUNT> slotRegisterWords{};
	std::vector<u8> sampleRam;
	ApuSampleTransferState sampleTransfer;
	ApuOutputState output;
	int64_t sampleCarry = 0;
	int64_t sampleSequence = 0;
	uint32_t apuStatus = 0;
	uint32_t apuFaultCode = APU_FAULT_NONE;
	uint32_t apuFaultDetail = 0;
};

} // namespace bmsx
