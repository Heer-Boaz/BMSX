import { FeatureQueue } from '../../common/feature_queue';
import { packLowHigh16 } from '../../machine/common/word';
import {
	IO_VDP_SLOT_PRIMARY_ATLAS,
	IO_VDP_SLOT_SECONDARY_ATLAS,
	VDP_SLOT_PRIMARY,
	VDP_SLOT_SECONDARY,
	VDP_SLOT_SYSTEM,
	VDP_SYSTEM_ATLAS_ID,
} from '../../machine/bus/io';
import { packFrameBufferColorWord } from '../../machine/devices/vdp/blitter';
import { FIX16_SCALE, toSignedWord } from '../../machine/common/numeric';
import {
	encodeVdpDrawCtrl,
	encodeVdpLayerPriority,
	VDP_CMD_BLIT,
	VDP_CMD_DRAW_LINE,
	VDP_CMD_FILL_RECT,
	VDP_REG_DRAW_COLOR,
	VDP_REG_DRAW_CTRL,
	VDP_REG_DRAW_LAYER_PRIO,
	VDP_REG_DRAW_SCALE_X,
	VDP_REG_DRAW_SCALE_Y,
	VDP_REG_DST_X,
	VDP_REG_DST_Y,
	VDP_REG_GEOM_X0,
	VDP_REG_GEOM_X1,
	VDP_REG_GEOM_Y0,
	VDP_REG_GEOM_Y1,
	VDP_REG_LINE_WIDTH,
	VDP_REG_SRC_SLOT,
	VDP_REG_SRC_UV,
	VDP_REG_SRC_WH,
} from '../../machine/devices/vdp/registers';
import {
	renderLayerTo2dLayer,
} from './submissions';
import type {
	color,
	GlyphRenderSubmission,
	ImgRenderSubmission,
	MeshRenderSubmission,
	ParticleRenderSubmission,
	PolyRenderSubmission,
	RectRenderSubmission,
	RenderLayer,
} from './submissions';
import type { Runtime } from '../../machine/runtime/runtime';
import { BFont } from './bitmap_font';
import { shallowcopy } from '../../common/shallowcopy';

const meshQueue = new FeatureQueue<MeshRenderSubmission>(256);
const particleQueue = new FeatureQueue<ParticleRenderSubmission>(1024);
let activeQueueSource: 'front' | 'back' = 'front';

function submitSpriteDirect(runtime: Runtime, slot: number, u: number, v: number, w: number, h: number, x: number, y: number, z: number, scaleX: number, scaleY: number, colorize: color, layer: RenderLayer, parallaxWeight: number, flipH = false, flipV = false): void {
	const vdp = runtime.machine.vdp;
	vdp.writeVdpRegister(VDP_REG_SRC_SLOT, slot);
	vdp.writeVdpRegister(VDP_REG_SRC_UV, packLowHigh16(u, v));
	vdp.writeVdpRegister(VDP_REG_SRC_WH, packLowHigh16(w, h));
	vdp.writeVdpRegister(VDP_REG_DST_X, toSignedWord(FIX16_SCALE * x));
	vdp.writeVdpRegister(VDP_REG_DST_Y, toSignedWord(FIX16_SCALE * y));
	vdp.writeVdpRegister(VDP_REG_DRAW_LAYER_PRIO, encodeVdpLayerPriority(renderLayerTo2dLayer(layer), z));
	vdp.writeVdpRegister(VDP_REG_DRAW_SCALE_X, toSignedWord(FIX16_SCALE * scaleX));
	vdp.writeVdpRegister(VDP_REG_DRAW_SCALE_Y, toSignedWord(FIX16_SCALE * scaleY));
	vdp.writeVdpRegister(VDP_REG_DRAW_CTRL, encodeVdpDrawCtrl(flipH, flipV, 0, parallaxWeight));
	vdp.writeVdpRegister(VDP_REG_DRAW_COLOR, packFrameBufferColorWord(colorize));
	vdp.consumeDirectVdpCommand(VDP_CMD_BLIT);
}

function submitFillRectDirect(runtime: Runtime, x0: number, y0: number, x1: number, y1: number, z: number, layer: RenderLayer, colorValue: color): void {
	const vdp = runtime.machine.vdp;
	writeGeometryRegisters(vdp, x0, y0, x1, y1, z, layer, colorValue);
	vdp.consumeDirectVdpCommand(VDP_CMD_FILL_RECT);
}

function writeGeometryRegisters(vdp: Runtime['machine']['vdp'], x0: number, y0: number, x1: number, y1: number, z: number, layer: RenderLayer, colorValue: color): void {
	vdp.writeVdpRegister(VDP_REG_GEOM_X0, toSignedWord(FIX16_SCALE * x0));
	vdp.writeVdpRegister(VDP_REG_GEOM_Y0, toSignedWord(FIX16_SCALE * y0));
	vdp.writeVdpRegister(VDP_REG_GEOM_X1, toSignedWord(FIX16_SCALE * x1));
	vdp.writeVdpRegister(VDP_REG_GEOM_Y1, toSignedWord(FIX16_SCALE * y1));
	vdp.writeVdpRegister(VDP_REG_DRAW_LAYER_PRIO, encodeVdpLayerPriority(renderLayerTo2dLayer(layer), z));
	vdp.writeVdpRegister(VDP_REG_DRAW_COLOR, packFrameBufferColorWord(colorValue));
}

function submitLineDirect(runtime: Runtime, x0: number, y0: number, x1: number, y1: number, z: number, layer: RenderLayer, colorValue: color, thickness: number): void {
	const vdp = runtime.machine.vdp;
	writeGeometryRegisters(vdp, x0, y0, x1, y1, z, layer, colorValue);
	vdp.writeVdpRegister(VDP_REG_LINE_WIDTH, toSignedWord(FIX16_SCALE * thickness));
	vdp.consumeDirectVdpCommand(VDP_CMD_DRAW_LINE);
}

// --- 2D framebuffer helpers -------------------------------------------------

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

export function prepareCompletedRenderQueues(): void {
	meshQueue.swap();
	particleQueue.swap();
	prepareHeldRenderQueues();
}

function hasCommittedFrontQueueContent(): boolean {
	return meshQueue.sizeFront() > 0
		|| particleQueue.sizeFront() > 0;
}

export function preparePartialRenderQueues(): void {
	activeQueueSource = hasCommittedFrontQueueContent()
		? 'front'
		: (hasPendingBackQueueContent() ? 'back' : 'front');
}

export function prepareOverlayRenderQueues(): void {
	activeQueueSource = 'back';
}

export function prepareHeldRenderQueues(): void {
	activeQueueSource = 'front';
}

export function hasPendingBackQueueContent(): boolean {
	return meshQueue.sizeBack() > 0
		|| particleQueue.sizeBack() > 0;
}

export function clearBackQueues(): void {
	meshQueue.clearBack();
	particleQueue.clearBack();
	prepareHeldRenderQueues();
}

export function clearAllQueues(runtime: Runtime): void {
	const vdp = runtime.machine.vdp;
	vdp.initializeRegisters();
	meshQueue.clearAll();
	particleQueue.clearAll();
	prepareHeldRenderQueues();
}

// --- Mesh queue helpers -----------------------------------------------------

export function submitMesh(item: MeshRenderSubmission): void {
	meshQueue.submit(item);
}

export function beginMeshQueue(): number {
	return activeQueueSource === 'back' ? meshQueue.sizeBack() : meshQueue.sizeFront();
}

export function forEachMeshQueue(fn: (item: MeshRenderSubmission, index: number) => void): void {
	if (activeQueueSource === 'back') {
		meshQueue.forEachBack(fn);
		return;
	}
	meshQueue.forEachFront(fn);
}

export function meshQueueBackSize(): number {
	return meshQueue.sizeBack();
}

export function meshQueueFrontSize(): number {
	return meshQueue.sizeFront();
}

// --- Particle queue helpers -------------------------------------------------

export function submit_particle(item: ParticleRenderSubmission): void {
	particleQueue.submit(item);
}

export function beginParticleQueue(): number {
	return activeQueueSource === 'back' ? particleQueue.sizeBack() : particleQueue.sizeFront();
}

export function forEachParticleQueue(fn: (item: ParticleRenderSubmission, index: number) => void): void {
	if (activeQueueSource === 'back') {
		particleQueue.forEachBack(fn);
		return;
	}
	particleQueue.forEachFront(fn);
}

export function particleQueueBackSize(): number {
	return particleQueue.sizeBack();
}

export function particleQueueFrontSize(): number {
	return particleQueue.sizeFront();
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

export function submitGlyphs(runtime: Runtime, o: GlyphRenderSubmission) {
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

export function correctAreaStartEnd(x: number, y: number, ex: number, ey: number): [number, number, number, number] {
	if (ex < x) { [x, ex] = [ex, x]; }
	if (ey < y) { [y, ey] = [ey, y]; }
	return [x, y, ex, ey];
}
export function getQueuedParticleCount(): number { return particleQueueBackSize(); }
export let particleAmbientModeDefault: 0 | 1 = 0;
export let particleAmbientFactorDefault = 1.0;

export function setAmbientDefaults(mode: 0 | 1, factor = 1.0): void {
	particleAmbientModeDefault = mode;
	particleAmbientFactorDefault = factor;
}

export let _skyTint: [number, number, number] = [1, 1, 1];
export let _skyExposure = 1.0;
export function setSkyboxTintExposure(tint: [number, number, number], exposure = 1.0): void {
	_skyTint = shallowcopy(tint);
	_skyExposure = exposure;
}
/**
 * Text rendering utility (engine-level). Preferred UE-style usage is via TextComponent + TextRenderSystem, which uses this internally.
 */
export function renderGlyphs(runtime: Runtime, x: number, y: number, textToWrite: string | string[], start: number, end: number, z: number, font: BFont, color: color, backgroundColor: color | undefined, layer: RenderLayer): void {
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

/**
 * Calculates the X coordinate for centering a block of text on the screen.
 *
 * This method determines the longest line of text from `this.fullTextLines`,
 * calculates its width in pixels, and then computes the X coordinate needed
 * to center this line on a screen with a fixed width of 256 pixels.
 *
 * @param fullTextLines - The array of text lines to be centered.
 * @param charWidth - The width of each character in pixels.
 * @param blockWidth - The total width of the block to center the text within.
 * @returns The X coordinate for centering the text block.
 */
export function calculateCenteredBlockX(fullTextLines: string[], charWidth: number, blockWidth: number): number {
	const longestLine = fullTextLines.reduce((a, b) => a.length > b.length ? a : b, '');
	const longestLineWidth = longestLine.length * charWidth;
	return (blockWidth - longestLineWidth) / 2;
}

/**
 * Splits a given text into an array of strings, where each string represents a line of text
 * that does not exceed the maximum number of characters per line. The method also respects
 * newline characters in the input text.
 *
 * @param text - The input text to be wrapped into lines.
 * @param maxLineLength - The maximum number of characters allowed per line.
 * @returns An array of strings, where each string is a line of text.
 */
export function wrapGlyphs(text: string, maxLineLength: number): string[] {
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
