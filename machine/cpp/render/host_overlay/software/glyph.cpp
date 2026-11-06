#include "render/host_overlay/software/glyph.h"
#include "render/backend/backend.h"
#include "render/host_overlay/atlas.h"
#include "render/shared/bitmap_font.h"
#include "render/shared/software_pixels.h"
#include <algorithm>

namespace bmsx {

namespace {
f32 sampleChannel(std::span<const u8> atlas, i32 from, i32 stride, f32 fx, f32 fy) {
	const f32 upper = atlas[from] + (static_cast<i32>(atlas[from + 4]) - atlas[from]) * fx;
	const f32 lower = atlas[from + stride] + (static_cast<i32>(atlas[from + stride + 4]) - atlas[from + stride]) * fx;
	return upper + (lower - upper) * fy;
}

template<bool Msdf>
void drawFilteredGlyph(SoftwareBackend& backend, const HostAtlas& source, const FontGlyph& item, f32 x, f32 y, u32 color, f32 screenRange) {
	const auto& transform = backend.hostOverlayTransform;
	const auto& rect = item.rect;
	if (rect.w == 0 || rect.h == 0) return;
	constexpr f32 padding = Msdf ? 0.0F : 0.5F;
	const f32 width = item.width * transform.scaleX, height = item.height * transform.scaleY;
	const f32 originX = (x + item.offsetX) * transform.scaleX + transform.offsetX, originY = (y + item.offsetY) * transform.scaleY + transform.offsetY;
	const f32 stepU = rect.w / width, stepV = rect.h / height;
	const f32 left = originX - padding / stepU, top = originY - padding / stepV;
	const f32 right = originX + width + padding / stepU, bottom = originY + height + padding / stepV;
	const auto& clip = backend.hostOverlayClip;
	i32 startX = std::max(clip.left, static_cast<i32>(left)), endX = std::min(clip.right, static_cast<i32>(right) + 1);
	i32 startY = std::max(clip.top, static_cast<i32>(top)), endY = std::min(clip.bottom, static_cast<i32>(bottom) + 1);
	if (startX + 0.5F < left) startX++;
	if (startY + 0.5F < top) startY++;
	if (endX - 0.5F >= right) endX--;
	if (endY - 0.5F >= bottom) endY--;
	const auto atlas = source.pixels;
	const i32 atlasStride = static_cast<i32>(source.width) * 4;
	const u8 r = static_cast<u8>(color >> 16u), g = static_cast<u8>(color >> 8u), b = static_cast<u8>(color);
	const f32 a = static_cast<f32>(color >> 24u) / 255.0F;
	const f32 firstU = rect.u - 0.5F + (startX + 0.5F - originX) * stepU;
	u32* target = backend.framebuffer();
	const i32 stride = backend.pitch() / static_cast<i32>(sizeof(u32));
	for (i32 py = startY; py < endY; py++) {
		const f32 v = rect.v - 0.5F + (py + 0.5F - originY) * stepV;
		const i32 iv = static_cast<i32>(v), row = iv * atlasStride;
		const f32 fy = v - iv;
		f32 u = firstU;
		i32 offset = py * stride + startX;
		for (i32 px = startX; px < endX; px++, u += stepU, offset++) {
			const i32 iu = static_cast<i32>(u), from = row + iu * 4;
			const f32 fx = u - iu;
			f32 coverage;
			if constexpr (Msdf) {
				const f32 dr = sampleChannel(atlas, from, atlasStride, fx, fy);
				const f32 dg = sampleChannel(atlas, from + 1, atlasStride, fx, fy);
				const f32 db = sampleChannel(atlas, from + 2, atlasStride, fx, fy);
				const f32 median = std::max(std::min(dr, dg), std::min(std::max(dr, dg), db));
				coverage = std::clamp(screenRange * (median - 127.5F) + 127.5F, 0.0F, 255.0F);
			} else {
				coverage = sampleChannel(atlas, from + 3, atlasStride, fx, fy);
			}
			blendSoftwareArgb(target[offset], r, g, b, static_cast<u8>(coverage * a + 0.5F));
		}
	}
}

} // namespace

void drawFilteredHostGlyph(SoftwareBackend& backend, const HostAtlas& atlas, const FontGlyph& item, f32 x, f32 y, u32 color, FontRaster raster, f32 screenRange) {
	if (raster == FontRaster::Msdf) drawFilteredGlyph<true>(backend, atlas, item, x, y, color, screenRange);
	else drawFilteredGlyph<false>(backend, atlas, item, x, y, color, screenRange);
}

} // namespace bmsx
