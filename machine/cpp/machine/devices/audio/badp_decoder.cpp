/*
 * badp_decoder.cpp - APU BADP block decoder and seek table parsing.
 */

#include "machine/devices/audio/badp_decoder.h"

#include "common/endian.h"

namespace bmsx {

void loadApuBadpSeekTable(ApuBadpSeekTable& out, const u8* bytes, size_t byteOffset) {
	out.bytes = bytes;
	out.byteOffset = byteOffset + readLE32(bytes + byteOffset + 32u);
	out.entryCount = readLE32(bytes + byteOffset + 28u);
}

} // namespace bmsx
