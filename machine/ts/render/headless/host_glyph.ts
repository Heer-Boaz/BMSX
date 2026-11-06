import type { FontGlyph } from '../shared/bitmap_font';
import { HOST_SYSTEM_ATLAS } from '../host_overlay/atlas';
import type { HeadlessHost2DContext } from './host_2d';
import { blendPixel } from './pixel_ops';

/** Linear coverage in the padded host atlas; no RGB filtering or temporary raster. */
export function drawLinearHostGlyph(context: HeadlessHost2DContext, item: FontGlyph, x: number, y: number): void {
	const { scaleX, scaleY, offsetX, offsetY } = context.transform, rect = item.rect;
	const width = item.width * scaleX, height = item.height * scaleY;
	const originX = x * scaleX + offsetX, originY = y * scaleY + offsetY;
	const stepU = rect.w / width, stepV = rect.h / height;
	const left = originX - 0.5 / stepU, top = originY - 0.5 / stepV;
	const right = originX + width + 0.5 / stepU, bottom = originY + height + 0.5 / stepV;
	const clip = context.clip;
	let startX = Math.max(clip.left, Math.trunc(left)), endX = Math.min(clip.right, Math.trunc(right) + 1);
	let startY = Math.max(clip.top, Math.trunc(top)), endY = Math.min(clip.bottom, Math.trunc(bottom) + 1);
	if (startX + 0.5 < left) startX++;
	if (startY + 0.5 < top) startY++;
	if (endX - 0.5 >= right) endX--;
	if (endY - 0.5 >= bottom) endY--;
	const atlas = HOST_SYSTEM_ATLAS.pixels, atlasStride = HOST_SYSTEM_ATLAS.width * 4;
	const color = context.colorValue, r = (color >>> 16) & 255, g = (color >>> 8) & 255, b = color & 255, a = (color >>> 24) / 255;
	const firstU = rect.u - 0.5 + (startX + 0.5 - originX) * stepU;
	for (let py = startY; py < endY; py++) {
		const v = rect.v - 0.5 + (py + 0.5 - originY) * stepV, iv = Math.trunc(v), fy = v - iv;
		const row = iv * atlasStride + 3;
		let u = firstU, target = (py * context.width + startX) * 4;
		for (let px = startX; px < endX; px++, u += stepU, target += 4) {
			const iu = Math.trunc(u), fx = u - iu, from = row + iu * 4;
			const upper = atlas[from] + (atlas[from + 4] - atlas[from]) * fx;
			const lower = atlas[from + atlasStride] + (atlas[from + atlasStride + 4] - atlas[from + atlasStride]) * fx;
			blendPixel(context.target, target, r, g, b, (upper + (lower - upper) * fy) * a);
		}
	}
}
