import { FeatureQueue } from '../../common/feature_queue';
import type {
	GlyphRenderSubmission,
	HostImageRenderSubmission,
	MeshRenderSubmission,
	ParticleRenderSubmission,
	PolyRenderSubmission,
	RectRenderSubmission,
} from './submissions';
export type Host2DKind = 'img' | 'poly' | 'rect' | 'glyphs';
export type Host2DRef = HostImageRenderSubmission | PolyRenderSubmission | RectRenderSubmission | GlyphRenderSubmission;
export type Host2DSubmission =
	| ({ type: 'img' } & HostImageRenderSubmission)
	| ({ type: 'poly' } & PolyRenderSubmission)
	| ({ type: 'rect' } & RectRenderSubmission)
	| ({ type: 'glyphs' } & GlyphRenderSubmission);

const meshQueue = new FeatureQueue<MeshRenderSubmission>(256);
const particleQueue = new FeatureQueue<ParticleRenderSubmission>(1024);
let activeQueueSource: 'front' | 'back' = 'front';

type RenderQueueLifecycle = {
	hasFront(): boolean;
	hasBack(): boolean;
	swap(): void;
	clearBack(): void;
	clearAll(): void;
};

const renderQueueLifecycles: readonly RenderQueueLifecycle[] = [
	{
		hasFront: () => meshQueue.sizeFront() > 0,
		hasBack: () => meshQueue.sizeBack() > 0,
		swap: () => { meshQueue.swap(); },
		clearBack: () => { meshQueue.clearBack(); },
		clearAll: () => { meshQueue.clearAll(); },
	},
	{
		hasFront: () => particleQueue.sizeFront() > 0,
		hasBack: () => particleQueue.sizeBack() > 0,
		swap: () => { particleQueue.swap(); },
		clearBack: () => { particleQueue.clearBack(); },
		clearAll: () => { particleQueue.clearAll(); },
	},
];

export function prepareCompletedRenderQueues(): void {
	for (let index = 0; index < renderQueueLifecycles.length; index += 1) {
		renderQueueLifecycles[index].swap();
	}
	prepareHeldRenderQueues();
}

function hasCommittedFrontQueueContent(): boolean {
	for (let index = 0; index < renderQueueLifecycles.length; index += 1) {
		if (renderQueueLifecycles[index].hasFront()) return true;
	}
	return false;
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
	for (let index = 0; index < renderQueueLifecycles.length; index += 1) {
		if (renderQueueLifecycles[index].hasBack()) return true;
	}
	return false;
}

export function clearBackQueues(): void {
	for (let index = 0; index < renderQueueLifecycles.length; index += 1) {
		renderQueueLifecycles[index].clearBack();
	}
	prepareHeldRenderQueues();
}

export function clearAllQueues(): void {
	for (let index = 0; index < renderQueueLifecycles.length; index += 1) {
		renderQueueLifecycles[index].clearAll();
	}
	prepareHeldRenderQueues();
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

export let _skyTint: [number, number, number] = [1, 1, 1];
export let _skyExposure = 1.0;
