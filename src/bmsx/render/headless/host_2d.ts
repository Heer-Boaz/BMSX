import {
	HOST_SYSTEM_ATLAS_WIDTH,
	hostSystemAtlasImage,
	hostSystemAtlasPixels,
} from '../../rompack/host_system_atlas';
import { forEachGlyphRunGlyph } from '../shared/glyph_runs';
import type { Host2DKind, Host2DRef, Host2DSubmission } from '../shared/queues';
import type {
	GlyphRenderSubmission,
	HostImageRenderSubmission,
	PolyRenderSubmission,
	RectRenderSubmission,
	color,
} from '../shared/submissions';
import { RectRenderKind } from '../shared/submissions';
import { blendPixel } from './pixel_ops';

export function renderHeadlessSubmissions(target: Uint8Array, width: number, height: number, commands: readonly Host2DSubmission[]): void {
	for (let index = 0; index < commands.length; index += 1) {
		renderHeadlessHost2DSubmission(target, width, height, commands[index]);
	}
}

export function renderHeadlessHost2DSubmission(target: Uint8Array, width: number, height: number, command: Host2DSubmission): void {
	switch (command.type) {
		case 'rect':
			drawRect(target, width, height, command);
			return;
		case 'glyphs':
			drawGlyphRun(target, width, height, command);
			return;
		case 'img':
			drawImage(target, width, height, command);
			return;
		case 'poly':
			drawPoly(target, width, height, command);
			return;
	}
}

export function renderHeadlessHost2DEntry(target: Uint8Array, width: number, height: number, kind: Host2DKind, item: Host2DRef): void {
	switch (kind) {
		case 'rect':
			drawRect(target, width, height, item as RectRenderSubmission);
			return;
		case 'glyphs':
			drawGlyphRun(target, width, height, item as GlyphRenderSubmission);
			return;
		case 'img':
			drawImage(target, width, height, item as HostImageRenderSubmission);
			return;
		case 'poly':
			drawPoly(target, width, height, item as PolyRenderSubmission);
			return;
	}
}

function drawRect(target: Uint8Array, width: number, height: number, command: RectRenderSubmission): void {
	const area = command.area;
	const colorValue = command.color;
	if (command.kind === RectRenderKind.Fill) {
		fillRect(target, width, height, area.left | 0, area.top | 0, area.right | 0, area.bottom | 0, colorValue);
		return;
	}
	fillRect(target, width, height, area.left | 0, area.top | 0, area.right | 0, (area.top + 1) | 0, colorValue);
	fillRect(target, width, height, area.left | 0, (area.bottom - 1) | 0, area.right | 0, area.bottom | 0, colorValue);
	fillRect(target, width, height, area.left | 0, area.top | 0, (area.left + 1) | 0, area.bottom | 0, colorValue);
	fillRect(target, width, height, (area.right - 1) | 0, area.top | 0, area.right | 0, area.bottom | 0, colorValue);
}

function drawPoly(target: Uint8Array, width: number, height: number, command: PolyRenderSubmission): void {
	const points = command.points;
	for (let index = 0; index + 3 < points.length; index += 2) {
		drawLine(target, width, height, points[index], points[index + 1], points[index + 2], points[index + 3], command.thickness, command.color);
	}
}

function drawLine(target: Uint8Array, width: number, height: number, x0: number, y0: number, x1: number, y1: number, thickness: number, colorValue: color): void {
	let ix0 = x0 | 0;
	let iy0 = y0 | 0;
	const ix1 = x1 | 0;
	const iy1 = y1 | 0;
	let dx = ix1 - ix0;
	let dy = iy1 - iy0;
	const sx = dx < 0 ? -1 : 1;
	const sy = dy < 0 ? -1 : 1;
	if (dx < 0) dx = -dx;
	if (dy < 0) dy = -dy;
	let err = dx - dy;
	const half = (thickness / 2) | 0;
	for (;;) {
		fillRect(target, width, height, ix0 - half, iy0 - half, ix0 + half + 1, iy0 + half + 1, colorValue);
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

function drawImage(target: Uint8Array, width: number, height: number, command: HostImageRenderSubmission): void {
	const source = hostSystemAtlasImage(command.imgid);
	const scale = command.scale;
	const flip = command.flip;
	drawHostAtlasRect(
		target,
		width,
		height,
		source.u,
		source.v,
		source.w,
		source.h,
		command.pos.x | 0,
		command.pos.y | 0,
		(source.w * scale.x) | 0,
		(source.h * scale.y) | 0,
		flip.flip_h,
		flip.flip_v,
		command.colorize,
	);
}

function drawGlyphRun(target: Uint8Array, width: number, height: number, command: GlyphRenderSubmission): void {
	const colorValue = command.color;
	const hasBackgroundColor = command.has_background_color;
	const backgroundColor = command.background_color;
	const lineHeight = command.font.lineHeight;
	forEachGlyphRunGlyph(command, (glyph, x, y) => {
		if (hasBackgroundColor) {
			fillRect(
				target,
				width,
				height,
				x | 0,
				y | 0,
				(x + glyph.advance) | 0,
				(y + lineHeight) | 0,
				backgroundColor,
			);
		}
		const source = hostSystemAtlasImage(glyph.imgid);
		drawHostAtlasRect(
			target,
			width,
			height,
			source.u,
			source.v,
			source.w,
			source.h,
			x | 0,
			y | 0,
			glyph.width,
			glyph.height,
			false,
			false,
			colorValue,
		);
	});
}

function fillRect(target: Uint8Array, width: number, height: number, left: number, top: number, right: number, bottom: number, colorValue: color): void {
	if (left < 0) left = 0;
	if (top < 0) top = 0;
	if (right > width) right = width;
	if (bottom > height) bottom = height;
	const r = (colorValue >>> 16) & 0xff, g = (colorValue >>> 8) & 0xff, b = colorValue & 0xff, a = (colorValue >>> 24) & 0xff;
	for (let y = top; y < bottom; y += 1) {
		let offset = (y * width + left) * 4;
		for (let x = left; x < right; x += 1) {
			blendPixel(target, offset, r, g, b, a);
			offset += 4;
		}
	}
}

function drawHostAtlasRect(target: Uint8Array,
	width: number,
	height: number,
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
	const atlas = hostSystemAtlasPixels();
	const colorR = (colorValue >>> 16) & 0xff, colorG = (colorValue >>> 8) & 0xff, colorB = colorValue & 0xff, colorA = (colorValue >>> 24) & 0xff;
	let startX = dstX;
	let startY = dstY;
	let endX = dstX + dstW;
	let endY = dstY + dstH;
	if (startX < 0) startX = 0;
	if (startY < 0) startY = 0;
	if (endX > width) endX = width;
	if (endY > height) endY = height;
	for (let y = startY; y < endY; y += 1) {
		const relY = y - dstY;
		const sampleY = flipV ? (dstH - 1 - relY) : relY;
		const srcY = sourceY + (((sampleY * sourceH) / dstH) | 0);
		for (let x = startX; x < endX; x += 1) {
			const relX = x - dstX;
			const sampleX = flipH ? (dstW - 1 - relX) : relX;
			const srcX = sourceX + (((sampleX * sourceW) / dstW) | 0);
			const srcOffset = (srcY * HOST_SYSTEM_ATLAS_WIDTH + srcX) * 4;
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
