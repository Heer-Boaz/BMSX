/*
 * badp_decoder.cpp - APU BADP block decoder and seek table parsing.
 */

#include "machine/devices/audio/badp_decoder.h"

#include "common/endian.h"

namespace bmsx {

ApuBadpSeekTableResult readApuBadpSeekTable(const u8* data) {
	ApuBadpSeekTableResult result;
	const u32 seekEntryCount = readLE32(data + 28);
	const u32 seekTableOffset = readLE32(data + 32);
	const size_t seekCount = seekEntryCount > 0u ? static_cast<size_t>(seekEntryCount) : 1u;
	result.frames.resize(seekCount);
	result.offsets.resize(seekCount);
	if (seekEntryCount > 0u) {
		size_t cursor = static_cast<size_t>(seekTableOffset);
		for (size_t index = 0; index < seekCount; index += 1u) {
			result.frames[index] = readLE32(data + cursor);
			result.offsets[index] = readLE32(data + cursor + 4u);
			cursor += 8u;
		}
	} else {
		result.frames[0] = 0u;
		result.offsets[0] = 0u;
	}
	return result;
}

} // namespace bmsx
