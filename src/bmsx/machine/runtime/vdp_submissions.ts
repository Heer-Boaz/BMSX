import { packLowHigh16 } from '../common/word';
import {
	IO_VDP_CMD,
	IO_VDP_REG_DRAW_COLOR,
	IO_VDP_REG_DRAW_CTRL,
	IO_VDP_REG_DRAW_LAYER_PRIO,
	IO_VDP_REG_DRAW_SCALE_X,
	IO_VDP_REG_DRAW_SCALE_Y,
	IO_VDP_REG_DST_X,
	IO_VDP_REG_DST_Y,
	IO_VDP_REG_GEOM_X0,
	IO_VDP_REG_GEOM_X1,
	IO_VDP_REG_GEOM_Y0,
	IO_VDP_REG_GEOM_Y1,
	IO_VDP_REG_LINE_WIDTH,
	IO_VDP_REG_SRC_SLOT,
	IO_VDP_REG_SRC_UV,
	IO_VDP_REG_SRC_WH,
	IO_VDP_SLOT_PRIMARY_ATLAS,
	IO_VDP_SLOT_SECONDARY_ATLAS,
	VDP_SLOT_PRIMARY,
	VDP_SLOT_SECONDARY,
	VDP_SLOT_SYSTEM,
	VDP_SYSTEM_ATLAS_ID,
} from '../bus/io';
import { FIX16_SCALE, toSignedWord } from '../common/numeric';
import { packFrameBufferColorWord } from '../devices/vdp/blitter';
import {
	encodeVdpDrawCtrl,
	encodeVdpLayerPriority,
	VDP_CMD_BLIT,
	VDP_CMD_DRAW_LINE,
	VDP_CMD_FILL_RECT,
} from '../devices/vdp/registers';
import type { Runtime } from './runtime';
import type { BFont } from '../../render/shared/bitmap_font';
import {
	renderLayerTo2dLayer,
	type color,
	type GlyphRenderSubmission,
	type ImgRenderSubmission,
	type PolyRenderSubmission,
	type RectRenderSubmission,
	type RenderLayer,
} from '../../render/shared/submissions';

function submitSpriteDirect(runtime: Runtime, slot: number, u: number, v: number, w: number, h: number, x: number, y: number, z: number, scaleX: number, scaleY: number, colorize: color, layer: RenderLayer, parallaxWeight: number, flipH = false, flipV = false): void {
	const memory = runtime.machine.memory;
	memory.writeValue(IO_VDP_REG_SRC_SLOT, slot);
	memory.writeValue(IO_VDP_REG_SRC_UV, packLowHigh16(u, v));
	memory.writeValue(IO_VDP_REG_SRC_WH, packLowHigh16(w, h));
	memory.writeValue(IO_VDP_REG_DST_X, toSignedWord(FIX16_SCALE * x));
	memory.writeValue(IO_VDP_REG_DST_Y, toSignedWord(FIX16_SCALE * y));
	memory.writeValue(IO_VDP_REG_DRAW_LAYER_PRIO, encodeVdpLayerPriority(renderLayerTo2dLayer(layer), z));
	memory.writeValue(IO_VDP_REG_DRAW_SCALE_X, toSignedWord(FIX16_SCALE * scaleX));
	memory.writeValue(IO_VDP_REG_DRAW_SCALE_Y, toSignedWord(FIX16_SCALE * scaleY));
	memory.writeValue(IO_VDP_REG_DRAW_CTRL, encodeVdpDrawCtrl(flipH, flipV, 0, parallaxWeight));
	memory.writeValue(IO_VDP_REG_DRAW_COLOR, packFrameBufferColorWord(colorize));
	memory.writeValue(IO_VDP_CMD, VDP_CMD_BLIT);
}

function writeGeometryRegisters(runtime: Runtime, x0: number, y0: number, x1: number, y1: number, z: number, layer: RenderLayer, colorValue: color): void {
	const memory = runtime.machine.memory;
	memory.writeValue(IO_VDP_REG_GEOM_X0, toSignedWord(FIX16_SCALE * x0));
	memory.writeValue(IO_VDP_REG_GEOM_Y0, toSignedWord(FIX16_SCALE * y0));
	memory.writeValue(IO_VDP_REG_GEOM_X1, toSignedWord(FIX16_SCALE * x1));
	memory.writeValue(IO_VDP_REG_GEOM_Y1, toSignedWord(FIX16_SCALE * y1));
	memory.writeValue(IO_VDP_REG_DRAW_LAYER_PRIO, encodeVdpLayerPriority(renderLayerTo2dLayer(layer), z));
	memory.writeValue(IO_VDP_REG_DRAW_COLOR, packFrameBufferColorWord(colorValue));
}

function submitFillRectDirect(runtime: Runtime, x0: number, y0: number, x1: number, y1: number, z: number, layer: RenderLayer, colorValue: color): void {
	writeGeometryRegisters(runtime, x0, y0, x1, y1, z, layer, colorValue);
	runtime.machine.memory.writeValue(IO_VDP_CMD, VDP_CMD_FILL_RECT);
}

function submitLineDirect(runtime: Runtime, x0: number, y0: number, x1: number, y1: number, z: number, layer: RenderLayer, colorValue: color, thickness: number): void {
	writeGeometryRegisters(runtime, x0, y0, x1, y1, z, layer, colorValue);
	runtime.machine.memory.writeValue(IO_VDP_REG_LINE_WIDTH, toSignedWord(FIX16_SCALE * thickness));
	runtime.machine.memory.writeValue(IO_VDP_CMD, VDP_CMD_DRAW_LINE);
}

export function submitSprite(runtime: Runtime, options: ImgRenderSubmission): void {
	if (options.slot === undefined || options.u === undefined || options.v === undefined || options.w === undefined || options.h === undefined) {
		throw new Error('submitSprite requires slot/u/v/w/h.');
	}
	if (options.scale === undefined) {
		throw new Error('submitSprite requires scale.');
	}
	if (options.flip === undefined) {
		throw new Error('submitSprite requires flip.');
	}
	if (options.colorize === undefined) {
		throw new Error('submitSprite requires colorize.');
	}
	if (options.layer === undefined) {
		throw new Error('submitSprite requires layer.');
	}
	submitSpriteDirect(
		runtime,
		options.slot,
		options.u,
		options.v,
		options.w,
		options.h,
		options.pos.x,
		options.pos.y,
		options.pos.z,
		options.scale.x,
		options.scale.y,
		options.colorize,
		options.layer,
		options.parallax_weight ?? 0,
		options.flip.flip_h,
		options.flip.flip_v,
	);
}

export function submitRectangle(runtime: Runtime, options: RectRenderSubmission): void {
	if (options.layer === undefined) {
		throw new Error('submitRectangle requires layer.');
	}
	let { left: x, top: y, z, right: ex, bottom: ey } = options.area;
	[x, y, ex, ey] = correctAreaStartEnd(x, y, ex, ey);
	if (options.kind === 'fill') {
		submitFillRectDirect(runtime, x, y, ex, ey, z, options.layer, options.color);
		return;
	}
	submitLineDirect(runtime, x, y, ex, y, z, options.layer, options.color, 1);
	submitLineDirect(runtime, ex, y, ex, ey, z, options.layer, options.color, 1);
	submitLineDirect(runtime, ex, ey, x, ey, z, options.layer, options.color, 1);
	submitLineDirect(runtime, x, ey, x, y, z, options.layer, options.color, 1);
}

export function submitDrawPolygon(runtime: Runtime, options: PolyRenderSubmission): void {
	if (options.thickness === undefined) {
		throw new Error('submitDrawPolygon requires thickness.');
	}
	if (options.layer === undefined) {
		throw new Error('submitDrawPolygon requires layer.');
	}
	for (let index = 0; index + 3 < options.points.length; index += 2) {
		submitLineDirect(runtime, options.points[index], options.points[index + 1], options.points[index + 2], options.points[index + 3], options.z, options.layer, options.color, options.thickness);
	}
}

export function submitGlyphs(runtime: Runtime, o: GlyphRenderSubmission): void {
	if (o.font === undefined) {
		throw new Error('submitGlyphs requires font.');
	}
	if (o.color === undefined) {
		throw new Error('submitGlyphs requires color.');
	}
	if (o.layer === undefined) {
		throw new Error('submitGlyphs requires layer.');
	}
	if (o.z === undefined) {
		throw new Error('submitGlyphs requires z.');
	}
	if (o.glyph_start === undefined) {
		throw new Error('submitGlyphs requires glyph_start.');
	}
	if (o.glyph_end === undefined) {
		throw new Error('submitGlyphs requires glyph_end.');
	}
	let lines: string | string[] = o.glyphs;
	if (typeof lines === 'string' && o.wrap_chars !== undefined && o.wrap_chars > 0) {
		lines = wrapGlyphs(lines, o.wrap_chars);
	}
	let xx = o.x;
	if (o.center_block_width && o.center_block_width > 0) {
		const arr = Array.isArray(lines) ? lines : [lines];
		xx += calculateCenteredBlockX(arr, o.font.char_width('a'), o.center_block_width);
	}

	renderGlyphs(
		runtime,
		xx,
		o.y,
		lines,
		o.glyph_start,
		o.glyph_end,
		o.z,
		o.font,
		o.color,
		o.background_color,
		o.layer,
	);
}

function correctAreaStartEnd(x: number, y: number, ex: number, ey: number): [number, number, number, number] {
	if (ex < x) { [x, ex] = [ex, x]; }
	if (ey < y) { [y, ey] = [ey, y]; }
	return [x, y, ex, ey];
}

function renderGlyphs(runtime: Runtime, x: number, y: number, textToWrite: string | string[], start: number, end: number, z: number, font: BFont, color: color, backgroundColor: color | undefined, layer: RenderLayer): void {
	let cursorY = y;
	if (typeof textToWrite === 'string') {
		renderGlyphLine(runtime, x, cursorY, textToWrite, start, end, z, font, color, backgroundColor, layer);
		return;
	}
	for (const line of textToWrite) {
		renderGlyphLine(runtime, x, cursorY, line, start, end, z, font, color, backgroundColor, layer);
		cursorY += font.lineHeight;
	}
}

function renderGlyphLine(runtime: Runtime, x: number, y: number, line: string, start: number, end: number, z: number, font: BFont, colorValue: color, backgroundColor: color | undefined, layer: RenderLayer): void {
	let cursorX = x;
	let glyphIndex = 0;
	for (const char of line) {
		const glyph = font.getGlyph(char);
		if (glyphIndex >= start && glyphIndex < end) {
			const rect = glyph.rect;
			if (backgroundColor !== undefined) {
				submitFillRectDirect(runtime, cursorX, y, cursorX + rect.w, y + rect.h, z, layer, backgroundColor);
			}
			submitSpriteDirect(runtime, resolveAtlasSlot(runtime, rect.atlasId), rect.u, rect.v, rect.w, rect.h, cursorX, y, z, 1, 1, colorValue, layer, 0);
		}
		cursorX += glyph.advance;
		glyphIndex += 1;
	}
}

function resolveAtlasSlot(runtime: Runtime, atlasId: number): number {
	if (atlasId === VDP_SYSTEM_ATLAS_ID) {
		return VDP_SLOT_SYSTEM;
	}
	if (runtime.machine.memory.readIoU32(IO_VDP_SLOT_PRIMARY_ATLAS) === atlasId) {
		return VDP_SLOT_PRIMARY;
	}
	if (runtime.machine.memory.readIoU32(IO_VDP_SLOT_SECONDARY_ATLAS) === atlasId) {
		return VDP_SLOT_SECONDARY;
	}
	throw new Error(`atlas ${atlasId} is not loaded in a VDP slot.`);
}

function calculateCenteredBlockX(fullTextLines: string[], charWidth: number, blockWidth: number): number {
	const longestLine = fullTextLines.reduce((a, b) => a.length > b.length ? a : b, '');
	const longestLineWidth = longestLine.length * charWidth;
	return (blockWidth - longestLineWidth) / 2;
}

function wrapGlyphs(text: string, maxLineLength: number): string[] {
	const words = text.match(/(\S+|\n)/g) || [];
	const lines: string[] = [];
	let currentLine = '';

	for (const word of words) {
		if (word === '\n') {
			lines.push(currentLine.trim());
			currentLine = '';
		} else {
			const tentativeLine = currentLine ? currentLine + ' ' + word : word;
			if (tentativeLine.length <= maxLineLength) {
				currentLine = tentativeLine;
			} else {
				if (currentLine) {
					lines.push(currentLine.trim());
					currentLine = word;
				} else {
					lines.push(word);
					currentLine = '';
				}
			}
		}
	}

	if (currentLine.trim()) {
		lines.push(currentLine.trim());
	}

	return lines;
}
