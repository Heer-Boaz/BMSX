import type { HostBitmapRenderSubmission } from '../host_overlay/bitmap';
import { drawHostBitmap } from './host_bitmap';
import { drawLinearHostGlyph } from './host_glyph';
import {
	HOST_SYSTEM_ATLAS,
	hostSystemAtlasImage,
} from '../host_overlay/atlas';
import { forEachBatchBlitGlyph } from '../shared/glyph_runs';
import {
	Host2DKind,
	type Host2DRef,
	type HostSolidQuadRenderSubmission,
} from '../host_overlay/commands';
import type {
	GlyphRenderSubmission,
	HostImageRenderSubmission,
	HostFrameRenderSubmission,
	PolyRenderSubmission,
	RectRenderSubmission,
	color,
} from '../shared/submissions';
import { RectRenderKind } from '../shared/submissions';
import { blendPixel } from './pixel_ops';
import type { FontGlyph } from '../shared/bitmap_font';
import type { HostOverlayClipRect, HostOverlayClipState } from '../host_overlay/clip';
import type { HostOverlayRasterTransform, HostOverlayTransform } from '../host_overlay/transform';
import { blitOpaquePixels } from '../shared/software_pixels';
import type { HostMeshSceneTargets, HostMeshSceneRenderSubmission } from '../host_overlay/mesh';
import { drawHeadlessHostMeshScene, type HeadlessHostMeshTarget } from '../host_overlay/headless/mesh';
import type { HostAffineQuadCoverage } from './host_affine_quad';

export type HeadlessHost2DContext = {
	target: Uint8Array;
	width: number;
	colorValue: number;
	backgroundColor: number;
	lineHeight: number;
	clip: HostOverlayClipState;
	transform: HostOverlayRasterTransform;
	framePixels: Uint8Array;
	frameWidth: number;
	frameHeight: number;
	meshScenes: HostMeshSceneTargets<HeadlessHostMeshTarget>;
	affineQuad: HostAffineQuadCoverage;
};

export function beginHeadlessHost2D(context: HeadlessHost2DContext, target: Uint8Array, width: number, height: number,
	logicalWidth: number, logicalHeight: number): void {
	context.target = target;
	context.width = width;
	context.transform.reset(logicalWidth, logicalHeight, width, height);
	context.clip.reset(logicalWidth, logicalHeight, width, height);
}

export function renderHeadlessHost2DEntry(context: HeadlessHost2DContext, kind: Host2DKind, item: Host2DRef): void {
	switch (kind) {
		case Host2DKind.Transform:
			context.transform.set(item as HostOverlayTransform);
			return;
		case Host2DKind.Clip:
			context.clip.set(item as HostOverlayClipRect);
			return;
		case Host2DKind.Rect:
			drawRect(context, item as RectRenderSubmission);
			return;
		case Host2DKind.SolidQuad:
			drawSolidQuad(context, item as HostSolidQuadRenderSubmission);
			return;
		case Host2DKind.Glyphs:
			drawBatchBlit(context, item as GlyphRenderSubmission);
			return;
		case Host2DKind.Img:
			drawImage(context, item as HostImageRenderSubmission);
			return;
		case Host2DKind.Bitmap:
			drawHostBitmap(context, item as HostBitmapRenderSubmission);
			return;
		case Host2DKind.MeshScene:
			drawHeadlessHostMeshScene(context, item as HostMeshSceneRenderSubmission);
			return;
		case Host2DKind.Frame:
			drawFrame(context, item as HostFrameRenderSubmission);
			return;
		case Host2DKind.Poly:
			drawPoly(context, item as PolyRenderSubmission);
			return;
	}
}

function drawFrame(context: HeadlessHost2DContext, command: HostFrameRenderSubmission): void {
	const { area } = command;
	const { scaleX, scaleY, offsetX, offsetY } = context.transform;
	const clip = context.clip;
	blitOpaquePixels(context.framePixels, context.frameWidth, context.frameHeight, context.target, context.width,
		Math.trunc(area.left * scaleX + offsetX), Math.trunc(area.top * scaleY + offsetY),
		Math.trunc(area.right * scaleX + offsetX), Math.trunc(area.bottom * scaleY + offsetY),
		clip.left, clip.top, clip.right, clip.bottom);
}

function drawRect(context: HeadlessHost2DContext, command: RectRenderSubmission): void {
	const area = command.area;
	const { scaleX, scaleY, offsetX, offsetY, viewportScaleX, viewportScaleY } = context.transform;
	const left = area.left * scaleX + offsetX;
	const top = area.top * scaleY + offsetY;
	const right = area.right * scaleX + offsetX;
	const bottom = area.bottom * scaleY + offsetY;
	const colorValue = command.color;
	if (command.kind === RectRenderKind.Fill) {
		fillRect(context, Math.trunc(left), Math.trunc(top), Math.trunc(right), Math.trunc(bottom), colorValue);
		return;
	}
	fillRect(context, Math.trunc(left), Math.trunc(top), Math.trunc(right), Math.trunc(top + viewportScaleY), colorValue);
	fillRect(context, Math.trunc(left), Math.trunc(bottom - viewportScaleY), Math.trunc(right), Math.trunc(bottom), colorValue);
	fillRect(context, Math.trunc(left), Math.trunc(top), Math.trunc(left + viewportScaleX), Math.trunc(bottom), colorValue);
	fillRect(context, Math.trunc(right - viewportScaleX), Math.trunc(top), Math.trunc(right), Math.trunc(bottom), colorValue);
}

function drawSolidQuad(context: HeadlessHost2DContext, command: HostSolidQuadRenderSubmission): void {
	const { scaleX, scaleY, offsetX, offsetY } = context.transform;
	const originX = command.originX * scaleX + offsetX, originY = command.originY * scaleY + offsetY;
	const xx = command.axisXX * scaleX, xy = command.axisXY * scaleY;
	const yx = command.axisYX * scaleX, yy = command.axisYY * scaleY;
	const determinant = xx * yy - xy * yx;
	if (determinant === 0) return;
	const coverage = context.affineQuad;
	coverage.set(originX, originY, xx, xy, yx, yy, determinant, context.clip);
	const { startX, startY, right, bottom, sign, area, includeS0, includeT0, stepSX, stepTX } = coverage;
	const target = context.target, width = context.width, color = command.color;
	const r = (color >>> 16) & 0xff, g = (color >>> 8) & 0xff, b = color & 0xff, a = color >>> 24;
	for (let y = startY; y < bottom; y++) {
		const px = startX + 0.5 - originX, py = y + 0.5 - originY;
		let s = (px * yy - py * yx) * sign, t = (xx * py - xy * px) * sign;
		let offset = (y * width + startX) * 4;
		for (let x = startX; x < right; x++, s += stepSX, t += stepTX, offset += 4) {
			if (s < 0 || s > area || t < 0 || t > area
				|| (s === 0 && !includeS0) || (s === area && includeS0)
				|| (t === 0 && !includeT0) || (t === area && includeT0)) continue;
			blendPixel(target, offset, r, g, b, a);
		}
	}
}

function drawPoly(context: HeadlessHost2DContext, command: PolyRenderSubmission): void {
	const points = command.points;
	const { scale, offsetX, offsetY } = context.transform.logical;
	for (let index = 0; index + 3 < points.length; index += 2) {
		drawLine(context, points[index] * scale + offsetX, points[index + 1] * scale + offsetY,
			points[index + 2] * scale + offsetX, points[index + 3] * scale + offsetY, command.thickness, command.color);
	}
}

function drawLine(context: HeadlessHost2DContext, x0: number, y0: number, x1: number, y1: number, thickness: number, colorValue: color): void {
	let ix0 = Math.trunc(x0);
	let iy0 = Math.trunc(y0);
	const ix1 = Math.trunc(x1);
	const iy1 = Math.trunc(y1);
	let dx = ix1 - ix0;
	let dy = iy1 - iy0;
	const sx = dx < 0 ? -1 : 1;
	const sy = dy < 0 ? -1 : 1;
	if (dx < 0) dx = -dx;
	if (dy < 0) dy = -dy;
	let err = dx - dy;
	const thicknessPixels = Math.trunc(thickness);
	const half = thicknessPixels >> 1;
	const { viewportScaleX, viewportScaleY } = context.transform;
	for (; ;) {
		fillRect(context, Math.trunc((ix0 - half) * viewportScaleX), Math.trunc((iy0 - half) * viewportScaleY),
			Math.trunc((ix0 - half + thicknessPixels) * viewportScaleX), Math.trunc((iy0 - half + thicknessPixels) * viewportScaleY), colorValue);
		if (ix0 === ix1 && iy0 === iy1) {
			return;
		}
		const e2 = err * 2;
		if (e2 > -dy) {
			err -= dy;
			ix0 += sx;
		}
		if (e2 < dx) {
			err += dx;
			iy0 += sy;
		}
	}
}

function drawImage(context: HeadlessHost2DContext, command: HostImageRenderSubmission): void {
	const source = hostSystemAtlasImage(command.imgid);
	const scale = command.scale;
	const flip = command.flip;
	const transform = context.transform;
	drawHostAtlasRect(
		context,
		source.u,
		source.v,
		source.w,
		source.h,
		command.pos.x * transform.scaleX + transform.offsetX,
		command.pos.y * transform.scaleY + transform.offsetY,
		source.width * scale.x * transform.scaleX,
		source.height * scale.y * transform.scaleY,
		flip.flip_h,
		flip.flip_v,
		command.colorize,
	);
}

function drawBatchBlit(context: HeadlessHost2DContext, command: GlyphRenderSubmission): void {
	context.colorValue = command.color;
	context.backgroundColor = command.background_color;
	context.lineHeight = command.font.lineHeight;
	if (command.has_background_color) forEachBatchBlitGlyph(command, context, drawGlyphBackground);
	forEachBatchBlitGlyph(command, context, command.font.sampling === 'linear' ? drawLinearHostGlyph : drawHeadlessGlyph);
}

function drawGlyphBackground(context: HeadlessHost2DContext, item: FontGlyph, x: number, y: number): void {
	const { scaleX, scaleY, offsetX, offsetY } = context.transform;
	const left = Math.trunc(x * scaleX + offsetX), top = Math.trunc(y * scaleY + offsetY);
	fillRect(context, left, top, left + Math.trunc(item.advance * scaleX), top + Math.trunc(context.lineHeight * scaleY), context.backgroundColor);
}

function drawHeadlessGlyph(context: HeadlessHost2DContext, item: FontGlyph, x: number, y: number): void {
	const { scaleX, scaleY, offsetX, offsetY } = context.transform;
	const source = item.rect;
	drawHostAtlasRect(
		context,
		source.u,
		source.v,
		source.w,
		source.h,
		x * scaleX + offsetX,
		y * scaleY + offsetY,
		item.width * scaleX,
		item.height * scaleY,
		false,
		false,
		context.colorValue,
	);
}

function fillRect(context: HeadlessHost2DContext, left: number, top: number, right: number, bottom: number, colorValue: color): void {
	const target = context.target;
	const width = context.width;
	const clip = context.clip;
	left = Math.max(clip.left, left);
	top = Math.max(clip.top, top);
	right = Math.min(clip.right, right);
	bottom = Math.min(clip.bottom, bottom);
	const r = (colorValue >>> 16) & 0xff, g = (colorValue >>> 8) & 0xff, b = colorValue & 0xff, a = (colorValue >>> 24) & 0xff;
	for (let y = top; y < bottom; y += 1) {
		let offset = (y * width + left) * 4;
		for (let x = left; x < right; x += 1) {
			blendPixel(target, offset, r, g, b, a);
			offset += 4;
		}
	}
}

function drawHostAtlasRect(context: HeadlessHost2DContext,
	sourceX: number,
	sourceY: number,
	sourceW: number,
	sourceH: number,
	dstX: number,
	dstY: number,
	dstW: number,
	dstH: number,
	flipH: boolean,
	flipV: boolean,
	colorValue: color): void {
	const target = context.target;
	const width = context.width;
	const clip = context.clip;
	const atlas = HOST_SYSTEM_ATLAS.pixels;
	const colorR = (colorValue >>> 16) & 0xff, colorG = (colorValue >>> 8) & 0xff, colorB = colorValue & 0xff, colorA = (colorValue >>> 24) & 0xff;
	const dstXi = Math.trunc(dstX);
	const dstYi = Math.trunc(dstY);
	const dstWi = Math.trunc(dstW);
	const dstHi = Math.trunc(dstH);
	let startX = dstXi;
	let startY = dstYi;
	let endX = dstXi + dstWi;
	let endY = dstYi + dstHi;
	if (startX < clip.left) startX = clip.left;
	if (startY < clip.top) startY = clip.top;
	if (endX > clip.right) endX = clip.right;
	if (endY > clip.bottom) endY = clip.bottom;
	for (let y = startY; y < endY; y += 1) {
		const relY = y - dstYi;
		const sampleY = flipV ? (dstHi - 1 - relY) : relY;
		const srcY = sourceY + ((sampleY * sourceH / dstHi) | 0);
		for (let x = startX; x < endX; x += 1) {
			const relX = x - dstXi;
			const sampleX = flipH ? (dstWi - 1 - relX) : relX;
			const srcX = sourceX + ((sampleX * sourceW / dstWi) | 0);
			const srcOffset = (srcY * HOST_SYSTEM_ATLAS.width + srcX) * 4;
			const sourceAlpha = (atlas[srcOffset + 3] * colorA + 127) / 255;
			blendPixel(
				target,
				(y * width + x) * 4,
				(atlas[srcOffset + 0] * colorR + 127) / 255,
				(atlas[srcOffset + 1] * colorG + 127) / 255,
				(atlas[srcOffset + 2] * colorB + 127) / 255,
				sourceAlpha,
			);
		}
	}
}
