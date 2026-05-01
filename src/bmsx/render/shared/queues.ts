import { FeatureQueue } from '../../common/feature_queue';
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
	runtime.machine.vdp.enqueueBlit(
			slot,
			u,
			v,
			w,
			h,
		x,
		y,
		z,
		renderLayerTo2dLayer(layer),
		scaleX,
		scaleY,
		flipH,
		flipV,
		colorize,
		parallaxWeight,
	);
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

export function resetTransientState(): void {
	clearBackQueues();
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

export function submit_particle(runtime: Runtime, item: ParticleRenderSubmission): void {
	if (item.slot === undefined || item.u === undefined || item.v === undefined || item.w === undefined || item.h === undefined) {
		throw new Error('submit_particle requires slot/u/v/w/h.');
	}
	const sample = runtime.machine.vdp.resolveBlitterSample({
		slot: item.slot,
		u: item.u,
		v: item.v,
		w: item.w,
		h: item.h,
	});
	const u0 = sample.source.srcX / sample.surfaceWidth;
	const v0 = sample.source.srcY / sample.surfaceHeight;
	const u1 = (sample.source.srcX + sample.source.width) / sample.surfaceWidth;
	const v1 = (sample.source.srcY + sample.source.height) / sample.surfaceHeight;
	item.uv0 = [u0, v0];
	item.uv1 = [u1, v1];
	item.slot = sample.slot;
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
		runtime.machine.vdp.enqueueFillRect(x, y, ex, ey, z, renderLayerTo2dLayer(options.layer), options.color);
		return;
	}
	runtime.machine.vdp.enqueueDrawRect(x, y, ex, ey, z, renderLayerTo2dLayer(options.layer), options.color);
}

export function submitDrawPolygon(runtime: Runtime, options: PolyRenderSubmission): void {
	if (options.thickness === undefined) {
		throw new Error('submitDrawPolygon requires thickness.');
	}
	if (options.layer === undefined) {
		throw new Error('submitDrawPolygon requires layer.');
	}
	runtime.machine.vdp.enqueueDrawPoly(options.points, options.z, options.color, options.thickness, renderLayerTo2dLayer(options.layer));
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
	runtime.machine.vdp.enqueueGlyphRun(
		textToWrite,
		x,
		y,
		z,
		font,
		color,
		backgroundColor,
		start,
		end,
		renderLayerTo2dLayer(layer),
	);
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
