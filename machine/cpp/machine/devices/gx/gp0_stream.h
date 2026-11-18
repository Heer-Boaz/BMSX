#pragma once

#include "common/compiler.h"
#include "spec/gx/gp0.h"
#include <algorithm>

namespace bmsx {

enum class Gp0WordAdmission : u8 { Blocked, Queued, Filtered };

constexpr bool gxGpuGp0OpcodeIsNop(u32 opcode) {
	return opcode == 0x00u
		|| (opcode >= 0x04u && opcode <= 0x1eu)
		|| opcode == 0xe0u
		|| (opcode >= 0xe7u && opcode <= 0xefu);
}

constexpr u32 GX_GPU_GP0_INGRESS_COMMAND = 0u;
constexpr u32 GX_GPU_GP0_INGRESS_FIXED = 1u;
constexpr u32 GX_GPU_GP0_INGRESS_IMAGE_HEADER = 2u;
constexpr u32 GX_GPU_GP0_INGRESS_IMAGE_PAYLOAD = 3u;
constexpr u32 GX_GPU_GP0_INGRESS_POLYLINE_HEADER = 4u;
constexpr u32 GX_GPU_GP0_INGRESS_POLYLINE_PAYLOAD = 5u;

inline u32 gp0LineWordCount(u32 opcode) {
	return (opcode & GX_GPU_GP0_RENDER_GOURAUD_BIT) != 0u ? 4u : 3u;
}

inline u32 gp0CommandWordCountForOpcode(u32 opcode) {
	if (opcode == GX_GPU_GP0_FILL_RECTANGLE) return 3u;
	if (opcode >= GX_GPU_GP0_POLYGON_FIRST && opcode <= GX_GPU_GP0_POLYGON_LAST) {
		const u32 wordsPerVertex = 1u + ((opcode & GX_GPU_GP0_RENDER_TEXTURE_BIT) >> 2u) + ((opcode & GX_GPU_GP0_RENDER_GOURAUD_BIT) >> 4u);
		const u32 vertices = (opcode & GX_GPU_GP0_RENDER_QUAD_OR_POLYLINE_BIT) != 0u ? 4u : 3u;
		return wordsPerVertex * vertices + ((opcode & GX_GPU_GP0_RENDER_GOURAUD_BIT) != 0u ? 0u : 1u);
	}
	if (opcode >= GX_GPU_GP0_LINE_FIRST && opcode <= GX_GPU_GP0_LINE_LAST) return gp0LineWordCount(opcode);
	if (opcode >= GX_GPU_GP0_RECTANGLE_FIRST && opcode <= GX_GPU_GP0_RECTANGLE_LAST) {
		return 2u + ((opcode & GX_GPU_GP0_RENDER_TEXTURE_BIT) >> 2u) + ((opcode & GX_GPU_GP0_RECTANGLE_SIZE_MASK) == 0u ? 1u : 0u);
	}
	if (opcode >= GX_GPU_GP0_VRAM_TO_VRAM_FIRST && opcode <= GX_GPU_GP0_VRAM_TO_VRAM_LAST) return 4u;
	if (opcode >= GX_GPU_GP0_CPU_TO_VRAM_FIRST && opcode <= GX_GPU_GP0_VRAM_TO_CPU_LAST) return 3u;
	return 1u;
}

constexpr u32 GP0_STREAM_IRQ = 1u;
constexpr u32 GP0_STREAM_READBACK = 2u;

struct Gp0StreamCursor {
	u32 phase = GX_GPU_GP0_INGRESS_COMMAND;
	u32 wordsRemaining = 0u;
	u32 polylineWordsPerVertex = 0u;
	u32 polylinePayloadPhase = 0u;

	u32 skipPayloadWords(u32 limit) {
		if (phase != GX_GPU_GP0_INGRESS_FIXED && phase != GX_GPU_GP0_INGRESS_IMAGE_PAYLOAD) return 0u;
		const u32 count = std::min(limit, wordsRemaining);
		wordsRemaining -= count;
		if (wordsRemaining == 0u) phase = GX_GPU_GP0_INGRESS_COMMAND;
		return count;
	}

	u32 advance(u32 word) {
		u32 boundary = 0u;
		switch (phase) {
		case GX_GPU_GP0_INGRESS_COMMAND: {
			const u32 opcode = word >> GX_GPU_GP0_OPCODE_SHIFT;
			if (opcode == GX_GPU_GP0_IRQ_REQUEST) boundary = GP0_STREAM_IRQ;
			else if (opcode >= GX_GPU_GP0_VRAM_TO_CPU_FIRST && opcode <= GX_GPU_GP0_VRAM_TO_CPU_LAST) boundary = GP0_STREAM_READBACK;
			if (opcode >= GX_GPU_GP0_CPU_TO_VRAM_FIRST && opcode <= GX_GPU_GP0_CPU_TO_VRAM_LAST) {
				phase = GX_GPU_GP0_INGRESS_IMAGE_HEADER;
				wordsRemaining = 2u;
			} else if (opcode >= GX_GPU_GP0_LINE_FIRST && opcode <= GX_GPU_GP0_LINE_LAST && (opcode & GX_GPU_GP0_RENDER_QUAD_OR_POLYLINE_BIT) != 0u) {
				phase = GX_GPU_GP0_INGRESS_POLYLINE_HEADER;
				wordsRemaining = gp0LineWordCount(opcode) - 1u;
				polylineWordsPerVertex = (opcode & GX_GPU_GP0_RENDER_GOURAUD_BIT) != 0u ? 2u : 1u;
				polylinePayloadPhase = 0u;
			} else {
				wordsRemaining = gp0CommandWordCountForOpcode(opcode) - 1u;
				if (wordsRemaining != 0u) phase = GX_GPU_GP0_INGRESS_FIXED;
			}
			break;
		}
		case GX_GPU_GP0_INGRESS_FIXED:
			if (--wordsRemaining == 0u) phase = GX_GPU_GP0_INGRESS_COMMAND;
			break;
		case GX_GPU_GP0_INGRESS_IMAGE_HEADER:
			if (--wordsRemaining == 0u) {
				phase = GX_GPU_GP0_INGRESS_IMAGE_PAYLOAD;
				wordsRemaining = ((gxGpuTransferWidth(word) * gxGpuTransferHeight(word)) + 1u) >> 1u;
			}
			break;
		case GX_GPU_GP0_INGRESS_IMAGE_PAYLOAD:
			if (--wordsRemaining == 0u) phase = GX_GPU_GP0_INGRESS_COMMAND;
			break;
		case GX_GPU_GP0_INGRESS_POLYLINE_HEADER:
			if (--wordsRemaining == 0u) phase = GX_GPU_GP0_INGRESS_POLYLINE_PAYLOAD;
			break;
		case GX_GPU_GP0_INGRESS_POLYLINE_PAYLOAD:
			if (polylinePayloadPhase == 0u && (word & 0xf000f000u) == 0x50005000u) {
				phase = GX_GPU_GP0_INGRESS_COMMAND;
				polylineWordsPerVertex = 0u;
				polylinePayloadPhase = 0u;
			} else if (++polylinePayloadPhase == polylineWordsPerVertex) {
				polylinePayloadPhase = 0u;
			}
			break;
		default:
			BMSX_UNREACHABLE();
		}
		return boundary;
	}
};

} // namespace bmsx
