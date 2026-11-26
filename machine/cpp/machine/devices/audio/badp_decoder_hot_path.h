#pragma once

#include "machine/devices/audio/badp_decoder.h"

#include "common/endian.h"

#include <algorithm>

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

// Signed predictor delta in the upper bits, next step index in the low byte.
inline constexpr auto APU_BADP_TRANSITIONS = [] {
	std::array<i32, 89 * 16> table{};
	for (i32 index = 0; index < 89; ++index) {
		const i32 step = APU_BADP_STEP_TABLE[index];
		for (i32 code = 0; code < 16; ++code) {
			i32 delta = (step >> 3) + ((code & 4) ? step : 0)
				+ ((code & 2) ? step >> 1 : 0) + ((code & 1) ? step >> 2 : 0);
			if (code & 8) delta = -delta;
			table[index * 16 + code] = delta * 256 + std::clamp(index + APU_BADP_INDEX_TABLE[code], 0, 88);
		}
	}
	return table;
}();

inline void loadApuBadpBlock(const u8* data, u32 channels, ApuBadpDecoderState& decoder, size_t offset) {
	const size_t blockFrames = static_cast<size_t>(readLE16(data + offset));
	const size_t blockBytes = static_cast<size_t>(readLE16(data + offset + 2));
	const size_t blockHeaderBytes = 4 + static_cast<size_t>(channels) * 4;
	const size_t blockEnd = offset + blockBytes;
	size_t cursor = offset + 4;
	for (u32 channel = 0; channel < channels; channel += 1) {
		decoder.predictors[channel] = readI16LE(data + cursor);
		decoder.stepIndices[channel] = std::min<i32>(data[cursor + 2], 88);
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
		const i32 transition = APU_BADP_TRANSITIONS[stepIndex * 16 + code];
		predictor = std::clamp(predictor + (transition >> 8), -32768, 32767);
		stepIndex = transition & 0xff;
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
	decoder.previousDecodedFrame = decoder.decodedFrame;
	decoder.previousDecodedLeft = decoder.decodedLeft;
	decoder.previousDecodedRight = decoder.decodedRight;
	decoder.decodedFrame = static_cast<i64>(decoder.nextFrame) - 1;
	decoder.decodedLeft = static_cast<i16>(left);
	decoder.decodedRight = static_cast<i16>(right);
}

inline void seekApuBadpDecoderToFrame(const u8* data,
										size_t frames,
										u32 channels,
										const ApuBadpSeekTable& seekTable,
										ApuBadpDecoderState& decoder,
										i64 frame) {
	decoder.decodedFrame = -1;
	decoder.decodedLeft = 0;
	decoder.decodedRight = 0;
	decoder.previousDecodedFrame = -1;
	decoder.previousDecodedLeft = 0;
	decoder.previousDecodedRight = 0;
	if (frame >= static_cast<i64>(frames)) {
		decoder.nextFrame = frames;
		return;
	}
	i64 currentFrame = 0;
	size_t cursor = 0;
	if (seekTable.entryCount != 0u) {
		u32 seekIndex = 0u;
		u32 lo = 0u;
		u32 hi = seekTable.entryCount - 1u;
		while (lo <= hi) {
			const u32 mid = (lo + hi) >> 1u;
			const u32 seekFrame = readLE32(seekTable.bytes + seekTable.byteOffset + static_cast<size_t>(mid) * 8u);
			if (static_cast<i64>(seekFrame) <= frame) {
				seekIndex = mid;
				lo = mid + 1u;
			} else {
				if (mid == 0u) {
					break;
				}
				hi = mid - 1u;
			}
		}
		const u8* entry = seekTable.bytes + seekTable.byteOffset + static_cast<size_t>(seekIndex) * 8u;
		currentFrame = readLE32(entry);
		cursor = readLE32(entry + 4u);
	}
	loadApuBadpBlock(data, channels, decoder, cursor);
	while (currentFrame + static_cast<i64>(decoder.blockFrames) <= frame) {
		currentFrame += static_cast<i64>(decoder.blockFrames);
		cursor = decoder.blockEnd;
		loadApuBadpBlock(data, channels, decoder, cursor);
	}
	decoder.nextFrame = static_cast<size_t>(currentFrame);
	while (static_cast<i64>(decoder.nextFrame) <= frame) {
		decodeNextApuBadpFrame(data, channels, decoder);
	}
}

inline void resetApuBadpDecoder(const u8* data,
								size_t frames,
								u32 channels,
								const ApuBadpSeekTable& seekTable,
								ApuBadpDecoderState& decoder,
								i64 frame) {
	decoder = ApuBadpDecoderState{};
	seekApuBadpDecoderToFrame(data, frames, channels, seekTable, decoder, frame);
}

inline void readApuBadpFrameAt(const u8* data,
								size_t frames,
								u32 channels,
								const ApuBadpSeekTable& seekTable,
								ApuBadpDecoderState& decoder,
								ApuBadpTransition& transition,
								const u64* sourceRevision,
								size_t frame,
								i16& outLeft,
								i16& outRight) {
	if (decoder.decodedFrame == static_cast<i64>(frame)) {
		outLeft = decoder.decodedLeft;
		outRight = decoder.decodedRight;
		return;
	}
	if (decoder.previousDecodedFrame == static_cast<i64>(frame)) {
		outLeft = decoder.previousDecodedLeft;
		outRight = decoder.previousDecodedRight;
		return;
	}
	if (frame < decoder.nextFrame) {
		seekApuBadpDecoderToFrame(data, frames, channels, seekTable, decoder, frame);
	} else if (frame > decoder.nextFrame + 1u) {
		const u64 revision = *sourceRevision;
		if (transition.target == static_cast<i64>(frame) && transition.revision == revision && transition.from == decoder) {
			decoder = transition.to;
		} else {
			transition.from = decoder;
			// Block headers replace the predictor and step index. A whole
			// remaining block cannot affect the result if both requested
			// latches (frame - 1 and frame) belong to later blocks.
			while (decoder.nextFrame < frame) {
				if (decoder.blockFrameIndex < decoder.blockFrames) {
					const size_t nextBlockFrame = decoder.nextFrame + (decoder.blockFrames - decoder.blockFrameIndex);
					if (nextBlockFrame >= frame) break;
					decoder.nextFrame = nextBlockFrame;
					decoder.blockFrameIndex = decoder.blockFrames;
				}
				// Load the successor through the ordinary decoder. This also
				// keeps the interpretation of live sample-RAM headers.
				decodeNextApuBadpFrame(data, channels, decoder);
			}
			while (decoder.nextFrame <= frame) {
				decodeNextApuBadpFrame(data, channels, decoder);
			}
			transition.to = decoder;
			transition.target = static_cast<i64>(frame);
			transition.revision = revision;
		}
		outLeft = decoder.decodedLeft;
		outRight = decoder.decodedRight;
		return;
	}
	while (decoder.nextFrame <= frame) {
		decodeNextApuBadpFrame(data, channels, decoder);
	}
	outLeft = decoder.decodedLeft;
	outRight = decoder.decodedRight;
}


} // namespace

} // namespace bmsx
