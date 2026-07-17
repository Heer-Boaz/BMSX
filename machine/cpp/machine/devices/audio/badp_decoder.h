#pragma once

#include "common/types.h"

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
	i64 previousDecodedFrame = -1;
	i16 previousDecodedLeft = 0;
	i16 previousDecodedRight = 0;
};

struct ApuBadpSeekTable {
	const u8* bytes = nullptr;
	size_t byteOffset = 0;
	u32 entryCount = 0;
};

void loadApuBadpSeekTable(ApuBadpSeekTable& out, const u8* bytes, size_t byteOffset);


} // namespace bmsx
