#pragma once

#include "machine/devices/audio/badp_decoder.h"

#include "common/endian.h"

namespace bmsx {

namespace {

inline constexpr i32 APU_BADP_STEP_TABLE[89] = {
	7, 8, 9, 10, 11, 12, 13, 14, 16, 17,
	19, 21, 23, 25, 28, 31, 34, 37, 41, 45,
	50, 55, 60, 66, 73, 80, 88, 97, 107, 118,
	130, 143, 157, 173, 190, 209, 230, 253, 279, 307,
	337, 371, 408, 449, 494, 544, 598, 658, 724, 796,
	876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066,
	2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358,
	5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899,
	15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767,
};

inline constexpr i32 APU_BADP_INDEX_TABLE[16] = {
	-1, -1, -1, -1, 2, 4, 6, 8,
	-1, -1, -1, -1, 2, 4, 6, 8,
};

inline void loadApuBadpBlock(const u8* data, u32 channels, ApuBadpDecoderState& decoder, size_t offset) {
	const size_t blockFrames = static_cast<size_t>(readLE16(data + offset));
	const size_t blockBytes = static_cast<size_t>(readLE16(data + offset + 2));
	const size_t blockHeaderBytes = 4 + static_cast<size_t>(channels) * 4;
	const size_t blockEnd = offset + blockBytes;
	size_t cursor = offset + 4;
	for (u32 channel = 0; channel < channels; channel += 1) {
		decoder.predictors[channel] = readI16LE(data + cursor);
		decoder.stepIndices[channel] = static_cast<i32>(data[cursor + 2]);
		cursor += 4;
	}
	decoder.blockEnd = blockEnd;
	decoder.blockFrames = blockFrames;
	decoder.blockFrameIndex = 0;
	decoder.payloadOffset = offset + blockHeaderBytes;
	decoder.nibbleCursor = 0;
}

inline void decodeNextApuBadpFrame(const u8* data, u32 channels, ApuBadpDecoderState& decoder) {
	if (decoder.blockFrameIndex >= decoder.blockFrames) {
		loadApuBadpBlock(data, channels, decoder, decoder.blockEnd);
	}
	i32 left = 0;
	i32 right = 0;
	for (u32 channel = 0; channel < channels; channel += 1) {
		i32& predictor = decoder.predictors[channel];
		i32& stepIndex = decoder.stepIndices[channel];
		const size_t payloadIndex = decoder.payloadOffset + (decoder.nibbleCursor >> 1);
		const u8 packed = data[payloadIndex];
		const i32 code = (decoder.nibbleCursor & 1) == 0 ? static_cast<i32>((packed >> 4) & 0x0f) : static_cast<i32>(packed & 0x0f);
		decoder.nibbleCursor += 1;
		const i32 step = APU_BADP_STEP_TABLE[stepIndex];
		i32 diff = step >> 3;
		if ((code & 4) != 0) diff += step;
		if ((code & 2) != 0) diff += step >> 1;
		if ((code & 1) != 0) diff += step >> 2;
		if ((code & 8) != 0) {
			predictor -= diff;
		} else {
			predictor += diff;
		}
		if (predictor < -32768) predictor = -32768;
		if (predictor > 32767) predictor = 32767;
		stepIndex += APU_BADP_INDEX_TABLE[code];
		if (stepIndex < 0) stepIndex = 0;
		if (stepIndex > 88) stepIndex = 88;
		if (channel == 0) {
			left = predictor;
		} else {
			right = predictor;
		}
	}
	if (channels == 1) {
		right = left;
	}
	decoder.blockFrameIndex += 1;
	decoder.nextFrame += 1;
	decoder.decodedFrame = static_cast<i64>(decoder.nextFrame) - 1;
	decoder.decodedLeft = static_cast<i16>(left);
	decoder.decodedRight = static_cast<i16>(right);
}

inline void seekApuBadpDecoderToFrame(const u8* data,
									 size_t frames,
									 u32 channels,
									 const std::vector<u32>& seekFrames,
									 const std::vector<u32>& seekOffsets,
									 ApuBadpDecoderState& decoder,
									 size_t frame) {
	if (frame == frames) {
		decoder.nextFrame = frame;
		decoder.decodedFrame = static_cast<i64>(frame) - 1;
		decoder.decodedLeft = 0;
		decoder.decodedRight = 0;
		return;
	}
	size_t seekIndex = 0;
	size_t lo = 0;
	size_t hi = seekFrames.size() - 1;
	while (lo <= hi) {
		const size_t mid = (lo + hi) >> 1;
		if (seekFrames[mid] <= frame) {
			seekIndex = mid;
			lo = mid + 1;
		} else {
			if (mid == 0) {
				break;
			}
			hi = mid - 1;
		}
	}
	size_t currentFrame = static_cast<size_t>(seekFrames[seekIndex]);
	size_t cursor = static_cast<size_t>(seekOffsets[seekIndex]);
	loadApuBadpBlock(data, channels, decoder, cursor);
	while (currentFrame + decoder.blockFrames <= frame) {
		currentFrame += decoder.blockFrames;
		cursor = decoder.blockEnd;
		loadApuBadpBlock(data, channels, decoder, cursor);
	}
	decoder.nextFrame = currentFrame;
	decoder.decodedFrame = static_cast<i64>(currentFrame) - 1;
	while (decoder.nextFrame <= frame) {
		decodeNextApuBadpFrame(data, channels, decoder);
	}
}

inline void resetApuBadpDecoder(const u8* data,
							   size_t frames,
							   u32 channels,
							   const std::vector<u32>& seekFrames,
							   const std::vector<u32>& seekOffsets,
							   ApuBadpDecoderState& decoder,
							   size_t frame) {
	decoder = ApuBadpDecoderState{};
	seekApuBadpDecoderToFrame(data, frames, channels, seekFrames, seekOffsets, decoder, frame);
}

inline bool readApuBadpFrameAt(const u8* data,
							  size_t frames,
							  u32 channels,
							  const std::vector<u32>& seekFrames,
							  const std::vector<u32>& seekOffsets,
							  ApuBadpDecoderState& decoder,
							  size_t frame,
							  i16& outLeft,
							  i16& outRight) {
	if (frame >= frames) {
		return false;
	}
	if (decoder.decodedFrame == static_cast<i64>(frame)) {
		outLeft = decoder.decodedLeft;
		outRight = decoder.decodedRight;
		return true;
	}
	if (frame < decoder.nextFrame) {
		seekApuBadpDecoderToFrame(data, frames, channels, seekFrames, seekOffsets, decoder, frame);
	}
	while (decoder.nextFrame <= frame) {
		decodeNextApuBadpFrame(data, channels, decoder);
	}
	outLeft = decoder.decodedLeft;
	outRight = decoder.decodedRight;
	return true;
}


} // namespace

} // namespace bmsx
