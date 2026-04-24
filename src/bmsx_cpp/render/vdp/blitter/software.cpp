#include "render/vdp/blitter/software.h"

#include "render/vdp/framebuffer.h"
#include "render/vdp/source_pixels.h"
#include <algorithm>
#include <cmath>
#include <cstring>
#include <limits>

namespace bmsx {
namespace {

constexpr u8 IMPLICIT_FRAME_CLEAR_RGBA[4] = {0u, 0u, 0u, 255u};
constexpr VDP::FrameBufferColor BLITTER_WHITE{255u, 255u, 255u, 255u};

struct VdpSoftwareRuntime {
	u32 width = 0;
	u32 height = 0;
	std::vector<u8> priorityLayer;
	std::vector<f32> priorityZ;
	std::vector<u32> prioritySeq;
};

VdpSoftwareRuntime g_vdpSoftwareRuntime{};

void resizeVdpSoftwareRuntime(u32 width, u32 height) {
	if (g_vdpSoftwareRuntime.width == width && g_vdpSoftwareRuntime.height == height) {
		return;
	}
	g_vdpSoftwareRuntime.width = width;
	g_vdpSoftwareRuntime.height = height;
	const size_t pixelCount = static_cast<size_t>(width) * static_cast<size_t>(height);
	g_vdpSoftwareRuntime.priorityLayer.resize(pixelCount);
	g_vdpSoftwareRuntime.priorityZ.resize(pixelCount);
	g_vdpSoftwareRuntime.prioritySeq.resize(pixelCount);
}

} // namespace

// start hot-path -- software blitter rasterization runs in the frame execution path when GLES2 is unavailable.
// start numeric-sanitization-acceptable -- software rasterization owns clipping, rounding, and pixel-boundary math for submitted draw commands.
void VdpSoftwareBlitter::execute(VDP& vdp, const std::vector<VDP::BlitterCommand>& queue) {
	if (queue.empty()) {
		return;
	}
	const u32 frameBufferWidth = vdp.frameBufferWidth();
	const u32 frameBufferHeight = vdp.frameBufferHeight();
	resizeVdpSoftwareRuntime(frameBufferWidth, frameBufferHeight);
	resetFrameBufferPriority();
	auto& pixels = vdp.frameBufferRenderReadback();
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
				resetFrameBufferPriority();
				break;
			case VDP::BlitterCommandType::FillRect:
				rasterizeFrameBufferFill(vdp, pixels, command.x0, command.y0, command.x1, command.y1, command.color, command.layer, command.z, command.seq);
				break;
			case VDP::BlitterCommandType::DrawLine:
				rasterizeFrameBufferLine(vdp, pixels, command.x0, command.y0, command.x1, command.y1, command.thickness, command.color, command.layer, command.z, command.seq);
				break;
			case VDP::BlitterCommandType::Blit:
				rasterizeFrameBufferBlit(vdp, pixels, command.source, command.dstX, command.dstY, command.scaleX, command.scaleY, command.flipH, command.flipV, command.color, command.layer, command.z, command.seq);
				break;
			case VDP::BlitterCommandType::CopyRect:
				copyFrameBufferRect(vdp, pixels, command.srcX, command.srcY, command.width, command.height, static_cast<i32>(std::round(command.dstX)), static_cast<i32>(std::round(command.dstY)), command.layer, command.z, command.seq);
				break;
			case VDP::BlitterCommandType::GlyphRun:
				if (command.backgroundColor.has_value()) {
					for (const auto& glyph : command.glyphs) {
						rasterizeFrameBufferFill(
							vdp,
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
					rasterizeFrameBufferBlit(vdp, pixels, glyph, glyph.dstX, glyph.dstY, 1.0f, 1.0f, false, false, command.color, command.layer, command.z, command.seq);
				}
				break;
			case VDP::BlitterCommandType::TileRun:
				for (const auto& tile : command.tiles) {
					rasterizeFrameBufferBlit(vdp, pixels, tile, tile.dstX, tile.dstY, 1.0f, 1.0f, false, false, BLITTER_WHITE, command.layer, command.z, command.seq);
				}
				break;
		}
	}
	uploadVdpFrameBufferPixels(pixels.data(), frameBufferWidth, frameBufferHeight);
	vdp.clearSurfaceUploadDirty(VDP_RD_SURFACE_FRAMEBUFFER);
	vdp.invalidateFrameBufferReadCache();
}

void VdpSoftwareBlitter::resetFrameBufferPriority() {
	std::fill(g_vdpSoftwareRuntime.priorityLayer.begin(), g_vdpSoftwareRuntime.priorityLayer.end(), static_cast<u8>(Layer2D::World));
	std::fill(g_vdpSoftwareRuntime.priorityZ.begin(), g_vdpSoftwareRuntime.priorityZ.end(), -std::numeric_limits<f32>::infinity());
	std::fill(g_vdpSoftwareRuntime.prioritySeq.begin(), g_vdpSoftwareRuntime.prioritySeq.end(), 0u);
}

void VdpSoftwareBlitter::blendFrameBufferPixel(std::vector<u8>& pixels, size_t index, u8 r, u8 g, u8 b, u8 a, Layer2D layer, f32 z, u32 seq) {
	if (a == 0u) {
		return;
	}
	const size_t pixelIndex = index >> 2u;
	const auto currentLayer = static_cast<Layer2D>(g_vdpSoftwareRuntime.priorityLayer[pixelIndex]);
	if (layer < currentLayer) {
		return;
	}
	if (layer == currentLayer) {
		const f32 currentZ = g_vdpSoftwareRuntime.priorityZ[pixelIndex];
		if (z < currentZ) {
			return;
		}
		if (z == currentZ && seq < g_vdpSoftwareRuntime.prioritySeq[pixelIndex]) {
			return;
		}
	}
	if (a == 255u) {
		pixels[index + 0u] = r;
		pixels[index + 1u] = g;
		pixels[index + 2u] = b;
		pixels[index + 3u] = 255u;
		g_vdpSoftwareRuntime.priorityLayer[pixelIndex] = static_cast<u8>(layer);
		g_vdpSoftwareRuntime.priorityZ[pixelIndex] = z;
		g_vdpSoftwareRuntime.prioritySeq[pixelIndex] = seq;
		return;
	}
	const u32 inverse = 255u - a;
	pixels[index + 0u] = static_cast<u8>(((static_cast<u32>(r) * a) + (static_cast<u32>(pixels[index + 0u]) * inverse) + 127u) / 255u);
	pixels[index + 1u] = static_cast<u8>(((static_cast<u32>(g) * a) + (static_cast<u32>(pixels[index + 1u]) * inverse) + 127u) / 255u);
	pixels[index + 2u] = static_cast<u8>(((static_cast<u32>(b) * a) + (static_cast<u32>(pixels[index + 2u]) * inverse) + 127u) / 255u);
	pixels[index + 3u] = static_cast<u8>(a + ((static_cast<u32>(pixels[index + 3u]) * inverse) + 127u) / 255u);
	g_vdpSoftwareRuntime.priorityLayer[pixelIndex] = static_cast<u8>(layer);
	g_vdpSoftwareRuntime.priorityZ[pixelIndex] = z;
	g_vdpSoftwareRuntime.prioritySeq[pixelIndex] = seq;
}

void VdpSoftwareBlitter::rasterizeFrameBufferFill(VDP& vdp, std::vector<u8>& pixels, f32 x0, f32 y0, f32 x1, f32 y1, const VDP::FrameBufferColor& color, Layer2D layer, f32 z, u32 seq) {
	const i32 frameBufferWidth = static_cast<i32>(vdp.frameBufferWidth());
	const i32 frameBufferHeight = static_cast<i32>(vdp.frameBufferHeight());
	i32 left = static_cast<i32>(std::round(x0));
	i32 top = static_cast<i32>(std::round(y0));
	i32 right = static_cast<i32>(std::round(x1));
	i32 bottom = static_cast<i32>(std::round(y1));
	if (right < left) {
		std::swap(left, right);
	}
	if (bottom < top) {
		std::swap(top, bottom);
	}
	left = std::max(0, left);
	top = std::max(0, top);
	right = std::min(frameBufferWidth, right);
	bottom = std::min(frameBufferHeight, bottom);
	for (i32 y = top; y < bottom; ++y) {
		size_t index = (static_cast<size_t>(y) * static_cast<size_t>(frameBufferWidth) + static_cast<size_t>(left)) * 4u;
		for (i32 x = left; x < right; ++x) {
			blendFrameBufferPixel(pixels, index, color.r, color.g, color.b, color.a, layer, z, seq);
			index += 4u;
		}
	}
}

void VdpSoftwareBlitter::rasterizeFrameBufferLine(VDP& vdp, std::vector<u8>& pixels, f32 x0, f32 y0, f32 x1, f32 y1, f32 thicknessValue, const VDP::FrameBufferColor& color, Layer2D layer, f32 z, u32 seq) {
	const i32 frameBufferWidth = static_cast<i32>(vdp.frameBufferWidth());
	const i32 frameBufferHeight = static_cast<i32>(vdp.frameBufferHeight());
	i32 currentX = static_cast<i32>(std::round(x0));
	i32 currentY = static_cast<i32>(std::round(y0));
	const i32 targetX = static_cast<i32>(std::round(x1));
	const i32 targetY = static_cast<i32>(std::round(y1));
	const i32 dx = std::abs(targetX - currentX);
	const i32 dy = std::abs(targetY - currentY);
	const i32 sx = currentX < targetX ? 1 : -1;
	const i32 sy = currentY < targetY ? 1 : -1;
	i32 err = dx - dy;
	const i32 thickness = std::max(1, static_cast<i32>(std::round(thicknessValue)));
	while (true) {
		const i32 half = thickness >> 1;
		for (i32 yy = currentY - half; yy < currentY - half + thickness; ++yy) {
			if (yy < 0 || yy >= frameBufferHeight) {
				continue;
			}
			for (i32 xx = currentX - half; xx < currentX - half + thickness; ++xx) {
				if (xx < 0 || xx >= frameBufferWidth) {
					continue;
				}
				const size_t index = (static_cast<size_t>(yy) * static_cast<size_t>(frameBufferWidth) + static_cast<size_t>(xx)) * 4u;
				blendFrameBufferPixel(pixels, index, color.r, color.g, color.b, color.a, layer, z, seq);
			}
		}
		if (currentX == targetX && currentY == targetY) {
			return;
		}
		const i32 e2 = err << 1;
		if (e2 > -dy) {
			err -= dy;
			currentX += sx;
		}
		if (e2 < dx) {
			err += dx;
			currentY += sy;
		}
	}
}

void VdpSoftwareBlitter::rasterizeFrameBufferBlit(VDP& vdp, std::vector<u8>& pixels, const VDP::BlitterSource& source, f32 dstXValue, f32 dstYValue, f32 scaleX, f32 scaleY, bool flipH, bool flipV, const VDP::FrameBufferColor& color, Layer2D layer, f32 z, u32 seq) {
	const i32 frameBufferWidth = static_cast<i32>(vdp.frameBufferWidth());
	const i32 frameBufferHeight = static_cast<i32>(vdp.frameBufferHeight());
	const VdpSourcePixels sourcePixels = resolveVdpSourcePixels(vdp, source);
	const i32 dstW = std::max(1, static_cast<i32>(std::round(static_cast<f32>(source.width) * scaleX)));
	const i32 dstH = std::max(1, static_cast<i32>(std::round(static_cast<f32>(source.height) * scaleY)));
	const i32 dstX = static_cast<i32>(std::round(dstXValue));
	const i32 dstY = static_cast<i32>(std::round(dstYValue));
	for (i32 y = 0; y < dstH; ++y) {
		const i32 targetY = dstY + y;
		if (targetY < 0 || targetY >= frameBufferHeight) {
			continue;
		}
		const i32 srcY = flipV
			? static_cast<i32>(source.height) - 1 - ((y * static_cast<i32>(source.height)) / dstH)
			: ((y * static_cast<i32>(source.height)) / dstH);
		for (i32 x = 0; x < dstW; ++x) {
			const i32 targetX = dstX + x;
			if (targetX < 0 || targetX >= frameBufferWidth) {
				continue;
			}
			const i32 srcX = flipH
				? static_cast<i32>(source.width) - 1 - ((x * static_cast<i32>(source.width)) / dstW)
				: ((x * static_cast<i32>(source.width)) / dstW);
			const size_t srcIndex = (static_cast<size_t>(source.srcY + static_cast<uint32_t>(srcY)) * static_cast<size_t>(sourcePixels.stride))
				+ (static_cast<size_t>(source.srcX + static_cast<uint32_t>(srcX)) * 4u);
			const u8 srcA = sourcePixels.pixels[srcIndex + 3u];
			if (srcA == 0u) {
				continue;
			}
			const u8 outA = static_cast<u8>((static_cast<u32>(srcA) * static_cast<u32>(color.a) + 127u) / 255u);
			const u8 outR = static_cast<u8>((static_cast<u32>(sourcePixels.pixels[srcIndex + 0u]) * static_cast<u32>(color.r) + 127u) / 255u);
			const u8 outG = static_cast<u8>((static_cast<u32>(sourcePixels.pixels[srcIndex + 1u]) * static_cast<u32>(color.g) + 127u) / 255u);
			const u8 outB = static_cast<u8>((static_cast<u32>(sourcePixels.pixels[srcIndex + 2u]) * static_cast<u32>(color.b) + 127u) / 255u);
			const size_t dstIndex = (static_cast<size_t>(targetY) * static_cast<size_t>(frameBufferWidth) + static_cast<size_t>(targetX)) * 4u;
			blendFrameBufferPixel(pixels, dstIndex, outR, outG, outB, outA, layer, z, seq);
		}
	}
}

void VdpSoftwareBlitter::copyFrameBufferRect(VDP& vdp, std::vector<u8>& pixels, i32 srcX, i32 srcY, i32 width, i32 height, i32 dstX, i32 dstY, Layer2D layer, f32 z, u32 seq) {
	const size_t frameBufferWidth = static_cast<size_t>(vdp.frameBufferWidth());
	const size_t rowBytes = static_cast<size_t>(width) * 4u;
	const bool overlapping =
		dstX < srcX + width
		&& dstX + width > srcX
		&& dstY < srcY + height
		&& dstY + height > srcY;
	const i32 startRow = overlapping && dstY > srcY ? height - 1 : 0;
	const i32 endRow = overlapping && dstY > srcY ? -1 : height;
	const i32 step = overlapping && dstY > srcY ? -1 : 1;
	for (i32 row = startRow; row != endRow; row += step) {
		const size_t sourceIndex = (static_cast<size_t>(srcY + row) * frameBufferWidth + static_cast<size_t>(srcX)) * 4u;
		const size_t targetIndex = (static_cast<size_t>(dstY + row) * frameBufferWidth + static_cast<size_t>(dstX)) * 4u;
		std::memmove(pixels.data() + targetIndex, pixels.data() + sourceIndex, rowBytes);
		const size_t targetPixel = (static_cast<size_t>(dstY + row) * frameBufferWidth) + static_cast<size_t>(dstX);
		for (i32 col = 0; col < width; ++col) {
			const size_t pixelIndex = targetPixel + static_cast<size_t>(col);
			g_vdpSoftwareRuntime.priorityLayer[pixelIndex] = static_cast<u8>(layer);
			g_vdpSoftwareRuntime.priorityZ[pixelIndex] = z;
			g_vdpSoftwareRuntime.prioritySeq[pixelIndex] = seq;
		}
	}
}
// end numeric-sanitization-acceptable
// end hot-path

} // namespace bmsx
