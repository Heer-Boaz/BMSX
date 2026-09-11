import {
	HOST_SYSTEM_ATLAS,
	hostSystemAtlasImage,
} from '../host_overlay/atlas';
import { forEachBatchBlitGlyph } from '../shared/glyph_runs';
import {
	Host2DKind,
	type Host2DRef,
} from '../host_overlay/commands';
import type {
	GlyphRenderSubmission,
	HostImageRenderSubmission,
	PolyRenderSubmission,
	RectRenderSubmission,
	color,
} from '../shared/submissions';
import { RectRenderKind } from '../shared/submissions';
import { blendPixel } from './pixel_ops';
import type { FontGlyph } from '../shared/bitmap_font';
import type { HostOverlayClipRect, HostOverlayClipState } from '../host_overlay/clip';
import { IDENTITY_HOST_OVERLAY_TRANSFORM, type HostOverlayTransform } from '../host_overlay/transform';

export type HeadlessHost2DContext = {
	target: Uint8Array;
	width: number;
	colorValue: number;
	hasBackgroundColor: boolean;
	backgroundColor: number;
	lineHeight: number;
	clip: HostOverlayClipState;
	transform: Readonly<HostOverlayTransform>;
};

export function beginHeadlessHost2D(context: HeadlessHost2DContext, target: Uint8Array, width: number, height: number): void {
	context.target = target;
	context.width = width;
	context.transform = IDENTITY_HOST_OVERLAY_TRANSFORM;
	context.clip.reset(width, height, width, height);
}

export function renderHeadlessHost2DEntry(context: HeadlessHost2DContext, kind: Host2DKind, item: Host2DRef): void {
	switch (kind) {
		case Host2DKind.Transform:
			context.transform = item as HostOverlayTransform;
			return;
		case Host2DKind.Clip:
			context.clip.set(item as HostOverlayClipRect);
			return;
		case Host2DKind.Rect:
			drawRect(context, item as RectRenderSubmission);
			return;
		case Host2DKind.Glyphs:
			drawBatchBlit(context, item as GlyphRenderSubmission);
			return;
		case Host2DKind.Img:
			drawImage(context, item as HostImageRenderSubmission);
			return;
		case Host2DKind.Poly:
			drawPoly(context, item as PolyRenderSubmission);
			return;
	}
}

function drawRect(context: HeadlessHost2DContext, command: RectRenderSubmission): void {
	const area = command.area;
	const { scale, offsetX, offsetY } = context.transform;
	const left = Math.trunc(area.left * scale + offsetX);
	const top = Math.trunc(area.top * scale + offsetY);
	const right = Math.trunc(area.right * scale + offsetX);
	const bottom = Math.trunc(area.bottom * scale + offsetY);
	const colorValue = command.color;
	if (command.kind === RectRenderKind.Fill) {
		fillRect(context, left, top, right, bottom, colorValue);
		return;
	}
	fillRect(context, left, top, right, top + 1, colorValue);
	fillRect(context, left, bottom - 1, right, bottom, colorValue);
	fillRect(context, left, top, left + 1, bottom, colorValue);
	fillRect(context, right - 1, top, right, bottom, colorValue);
}

function drawPoly(context: HeadlessHost2DContext, command: PolyRenderSubmission): void {
	const points = command.points;
	const { scale, offsetX, offsetY } = context.transform;
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
	for (; ;) {
		fillRect(context, ix0 - half, iy0 - half, ix0 - half + thicknessPixels, iy0 - half + thicknessPixels, colorValue);
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
		command.pos.x * transform.scale + transform.offsetX,
		command.pos.y * transform.scale + transform.offsetY,
		source.width * scale.x * transform.scale,
		source.height * scale.y * transform.scale,
		flip.flip_h,
		flip.flip_v,
		command.colorize,
	);
}

function drawBatchBlit(context: HeadlessHost2DContext, command: GlyphRenderSubmission): void {
	context.colorValue = command.color;
	context.hasBackgroundColor = command.has_background_color;
	context.backgroundColor = command.background_color;
	context.lineHeight = command.font.lineHeight;
	forEachBatchBlitGlyph(command, context, drawHeadlessGlyph);
}

function drawHeadlessGlyph(context: HeadlessHost2DContext, item: FontGlyph, x: number, y: number): void {
	const { scale, offsetX, offsetY } = context.transform;
	x = x * scale + offsetX;
	y = y * scale + offsetY;
	if (context.hasBackgroundColor) {
		const left = Math.trunc(x);
		const top = Math.trunc(y);
		fillRect(context, left, top, left + Math.trunc(item.advance * scale), top + Math.trunc(context.lineHeight * scale), context.backgroundColor);
	}
	const source = hostSystemAtlasImage(item.imgid);
	drawHostAtlasRect(
		context,
		source.u,
		source.v,
		source.w,
		source.h,
		x,
		y,
		item.width * scale,
		item.height * scale,
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
