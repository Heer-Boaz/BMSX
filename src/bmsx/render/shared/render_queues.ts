import { FeatureQueue } from '../../utils/feature_queue';
import type { ImgMeta } from '../../rompack/rompack';
import type { ImgRenderSubmission, MeshRenderSubmission, ParticleRenderSubmission } from './render_types';
import { RenderSubmission } from '../gameview';

export interface SpriteQueueItem {
	options: ImgRenderSubmission;
	imgmeta: ImgMeta;
	submissionIndex: number;
}

const spriteQueue = new FeatureQueue<SpriteQueueItem>(256);
const meshQueue = new FeatureQueue<MeshRenderSubmission>(256);
const particleQueue = new FeatureQueue<ParticleRenderSubmission>(1024);
let spriteSubmissionCounter = 0;

// --- Sprite queue helpers ---------------------------------------------------

export function submitSprite(item: Omit<SpriteQueueItem, 'submissionIndex'>): void {
	const submissionIndex = spriteSubmissionCounter++;
	spriteQueue.submit({ ...item, submissionIndex });
}

export function beginSpriteQueue(): number {
	spriteQueue.swap();
	spriteSubmissionCounter = 0;
	return spriteQueue.sizeFront();
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
	const items: RenderSubmission[] = [];
	spriteQueue.forEachBack((item) => {
		items.push( {...item.options, type: 'img'} ); // Add 'kind' property for playback so that we can use `$.view.renderer.submit.typed`
	});
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
