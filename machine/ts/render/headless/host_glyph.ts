import type { FontGlyph } from '../shared/bitmap_font';
import type { HeadlessHost2DContext } from './host_2d';
import { blendPixel } from './pixel_ops';

/** Filter glyph coverage or signed distances, never image RGB or game pixels. */
export function drawFilteredHostGlyph(context: HeadlessHost2DContext, item: FontGlyph, x: number, y: number): void {
	const { scaleX, scaleY, offsetX, offsetY } = context.transform, rect = item.rect;
	if (rect.w === 0 || rect.h === 0) return;
	const msdf = context.glyphRaster === 'msdf', padding = msdf ? 0 : 0.5;
	const width = item.width * scaleX, height = item.height * scaleY;
	const originX = (x + item.offsetX) * scaleX + offsetX, originY = (y + item.offsetY) * scaleY + offsetY;
	const stepU = rect.w / width, stepV = rect.h / height;
	const left = originX - padding / stepU, top = originY - padding / stepV;
	const right = originX + width + padding / stepU, bottom = originY + height + padding / stepV;
	const clip = context.clip;
	let startX = Math.max(clip.left, Math.trunc(left)), endX = Math.min(clip.right, Math.trunc(right) + 1);
	let startY = Math.max(clip.top, Math.trunc(top)), endY = Math.min(clip.bottom, Math.trunc(bottom) + 1);
	if (startX + 0.5 < left) startX++;
	if (startY + 0.5 < top) startY++;
	if (endX - 0.5 >= right) endX--;
	if (endY - 0.5 >= bottom) endY--;
	const source = context.glyphAtlas;
	const atlas = source.pixels, atlasStride = source.width * 4;
	const screenRange = context.glyphScreenRange;
	const color = context.colorValue, r = (color >>> 16) & 255, g = (color >>> 8) & 255, b = color & 255, a = (color >>> 24) / 255;
	const firstU = rect.u - 0.5 + (startX + 0.5 - originX) * stepU;
	for (let py = startY; py < endY; py++) {
		const v = rect.v - 0.5 + (py + 0.5 - originY) * stepV, iv = Math.trunc(v), fy = v - iv;
		const row = iv * atlasStride;
		let u = firstU, target = (py * context.width + startX) * 4;
		if (msdf) {
			for (let px = startX; px < endX; px++, u += stepU, target += 4) {
				const iu = Math.trunc(u), fx = u - iu, from = row + iu * 4;
				const dr = sampleChannel(atlas, from, atlasStride, fx, fy);
				const dg = sampleChannel(atlas, from + 1, atlasStride, fx, fy);
				const db = sampleChannel(atlas, from + 2, atlasStride, fx, fy);
				const median = Math.max(Math.min(dr, dg), Math.min(Math.max(dr, dg), db));
				const coverage = Math.min(255, Math.max(0, screenRange * (median - 127.5) + 127.5));
				blendPixel(context.target, target, r, g, b, coverage * a);
			}
		} else {
			for (let px = startX; px < endX; px++, u += stepU, target += 4) {
				const iu = Math.trunc(u);
				blendPixel(context.target, target, r, g, b, sampleChannel(atlas, row + iu * 4 + 3, atlasStride, u - iu, fy) * a);
			}
		}
	}
}

function sampleChannel(atlas: Uint8Array, from: number, stride: number, fx: number, fy: number): number {
	const upper = atlas[from] + (atlas[from + 4] - atlas[from]) * fx;
	const lower = atlas[from + stride] + (atlas[from + stride + 4] - atlas[from + stride]) * fx;
	return upper + (lower - upper) * fy;
}
