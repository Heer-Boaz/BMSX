#include "machine/devices/vdp/command_processor.h"
#include "machine/devices/vdp/vdp.h"
#include "core/font.h"
#include "core/utf8.h"
#include "machine/common/word.h"
#include "machine/devices/vdp/blitter.h"
#include "machine/devices/vdp/fault.h"
#include "machine/common/numeric.h"
#include "machine/devices/vdp/packet_schema.h"
#include "machine/devices/vdp/registers.h"
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

template<typename Reader>
inline u32 readPacketColorWord(const Reader& reader, uint32_t cmd, int offset) {
	return packFrameBufferColorWord(
		readPacketArgF32(reader, cmd, offset + 0),
		readPacketArgF32(reader, cmd, offset + 1),
		readPacketArgF32(reader, cmd, offset + 2),
		readPacketArgF32(reader, cmd, offset + 3));
}

inline void writeVdpFillRectCommand(VDP& vdp, f32 x0, f32 y0, f32 x1, f32 y1, f32 priority, Layer2D layer, u32 colorWord) {
	vdp.writeVdpRegister(VDP_REG_GEOM_X0, toSignedWord(FIX16_SCALE * x0));
	vdp.writeVdpRegister(VDP_REG_GEOM_Y0, toSignedWord(FIX16_SCALE * y0));
	vdp.writeVdpRegister(VDP_REG_GEOM_X1, toSignedWord(FIX16_SCALE * x1));
	vdp.writeVdpRegister(VDP_REG_GEOM_Y1, toSignedWord(FIX16_SCALE * y1));
	vdp.writeVdpRegister(VDP_REG_DRAW_LAYER_PRIO, encodeVdpLayerPriority(layer, priority));
	vdp.writeVdpRegister(VDP_REG_DRAW_COLOR, colorWord);
	vdp.consumeDirectVdpCommand(VDP_CMD_FILL_RECT);
}

inline void writeVdpBlitCommand(VDP& vdp, u32 slot, u32 u, u32 v, u32 w, u32 h, f32 x, f32 y, f32 priority, Layer2D layer, f32 scaleX, f32 scaleY, u32 flipFlags, u32 colorWord, f32 parallaxWeight) {
	vdp.writeVdpRegister(VDP_REG_SRC_SLOT, slot);
	vdp.writeVdpRegister(VDP_REG_SRC_UV, packLowHigh16(u, v));
	vdp.writeVdpRegister(VDP_REG_SRC_WH, packLowHigh16(w, h));
	vdp.writeVdpRegister(VDP_REG_DST_X, toSignedWord(FIX16_SCALE * x));
	vdp.writeVdpRegister(VDP_REG_DST_Y, toSignedWord(FIX16_SCALE * y));
	vdp.writeVdpRegister(VDP_REG_DRAW_LAYER_PRIO, encodeVdpLayerPriority(layer, priority));
	vdp.writeVdpRegister(VDP_REG_DRAW_SCALE_X, toSignedWord(FIX16_SCALE * scaleX));
	vdp.writeVdpRegister(VDP_REG_DRAW_SCALE_Y, toSignedWord(FIX16_SCALE * scaleY));
	vdp.writeVdpRegister(VDP_REG_DRAW_CTRL, encodeVdpDrawCtrl((flipFlags & 1u) != 0u, (flipFlags & 2u) != 0u, 0u, parallaxWeight));
	vdp.writeVdpRegister(VDP_REG_DRAW_COLOR, colorWord);
	vdp.consumeDirectVdpCommand(VDP_CMD_BLIT);
}

inline u32 resolveAtlasSlotFromMemory(const Memory& memory, i32 atlasId) {
	if (atlasId == static_cast<i32>(VDP_SYSTEM_ATLAS_ID)) {
		return VDP_SLOT_SYSTEM;
	}
	const u32 atlas = static_cast<u32>(atlasId);
	if (memory.readIoU32(IO_VDP_SLOT_PRIMARY_ATLAS) == atlas) {
		return VDP_SLOT_PRIMARY;
	}
	if (memory.readIoU32(IO_VDP_SLOT_SECONDARY_ATLAS) == atlas) {
		return VDP_SLOT_SECONDARY;
	}
	throw vdpFault("atlas " + std::to_string(atlasId) + " is not loaded in a VDP slot.");
}

template<typename ArgReader, typename PayloadReader>
void processVdpCommandImpl(VDP& vdp, CPU& cpu, Api& api, uint32_t cmd, uint32_t argWords, const ArgReader& argReader, const PayloadReader& payloadReader, uint32_t payloadWords) {
	switch (cmd) {
		case IO_CMD_VDP_CLEAR: {
			assertVdpPacketArgWords(cmd, argWords);
			vdp.writeVdpRegister(VDP_REG_DRAW_COLOR, readPacketColorWord(argReader, cmd, 0));
			vdp.consumeDirectVdpCommand(VDP_CMD_CLEAR);
			break;
		}
		case IO_CMD_VDP_FILL_RECT: {
			assertVdpPacketArgWords(cmd, argWords);
			writeVdpFillRectCommand(
				vdp,
				readPacketArgF32(argReader, cmd, 0),
				readPacketArgF32(argReader, cmd, 1),
				readPacketArgF32(argReader, cmd, 2),
				readPacketArgF32(argReader, cmd, 3),
				readPacketArgF32(argReader, cmd, 4),
				static_cast<Layer2D>(readPacketArgU32(argReader, cmd, 5)),
				readPacketColorWord(argReader, cmd, 6)
			);
			break;
		}
		case IO_CMD_VDP_DRAW_LINE: {
			assertVdpPacketArgWords(cmd, argWords);
			vdp.writeVdpRegister(VDP_REG_GEOM_X0, toSignedWord(FIX16_SCALE * readPacketArgF32(argReader, cmd, 0)));
			vdp.writeVdpRegister(VDP_REG_GEOM_Y0, toSignedWord(FIX16_SCALE * readPacketArgF32(argReader, cmd, 1)));
			vdp.writeVdpRegister(VDP_REG_GEOM_X1, toSignedWord(FIX16_SCALE * readPacketArgF32(argReader, cmd, 2)));
			vdp.writeVdpRegister(VDP_REG_GEOM_Y1, toSignedWord(FIX16_SCALE * readPacketArgF32(argReader, cmd, 3)));
			vdp.writeVdpRegister(VDP_REG_DRAW_LAYER_PRIO, encodeVdpLayerPriority(static_cast<Layer2D>(readPacketArgU32(argReader, cmd, 5)), readPacketArgF32(argReader, cmd, 4)));
			vdp.writeVdpRegister(VDP_REG_DRAW_COLOR, readPacketColorWord(argReader, cmd, 6));
			vdp.writeVdpRegister(VDP_REG_LINE_WIDTH, toSignedWord(FIX16_SCALE * readPacketArgF32(argReader, cmd, 10)));
			vdp.consumeDirectVdpCommand(VDP_CMD_DRAW_LINE);
			break;
		}
		case IO_CMD_VDP_BLIT: {
			assertVdpPacketArgWords(cmd, argWords);
			const uint32_t flipFlags = readPacketArgU32(argReader, cmd, 11);
			writeVdpBlitCommand(
				vdp,
				readPacketArgU32(argReader, cmd, 0),
				readPacketArgU32(argReader, cmd, 1),
				readPacketArgU32(argReader, cmd, 2),
				readPacketArgU32(argReader, cmd, 3),
				readPacketArgU32(argReader, cmd, 4),
				readPacketArgF32(argReader, cmd, 5),
				readPacketArgF32(argReader, cmd, 6),
				readPacketArgF32(argReader, cmd, 7),
				static_cast<Layer2D>(readPacketArgU32(argReader, cmd, 8)),
				readPacketArgF32(argReader, cmd, 9),
				readPacketArgF32(argReader, cmd, 10),
				flipFlags,
				readPacketColorWord(argReader, cmd, 12),
				readPacketArgF32(argReader, cmd, 16)
			);
			break;
		}
		case IO_CMD_VDP_GLYPH_RUN: {
			assertVdpPacketArgWords(cmd, argWords);
			const std::string& text = cpu.stringPool().toString(readPacketArgU32(argReader, cmd, 0));
			const bool backgroundEnabled = readPacketArgU32(argReader, cmd, 12) != 0u;
			f32 cursorX = readPacketArgF32(argReader, cmd, 1);
			const f32 cursorY = readPacketArgF32(argReader, cmd, 2);
			const f32 priority = readPacketArgF32(argReader, cmd, 3);
			BFont* font = api.resolveFontId(readPacketArgU32(argReader, cmd, 4));
			const i32 start = readPacketArgI32(argReader, cmd, 5);
			const i32 end = readPacketArgI32(argReader, cmd, 6);
			const Layer2D layer = static_cast<Layer2D>(readPacketArgU32(argReader, cmd, 7));
			const u32 colorWord = readPacketColorWord(argReader, cmd, 8);
			const u32 backgroundColorWord = backgroundEnabled ? readPacketColorWord(argReader, cmd, 13) : 0u;
			size_t byteIndex = 0u;
			i32 glyphIndex = 0;
			while (byteIndex < text.size()) {
				const u32 codepoint = readUtf8Codepoint(text, byteIndex);
				const FontGlyph& glyph = font->getGlyph(codepoint);
				if (glyphIndex >= start && glyphIndex < end) {
					if (backgroundEnabled) {
						writeVdpFillRectCommand(vdp, cursorX, cursorY, cursorX + static_cast<f32>(glyph.rect.w), cursorY + static_cast<f32>(glyph.rect.h), priority, layer, backgroundColorWord);
					}
					writeVdpBlitCommand(vdp, resolveAtlasSlotFromMemory(cpu.memory(), glyph.rect.atlasId), glyph.rect.u, glyph.rect.v, glyph.rect.w, glyph.rect.h, cursorX, cursorY, priority, layer, 1.0f, 1.0f, 0u, colorWord, 0.0f);
				}
				cursorX += static_cast<f32>(glyph.advance);
				glyphIndex += 1;
			}
			break;
		}
		case IO_CMD_VDP_TILE_RUN: {
			assertVdpPacketArgWords(cmd, argWords);
			const uint32_t tileCount = readPacketArgU32(argReader, cmd, 0);
			const uint64_t requiredPayloadWords = static_cast<uint64_t>(tileCount) * 5u;
			if (tileCount > payloadWords / 5u) {
				throw vdpFault("tile payload underrun (" + std::to_string(requiredPayloadWords) + " > " + std::to_string(payloadWords) + ").");
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
		case IO_CMD_VDP_CONFIG_SURFACE: {
			assertVdpPacketArgWords(cmd, argWords);
			vdp.configureVramSlotSurface(
				readPacketArgU32(argReader, cmd, 0),
				readPacketArgU32(argReader, cmd, 1),
				readPacketArgU32(argReader, cmd, 2)
			);
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
