#include "machine/devices/vdp/command_processor.h"
#include "machine/devices/vdp/vdp.h"
#include "machine/devices/vdp/fault.h"
#include "machine/devices/vdp/packet_schema.h"
#include "machine/firmware/api.h"
#include "machine/memory/memory.h"
#include "machine/bus/io.h"
#include <cstring>
#include <optional>
#include <string>

namespace bmsx {
namespace {

struct MemoryPacketWordReader {
	static constexpr bool kMemoryBacked = true;
	const Memory* memory = nullptr;
	uint32_t base = 0u;

	inline uint32_t readU32(int index) const {
		return memory->readU32(base + static_cast<uint32_t>(index) * IO_ARG_STRIDE);
	}
};

struct BufferPacketWordReader {
	static constexpr bool kMemoryBacked = false;
	const u32* words = nullptr;
	uint32_t wordOffset = 0u;

	inline uint32_t readU32(int index) const {
		return words[wordOffset + static_cast<uint32_t>(index)];
	}
};

template<typename Reader>
inline uint32_t readPacketArgWord(const Reader& reader, uint32_t cmd, int index, VdpPacketWordKind expectedKind, const char* kindLabel) {
	if (getVdpPacketArgKind(cmd, static_cast<uint32_t>(index)) != expectedKind) {
		throw vdpFault("packet arg " + std::to_string(index) + " is not encoded as " + kindLabel + ".");
	}
	return reader.readU32(index);
}

template<typename Reader>
inline uint32_t readPacketArgU32(const Reader& reader, uint32_t cmd, int index) {
	return readPacketArgWord(reader, cmd, index, VdpPacketWordKind::U32, "u32");
}

template<typename Reader>
inline int32_t readPacketArgI32(const Reader& reader, uint32_t cmd, int index) {
	return static_cast<int32_t>(readPacketArgWord(reader, cmd, index, VdpPacketWordKind::U32, "u32"));
}

template<typename Reader>
inline float readPacketArgF32(const Reader& reader, uint32_t cmd, int index) {
	const uint32_t bits = readPacketArgWord(reader, cmd, index, VdpPacketWordKind::F32, "f32");
	float value = 0.0f;
	std::memcpy(&value, &bits, sizeof(value));
	return value;
}

template<typename Reader>
inline Color readPacketColor(const Reader& reader, uint32_t cmd, int offset) {
	return Color{
		readPacketArgF32(reader, cmd, offset + 0),
		readPacketArgF32(reader, cmd, offset + 1),
		readPacketArgF32(reader, cmd, offset + 2),
		readPacketArgF32(reader, cmd, offset + 3),
	};
}

template<typename ArgReader, typename PayloadReader>
void processVdpCommandImpl(VDP& vdp, CPU& cpu, Api& api, uint32_t cmd, uint32_t argWords, const ArgReader& argReader, const PayloadReader& payloadReader, uint32_t payloadWords) {
	switch (cmd) {
		case IO_CMD_VDP_CLEAR: {
			assertVdpPacketArgWords(cmd, argWords);
			vdp.enqueueClear(readPacketColor(argReader, cmd, 0));
			break;
		}
		case IO_CMD_VDP_FILL_RECT: {
			assertVdpPacketArgWords(cmd, argWords);
			vdp.enqueueFillRect(
				readPacketArgF32(argReader, cmd, 0),
				readPacketArgF32(argReader, cmd, 1),
				readPacketArgF32(argReader, cmd, 2),
				readPacketArgF32(argReader, cmd, 3),
				readPacketArgF32(argReader, cmd, 4),
				static_cast<Layer2D>(readPacketArgU32(argReader, cmd, 5)),
				readPacketColor(argReader, cmd, 6)
			);
			break;
		}
		case IO_CMD_VDP_DRAW_LINE: {
			assertVdpPacketArgWords(cmd, argWords);
			vdp.enqueueDrawLine(
				readPacketArgF32(argReader, cmd, 0),
				readPacketArgF32(argReader, cmd, 1),
				readPacketArgF32(argReader, cmd, 2),
				readPacketArgF32(argReader, cmd, 3),
				readPacketArgF32(argReader, cmd, 4),
				static_cast<Layer2D>(readPacketArgU32(argReader, cmd, 5)),
				readPacketColor(argReader, cmd, 6),
				readPacketArgF32(argReader, cmd, 10)
			);
			break;
		}
		case IO_CMD_VDP_BLIT: {
			assertVdpPacketArgWords(cmd, argWords);
			const uint32_t flipFlags = readPacketArgU32(argReader, cmd, 7);
			vdp.enqueueBlit(
				readPacketArgU32(argReader, cmd, 0),
				readPacketArgF32(argReader, cmd, 1),
				readPacketArgF32(argReader, cmd, 2),
				readPacketArgF32(argReader, cmd, 3),
				static_cast<Layer2D>(readPacketArgU32(argReader, cmd, 4)),
				readPacketArgF32(argReader, cmd, 5),
				readPacketArgF32(argReader, cmd, 6),
				(flipFlags & 1u) != 0u,
				(flipFlags & 2u) != 0u,
				readPacketColor(argReader, cmd, 8),
				readPacketArgF32(argReader, cmd, 12)
			);
			break;
		}
		case IO_CMD_VDP_GLYPH_RUN: {
			assertVdpPacketArgWords(cmd, argWords);
			const std::string& text = cpu.stringPool().toString(readPacketArgU32(argReader, cmd, 0));
			const bool backgroundEnabled = readPacketArgU32(argReader, cmd, 12) != 0u;
			const std::optional<Color> backgroundColor = backgroundEnabled
				? std::optional<Color>(readPacketColor(argReader, cmd, 13))
				: std::nullopt;
			vdp.enqueueGlyphRun(
				text,
				readPacketArgF32(argReader, cmd, 1),
				readPacketArgF32(argReader, cmd, 2),
				readPacketArgF32(argReader, cmd, 3),
				api.resolveFontId(readPacketArgU32(argReader, cmd, 4)),
				readPacketColor(argReader, cmd, 8),
				backgroundColor,
				readPacketArgI32(argReader, cmd, 5),
				readPacketArgI32(argReader, cmd, 6),
				static_cast<Layer2D>(readPacketArgU32(argReader, cmd, 7))
			);
			break;
		}
		case IO_CMD_VDP_TILE_RUN: {
			assertVdpPacketArgWords(cmd, argWords);
			const uint32_t tileCount = readPacketArgU32(argReader, cmd, 0);
			if (tileCount > payloadWords) {
				throw vdpFault("tile payload underrun (" + std::to_string(tileCount) + " > " + std::to_string(payloadWords) + ").");
			}
			const i32 cols = readPacketArgI32(argReader, cmd, 1);
			const i32 rows = readPacketArgI32(argReader, cmd, 2);
			if (tileCount != static_cast<uint32_t>(cols * rows)) {
				throw vdpFault("tile payload size mismatch (" + std::to_string(tileCount) + " != " + std::to_string(cols * rows) + ").");
			}
			if constexpr (PayloadReader::kMemoryBacked) {
				vdp.enqueuePayloadTileRun(
					payloadReader.base,
					tileCount,
					cols,
					rows,
					readPacketArgI32(argReader, cmd, 3),
					readPacketArgI32(argReader, cmd, 4),
					readPacketArgI32(argReader, cmd, 5),
					readPacketArgI32(argReader, cmd, 6),
					readPacketArgI32(argReader, cmd, 7),
					readPacketArgI32(argReader, cmd, 8),
					readPacketArgF32(argReader, cmd, 9),
					static_cast<Layer2D>(readPacketArgU32(argReader, cmd, 10))
				);
			} else {
				vdp.enqueuePayloadTileRunWords(
					payloadReader.words + payloadReader.wordOffset,
					tileCount,
					cols,
					rows,
					readPacketArgI32(argReader, cmd, 3),
					readPacketArgI32(argReader, cmd, 4),
					readPacketArgI32(argReader, cmd, 5),
					readPacketArgI32(argReader, cmd, 6),
					readPacketArgI32(argReader, cmd, 7),
					readPacketArgI32(argReader, cmd, 8),
					readPacketArgF32(argReader, cmd, 9),
					static_cast<Layer2D>(readPacketArgU32(argReader, cmd, 10))
				);
			}
			break;
		}
		default:
			throw vdpFault("unknown I/O command " + std::to_string(cmd) + ".");
	}
}

} // namespace

void processVdpCommand(
	VDP& vdp,
	CPU& cpu,
	Api& api,
	const Memory& memory,
	uint32_t cmd,
	uint32_t argWords,
	uint32_t argBase,
	uint32_t payloadBase,
	uint32_t payloadWords
) {
	const MemoryPacketWordReader argReader{&memory, argBase};
	const MemoryPacketWordReader payloadReader{&memory, payloadBase};
	processVdpCommandImpl(vdp, cpu, api, cmd, argWords, argReader, payloadReader, payloadWords);
}

void processVdpBufferedCommand(
	VDP& vdp,
	CPU& cpu,
	Api& api,
	const u32* words,
	uint32_t cmd,
	uint32_t argWords,
	uint32_t argOffset,
	uint32_t payloadOffset,
	uint32_t payloadWords
) {
	const BufferPacketWordReader argReader{words, argOffset};
	const BufferPacketWordReader payloadReader{words, payloadOffset};
	processVdpCommandImpl(vdp, cpu, api, cmd, argWords, argReader, payloadReader, payloadWords);
}

} // namespace bmsx
