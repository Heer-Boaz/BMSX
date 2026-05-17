#include "render/backend/software/vdp_framebuffer_rasterizer.h"

#include "machine/devices/vdp/vdp.h"
#include <algorithm>
#include <limits>
#include <utility>

namespace bmsx {
namespace {

constexpr VdpFrameBufferColor VDP_BLITTER_IMPLICIT_CLEAR_COLOR{0u, 0u, 0u, 255u};

} // namespace

VdpFrameBufferRasterizer::VdpFrameBufferRasterizer(VDP& vdp)
	: m_vdp(vdp) {}

void VdpFrameBufferRasterizer::executeFrameBufferCommands(const VdpBlitterCommand& commands, u32 frameWidth, u32 frameHeight, std::vector<u8>& pixels) {
	if (commands.length == 0u) {
		return;
	}
	resizeFrameBufferPriorityStorage(static_cast<size_t>(frameWidth) * static_cast<size_t>(frameHeight));
	if (commands.opcode[0] != VdpBlitterCommandType::Clear) {
		fillFrameBuffer(pixels, VDP_BLITTER_IMPLICIT_CLEAR_COLOR);
	}
	resetFrameBufferPriority();
	for (size_t index = 0u; index < commands.length; ++index) {
		const VdpBlitterCommandType opcode = commands.opcode[index];
		if (opcode == VdpBlitterCommandType::Clear) {
			fillFrameBuffer(pixels, unpackArgbColor(commands.color[index]));
			resetFrameBufferPriority();
			continue;
		}
		const Layer2D layer = commands.layer[index];
		const f32 priority = commands.priority[index];
		const u32 sequence = commands.seq[index];
		const VdpFrameBufferColor color = unpackArgbColor(commands.color[index]);
		switch (opcode) {
			case VdpBlitterCommandType::FillRect:
				rasterizeFrameBufferFill(pixels, frameWidth, frameHeight, commands.x0[index], commands.y0[index], commands.x1[index], commands.y1[index], color, layer, priority, sequence);
				break;
			case VdpBlitterCommandType::DrawLine:
				rasterizeFrameBufferLine(pixels, frameWidth, frameHeight, commands.x0[index], commands.y0[index], commands.x1[index], commands.y1[index], commands.thickness[index], color, layer, priority, sequence);
				break;
			case VdpBlitterCommandType::Blit:
				m_latchedSourceScratch.surfaceId = commands.sourceSurfaceId[index];
				m_latchedSourceScratch.srcX = commands.sourceSrcX[index];
				m_latchedSourceScratch.srcY = commands.sourceSrcY[index];
				m_latchedSourceScratch.width = commands.sourceWidth[index];
				m_latchedSourceScratch.height = commands.sourceHeight[index];
				rasterizeFrameBufferBlit(pixels, frameWidth, frameHeight, m_latchedSourceScratch, commands.dstX[index], commands.dstY[index], commands.width[index], commands.height[index], commands.flipH[index] != 0u, commands.flipV[index] != 0u, color, layer, priority, sequence);
				break;
			case VdpBlitterCommandType::BatchBlit: {
				const size_t firstItem = commands.batchBlitFirstEntry[index];
				const size_t itemEnd = firstItem + commands.batchBlitItemCount[index];
				if (commands.hasBackgroundColor[index] != 0u) {
					const VdpFrameBufferColor background = unpackArgbColor(commands.backgroundColor[index]);
					for (size_t itemIndex = firstItem; itemIndex < itemEnd; ++itemIndex) {
						rasterizeFrameBufferFill(
							pixels,
							frameWidth,
							frameHeight,
							commands.batchBlitDstX[itemIndex],
							commands.batchBlitDstY[itemIndex],
							commands.batchBlitDstX[itemIndex] + static_cast<i32>(commands.batchBlitAdvance[itemIndex]),
							commands.batchBlitDstY[itemIndex] + static_cast<i32>(commands.lineHeight[index]),
							background,
							layer,
							priority,
							sequence
						);
					}
				}
				for (size_t itemIndex = firstItem; itemIndex < itemEnd; ++itemIndex) {
					m_latchedSourceScratch.surfaceId = commands.batchBlitSurfaceId[itemIndex];
					m_latchedSourceScratch.srcX = commands.batchBlitSrcX[itemIndex];
					m_latchedSourceScratch.srcY = commands.batchBlitSrcY[itemIndex];
					m_latchedSourceScratch.width = commands.batchBlitWidth[itemIndex];
					m_latchedSourceScratch.height = commands.batchBlitHeight[itemIndex];
					rasterizeFrameBufferBlit(pixels, frameWidth, frameHeight, m_latchedSourceScratch, commands.batchBlitDstX[itemIndex], commands.batchBlitDstY[itemIndex], static_cast<i32>(commands.batchBlitWidth[itemIndex]), static_cast<i32>(commands.batchBlitHeight[itemIndex]), false, false, color, layer, priority, sequence);
				}
				break;
			}
			case VdpBlitterCommandType::Clear:
				break;
		}
	}
}

void VdpFrameBufferRasterizer::resizeFrameBufferPriorityStorage(size_t pixelCount) {
	if (m_frameBufferPriorityLayer.size() == pixelCount) {
		return;
	}
	m_frameBufferPriorityLayer.resize(pixelCount);
	m_frameBufferPriorityZ.resize(pixelCount);
	m_frameBufferPrioritySeq.resize(pixelCount);
}

void VdpFrameBufferRasterizer::resetFrameBufferPriority() {
	std::fill(m_frameBufferPriorityLayer.begin(), m_frameBufferPriorityLayer.end(), static_cast<u8>(Layer2D::World));
	std::fill(m_frameBufferPriorityZ.begin(), m_frameBufferPriorityZ.end(), -std::numeric_limits<f32>::infinity());
	std::fill(m_frameBufferPrioritySeq.begin(), m_frameBufferPrioritySeq.end(), 0u);
}

void VdpFrameBufferRasterizer::fillFrameBuffer(std::vector<u8>& pixels, const VdpFrameBufferColor& color) {
	for (size_t index = 0u; index < pixels.size(); index += 4u) {
		pixels[index + 0u] = color.r;
		pixels[index + 1u] = color.g;
		pixels[index + 2u] = color.b;
		pixels[index + 3u] = color.a;
	}
}

void VdpFrameBufferRasterizer::blendFrameBufferPixel(std::vector<u8>& pixels, size_t pixelIndex, u8 r, u8 g, u8 b, u8 a, Layer2D layer, f32 priority, u32 seq) {
	if (a == 0u) {
		return;
	}
	const auto currentLayer = static_cast<Layer2D>(m_frameBufferPriorityLayer[pixelIndex]);
	if (layer < currentLayer) {
		return;
	}
	if (layer == currentLayer) {
		const f32 currentPriority = m_frameBufferPriorityZ[pixelIndex];
		if (priority < currentPriority) {
			return;
		}
		if (priority == currentPriority && seq < m_frameBufferPrioritySeq[pixelIndex]) {
			return;
		}
	}
	const size_t byteIndex = pixelIndex * 4u;
	if (a == 255u) {
		pixels[byteIndex + 0u] = r;
		pixels[byteIndex + 1u] = g;
		pixels[byteIndex + 2u] = b;
		pixels[byteIndex + 3u] = 255u;
		m_frameBufferPriorityLayer[pixelIndex] = static_cast<u8>(layer);
		m_frameBufferPriorityZ[pixelIndex] = priority;
		m_frameBufferPrioritySeq[pixelIndex] = seq;
		return;
	}
	const u32 inverse = 255u - a;
	const u32 dstR = pixels[byteIndex + 0u];
	const u32 dstG = pixels[byteIndex + 1u];
	const u32 dstB = pixels[byteIndex + 2u];
	const u32 dstA = pixels[byteIndex + 3u];
	pixels[byteIndex + 0u] = static_cast<u8>(((static_cast<u32>(r) * a) + (dstR * inverse) + 127u) / 255u);
	pixels[byteIndex + 1u] = static_cast<u8>(((static_cast<u32>(g) * a) + (dstG * inverse) + 127u) / 255u);
	pixels[byteIndex + 2u] = static_cast<u8>(((static_cast<u32>(b) * a) + (dstB * inverse) + 127u) / 255u);
	pixels[byteIndex + 3u] = static_cast<u8>(a + ((dstA * inverse) + 127u) / 255u);
	m_frameBufferPriorityLayer[pixelIndex] = static_cast<u8>(layer);
	m_frameBufferPriorityZ[pixelIndex] = priority;
	m_frameBufferPrioritySeq[pixelIndex] = seq;
}

void VdpFrameBufferRasterizer::rasterizeFrameBufferFill(std::vector<u8>& pixels, u32 frameWidth, u32 frameHeight, i32 x0, i32 y0, i32 x1, i32 y1, const VdpFrameBufferColor& color, Layer2D layer, f32 priority, u32 seq) {
	const i32 frameBufferWidth = static_cast<i32>(frameWidth);
	const i32 frameBufferHeight = static_cast<i32>(frameHeight);
	i32 left = x0;
	i32 top = y0;
	i32 right = x1;
	i32 bottom = y1;
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
		size_t index = static_cast<size_t>(y) * static_cast<size_t>(frameBufferWidth) + static_cast<size_t>(left);
		for (i32 x = left; x < right; ++x) {
			blendFrameBufferPixel(pixels, index, color.r, color.g, color.b, color.a, layer, priority, seq);
			index += 1u;
		}
	}
}

void VdpFrameBufferRasterizer::rasterizeFrameBufferLine(std::vector<u8>& pixels, u32 frameWidth, u32 frameHeight, i32 x0, i32 y0, i32 x1, i32 y1, i32 thicknessValue, const VdpFrameBufferColor& color, Layer2D layer, f32 priority, u32 seq) {
	const i32 frameBufferWidth = static_cast<i32>(frameWidth);
	const i32 frameBufferHeight = static_cast<i32>(frameHeight);
	i32 currentX = x0;
	i32 currentY = y0;
	const i32 targetX = x1;
	const i32 targetY = y1;
	const i32 dx = targetX >= currentX ? targetX - currentX : currentX - targetX;
	const i32 dy = targetY >= currentY ? targetY - currentY : currentY - targetY;
	const i32 sx = currentX < targetX ? 1 : -1;
	const i32 sy = currentY < targetY ? 1 : -1;
	i32 err = dx - dy;
	const i32 thickness = thicknessValue;
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
				const size_t index = static_cast<size_t>(yy) * static_cast<size_t>(frameBufferWidth) + static_cast<size_t>(xx);
				blendFrameBufferPixel(pixels, index, color.r, color.g, color.b, color.a, layer, priority, seq);
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

void VdpFrameBufferRasterizer::rasterizeFrameBufferBlit(std::vector<u8>& pixels, u32 frameWidth, u32 frameHeight, const VdpBlitterSource& source, i32 dstX, i32 dstY, i32 dstW, i32 dstH, bool flipH, bool flipV, const VdpFrameBufferColor& color, Layer2D layer, f32 priority, u32 seq) {
	const i32 frameBufferWidth = static_cast<i32>(frameWidth);
	const i32 frameBufferHeight = static_cast<i32>(frameHeight);
	const VdpSurfaceUploadSlot* sourceSlot = m_vdp.resolveFrameBufferExecutionSource(source.surfaceId);
	if (sourceSlot == nullptr) {
		return;
	}
	const auto& sourcePixels = sourceSlot->cpuReadback;
	const size_t sourceStride = static_cast<size_t>(sourceSlot->surfaceWidth) * 4u;
	const i32 sourceWidth = static_cast<i32>(source.width);
	const i32 sourceHeight = static_cast<i32>(source.height);
	i32 srcY = 0;
	i32 srcYRemainder = 0;
	for (i32 y = 0; y < dstH; ++y) {
		const i32 targetY = dstY + y;
		if (targetY >= 0 && targetY < frameBufferHeight) {
			const i32 sampleSourceY = flipV ? sourceHeight - 1 - srcY : srcY;
			i32 srcX = 0;
			i32 srcXRemainder = 0;
			for (i32 x = 0; x < dstW; ++x) {
				const i32 targetX = dstX + x;
				if (targetX >= 0 && targetX < frameBufferWidth) {
					const i32 sampleSourceX = flipH ? sourceWidth - 1 - srcX : srcX;
					const uint32_t sampleX = source.srcX + static_cast<uint32_t>(sampleSourceX);
					const uint32_t sampleY = source.srcY + static_cast<uint32_t>(sampleSourceY);
					if (sampleX < sourceSlot->surfaceWidth && sampleY < sourceSlot->surfaceHeight) {
						const size_t srcIndex = (static_cast<size_t>(sampleY) * sourceStride) + (static_cast<size_t>(sampleX) * 4u);
						const u8 srcA = sourcePixels[srcIndex + 3u];
						if (srcA != 0u) {
							const u8 outA = static_cast<u8>((static_cast<u32>(srcA) * static_cast<u32>(color.a) + 127u) / 255u);
							const u8 outR = static_cast<u8>((static_cast<u32>(sourcePixels[srcIndex + 0u]) * static_cast<u32>(color.r) + 127u) / 255u);
							const u8 outG = static_cast<u8>((static_cast<u32>(sourcePixels[srcIndex + 1u]) * static_cast<u32>(color.g) + 127u) / 255u);
							const u8 outB = static_cast<u8>((static_cast<u32>(sourcePixels[srcIndex + 2u]) * static_cast<u32>(color.b) + 127u) / 255u);
							const size_t dstIndex = static_cast<size_t>(targetY) * static_cast<size_t>(frameBufferWidth) + static_cast<size_t>(targetX);
							blendFrameBufferPixel(pixels, dstIndex, outR, outG, outB, outA, layer, priority, seq);
						}
					}
				}
				srcXRemainder += sourceWidth;
				while (srcXRemainder >= dstW) {
					++srcX;
					srcXRemainder -= dstW;
				}
			}
		}
		srcYRemainder += sourceHeight;
		while (srcYRemainder >= dstH) {
			++srcY;
			srcYRemainder -= dstH;
		}
	}
}

} // namespace bmsx
