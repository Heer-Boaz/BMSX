#include "render/host_overlay/software/renderer.h"

#include "render/shared/glyph_runs.h"
#include "render/shared/software_pixels.h"
#include "render/shared/submissions.h"
#include "render/host_overlay/atlas.h"

namespace bmsx {
namespace {


void drawRectSoftware(SoftwareBackend& backend, const RectRenderSubmission& command) {
	const auto& transform = backend.hostOverlayTransform;
	const i32 left = static_cast<i32>(command.area.left * transform.scale + transform.offsetX);
	const i32 top = static_cast<i32>(command.area.top * transform.scale + transform.offsetY);
	const i32 right = static_cast<i32>(command.area.right * transform.scale + transform.offsetX);
	const i32 bottom = static_cast<i32>(command.area.bottom * transform.scale + transform.offsetY);
	const i32 width = right - left;
	const i32 height = bottom - top;
	if (command.kind == RectRenderKind::Fill) {
		backend.fillRect(left, top, width, height, command.color);
		return;
	}
	backend.fillRect(left, top, width, 1, command.color);
	backend.fillRect(left, top + height - 1, width, 1, command.color);
	backend.fillRect(left, top, 1, height, command.color);
	backend.fillRect(left + width - 1, top, 1, height, command.color);
}

void drawPolySoftware(SoftwareBackend& backend, const PolyRenderSubmission& command) {
	const auto& transform = backend.hostOverlayTransform;
	const i32 thickness = static_cast<i32>(command.thickness);
	const i32 half = thickness / 2;
	for (size_t index = 0; index + 3u < command.points.size(); index += 2u) {
		i32 x0 = static_cast<i32>(command.points[index] * transform.scale + transform.offsetX);
		i32 y0 = static_cast<i32>(command.points[index + 1u] * transform.scale + transform.offsetY);
		const i32 x1 = static_cast<i32>(command.points[index + 2u] * transform.scale + transform.offsetX);
		const i32 y1 = static_cast<i32>(command.points[index + 3u] * transform.scale + transform.offsetY);
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
							std::span<const u8> atlasPixels,
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
							u32 color) {
	const SoftwareColorBytes tint{
		static_cast<u8>((color >> 16u) & 0xffu),
		static_cast<u8>((color >> 8u) & 0xffu),
		static_cast<u8>(color & 0xffu),
		static_cast<u8>((color >> 24u) & 0xffu),
	};
	const i32 pixelsPerRow = backend.pitch() / static_cast<i32>(sizeof(u32));
	u32* framebuffer = backend.framebuffer();
	const auto& clip = backend.hostOverlayClip;
	const i32 startX = std::max(clip.left, dstX);
	const i32 startY = std::max(clip.top, dstY);
	const i32 endX = std::min(clip.right, dstX + dstW);
	const i32 endY = std::min(clip.bottom, dstY + dstH);
	for (i32 targetY = startY; targetY < endY; targetY += 1) {
		const i32 relY = targetY - dstY;
		const i32 sampleY = flipV ? dstH - 1 - relY : relY;
		const i32 sourceY = static_cast<i32>(sourceV) + sampleY * static_cast<i32>(sourceH) / dstH;
		const u8* sourceRow = atlasPixels.data() + static_cast<size_t>(sourceY) * static_cast<size_t>(atlasWidth) * 4u;
		u32* targetRow = framebuffer + static_cast<size_t>(targetY) * static_cast<size_t>(pixelsPerRow);
		for (i32 targetX = startX; targetX < endX; targetX += 1) {
			const i32 relX = targetX - dstX;
			const i32 sampleX = flipH ? dstW - 1 - relX : relX;
			const i32 sourceX = static_cast<i32>(sourceU) + sampleX * static_cast<i32>(sourceW) / dstW;
			const u8* sourcePixel = sourceRow + static_cast<size_t>(sourceX) * 4u;
			blendTintedSoftwarePixel(targetRow[targetX], sourcePixel, tint);
		}
	}
}

void drawImageSoftware(SoftwareBackend& backend, const HostImageRenderSubmission& command) {
	const HostSystemAtlasImage& source = hostSystemAtlasImage(command.imgid);
	const Vec2& scale = command.scale;
	const auto& transform = backend.hostOverlayTransform;
	drawAtlasPixelsSoftware(
		backend,
		HOST_SYSTEM_ATLAS.pixels,
		static_cast<i32>(HOST_SYSTEM_ATLAS.width),
		source.u,
		source.v,
		source.w,
		source.h,
		static_cast<i32>(command.pos.x * transform.scale + transform.offsetX),
		static_cast<i32>(command.pos.y * transform.scale + transform.offsetY),
		static_cast<i32>(static_cast<f32>(source.width) * scale.x * transform.scale),
		static_cast<i32>(static_cast<f32>(source.height) * scale.y * transform.scale),
		command.flip.flip_h,
		command.flip.flip_v,
		command.colorize
	);
}

void drawGlyphImageSoftware(SoftwareBackend& backend, const HostSystemAtlas& atlas, const FontGlyph& item, f32 imageX, f32 imageY, u32 color) {
	const ImageAtlasRect& rect = item.rect;
	const auto& transform = backend.hostOverlayTransform;
	drawAtlasPixelsSoftware(
		backend,
		atlas.pixels,
		static_cast<i32>(atlas.width),
		rect.u,
		rect.v,
		rect.w,
		rect.h,
		static_cast<i32>(imageX * transform.scale + transform.offsetX),
		static_cast<i32>(imageY * transform.scale + transform.offsetY),
		static_cast<i32>(static_cast<f32>(item.width) * transform.scale),
		static_cast<i32>(static_cast<f32>(item.height) * transform.scale),
		false,
		false,
		color
	);
}

struct GlyphSoftwareContext {
	SoftwareBackend& backend;
	i32 lineHeight;
	u32 color;
};

void drawGlyphBackgroundSoftware(
	GlyphSoftwareContext& context,
	const FontGlyph& item,
	f32 imageX,
	f32 imageY
) {
	const auto& transform = context.backend.hostOverlayTransform;
	context.backend.fillRect(
		static_cast<i32>(imageX * transform.scale + transform.offsetX),
		static_cast<i32>(imageY * transform.scale + transform.offsetY),
		static_cast<i32>(static_cast<f32>(item.advance) * transform.scale),
		static_cast<i32>(static_cast<f32>(context.lineHeight) * transform.scale),
		context.color
	);
}

void drawGlyphSoftware(
	GlyphSoftwareContext& context,
	const FontGlyph& item,
	f32 imageX,
	f32 imageY
) {
	drawGlyphImageSoftware(
		context.backend,
		HOST_SYSTEM_ATLAS,
		item,
		imageX,
		imageY,
		context.color
	);
}

void drawGlyphsSoftware(SoftwareBackend& backend, const GlyphRenderSubmission& command) {
	GlyphSoftwareContext context{
		.backend = backend,
		.lineHeight = 0,
		.color = command.background_color,
	};
	if (command.has_background_color) {
		context.lineHeight = command.font->lineHeight();
		forEachBatchBlitGlyph(command, context, drawGlyphBackgroundSoftware);
	}
	context.color = command.color;
	forEachBatchBlitGlyph(command, context, drawGlyphSoftware);
}

} // namespace

void beginHostOverlaySoftware(SoftwareBackend& backend, const Host2DPipelineState& state) {
	(void)state;
	backend.hostOverlayTransform = IDENTITY_HOST_OVERLAY_TRANSFORM;
	backend.hostOverlayClip.reset(backend.width(), backend.height(), backend.width(), backend.height());
}

void renderHost2DEntrySoftware(SoftwareBackend& backend, Host2DKind kind, Host2DRef ref) {
	switch (kind) {
		case Host2DKind::Transform: backend.hostOverlayTransform = *ref.transform; return;
		case Host2DKind::Clip: backend.hostOverlayClip.set(*ref.clip); return;
		case Host2DKind::Img: drawImageSoftware(backend, *ref.img); return;
		case Host2DKind::Rect: drawRectSoftware(backend, *ref.rect); return;
		case Host2DKind::Poly: drawPolySoftware(backend, *ref.poly); return;
		case Host2DKind::Glyphs: drawGlyphsSoftware(backend, *ref.glyphs); return;
	}
}

void endHostOverlaySoftware(SoftwareBackend& backend) {
	backend.hostOverlayClip.reset(backend.width(), backend.height(), backend.width(), backend.height());
}

} // namespace bmsx
