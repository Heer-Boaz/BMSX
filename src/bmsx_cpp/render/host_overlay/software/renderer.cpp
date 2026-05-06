#include "render/host_overlay/software/renderer.h"

#include "render/shared/glyphs.h"
#include "render/shared/software_pixels.h"
#include "rompack/host_system_atlas.h"

namespace bmsx {
namespace {


void drawRectSoftware(SoftwareBackend& backend, const RectRenderSubmission& command) {
	const i32 left = static_cast<i32>(command.area.left);
	const i32 top = static_cast<i32>(command.area.top);
	const i32 right = static_cast<i32>(command.area.right);
	const i32 bottom = static_cast<i32>(command.area.bottom);
	const i32 width = right - left;
	const i32 height = bottom - top;
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
	const i32 thickness = static_cast<i32>(command.thickness);
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

void drawAtlasPixelsSoftware(SoftwareBackend& backend,
							const std::vector<u8>& atlasPixels,
							i32 atlasWidth,
							u32 sourceU,
							u32 sourceV,
							u32 sourceW,
							u32 sourceH,
							i32 dstX,
							i32 dstY,
							i32 dstW,
							i32 dstH,
							bool flipH,
							bool flipV,
							const Color& color) {
	const SoftwareColorBytes tint = softwareColorBytes(color);
	const i32 pixelsPerRow = backend.pitch() / static_cast<i32>(sizeof(u32));
	u32* framebuffer = backend.framebuffer();
	for (i32 y = 0; y < dstH; y += 1) {
		const i32 targetY = dstY + y;
		if (targetY < 0 || targetY >= backend.height()) {
			continue;
		}
		const i32 sampleY = flipV ? dstH - 1 - y : y;
		const i32 sourceY = static_cast<i32>(sourceV) + sampleY * static_cast<i32>(sourceH) / dstH;
		const u8* sourceRow = atlasPixels.data() + static_cast<size_t>(sourceY) * static_cast<size_t>(atlasWidth) * 4u;
		u32* targetRow = framebuffer + static_cast<size_t>(targetY) * static_cast<size_t>(pixelsPerRow);
		for (i32 x = 0; x < dstW; x += 1) {
			const i32 targetX = dstX + x;
			if (targetX < 0 || targetX >= backend.width()) {
				continue;
			}
			const i32 sampleX = flipH ? dstW - 1 - x : x;
			const i32 sourceX = static_cast<i32>(sourceU) + sampleX * static_cast<i32>(sourceW) / dstW;
			const u8* sourcePixel = sourceRow + static_cast<size_t>(sourceX) * 4u;
			blendTintedSoftwarePixel(targetRow[targetX], sourcePixel, tint);
		}
	}
}

void drawImageSoftware(SoftwareBackend& backend, const HostImageRenderSubmission& command) {
	const HostSystemAtlasGeneratedImage& source = hostSystemAtlasImage(command.imgid);
	const Vec2& scale = command.scale;
	drawAtlasPixelsSoftware(
		backend,
		hostSystemAtlasPixels(),
		static_cast<i32>(hostSystemAtlasWidth()),
		source.u,
		source.v,
		source.w,
		source.h,
		static_cast<i32>(command.pos.x),
		static_cast<i32>(command.pos.y),
		static_cast<i32>(static_cast<f32>(source.width) * scale.x),
		static_cast<i32>(static_cast<f32>(source.height) * scale.y),
		command.flip.flip_h,
		command.flip.flip_v,
		command.colorize
	);
}

void drawGlyphImageSoftware(SoftwareBackend& backend, const std::vector<u8>& atlasPixels, i32 atlasWidth, const FontGlyph& glyph, f32 imageX, f32 imageY, const Color& color) {
	const ImageAtlasRect& rect = glyph.rect;
	drawAtlasPixelsSoftware(
		backend,
		atlasPixels,
		atlasWidth,
		rect.u,
		rect.v,
		rect.w,
		rect.h,
		static_cast<i32>(imageX),
		static_cast<i32>(imageY),
		static_cast<i32>(rect.w),
		static_cast<i32>(rect.h),
		false,
		false,
		color
	);
}

void drawGlyphsSoftware(SoftwareBackend& backend, const GlyphRenderSubmission& command) {
	const std::vector<u8>& atlasPixels = hostSystemAtlasPixels();
	const i32 atlasWidth = static_cast<i32>(hostSystemAtlasWidth());
	if (command.has_background_color) {
		const Color& background = command.background_color;
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

void renderHost2DEntrySoftware(SoftwareBackend& backend, Host2DKind kind, Host2DRef ref) {
	switch (kind) {
		case Host2DKind::Img: drawImageSoftware(backend, *static_cast<const HostImageRenderSubmission*>(ref)); return;
		case Host2DKind::Rect: drawRectSoftware(backend, *static_cast<const RectRenderSubmission*>(ref)); return;
		case Host2DKind::Poly: drawPolySoftware(backend, *static_cast<const PolyRenderSubmission*>(ref)); return;
		case Host2DKind::Glyphs: drawGlyphsSoftware(backend, *static_cast<const GlyphRenderSubmission*>(ref)); return;
	}
}

void endHostOverlaySoftware(SoftwareBackend& backend) {
	(void)backend;
}

} // namespace bmsx
