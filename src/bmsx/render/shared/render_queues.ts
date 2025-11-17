import { FeatureQueue } from '../../utils/feature_queue';
import type { ImgMeta } from '../../rompack/rompack';
import type { ImgRenderSubmission, MeshRenderSubmission, ParticleRenderSubmission } from './render_types';

export interface SpriteQueueItem {
	options: ImgRenderSubmission;
	imgmeta: ImgMeta;
}

const spriteQueue = new FeatureQueue<SpriteQueueItem>(256);
const meshQueue = new FeatureQueue<MeshRenderSubmission>(256);
const particleQueue = new FeatureQueue<ParticleRenderSubmission>(1024);

// --- Sprite queue helpers ---------------------------------------------------

export function submitSprite(item: SpriteQueueItem): void {
	spriteQueue.submit(item);
}

export function beginSpriteQueue(): number {
	spriteQueue.swap();
	return spriteQueue.sizeFront();
}

export function sortSpriteQueue(compare: (a: SpriteQueueItem, b: SpriteQueueItem) => number): void {
	spriteQueue.sortFront(compare);
}

export function forEachSpriteQueue(fn: (item: SpriteQueueItem, index: number) => void): void {
	spriteQueue.forEachFront(fn);
}

export function spriteQueueBackSize(): number {
	return spriteQueue.sizeBack();
}

export function spriteQueueFrontSize(): number {
	return spriteQueue.sizeFront();
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

