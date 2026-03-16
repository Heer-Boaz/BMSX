import { FeatureQueue } from '../../utils/feature_queue';
import type { color, GlyphRenderSubmission, ImgRenderSubmission, MeshRenderSubmission, ParticleRenderSubmission, PolyRenderSubmission, RectRenderSubmission, SpriteParallaxRig } from './render_types';
import type { RenderLayer } from './render_types';
import { DEFAULT_ZCOORD } from '../backend/webgl/webgl.constants';
import { RenderSubmission } from '../backend/pipeline_interfaces';
import { ASSET_FLAG_VIEW, type AssetEntry } from '../../emulator/memory';
import { Runtime } from '../../emulator/runtime';
import { ENGINE_ATLAS_INDEX } from '../../rompack/rompack';
import { new_vec3, new_vec2 } from '../../utils/vector_operations';
import { clamp } from '../../utils/clamp';
import { BFont } from '../../core/font';
import { $ } from '../../core/engine_core';

export interface SpriteQueueItem {
	options: ImgRenderSubmission;
	entry: AssetEntry;
	baseEntry: AssetEntry;
	atlasId: number;
	submissionIndex: number;
}

const spriteQueue = new FeatureQueue<SpriteQueueItem>(256);
const meshQueue = new FeatureQueue<MeshRenderSubmission>(256);
const particleQueue = new FeatureQueue<ParticleRenderSubmission>(1024);
let spriteSubmissionCounter = 0;
let activeQueueSource: 'front' | 'back' = 'front';

type PlaybackImgSubmission = Extract<RenderSubmission, { type: 'img' }>;
type PlaybackMeshSubmission = Extract<RenderSubmission, { type: 'mesh' }>;
type PlaybackParticleSubmission = Extract<RenderSubmission, { type: 'particle' }>;

const DEFAULT_ASSET_ENTRY: AssetEntry = {
	id: 'none',
	idTokenLo: 0,
	idTokenHi: 0,
	type: 'image',
	flags: 0,
	ownerIndex: -1,
	baseAddr: 0,
	baseSize: 0,
	capacity: 0,
	baseStride: 0,
	regionX: 0,
	regionY: 0,
	regionW: 0,
	regionH: 0,
	sampleRate: 0,
	channels: 0,
	frames: 0,
	bitsPerSample: 0,
	audioDataOffset: 0,
	audioDataSize: 0,
};

const renderQueuePlaybackBuffer: RenderSubmission[] = [];

function createPlaybackImgSubmission(): PlaybackImgSubmission {
	return {
		type: 'img',
		imgid: 'none',
		pos: { x: 0, y: 0, z: DEFAULT_ZCOORD },
		scale: { x: 1, y: 1 },
		flip: { flip_h: false, flip_v: false },
		colorize: { r: 1, g: 1, b: 1, a: 1 },
		layer: undefined,
		ambient_affected: undefined,
		ambient_factor: undefined,
		parallax_weight: 0,
	};
}

function setPlaybackSpriteSubmission(index: number, src: ImgRenderSubmission): void {
	let op = renderQueuePlaybackBuffer[index] as PlaybackImgSubmission;
	if (!op || op.type !== 'img') {
		op = createPlaybackImgSubmission();
		renderQueuePlaybackBuffer[index] = op;
	}
	op.imgid = src.imgid;
	op.layer = src.layer;
	op.ambient_affected = src.ambient_affected;
	op.ambient_factor = src.ambient_factor;
	op.pos.x = src.pos.x;
	op.pos.y = src.pos.y;
	op.pos.z = src.pos.z;
	op.scale.x = src.scale.x;
	op.scale.y = src.scale.y;
	op.flip.flip_h = src.flip.flip_h;
	op.flip.flip_v = src.flip.flip_v;
	op.colorize.r = src.colorize.r;
	op.colorize.g = src.colorize.g;
	op.colorize.b = src.colorize.b;
	op.colorize.a = src.colorize.a;
	op.parallax_weight = src.parallax_weight ?? 0;
}

function setPlaybackMeshSubmission(index: number, src: MeshRenderSubmission): void {
	let op = renderQueuePlaybackBuffer[index] as PlaybackMeshSubmission;
	if (!op || op.type !== 'mesh') {
		op = { type: 'mesh', mesh: src.mesh, matrix: src.matrix };
		renderQueuePlaybackBuffer[index] = op;
	}
	op.mesh = src.mesh;
	op.matrix = src.matrix;
	op.joint_matrices = src.joint_matrices;
	op.morph_weights = src.morph_weights;
	op.receive_shadow = src.receive_shadow;
	op.layer = src.layer;
}

function setPlaybackParticleSubmission(index: number, src: ParticleRenderSubmission): void {
	let op = renderQueuePlaybackBuffer[index] as PlaybackParticleSubmission;
	if (!op || op.type !== 'particle') {
		op = {
			type: 'particle',
			position: src.position,
			size: src.size,
			color: src.color,
		};
		renderQueuePlaybackBuffer[index] = op;
	}
	op.position = src.position;
	op.size = src.size;
	op.color = src.color;
	op.texture = src.texture;
	op.ambient_mode = src.ambient_mode;
	op.ambient_factor = src.ambient_factor;
	op.layer = src.layer;
}

const spriteItemPoolA: SpriteQueueItem[] = [];
const spriteItemPoolB: SpriteQueueItem[] = [];
let spriteItemPool = spriteItemPoolA;
let spriteItemPoolAlt = spriteItemPoolB;
let spriteItemPoolIndex = 0;

function createSpriteQueueItem(): SpriteQueueItem {
	return {
		options: {
			imgid: 'none',
			pos: { x: 0, y: 0, z: DEFAULT_ZCOORD },
			scale: { x: 1, y: 1 },
			flip: { flip_h: false, flip_v: false },
			colorize: { r: 1, g: 1, b: 1, a: 1 },
			layer: undefined,
			ambient_affected: undefined,
			ambient_factor: undefined,
			parallax_weight: 0,
		},
		entry: DEFAULT_ASSET_ENTRY,
		baseEntry: DEFAULT_ASSET_ENTRY,
		atlasId: ENGINE_ATLAS_INDEX,
		submissionIndex: 0,
	};
}

function acquireSpriteQueueItem(): SpriteQueueItem {
	const index = spriteItemPoolIndex;
	spriteItemPoolIndex = index + 1;
	if (index >= spriteItemPool.length) {
		const created = createSpriteQueueItem();
		spriteItemPool.push(created);
		return created;
	}
	return spriteItemPool[index];
}

// --- Sprite queue helpers ---------------------------------------------------

export function submitSprite(options: ImgRenderSubmission): void {
	const submissionIndex = spriteSubmissionCounter++;
	const pooled = acquireSpriteQueueItem();
	pooled.submissionIndex = submissionIndex;

	const { imgid } = options;
	if (imgid === 'none') return;
	const runtime = Runtime.instance;
	const handle = runtime.resolveAssetHandle(imgid);
	const entry = runtime.getAssetEntryByHandle(handle);
	if (entry.type !== 'image') {
		throw new Error(`[Sprite Pipeline] Asset '${imgid}' is not an image.`);
	}
	const meta = runtime.getImageMetaByHandle(handle);
	if (meta.atlasid === undefined || meta.atlasid === null) {
		throw new Error(`[Sprite Pipeline] Image metadata missing atlas id for imgid '${imgid}'.`);
	}
	const baseEntry = (entry.flags & ASSET_FLAG_VIEW)
		? runtime.getAssetEntryByHandle(entry.ownerIndex)
		: entry;
	pooled.entry = entry;
	pooled.baseEntry = baseEntry;
	pooled.atlasId = meta.atlasid;
	const src = options;
	const dst = pooled.options;
	dst.imgid = src.imgid;
	dst.layer = src.layer;
	dst.ambient_affected = src.ambient_affected;
	dst.ambient_factor = src.ambient_factor;
	dst.pos.x = ~~src.pos.x;
	dst.pos.y = ~~src.pos.y;
	dst.pos.z = ~~src.pos.z;
	const scale = src.scale;
	if (scale) {
		dst.scale.x = scale.x;
		dst.scale.y = scale.y;
	} else {
		dst.scale.x = 1;
		dst.scale.y = 1;
	}
	const flip = src.flip;
	if (flip) {
		dst.flip.flip_h = flip.flip_h;
		dst.flip.flip_v = flip.flip_v;
	} else {
		dst.flip.flip_h = false;
		dst.flip.flip_v = false;
	}
	const colorize = src.colorize;
	if (colorize) {
		dst.colorize.r = colorize.r;
		dst.colorize.g = colorize.g;
		dst.colorize.b = colorize.b;
		dst.colorize.a = colorize.a;
	} else {
		dst.colorize.r = 1;
		dst.colorize.g = 1;
		dst.colorize.b = 1;
		dst.colorize.a = 1;
	}
	dst.parallax_weight = src.parallax_weight ?? 0;
	spriteQueue.submit(pooled);
}

export function beginSpriteQueue(): number {
	if (activeQueueSource === 'back') {
		sortSpriteBackQueueForRendering();
		return spriteQueue.sizeBack();
	}
	return spriteQueue.sizeFront();
}

export function prepareCompletedRenderQueues(): void {
	spriteSubmissionCounter = 0;
	spriteQueue.swap();
	meshQueue.swap();
	particleQueue.swap();
	const tmpPool = spriteItemPool;
	spriteItemPool = spriteItemPoolAlt;
	spriteItemPoolAlt = tmpPool;
	spriteItemPoolIndex = 0;
	sortSpriteQueueForRendering();
	activeQueueSource = 'front';
}

export function preparePartialRenderQueues(): void {
	activeQueueSource = hasPendingBackQueueContent() ? 'back' : 'front';
}

export function hasPendingBackQueueContent(): boolean {
	return spriteQueue.sizeBack() > 0
		|| meshQueue.sizeBack() > 0
		|| particleQueue.sizeBack() > 0;
}

export function clearBackQueues(): void {
	spriteSubmissionCounter = 0;
	spriteItemPoolIndex = 0;
	spriteQueue.clearBack();
	meshQueue.clearBack();
	particleQueue.clearBack();
	activeQueueSource = 'front';
}

function renderLayerWeight(layer?: RenderLayer): number {
	if (layer === 'ide') return 2;
	if (layer === 'ui') return 1;
	return 0;
}

function sortSpriteQueueForRendering(): void {
	spriteQueue.sortFront((a, b) => {
		const la = renderLayerWeight(a.options.layer);
		const lb = renderLayerWeight(b.options.layer);
		if (la !== lb) return la - lb;
		const za = a.options.pos.z ?? DEFAULT_ZCOORD;
		const zb = b.options.pos.z ?? DEFAULT_ZCOORD;
		if (za !== zb) return za - zb;
		return a.submissionIndex - b.submissionIndex;
	});
}

function sortSpriteBackQueueForRendering(): void {
	spriteQueue.sortBack((a, b) => {
		const la = renderLayerWeight(a.options.layer);
		const lb = renderLayerWeight(b.options.layer);
		if (la !== lb) return la - lb;
		const za = a.options.pos.z ?? DEFAULT_ZCOORD;
		const zb = b.options.pos.z ?? DEFAULT_ZCOORD;
		if (za !== zb) return za - zb;
		return a.submissionIndex - b.submissionIndex;
	});
}


export function sortSpriteQueue(compare: (a: SpriteQueueItem, b: SpriteQueueItem) => number): void {
	spriteQueue.sortFront(compare);
}

export function forEachSprite(fn: (item: SpriteQueueItem, index: number) => void): void {
	if (activeQueueSource === 'back') {
		spriteQueue.forEachBack(fn);
		return;
	}
	spriteQueue.forEachFront(fn);
}

export function spriteQueueBackSize(): number {
	return spriteQueue.sizeBack();
}

export function spriteQueueFrontSize(): number {
	return spriteQueue.sizeFront();
}

export function copyRenderQueueForPlayback(): RenderSubmission[] {
	let count = 0;
	spriteQueue.forEachBack((item) => {
		const src = item.options;
		setPlaybackSpriteSubmission(count, src);
		count += 1;
	});
	meshQueue.forEachBack((item) => {
		setPlaybackMeshSubmission(count, item);
		count += 1;
	});
	particleQueue.forEachBack((item) => {
		setPlaybackParticleSubmission(count, item);
		count += 1;
	});
	renderQueuePlaybackBuffer.length = count;
	return renderQueuePlaybackBuffer;
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
	const runtime = Runtime.instance;
	const imgid = item.texture ?? 'whitepixel';
	const handle = runtime.resolveAssetHandle(imgid);
	const entry = runtime.getAssetEntryByHandle(handle);
	if (entry.type !== 'image') {
		throw new Error(`[Particles Pipeline] Asset '${imgid}' is not an image.`);
	}
	const meta = runtime.getImageMetaByHandle(handle);
	if (!meta.atlassed) {
		throw new Error(`[Particles Pipeline] Image '${imgid}' must be atlassed.`);
	}
	if (meta.atlasid === undefined || meta.atlasid === null) {
		throw new Error(`[Particles Pipeline] Image '${imgid}' missing atlas id.`);
	}
	const baseEntry = (entry.flags & ASSET_FLAG_VIEW)
		? runtime.getAssetEntryByHandle(entry.ownerIndex)
		: entry;
	if (baseEntry.regionW <= 0 || baseEntry.regionH <= 0) {
		throw new Error(`[Particles Pipeline] Atlas backing entry for '${imgid}' missing dimensions.`);
	}
	const u0 = entry.regionX / baseEntry.regionW;
	const v0 = entry.regionY / baseEntry.regionH;
	const u1 = (entry.regionX + entry.regionW) / baseEntry.regionW;
	const v1 = (entry.regionY + entry.regionH) / baseEntry.regionH;
	let atlasBinding = ENGINE_ATLAS_INDEX;
	if (meta.atlasid !== ENGINE_ATLAS_INDEX) {
		const primaryAtlasIdInSlot = $.view.primaryAtlasIdInSlot;
		const secondaryAtlasIdInSlot = $.view.secondaryAtlasIdInSlot;
		if (meta.atlasid === primaryAtlasIdInSlot) {
			atlasBinding = 0;
		} else if (meta.atlasid === secondaryAtlasIdInSlot) {
			atlasBinding = 1;
		} else {
			throw new Error(`[Particles Pipeline] Atlas ${meta.atlasid} not mapped to primary/secondary slots.`);
		}
	}
	item.texture = imgid;
	item.uv0 = [u0, v0];
	item.uv1 = [u1, v1];
	item.atlasBinding = atlasBinding;
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

export function submitRectangle(options: RectRenderSubmission): void {
	let { left: x, top: y, z, right: ex, bottom: ey } = options.area;
	const c = options.color;
	const imgid = 'whitepixel';
	[x, y, ex, ey] = correctAreaStartEnd(x, y, ex, ey);
	if (options.kind === 'fill') {
		submitSprite({ pos: new_vec3(x, y, z), imgid, scale: new_vec2(~~(ex - x), ~~(ey - y)), colorize: c, layer: options.layer });
	}
	else {
		submitSprite({ pos: new_vec3(x, y, z), imgid, scale: new_vec2(~~(ex - x), 1), colorize: c, layer: options.layer });
		submitSprite({ pos: new_vec3(x, ey, z), imgid, scale: new_vec2(~~(ex - x), 1), colorize: c, layer: options.layer });
		submitSprite({ pos: new_vec3(x, y, z), imgid, scale: new_vec2(1, ~~(ey - y)), colorize: c, layer: options.layer });
		submitSprite({ pos: new_vec3(ex, y, z), imgid, scale: new_vec2(1, ~~(ey - y)), colorize: c, layer: options.layer });
	}
}

export function submitDrawPolygon(options: PolyRenderSubmission): void {
	const { points: coords, z, color, thickness = 1, layer } = options;
	if (!coords || coords.length < 4) return; const imgid = 'whitepixel';
	for (let i = 0; i < coords.length; i += 2) {
		// Snap to integer grid so Bresenham-style stepping terminates with fractional inputs.
		let x0 = Math.round(coords[i]), y0 = Math.round(coords[i + 1]); const next = (i + 2) % coords.length; let x1 = Math.round(coords[next]), y1 = Math.round(coords[next + 1]);
		const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0); const sx = x0 < x1 ? 1 : -1; const sy = y0 < y1 ? 1 : -1; let err = dx - dy;
		if (dx > dy) {
			while (true) {
				submitSprite({ pos: new_vec3(x0, y0, z), imgid, scale: new_vec2(thickness, thickness), colorize: color, layer }); if (x0 === x1 && y0 === y1) break; const e2 = 2 * err; if (e2 > -dy) { err -= dy; x0 += sx; } if (x0 === x1 && y0 === y1) { submitSprite({ pos: new_vec3(x0, y0, z), imgid, scale: new_vec2(thickness, thickness), colorize: color, layer }); break; } if (e2 < dx) { err += dx; y0 += sy; }
			}
		} else {
			while (true) {
				submitSprite({ pos: new_vec3(x0, y0, z), imgid, scale: new_vec2(thickness, thickness), colorize: color, layer }); if (x0 === x1 && y0 === y1) break; const e2 = 2 * err; if (e2 > -dy) { err -= dy; x0 += sx; } if (x0 === x1 && y0 === y1) { submitSprite({ pos: new_vec3(x0, y0, z), imgid, scale: new_vec2(thickness, thickness), colorize: color, layer }); break; } if (e2 < dx) { err += dx; y0 += sy; }
			}
		}
	}
}

export function submitGlyphs(o: GlyphRenderSubmission) {
	let lines: string | string[] = o.glyphs;
	const resolvedFont = o.font ?? $.view.default_font;
	if (!resolvedFont) {
		throw new Error('No font available for glyph rendering.');
	}
	o.font = resolvedFont;

	// Optional char-based wrapping
	if (typeof lines === 'string' && o.wrap_chars !== undefined && o.wrap_chars > 0) {
		lines = wrapGlyphs(lines, o.wrap_chars);
	}
	let xx = o.x;
	// Optional simple centering within a block of width (pixels)
	if (o.center_block_width && o.center_block_width > 0) {
		const arr = Array.isArray(lines) ? lines : [lines];
		xx += calculateCenteredBlockX(arr, o.font.char_width('a'), o.center_block_width);
	}

	renderGlyphs(xx, o.y, lines, o.glyph_start, o.glyph_end, o.z ?? 950, o.font, o.color, o.background_color, o.layer);
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
	particleAmbientFactorDefault = clamp(factor, 0, 1);
}

export const spriteParallaxRig: SpriteParallaxRig = {
	vy: 0,
	scale: 1,
	impact: 0,
	impact_t: 0,
	bias_px: 0,
	parallax_strength: 1,
	scale_strength: 1,
	flip_strength: 0,
	flip_window: 0.6,
};
export function setSpriteParallaxRig(vy: number, scale: number, impact: number, impact_t: number, bias_px: number, parallax_strength: number, scale_strength: number, flip_strength: number, flip_window: number): void {
	if (flip_window <= 0) {
		throw new Error(`[Sprite Pipeline] setSpriteParallaxRig requires flip_window > 0, got ${flip_window}.`);
	}
	spriteParallaxRig.vy = vy;
	spriteParallaxRig.scale = scale;
	spriteParallaxRig.impact = impact;
	spriteParallaxRig.impact_t = impact_t;
	spriteParallaxRig.bias_px = bias_px;
	spriteParallaxRig.parallax_strength = parallax_strength;
	spriteParallaxRig.scale_strength = scale_strength;
	spriteParallaxRig.flip_strength = flip_strength;
	spriteParallaxRig.flip_window = flip_window;
}

export let _skyTint: [number, number, number] = [1, 1, 1];
export let _skyExposure = 1.0;
export function setSkyboxTintExposure(tint: [number, number, number], exposure = 1.0): void {
	_skyTint = [Math.max(0, tint[0]), Math.max(0, tint[1]), Math.max(0, tint[2])];
	_skyExposure = Math.max(0, exposure);
}
const CHAR_CACHE: string[] = (() => {
	const cache: string[] = new Array(256);
	for (let i = 0; i < cache.length; i += 1) {
		cache[i] = String.fromCharCode(i);
	}
	return cache;
})();

/**
 * Text rendering utility (engine-level). Preferred UE-style usage is via TextComponent + TextRenderSystem, which uses this internally.
 */
export function renderGlyphs(x: number, y: number, textToWrite: string | string[], start?: number, end?: number, z: number = 950, font?: BFont, color?: color, backgroundColor?: color, layer?: RenderLayer): void {
	font ??= $.view.default_font;
	if (!font) { throw new Error('No font or default font available for renderGlyphs'); }
	const startX = x;
	let stepY = 0;
	const spriteOptions: ImgRenderSubmission = { imgid: 'none', pos: { x, y, z }, colorize: color, layer };
	const spritePos = spriteOptions.pos;
	const rectoptions: RectRenderSubmission = backgroundColor
		? { area: { left: 0, top: 0, right: 0, bottom: 0 }, color: backgroundColor, kind: 'fill', layer }
		: null;

	start = start ?? 0;

	const renderSpan = (text: string) => {
		if (text.length === 0) {
			y += font.lineHeight;
			return;
		}
		const endIndex = end ?? text.length;
		for (let i = start; i < endIndex; i += 1) {
			const code = text.charCodeAt(i);
			const letter = code < CHAR_CACHE.length ? CHAR_CACHE[code] : text.charAt(i);
			const glyph = font.getGlyph(letter);
			const stepX = glyph.advance;
			const height = glyph.height;
			if (height > stepY) {
				stepY = height;
			}
			if (rectoptions) {
				const area = rectoptions.area;
				area.left = x;
				area.top = y;
				area.right = x + stepX;
				area.bottom = y + stepY;
				$.view.renderer.submit.rect(rectoptions);
			}
			spritePos.x = x;
			spritePos.y = y;
			spriteOptions.imgid = glyph.imgid;
			$.view.renderer.submit.sprite(spriteOptions);
			x += stepX;
		}
		x = startX;
		y += stepY;
		stepY = 0;
	};

	if (Array.isArray(textToWrite)) {
		for (let a = 0; a < textToWrite.length; a += 1) {
			renderSpan(textToWrite[a]);
			if (y >= $.view.canvasSize.y) return;
		}
	}
	else {
		renderSpan(textToWrite);
	}
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
