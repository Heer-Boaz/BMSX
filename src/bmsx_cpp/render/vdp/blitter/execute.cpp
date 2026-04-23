#include "render/vdp/blitter/execute.h"

#include "render/vdp/blitter/gles2.h"
#include "render/vdp/framebuffer.h"
#include <cmath>

namespace bmsx {
namespace {

constexpr u8 IMPLICIT_FRAME_CLEAR_RGBA[4] = {0u, 0u, 0u, 255u};

} // namespace

void drainReadyVdpExecution(VDP& vdp) {
	if (!vdp.m_activeFrameExecutionPending) {
		return;
	}
	if (vdp.m_activeBlitterQueue.empty()) {
		vdp.m_activeFrameExecutionPending = false;
		vdp.m_activeFrameReady = true;
		return;
	}
	executeVdpBlitterQueue(vdp, vdp.m_activeBlitterQueue);
	vdp.m_activeFrameExecutionPending = false;
	vdp.m_activeFrameReady = true;
}

void executeVdpBlitterQueue(VDP& vdp, const std::vector<VDP::BlitterCommand>& queue) {
	if (queue.empty()) {
		return;
	}
#if BMSX_ENABLE_GLES2
	if (VdpGles2Blitter::execute(vdp, queue)) {
		return;
	}
#endif
	vdp.resetFrameBufferPriority();
	auto& pixels = vdp.getVramSlotByTextureKey(FRAMEBUFFER_RENDER_TEXTURE_KEY).cpuReadback;
	if (queue.front().type != VDP::BlitterCommandType::Clear) {
		for (size_t index = 0; index < pixels.size(); index += 4u) {
			pixels[index + 0u] = IMPLICIT_FRAME_CLEAR_RGBA[0];
			pixels[index + 1u] = IMPLICIT_FRAME_CLEAR_RGBA[1];
			pixels[index + 2u] = IMPLICIT_FRAME_CLEAR_RGBA[2];
			pixels[index + 3u] = IMPLICIT_FRAME_CLEAR_RGBA[3];
		}
	}
	for (const auto& command : queue) {
		switch (command.type) {
			case VDP::BlitterCommandType::Clear:
				for (size_t index = 0; index < pixels.size(); index += 4u) {
					pixels[index + 0u] = command.color.r;
					pixels[index + 1u] = command.color.g;
					pixels[index + 2u] = command.color.b;
					pixels[index + 3u] = command.color.a;
				}
				vdp.resetFrameBufferPriority();
				break;
			case VDP::BlitterCommandType::FillRect:
				vdp.rasterizeFrameBufferFill(pixels, command.x0, command.y0, command.x1, command.y1, command.color, command.layer, command.z, command.seq);
				break;
			case VDP::BlitterCommandType::DrawLine:
				vdp.rasterizeFrameBufferLine(pixels, command.x0, command.y0, command.x1, command.y1, command.thickness, command.color, command.layer, command.z, command.seq);
				break;
			case VDP::BlitterCommandType::Blit:
				vdp.rasterizeFrameBufferBlit(pixels, command.source, command.dstX, command.dstY, command.scaleX, command.scaleY, command.flipH, command.flipV, command.color, command.layer, command.z, command.seq);
				break;
			case VDP::BlitterCommandType::CopyRect:
				vdp.copyFrameBufferRect(pixels, command.srcX, command.srcY, command.width, command.height, static_cast<i32>(std::round(command.dstX)), static_cast<i32>(std::round(command.dstY)), command.layer, command.z, command.seq);
				break;
			case VDP::BlitterCommandType::GlyphRun:
				if (command.backgroundColor.has_value()) {
					for (const auto& glyph : command.glyphs) {
						vdp.rasterizeFrameBufferFill(
							pixels,
							glyph.dstX,
							glyph.dstY,
							glyph.dstX + static_cast<f32>(glyph.advance),
							glyph.dstY + static_cast<f32>(command.lineHeight),
							*command.backgroundColor,
							command.layer,
							command.z,
							command.seq
						);
					}
				}
				for (const auto& glyph : command.glyphs) {
					vdp.rasterizeFrameBufferBlit(pixels, glyph, glyph.dstX, glyph.dstY, 1.0f, 1.0f, false, false, command.color, command.layer, command.z, command.seq);
				}
				break;
			case VDP::BlitterCommandType::TileRun:
				for (const auto& tile : command.tiles) {
					vdp.rasterizeFrameBufferBlit(pixels, tile, tile.dstX, tile.dstY, 1.0f, 1.0f, false, false, VDP::FrameBufferColor{255u, 255u, 255u, 255u}, command.layer, command.z, command.seq);
				}
				break;
		}
	}
	updateVdpRenderFrameBufferTexture(pixels.data(), vdp.m_frameBufferWidth, vdp.m_frameBufferHeight);
	vdp.invalidateReadCache(VDP_RD_SURFACE_FRAMEBUFFER);
}

} // namespace bmsx
