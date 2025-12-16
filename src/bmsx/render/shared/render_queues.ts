import { FeatureQueue } from '../../utils/feature_queue';
import type { ImgMeta } from '../../rompack/rompack';
import type { ImgRenderSubmission, MeshRenderSubmission, ParticleRenderSubmission } from './render_types';
import type { RenderLayer } from './render_types';
import { DEFAULT_ZCOORD } from '../backend/webgl/webgl.constants';
import { RenderSubmission } from '../backend/pipeline_interfaces';

export interface SpriteQueueItem {
	options: ImgRenderSubmission;
	imgmeta: ImgMeta;
	submissionIndex: number;
}

const spriteQueue = new FeatureQueue<SpriteQueueItem>(256);
const meshQueue = new FeatureQueue<MeshRenderSubmission>(256);
const particleQueue = new FeatureQueue<ParticleRenderSubmission>(1024);
let spriteSubmissionCounter = 0;

type PlaybackImgSubmission = Extract<RenderSubmission, { type: 'img' }>;

const DEFAULT_IMG_META: ImgMeta = {
	atlassed: false,
	width: 0,
	height: 0,
};

const spriteQueuePlaybackBuffer: PlaybackImgSubmission[] = [];

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
	};
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
		},
		imgmeta: DEFAULT_IMG_META,
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

export function submitSprite(options: ImgRenderSubmission, imgmeta: ImgMeta): void {
	const submissionIndex = spriteSubmissionCounter++;
	const pooled = acquireSpriteQueueItem();
	pooled.submissionIndex = submissionIndex;
	pooled.imgmeta = imgmeta;
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
	spriteQueue.submit(pooled);
}

export function beginSpriteQueue(): number {
	spriteQueue.swap();
	spriteSubmissionCounter = 0;
	const tmpPool = spriteItemPool;
	spriteItemPool = spriteItemPoolAlt;
	spriteItemPoolAlt = tmpPool;
	spriteItemPoolIndex = 0;
	sortSpriteQueueForRendering();
	return spriteQueue.sizeFront();
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

export function sortSpriteQueue(compare: (a: SpriteQueueItem, b: SpriteQueueItem) => number): void {
	spriteQueue.sortFront(compare);
}

export function forEachSprite(fn: (item: SpriteQueueItem, index: number) => void): void {
	spriteQueue.forEachFront(fn);
}

export function spriteQueueBackSize(): number {
	return spriteQueue.sizeBack();
}

export function spriteQueueFrontSize(): number {
	return spriteQueue.sizeFront();
}

export function copySpriteQueueForPlayback(): RenderSubmission[] {
	const items = spriteQueuePlaybackBuffer;
	let count = 0;
	spriteQueue.forEachBack((item) => {
		let op = items[count];
		if (!op) {
			op = createPlaybackImgSubmission();
			items[count] = op;
		}
		const src = item.options;
		const dst = op;
		dst.imgid = src.imgid;
		dst.layer = src.layer;
		dst.ambient_affected = src.ambient_affected;
		dst.ambient_factor = src.ambient_factor;
		dst.pos.x = src.pos.x;
		dst.pos.y = src.pos.y;
		dst.pos.z = src.pos.z;
		dst.scale.x = src.scale.x;
		dst.scale.y = src.scale.y;
		dst.flip.flip_h = src.flip.flip_h;
		dst.flip.flip_v = src.flip.flip_v;
		dst.colorize.r = src.colorize.r;
		dst.colorize.g = src.colorize.g;
		dst.colorize.b = src.colorize.b;
		dst.colorize.a = src.colorize.a;
		count += 1;
	});
	items.length = count;
	return items;
}

// --- Mesh queue helpers -----------------------------------------------------

export function submitMesh(item: MeshRenderSubmission): void {
	meshQueue.submit(item);
}

export function beginMeshQueue(): number {
	meshQueue.swap();
	return meshQueue.sizeFront();
}

export function forEachMeshQueue(fn: (item: MeshRenderSubmission, index: number) => void): void {
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
	particleQueue.swap();
	return particleQueue.sizeFront();
}

export function forEachParticleQueue(fn: (item: ParticleRenderSubmission, index: number) => void): void {
	particleQueue.forEachFront(fn);
}

export function particleQueueBackSize(): number {
	return particleQueue.sizeBack();
}

export function particleQueueFrontSize(): number {
	return particleQueue.sizeFront();
}
