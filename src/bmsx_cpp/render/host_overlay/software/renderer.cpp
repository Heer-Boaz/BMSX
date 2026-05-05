#include "render/host_overlay/software/renderer.h"

#include "render/shared/glyphs.h"
#include "rompack/host_system_atlas.h"

namespace bmsx {
namespace {

u32 packArgb(u8 r, u8 g, u8 b, u8 a) {
	return (static_cast<u32>(a) << 24u)
		| (static_cast<u32>(r) << 16u)
		| (static_cast<u32>(g) << 8u)
		| static_cast<u32>(b);
}

void blendArgb(u32& target, u8 r, u8 g, u8 b, u8 a) {
	if (a == 0u) {
		return;
	}
	if (a == 255u) {
		target = packArgb(r, g, b, 255u);
		return;
	}
	const u32 invA = 255u - static_cast<u32>(a);
	const u32 dr = (target >> 16u) & 0xffu;
	const u32 dg = (target >> 8u) & 0xffu;
	const u32 db = target & 0xffu;
	const u32 da = (target >> 24u) & 0xffu;
	const u32 outR = (static_cast<u32>(r) * a + dr * invA + 127u) / 255u;
	const u32 outG = (static_cast<u32>(g) * a + dg * invA + 127u) / 255u;
	const u32 outB = (static_cast<u32>(b) * a + db * invA + 127u) / 255u;
	const u32 outA = static_cast<u32>(a) + (da * invA + 127u) / 255u;
	target = (outA << 24u) | (outR << 16u) | (outG << 8u) | outB;
}

void drawRectSoftware(SoftwareBackend& backend, const RectRenderSubmission& command) {
	const RectBounds& area = command.area;
	const i32 left = static_cast<i32>(area.left);
	const i32 top = static_cast<i32>(area.top);
	const i32 width = static_cast<i32>(area.right - area.left);
	const i32 height = static_cast<i32>(area.bottom - area.top);
	if (command.kind == RectRenderSubmission::Kind::Fill) {
		backend.fillRect(left, top, width, height, command.color);
		return;
	}
	backend.fillRect(left, top, width, 1, command.color);
	backend.fillRect(left, top + height - 1, width, 1, command.color);
	backend.fillRect(left, top, 1, height, command.color);
	backend.fillRect(left + width - 1, top, 1, height, command.color);
}

void drawPolySoftware(SoftwareBackend& backend, const PolyRenderSubmission& command) {
	const i32 thickness = static_cast<i32>(command.thickness.value());
	const i32 half = thickness / 2;
	for (size_t index = 0; index + 3u < command.points.size(); index += 2u) {
		i32 x0 = static_cast<i32>(command.points[index]);
		i32 y0 = static_cast<i32>(command.points[index + 1u]);
		const i32 x1 = static_cast<i32>(command.points[index + 2u]);
		const i32 y1 = static_cast<i32>(command.points[index + 3u]);
		i32 dx = x1 - x0;
		i32 dy = y1 - y0;
		const i32 sx = dx < 0 ? -1 : 1;
		const i32 sy = dy < 0 ? -1 : 1;
		if (dx < 0) dx = -dx;
		if (dy < 0) dy = -dy;
		i32 err = dx - dy;
		for (;;) {
			backend.fillRect(x0 - half, y0 - half, thickness, thickness, command.color);
			if (x0 == x1 && y0 == y1) {
				break;
			}
			const i32 e2 = err * 2;
			if (e2 > -dy) {
				err -= dy;
				x0 += sx;
			}
			if (e2 < dx) {
				err += dx;
				y0 += sy;
			}
		}
	}
}

void drawImageSoftware(SoftwareBackend& backend, const HostImageRenderSubmission& command) {
	const HostSystemAtlasGeneratedImage& source = hostSystemAtlasImage(command.imgid);
	const Vec2& scale = command.scale;
	const FlipOptions& flip = command.flip;
	const Color& color = command.colorize;
	const i32 dstX = static_cast<i32>(command.pos.x);
	const i32 dstY = static_cast<i32>(command.pos.y);
	const i32 dstW = static_cast<i32>(static_cast<f32>(source.width) * scale.x);
	const i32 dstH = static_cast<i32>(static_cast<f32>(source.height) * scale.y);
	const u8 colorR = Color::channelToByte(color.r);
	const u8 colorG = Color::channelToByte(color.g);
	const u8 colorB = Color::channelToByte(color.b);
	const u8 colorA = Color::channelToByte(color.a);
	const std::vector<u8>& atlasPixels = hostSystemAtlasPixels();
	const i32 atlasWidth = static_cast<i32>(hostSystemAtlasWidth());
	const i32 pixelsPerRow = backend.pitch() / static_cast<i32>(sizeof(u32));
	u32* framebuffer = backend.framebuffer();
	for (i32 y = 0; y < dstH; y += 1) {
		const i32 targetY = dstY + y;
		if (targetY < 0 || targetY >= backend.height()) {
			continue;
		}
		const i32 sourceY = static_cast<i32>(source.v) + (flip.flip_v ? (dstH - 1 - y) * source.h / dstH : y * source.h / dstH);
		const u8* sourceRow = atlasPixels.data() + static_cast<size_t>(sourceY) * static_cast<size_t>(atlasWidth) * 4u;
		u32* targetRow = framebuffer + static_cast<size_t>(targetY) * static_cast<size_t>(pixelsPerRow);
		for (i32 x = 0; x < dstW; x += 1) {
			const i32 targetX = dstX + x;
			if (targetX < 0 || targetX >= backend.width()) {
				continue;
			}
			const i32 sourceX = static_cast<i32>(source.u) + (flip.flip_h ? (dstW - 1 - x) * source.w / dstW : x * source.w / dstW);
			const u8* sourcePixel = sourceRow + static_cast<size_t>(sourceX) * 4u;
			const u8 srcA = static_cast<u8>((static_cast<u32>(sourcePixel[3]) * colorA + 127u) / 255u);
			const u8 srcR = static_cast<u8>((static_cast<u32>(sourcePixel[0]) * colorR + 127u) / 255u);
			const u8 srcG = static_cast<u8>((static_cast<u32>(sourcePixel[1]) * colorG + 127u) / 255u);
			const u8 srcB = static_cast<u8>((static_cast<u32>(sourcePixel[2]) * colorB + 127u) / 255u);
			blendArgb(targetRow[targetX], srcR, srcG, srcB, srcA);
		}
	}
}

void drawGlyphImageSoftware(SoftwareBackend& backend, const std::vector<u8>& atlasPixels, i32 atlasWidth, const FontGlyph& glyph, f32 imageX, f32 imageY, const Color& color) {
	const ImageAtlasRect& rect = glyph.rect;
	const i32 dstX = static_cast<i32>(imageX);
	const i32 dstY = static_cast<i32>(imageY);
	const i32 width = static_cast<i32>(rect.w);
	const i32 height = static_cast<i32>(rect.h);
	const u8 colorR = Color::channelToByte(color.r);
	const u8 colorG = Color::channelToByte(color.g);
	const u8 colorB = Color::channelToByte(color.b);
	const u8 colorA = Color::channelToByte(color.a);
	const i32 pixelsPerRow = backend.pitch() / static_cast<i32>(sizeof(u32));
	u32* framebuffer = backend.framebuffer();
	for (i32 y = 0; y < height; y += 1) {
		const i32 targetY = dstY + y;
		if (targetY < 0 || targetY >= backend.height()) {
			continue;
		}
		const u8* sourceRow = atlasPixels.data() + (static_cast<size_t>(rect.v + static_cast<u32>(y)) * static_cast<size_t>(atlasWidth) + rect.u) * 4u;
		u32* targetRow = framebuffer + static_cast<size_t>(targetY) * static_cast<size_t>(pixelsPerRow);
		for (i32 x = 0; x < width; x += 1) {
			const i32 targetX = dstX + x;
			if (targetX < 0 || targetX >= backend.width()) {
				continue;
			}
			const u8* sourcePixel = sourceRow + static_cast<size_t>(x) * 4u;
			const u8 srcA = static_cast<u8>((static_cast<u32>(sourcePixel[3]) * colorA + 127u) / 255u);
			const u8 srcR = static_cast<u8>((static_cast<u32>(sourcePixel[0]) * colorR + 127u) / 255u);
			const u8 srcG = static_cast<u8>((static_cast<u32>(sourcePixel[1]) * colorG + 127u) / 255u);
			const u8 srcB = static_cast<u8>((static_cast<u32>(sourcePixel[2]) * colorB + 127u) / 255u);
			blendArgb(targetRow[targetX], srcR, srcG, srcB, srcA);
		}
	}
}

void drawGlyphsSoftware(SoftwareBackend& backend, const GlyphRenderSubmission& command) {
	const std::vector<u8>& atlasPixels = hostSystemAtlasPixels();
	const i32 atlasWidth = static_cast<i32>(hostSystemAtlasWidth());
	if (command.background_color.has_value()) {
		const Color& background = *command.background_color;
		const i32 lineHeight = command.font->lineHeight();
		forEachGlyphImage(command, [&](const FontGlyph& glyph, f32 imageX, f32 imageY, f32, const Color&) {
			backend.fillRect(
				static_cast<i32>(imageX),
				static_cast<i32>(imageY),
				glyph.advance,
				lineHeight,
				background
			);
		});
	}
	forEachGlyphImage(command, [&](const FontGlyph& glyph, f32 imageX, f32 imageY, f32, const Color& color) {
		drawGlyphImageSoftware(backend, atlasPixels, atlasWidth, glyph, imageX, imageY, color);
	});
}

} // namespace

void beginHostOverlaySoftware(SoftwareBackend& backend, const Host2DPipelineState& state) {
	(void)backend;
	(void)state;
}

void renderHost2DEntrySoftware(SoftwareBackend& backend, const RenderQueues::Host2DEntry& entry) {
	switch (entry.kind) {
		case RenderQueues::Host2DKind::Img: drawImageSoftware(backend, *entry.img); return;
		case RenderQueues::Host2DKind::Rect: drawRectSoftware(backend, *entry.rect); return;
		case RenderQueues::Host2DKind::Poly: drawPolySoftware(backend, *entry.poly); return;
		case RenderQueues::Host2DKind::Glyphs: drawGlyphsSoftware(backend, *entry.glyphs); return;
	}
}

void endHostOverlaySoftware(SoftwareBackend& backend) {
	(void)backend;
}

} // namespace bmsx
