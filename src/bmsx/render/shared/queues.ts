import { FeatureQueue } from '../../common/feature_queue';
import type {
	GlyphRenderSubmission,
	ImgRenderSubmission,
	MeshRenderSubmission,
	ParticleRenderSubmission,
	PolyRenderSubmission,
	RectRenderSubmission,
} from './submissions';
import { shallowcopy } from '../../common/shallowcopy';

type Host2DSubmission =
	| ({ type: 'img'; } & ImgRenderSubmission)
	| ({ type: 'poly'; } & PolyRenderSubmission)
	| ({ type: 'rect'; } & RectRenderSubmission)
	| ({ type: 'glyphs'; } & GlyphRenderSubmission);

const meshQueue = new FeatureQueue<MeshRenderSubmission>(256);
const particleQueue = new FeatureQueue<ParticleRenderSubmission>(1024);
const host2dQueue = new FeatureQueue<Host2DSubmission>(512);
let activeQueueSource: 'front' | 'back' = 'front';

export function prepareCompletedRenderQueues(): void {
	meshQueue.swap();
	particleQueue.swap();
	host2dQueue.swap();
	prepareHeldRenderQueues();
}

function hasCommittedFrontQueueContent(): boolean {
	return meshQueue.sizeFront() > 0
		|| particleQueue.sizeFront() > 0
		|| host2dQueue.sizeFront() > 0;
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
		|| particleQueue.sizeBack() > 0
		|| host2dQueue.sizeBack() > 0;
}

export function clearBackQueues(): void {
	meshQueue.clearBack();
	particleQueue.clearBack();
	host2dQueue.clearBack();
	prepareHeldRenderQueues();
}

export function clearAllQueues(): void {
	meshQueue.clearAll();
	particleQueue.clearAll();
	host2dQueue.clearAll();
	prepareHeldRenderQueues();
}

export function submitSprite(item: ImgRenderSubmission): void {
	const submission = item as Host2DSubmission;
	submission.type = 'img';
	host2dQueue.submit(submission);
}

export function submitRectangle(item: RectRenderSubmission): void {
	const submission = item as Host2DSubmission;
	submission.type = 'rect';
	host2dQueue.submit(submission);
}

export function submitDrawPolygon(item: PolyRenderSubmission): void {
	const submission = item as Host2DSubmission;
	submission.type = 'poly';
	host2dQueue.submit(submission);
}

export function submitGlyphs(item: GlyphRenderSubmission): void {
	const submission = item as Host2DSubmission;
	submission.type = 'glyphs';
	host2dQueue.submit(submission);
}

export function beginHost2DQueue(): number {
	return activeQueueSource === 'back' ? host2dQueue.sizeBack() : host2dQueue.sizeFront();
}

export function forEachHost2DQueue(fn: (item: Host2DSubmission, index: number) => void): void {
	if (activeQueueSource === 'back') {
		host2dQueue.forEachBack(fn);
		return;
	}
	host2dQueue.forEachFront(fn);
}

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
