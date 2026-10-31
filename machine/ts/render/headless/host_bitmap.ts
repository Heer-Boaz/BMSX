import type { HostBitmapRenderSubmission } from '../host_overlay/bitmap';
import type { HeadlessHost2DContext } from './host_2d';
import { blendPixel } from './pixel_ops';
import { clamp } from '../../common/clamp';

/** Pixel-centre affine coverage; sampling follows the host GPU's nearest/clamp sampler. */
export function drawHostBitmap(context: HeadlessHost2DContext, command: HostBitmapRenderSubmission): void {
	const { scale, offsetX, offsetY } = context.transform;
	const originX = command.originX * scale + offsetX, originY = command.originY * scale + offsetY;
	const xx = command.axisXX * scale, xy = command.axisXY * scale;
	const yx = command.axisYX * scale, yy = command.axisYY * scale;
	const determinant = xx * yy - xy * yx;
	if (determinant === 0) return;
	const { image } = command.bitmap, { pixels, width, height } = image;
	const colorR = ((command.color >>> 16) & 0xff) / 255, colorG = ((command.color >>> 8) & 0xff) / 255;
	const colorB = (command.color & 0xff) / 255, colorA = (command.color >>> 24) / 255;
	const target = context.target, stride = context.width, clip = context.clip;
	if (xy === 0 && yx === 0) {
		const left = Math.min(originX, originX + xx), right = Math.max(originX, originX + xx);
		const top = Math.min(originY, originY + yy), bottom = Math.max(originY, originY + yy);
		let startX = Math.max(clip.left, Math.trunc(left)), endX = Math.min(clip.right, Math.trunc(right) + 1);
		let startY = Math.max(clip.top, Math.trunc(top)), endY = Math.min(clip.bottom, Math.trunc(bottom) + 1);
		if (startX + 0.5 < left) startX++;
		if (startY + 0.5 < top) startY++;
		if (endX - 0.5 >= right) endX--;
		if (endY - 0.5 >= bottom) endY--;
		if (command.color === 0xffffffff && command.u0 === 0 && command.v0 === 0
			&& command.u1 === 1 && command.v1 === 1 && xx > 0 && yy > 0) {
			const stepX = width / xx, stepY = height / yy;
			for (let y = startY; y < endY; y++) {
				const sourceRow = Math.trunc((y + 0.5 - originY) * stepY) * width;
				let offset = (y * stride + startX) * 4;
				for (let x = startX; x < endX; x++, offset += 4) {
					const from = (sourceRow + Math.trunc((x + 0.5 - originX) * stepX)) * 4;
					blendPixel(target, offset, pixels[from], pixels[from + 1], pixels[from + 2], pixels[from + 3]);
				}
			}
			return;
		}
		const stepU = (command.u1 - command.u0) * width / xx;
		const stepV = (command.v1 - command.v0) * height / yy;
		const firstU = command.u0 * width + (startX + 0.5 - originX) * stepU;
		for (let y = startY; y < endY; y++) {
			const v = command.v0 * height + (y + 0.5 - originY) * stepV;
			const sourceRow = clamp(Math.trunc(v), 0, height - 1) * width;
			let u = firstU, offset = (y * stride + startX) * 4;
			for (let x = startX; x < endX; x++, u += stepU, offset += 4) {
				const from = (sourceRow + clamp(Math.trunc(u), 0, width - 1)) * 4;
				blendPixel(target, offset, pixels[from] * colorR, pixels[from + 1] * colorG,
					pixels[from + 2] * colorB, pixels[from + 3] * colorA);
			}
		}
		return;
	}
	const endXX = originX + xx, endXY = originY + xy;
	const endYX = originX + yx, endYY = originY + yy;
	const endX = endXX + yx, endY = endXY + yy;
	const startX = Math.max(clip.left, Math.trunc(Math.min(originX, endXX, endYX, endX)));
	const startY = Math.max(clip.top, Math.trunc(Math.min(originY, endXY, endYY, endY)));
	const right = Math.min(clip.right, Math.trunc(Math.max(originX, endXX, endYX, endX)) + 1);
	const bottom = Math.min(clip.bottom, Math.trunc(Math.max(originY, endXY, endYY, endY)) + 1);
	const sign = determinant < 0 ? -1 : 1, area = determinant * sign;
	// Normalize winding. At exact edges, include screen-space top/left, not local s/t zero.
	const includeS0 = yy * sign > 0 || (yy === 0 && yx * sign < 0);
	const includeT0 = xy * sign < 0 || (xy === 0 && xx * sign > 0);
	const stepSX = yy * sign, stepTX = -xy * sign;
	const stepU = (command.u1 - command.u0) * width / area;
	const stepV = (command.v1 - command.v0) * height / area;
	const originU = command.u0 * width, originV = command.v0 * height;
	for (let y = startY; y < bottom; y++) {
		const px = startX + 0.5 - originX, py = y + 0.5 - originY;
		let s = (px * yy - py * yx) * sign, t = (xx * py - xy * px) * sign;
		let offset = (y * stride + startX) * 4;
		for (let x = startX; x < right; x++, s += stepSX, t += stepTX, offset += 4) {
			if (s < 0 || s > area || t < 0 || t > area
				|| (s === 0 && !includeS0) || (s === area && includeS0)
				|| (t === 0 && !includeT0) || (t === area && includeT0)) continue;
			const u = originU + s * stepU, v = originV + t * stepV;
			const sourceX = clamp(Math.trunc(u), 0, width - 1);
			const sourceY = clamp(Math.trunc(v), 0, height - 1);
			const from = (sourceY * width + sourceX) * 4;
			blendPixel(target, offset, pixels[from] * colorR, pixels[from + 1] * colorG,
				pixels[from + 2] * colorB, pixels[from + 3] * colorA);
		}
	}
}
