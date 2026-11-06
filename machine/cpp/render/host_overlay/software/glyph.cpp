#include "render/host_overlay/software/glyph.h"
#include "render/backend/backend.h"
#include "render/host_overlay/atlas.h"
#include "render/shared/bitmap_font.h"
#include "render/shared/software_pixels.h"

namespace bmsx {

void drawLinearHostGlyph(SoftwareBackend& backend, const FontGlyph& item, f32 x, f32 y, u32 color) {
	const auto& transform = backend.hostOverlayTransform;
	const auto& rect = item.rect;
	const f32 width = item.width * transform.scaleX, height = item.height * transform.scaleY;
	const f32 originX = x * transform.scaleX + transform.offsetX, originY = y * transform.scaleY + transform.offsetY;
	const f32 stepU = rect.w / width, stepV = rect.h / height;
	const f32 left = originX - 0.5F / stepU, top = originY - 0.5F / stepV;
	const f32 right = originX + width + 0.5F / stepU, bottom = originY + height + 0.5F / stepV;
	const auto& clip = backend.hostOverlayClip;
	i32 startX = std::max(clip.left, static_cast<i32>(left)), endX = std::min(clip.right, static_cast<i32>(right) + 1);
	i32 startY = std::max(clip.top, static_cast<i32>(top)), endY = std::min(clip.bottom, static_cast<i32>(bottom) + 1);
	if (startX + 0.5F < left) startX++;
	if (startY + 0.5F < top) startY++;
	if (endX - 0.5F >= right) endX--;
	if (endY - 0.5F >= bottom) endY--;
	const auto& atlas = HOST_SYSTEM_ATLAS.pixels;
	const i32 atlasStride = static_cast<i32>(HOST_SYSTEM_ATLAS.width) * 4;
	const u8 r = static_cast<u8>(color >> 16u), g = static_cast<u8>(color >> 8u), b = static_cast<u8>(color);
	const f32 a = static_cast<f32>(color >> 24u) / 255.0F;
	const f32 firstU = rect.u - 0.5F + (startX + 0.5F - originX) * stepU;
	u32* target = backend.framebuffer();
	const i32 stride = backend.pitch() / static_cast<i32>(sizeof(u32));
	for (i32 py = startY; py < endY; py++) {
		const f32 v = rect.v - 0.5F + (py + 0.5F - originY) * stepV;
		const i32 iv = static_cast<i32>(v), row = iv * atlasStride + 3;
		const f32 fy = v - iv;
		f32 u = firstU;
		i32 offset = py * stride + startX;
		for (i32 px = startX; px < endX; px++, u += stepU, offset++) {
			const i32 iu = static_cast<i32>(u), from = row + iu * 4;
			const f32 fx = u - iu;
			const f32 upper = atlas[from] + (static_cast<i32>(atlas[from + 4]) - atlas[from]) * fx;
			const f32 lower = atlas[from + atlasStride] + (static_cast<i32>(atlas[from + atlasStride + 4]) - atlas[from + atlasStride]) * fx;
			blendSoftwareArgb(target[offset], r, g, b, static_cast<u8>((upper + (lower - upper) * fy) * a + 0.5F));
		}
	}
}

} // namespace bmsx
