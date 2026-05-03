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

export type Host2DKind = 'img' | 'poly' | 'rect' | 'glyphs';
export type Host2DRef = ImgRenderSubmission | PolyRenderSubmission | RectRenderSubmission | GlyphRenderSubmission;

const meshQueue = new FeatureQueue<MeshRenderSubmission>(256);
const particleQueue = new FeatureQueue<ParticleRenderSubmission>(1024);
const host2dKindQueue = new FeatureQueue<Host2DKind>(512);
const host2dRefQueue = new FeatureQueue<Host2DRef>(512);
let activeQueueSource: 'front' | 'back' = 'front';

export function prepareCompletedRenderQueues(): void {
	meshQueue.swap();
	particleQueue.swap();
	host2dKindQueue.swap();
	host2dRefQueue.swap();
	prepareHeldRenderQueues();
}

function hasCommittedFrontQueueContent(): boolean {
	return meshQueue.sizeFront() > 0
		|| particleQueue.sizeFront() > 0
		|| host2dRefQueue.sizeFront() > 0;
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
		|| host2dRefQueue.sizeBack() > 0;
}

export function clearBackQueues(): void {
	meshQueue.clearBack();
	particleQueue.clearBack();
	host2dKindQueue.clearBack();
	host2dRefQueue.clearBack();
	prepareHeldRenderQueues();
}

export function clearAllQueues(): void {
	meshQueue.clearAll();
	particleQueue.clearAll();
	host2dKindQueue.clearAll();
	host2dRefQueue.clearAll();
	prepareHeldRenderQueues();
}

export function submitSprite(item: ImgRenderSubmission): void {
	host2dKindQueue.submit('img');
	host2dRefQueue.submit(item);
}

export function submitRectangle(item: RectRenderSubmission): void {
	host2dKindQueue.submit('rect');
	host2dRefQueue.submit(item);
}

export function submitDrawPolygon(item: PolyRenderSubmission): void {
	host2dKindQueue.submit('poly');
	host2dRefQueue.submit(item);
}

export function submitGlyphs(item: GlyphRenderSubmission): void {
	host2dKindQueue.submit('glyphs');
	host2dRefQueue.submit(item);
}

export function beginHost2DQueue(): number {
	return activeQueueSource === 'back' ? host2dRefQueue.sizeBack() : host2dRefQueue.sizeFront();
}

export function forEachHost2DQueue(fn: (kind: Host2DKind, item: Host2DRef, index: number) => void): void {
	if (activeQueueSource === 'back') {
		host2dRefQueue.forEachBack((item, index) => fn(host2dKindQueue.getBack(index), item, index));
		return;
	}
	host2dRefQueue.forEachFront((item, index) => fn(host2dKindQueue.getFront(index), item, index));
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
