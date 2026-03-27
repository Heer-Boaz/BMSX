import { FeatureQueue } from '../../utils/feature_queue';
import {
	PAT_FLAG_ENABLED,
	OAM_FLAG_ENABLED,
	OAM_LAYER_WORLD,
	oamLayerToRenderLayer,
	renderLayerToOamLayer,
} from './render_types';
import type {
	PatEntry,
	color,
	GlyphRenderSubmission,
	ImgRenderSubmission,
	MeshRenderSubmission,
	OamEntry,
	ParticleRenderSubmission,
	PolyRenderSubmission,
	RectRenderSubmission,
	SpriteParallaxRig,
	RenderLayer,
} from './render_types';
import { DEFAULT_ZCOORD } from '../backend/webgl/webgl.constants';
import { RenderSubmission } from '../backend/pipeline_interfaces';
import { Runtime } from '../../emulator/runtime';
import { ASSET_FLAG_VIEW } from '../../emulator/memory';
import { ENGINE_ATLAS_INDEX } from '../../rompack/rompack';
import { new_vec3, new_vec2 } from '../../utils/vector_operations';
import { clamp } from '../../utils/clamp';
import { BFont } from './bitmap_font';

const SPRITE_SLOT_COUNT = 5000;
export const OAM_SLOT_COUNT = SPRITE_SLOT_COUNT;
const meshQueue = new FeatureQueue<MeshRenderSubmission>(256);
const particleQueue = new FeatureQueue<ParticleRenderSubmission>(1024);
let activeQueueSource: 'front' | 'back' = 'front';

type PlaybackImgSubmission = Extract<RenderSubmission, { type: 'img' }>;
type PlaybackMeshSubmission = Extract<RenderSubmission, { type: 'mesh' }>;
type PlaybackParticleSubmission = Extract<RenderSubmission, { type: 'particle' }>;

const renderQueuePlaybackBuffer: RenderSubmission[] = [];
const GLYPH_TRACE_CALL_LOG_LIMIT = 12;
const GLYPH_TRACE_ENTRY_LOG_LIMIT = 48;
const OAM_SUBMIT_TRACE_LOG_LIMIT = 32;
let glyphTraceCallLogCount = 0;
let glyphTraceEntryLogCount = 0;
let oamSubmitTraceLogCount = 0;

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

function setPlaybackSpriteSubmission(index: number, src: OamEntry): void {
	let op = renderQueuePlaybackBuffer[index] as PlaybackImgSubmission;
	if (!op || op.type !== 'img') {
		op = createPlaybackImgSubmission();
		renderQueuePlaybackBuffer[index] = op;
	}
	const runtime = Runtime.instance;
	const entry = runtime.getAssetEntryByHandle(src.assetHandle);
	if (entry.type !== 'image') {
		throw new Error(`[Sprite Playback] Asset handle ${src.assetHandle} is not an image.`);
	}
	if (entry.regionW <= 0 || entry.regionH <= 0) {
		throw new Error(`[Sprite Playback] Asset '${entry.id}' has invalid dimensions.`);
	}
	op.imgid = entry.id;
	op.layer = oamLayerToRenderLayer(src.layer);
	op.ambient_affected = undefined;
	op.ambient_factor = undefined;
	op.pos.x = src.x;
	op.pos.y = src.y;
	op.pos.z = src.z;
	op.scale.x = src.w / entry.regionW;
	op.scale.y = src.h / entry.regionH;
	op.flip.flip_h = src.u0 > src.u1;
	op.flip.flip_v = src.v0 > src.v1;
	op.colorize.r = src.r;
	op.colorize.g = src.g;
	op.colorize.b = src.b;
	op.colorize.a = src.a;
	op.parallax_weight = src.parallaxWeight;
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

// --- Sprite queue helpers ---------------------------------------------------

export function submitSprite(options: ImgRenderSubmission): void {
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
	if (entry.regionW <= 0 || entry.regionH <= 0) {
		throw new Error(`[Sprite Pipeline] Image asset '${imgid}' has invalid region size.`);
	}
	if (baseEntry.regionW <= 0 || baseEntry.regionH <= 0) {
		throw new Error(`[Sprite Pipeline] Atlas backing entry for '${imgid}' missing dimensions.`);
	}
	let u0 = entry.regionX / baseEntry.regionW;
	let v0 = entry.regionY / baseEntry.regionH;
	let u1 = (entry.regionX + entry.regionW) / baseEntry.regionW;
	let v1 = (entry.regionY + entry.regionH) / baseEntry.regionH;
	const flip = options.flip;
	if (flip?.flip_h) {
		const tmp = u0;
		u0 = u1;
		u1 = tmp;
	}
	if (flip?.flip_v) {
		const tmp = v0;
		v0 = v1;
		v1 = tmp;
	}
	const scale = options.scale;
	const scaleX = scale ? scale.x : 1;
	const scaleY = scale ? scale.y : 1;
	const colorize = options.colorize;
	const oam: OamEntry = {
		atlasId: meta.atlasid,
		flags: OAM_FLAG_ENABLED,
		assetHandle: handle,
		x: ~~options.pos.x,
		y: ~~options.pos.y,
		z: ~~(options.pos.z ?? DEFAULT_ZCOORD),
		w: entry.regionW * scaleX,
		h: entry.regionH * scaleY,
		u0,
		v0,
		u1,
		v1,
		r: colorize ? colorize.r : 1,
		g: colorize ? colorize.g : 1,
		b: colorize ? colorize.b : 1,
		a: colorize ? colorize.a : 1,
		layer: renderLayerToOamLayer(options.layer),
		parallaxWeight: 0,
	};
	oam.parallaxWeight = oam.layer === OAM_LAYER_WORLD ? (options.parallax_weight ?? 0) : 0;
	if (oam.layer !== OAM_LAYER_WORLD && oamSubmitTraceLogCount < OAM_SUBMIT_TRACE_LOG_LIMIT) {
		console.log(`[OAMSubmitTrace][TS] imgid=${options.imgid} layer=${oam.layer} pos=${oam.x},${oam.y},${oam.z} size=${oam.w}x${oam.h} atlas=${oam.atlasId}`);
		oamSubmitTraceLogCount += 1;
	}
	runtime.vdp.submitOamEntry(oam);
}

export function beginSpriteQueue(): number {
	return Runtime.instance.vdp.begin2dRead();
}

export function prepareCompletedRenderQueues(): void {
	Runtime.instance.vdp.swapBgMapBuffers();
	Runtime.instance.vdp.swapPatBuffers();
	Runtime.instance.vdp.swapOamBuffers();
	Runtime.instance.vdp.setOamReadSource('front');
	meshQueue.swap();
	particleQueue.swap();
	activeQueueSource = 'front';
}

function hasCommittedFrontQueueContent(): boolean {
	return Runtime.instance.vdp.hasFront2dContent()
		|| meshQueue.sizeFront() > 0
		|| particleQueue.sizeFront() > 0;
}

export function preparePartialRenderQueues(): void {
	activeQueueSource = hasCommittedFrontQueueContent()
		? 'front'
		: (hasPendingBackQueueContent() ? 'back' : 'front');
	Runtime.instance.vdp.setOamReadSource(activeQueueSource);
}

export function prepareOverlayRenderQueues(): void {
	activeQueueSource = 'back';
	Runtime.instance.vdp.setOamReadSource('back');
}

export function hasPendingBackQueueContent(): boolean {
	return Runtime.instance.vdp.hasBack2dContent()
		|| meshQueue.sizeBack() > 0
		|| particleQueue.sizeBack() > 0;
}

export function clearBackQueues(): void {
	Runtime.instance.vdp.clearBackBgMap();
	Runtime.instance.vdp.clearBackPatBuffer();
	Runtime.instance.vdp.clearBackOamBuffer();
	meshQueue.clearBack();
	particleQueue.clearBack();
	activeQueueSource = 'front';
}

export function forEachOamEntry(fn: (item: OamEntry, index: number) => void): void {
	Runtime.instance.vdp.forEachOamEntry(fn);
}

export function spriteQueueBackSize(): number {
	return Runtime.instance.vdp.getOamBackCount();
}

export function spriteQueueFrontSize(): number {
	return Runtime.instance.vdp.getOamFrontCount();
}

export function copyRenderQueueForPlayback(): RenderSubmission[] {
	let count = 0;
	const copySpriteEntries = () => {
		Runtime.instance.vdp.forEach2dEntry((item) => {
			setPlaybackSpriteSubmission(count, item);
			count += 1;
		});
	};
	const copyMesh = (item: MeshRenderSubmission) => {
		setPlaybackMeshSubmission(count, item);
		count += 1;
	};
	const copyParticle = (item: ParticleRenderSubmission) => {
		setPlaybackParticleSubmission(count, item);
		count += 1;
	};
	if (activeQueueSource === 'back') {
		copySpriteEntries();
		meshQueue.forEachBack(copyMesh);
		particleQueue.forEachBack(copyParticle);
	} else {
		copySpriteEntries();
		meshQueue.forEachFront(copyMesh);
		particleQueue.forEachFront(copyParticle);
	}
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
	const runtime = Runtime.instance;
	const memory = runtime.memory;
	const startX = x;
	let stepY = 0;
	const packColor8888 = (source: color | undefined): number => {
		const value = source ?? { r: 1, g: 1, b: 1, a: 1 };
		const r = Math.round(clamp(value.r, 0, 1) * 255);
		const g = Math.round(clamp(value.g, 0, 1) * 255);
		const b = Math.round(clamp(value.b, 0, 1) * 255);
		const a = Math.round(clamp(value.a, 0, 1) * 255);
		return (r | (g << 8) | (b << 16) | (a << 24)) >>> 0;
	};
	const packedColor = packColor8888(color);
	const packedBackgroundColor = backgroundColor ? packColor8888(backgroundColor) : 0;
	if (glyphTraceCallLogCount < GLYPH_TRACE_CALL_LOG_LIMIT) {
		const lineCount = Array.isArray(textToWrite) ? textToWrite.length : 1;
		const totalChars = Array.isArray(textToWrite)
			? textToWrite.reduce((sum, line) => sum + line.length, 0)
			: textToWrite.length;
		console.log(`[GlyphTrace][TS] renderGlyphs lines=${lineCount} chars=${totalChars} start=${start ?? 0} end=${end ?? -1} z=${z} layer=${layer ?? 'world'} lineHeight=${font.lineHeight} bg=${backgroundColor ? 1 : 0}`);
		glyphTraceCallLogCount += 1;
	}
	const backgroundAsset = (() => {
		if (!backgroundColor) {
			return null;
		}
		const handle = memory.resolveAssetHandle('whitepixel');
		const entry = memory.getAssetEntryByHandle(handle);
		if (entry.type !== 'image') {
			throw new Error(`[Glyph Queue] Asset 'whitepixel' is not an image.`);
		}
		const imgMeta = runtime.getImageMetaByHandle(handle);
		const baseEntry = (entry.flags & ASSET_FLAG_VIEW) !== 0
			? memory.getAssetEntryByHandle(entry.ownerIndex)
			: entry;
		if (baseEntry.regionW <= 0 || baseEntry.regionH <= 0) {
			throw new Error(`[Glyph Queue] Atlas backing entry for 'whitepixel' missing dimensions.`);
		}
		const u0 = entry.regionX / baseEntry.regionW;
		const v0 = entry.regionY / baseEntry.regionH;
		const u1 = (entry.regionX + entry.regionW) / baseEntry.regionW;
		const v1 = (entry.regionY + entry.regionH) / baseEntry.regionH;
		return { handle, imgMeta, u0, v0, u1, v1 };
	})();

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
			if (backgroundAsset) {
				const pat: PatEntry = {
					atlasId: backgroundAsset.imgMeta.atlasid,
					flags: PAT_FLAG_ENABLED,
					assetHandle: backgroundAsset.handle,
					layer: renderLayerToOamLayer(layer),
					x: ~~x,
					y: ~~y,
					z: ~~z,
					glyphW: stepX,
					glyphH: font.lineHeight,
					bgW: 0,
					bgH: 0,
					u0: backgroundAsset.u0,
					v0: backgroundAsset.v0,
					u1: backgroundAsset.u1,
					v1: backgroundAsset.v1,
					fgColor: packedBackgroundColor,
					bgColor: 0,
				};
				runtime.vdp.submitPatEntry(pat);
			}
			const handle = memory.resolveAssetHandle(glyph.imgid);
			const entry = memory.getAssetEntryByHandle(handle);
			if (entry.type !== 'image') {
				throw new Error(`[Glyph Queue] Asset '${glyph.imgid}' is not an image.`);
			}
			const imgMeta = runtime.getImageMetaByHandle(handle);
			const baseEntry = (entry.flags & ASSET_FLAG_VIEW) !== 0
				? memory.getAssetEntryByHandle(entry.ownerIndex)
				: entry;
			if (baseEntry.regionW <= 0 || baseEntry.regionH <= 0) {
				throw new Error(`[Glyph Queue] Atlas backing entry for '${glyph.imgid}' missing dimensions.`);
			}
			const u0 = entry.regionX / baseEntry.regionW;
			const v0 = entry.regionY / baseEntry.regionH;
			const u1 = (entry.regionX + entry.regionW) / baseEntry.regionW;
			const v1 = (entry.regionY + entry.regionH) / baseEntry.regionH;
			if (glyphTraceEntryLogCount < GLYPH_TRACE_ENTRY_LOG_LIMIT) {
				console.log(`[GlyphTrace][TS] glyph=${JSON.stringify(letter)} imgid=${glyph.imgid} atlas=${imgMeta.atlasid} handle=${handle} region=${entry.regionX},${entry.regionY},${entry.regionW},${entry.regionH} base=${baseEntry.regionW}x${baseEntry.regionH} uv=${u0.toFixed(4)},${v0.toFixed(4)},${u1.toFixed(4)},${v1.toFixed(4)} pos=${~~x},${~~y} size=${glyph.width}x${glyph.height}`);
				glyphTraceEntryLogCount += 1;
			}
			const pat: PatEntry = {
				atlasId: imgMeta.atlasid,
				flags: PAT_FLAG_ENABLED,
				assetHandle: handle,
				layer: renderLayerToOamLayer(layer),
				x: ~~x,
				y: ~~y,
				z: ~~z,
				glyphW: glyph.width,
				glyphH: glyph.height,
				bgW: 0,
				bgH: 0,
				u0,
				v0,
				u1,
				v1,
				fgColor: packedColor,
				bgColor: 0,
			};
			runtime.vdp.submitPatEntry(pat);
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
