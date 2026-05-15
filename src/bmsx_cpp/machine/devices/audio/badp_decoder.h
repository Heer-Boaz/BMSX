#pragma once

#include "common/types.h"
#include "machine/devices/audio/contracts.h"

#include <vector>

namespace bmsx {

struct ApuBadpDecoderState {
	i32 predictors[2] = {0, 0};
	i32 stepIndices[2] = {0, 0};
	size_t nextFrame = 0;
	size_t blockEnd = 0;
	size_t blockFrames = 0;
	size_t blockFrameIndex = 0;
	size_t payloadOffset = 0;
	size_t nibbleCursor = 0;
	i64 decodedFrame = -1;
	i16 decodedLeft = 0;
	i16 decodedRight = 0;
};

struct ApuBadpSeekTableResult {
	u32 faultCode = APU_FAULT_NONE;
	u32 faultDetail = 0;
	std::vector<u32> frames;
	std::vector<u32> offsets;
};

ApuBadpSeekTableResult readApuBadpSeekTable(const u8* data, size_t size, const ApuAudioSource& source);


} // namespace bmsx
