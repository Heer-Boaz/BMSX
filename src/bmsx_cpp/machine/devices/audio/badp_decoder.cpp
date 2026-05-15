/*
 * badp_decoder.cpp - APU BADP block decoder and seek table validation.
 */

#include "machine/devices/audio/badp_decoder.h"

#include "common/endian.h"

namespace bmsx {

static constexpr size_t BADP_HEADER_SIZE = 48;
static constexpr u16 BADP_VERSION = 1;
static constexpr u8 BADP_MAGIC[4] = {0x42, 0x41, 0x44, 0x50};

static bool isApuBadpSource(const u8* data, size_t size) {
	return size >= BADP_HEADER_SIZE
		&& data[0] == BADP_MAGIC[0]
		&& data[1] == BADP_MAGIC[1]
		&& data[2] == BADP_MAGIC[2]
		&& data[3] == BADP_MAGIC[3];
}

static ApuBadpSeekTableResult validateApuBadpBlocks(const u8* data, const ApuAudioSource& source, const std::vector<u32>& seekFrames, const std::vector<u32>& seekOffsets) {
	ApuBadpSeekTableResult result;
	size_t offset = 0;
	u32 decodedFrames = 0;
	size_t seekIndex = 0;
	u32 seekFaultDetail = 0;
	while (decodedFrames < source.frameCount) {
		while (seekIndex < seekOffsets.size() && seekOffsets[seekIndex] == offset) {
			if (seekFrames[seekIndex] != decodedFrames) {
				result.faultCode = APU_FAULT_OUTPUT_METADATA;
				result.faultDetail = seekFaultDetail;
				return result;
			}
			seekIndex += 1u;
			seekFaultDetail += 1u;
		}
		if (seekIndex < seekOffsets.size() && seekOffsets[seekIndex] < offset) {
			result.faultCode = APU_FAULT_OUTPUT_METADATA;
			result.faultDetail = seekFaultDetail;
			return result;
		}
		const u32 blockFaultDetail = static_cast<u32>(offset);
		const size_t blockOffset = static_cast<size_t>(source.dataOffset) + offset;
		if (offset + 4u > static_cast<size_t>(source.dataBytes)) {
			result.faultCode = APU_FAULT_OUTPUT_BLOCK;
			result.faultDetail = blockFaultDetail;
			return result;
		}
		const size_t blockFrames = static_cast<size_t>(readLE16(data + blockOffset));
		const size_t blockBytes = static_cast<size_t>(readLE16(data + blockOffset + 2u));
		if (blockFrames == 0u) {
			result.faultCode = APU_FAULT_OUTPUT_BLOCK;
			result.faultDetail = blockFaultDetail;
			return result;
		}
		const size_t blockHeaderBytes = 4u + static_cast<size_t>(source.channels) * 4u;
		if (blockBytes < blockHeaderBytes) {
			result.faultCode = APU_FAULT_OUTPUT_BLOCK;
			result.faultDetail = blockFaultDetail;
			return result;
		}
		const size_t blockEnd = offset + blockBytes;
		if (blockEnd > static_cast<size_t>(source.dataBytes)) {
			result.faultCode = APU_FAULT_OUTPUT_BLOCK;
			result.faultDetail = blockFaultDetail;
			return result;
		}
		size_t channelCursor = blockOffset + 4u;
		for (u32 channel = 0; channel < source.channels; channel += 1u) {
			if (data[channelCursor + 2u] > 88u) {
				result.faultCode = APU_FAULT_OUTPUT_BLOCK;
				result.faultDetail = blockFaultDetail;
				return result;
			}
			channelCursor += 4u;
		}
		if (blockFrames * static_cast<size_t>(source.channels) > (blockBytes - blockHeaderBytes) * 2u) {
			result.faultCode = APU_FAULT_OUTPUT_BLOCK;
			result.faultDetail = blockFaultDetail;
			return result;
		}
		decodedFrames += static_cast<u32>(blockFrames);
		offset = blockEnd;
	}
	while (seekIndex < seekOffsets.size()) {
		if (seekFrames[seekIndex] <= source.frameCount) {
			result.faultCode = APU_FAULT_OUTPUT_METADATA;
			result.faultDetail = seekFaultDetail;
			return result;
		}
		seekIndex += 1u;
		seekFaultDetail += 1u;
	}
	return result;
}

ApuBadpSeekTableResult readApuBadpSeekTable(const u8* data, size_t size, const ApuAudioSource& source) {
	ApuBadpSeekTableResult result;
	if (!isApuBadpSource(data, size)) {
		result.faultCode = APU_FAULT_UNSUPPORTED_FORMAT;
		result.faultDetail = static_cast<u32>(size);
		return result;
	}
	const u16 version = readLE16(data + 4);
	if (version != BADP_VERSION) {
		result.faultCode = APU_FAULT_UNSUPPORTED_FORMAT;
		result.faultDetail = version;
		return result;
	}
	const u32 channels = readLE16(data + 6);
	const u32 sampleRate = readLE32(data + 8);
	const u32 frameCount = readLE32(data + 12);
	const u32 seekEntryCount = readLE32(data + 28);
	const u32 seekTableOffset = readLE32(data + 32);
	const u32 dataOffset = readLE32(data + 36);
	if (channels != source.channels || sampleRate != source.sampleRateHz || frameCount != source.frameCount || dataOffset != source.dataOffset) {
		result.faultCode = APU_FAULT_OUTPUT_METADATA;
		result.faultDetail = dataOffset;
		return result;
	}
	if (dataOffset < BADP_HEADER_SIZE || dataOffset > size) {
		result.faultCode = APU_FAULT_OUTPUT_DATA_RANGE;
		result.faultDetail = dataOffset;
		return result;
	}
	if (source.dataBytes == 0 || dataOffset + source.dataBytes > size) {
		result.faultCode = APU_FAULT_OUTPUT_DATA_RANGE;
		result.faultDetail = source.dataBytes;
		return result;
	}
	if (seekEntryCount > 0 && (seekTableOffset < BADP_HEADER_SIZE || seekTableOffset >= dataOffset)) {
		result.faultCode = APU_FAULT_OUTPUT_METADATA;
		result.faultDetail = seekTableOffset;
		return result;
	}
	if (seekEntryCount > 0 && static_cast<u64>(seekTableOffset) + static_cast<u64>(seekEntryCount) * 8u > static_cast<u64>(dataOffset)) {
		result.faultCode = APU_FAULT_OUTPUT_METADATA;
		result.faultDetail = seekEntryCount;
		return result;
	}
	const size_t seekCount = seekEntryCount > 0 ? static_cast<size_t>(seekEntryCount) : 1u;
	std::vector<u32> frames(seekCount);
	std::vector<u32> offsets(seekCount);
	if (seekEntryCount > 0) {
		size_t cursor = static_cast<size_t>(seekTableOffset);
		for (size_t i = 0; i < seekCount; i += 1) {
			frames[i] = readLE32(data + cursor);
			offsets[i] = readLE32(data + cursor + 4);
			cursor += 8;
		}
	} else {
		frames[0] = 0;
		offsets[0] = 0;
	}
	if (frames[0] != 0 || offsets[0] != 0) {
		result.faultCode = APU_FAULT_OUTPUT_METADATA;
		result.faultDetail = offsets[0];
		return result;
	}
	for (size_t i = 0; i < seekCount; i += 1) {
		if (frames[i] > source.frameCount || offsets[i] >= source.dataBytes) {
			result.faultCode = APU_FAULT_OUTPUT_METADATA;
			result.faultDetail = static_cast<u32>(i);
			return result;
		}
		if (i > 0 && (frames[i] < frames[i - 1] || offsets[i] < offsets[i - 1])) {
			result.faultCode = APU_FAULT_OUTPUT_METADATA;
			result.faultDetail = static_cast<u32>(i);
			return result;
		}
	}
	const ApuBadpSeekTableResult blockResult = validateApuBadpBlocks(data, source, frames, offsets);
	if (blockResult.faultCode != APU_FAULT_NONE) {
		result.faultCode = blockResult.faultCode;
		result.faultDetail = blockResult.faultDetail;
		return result;
	}
	result.frames = std::move(frames);
	result.offsets = std::move(offsets);
	return result;
}

} // namespace bmsx
