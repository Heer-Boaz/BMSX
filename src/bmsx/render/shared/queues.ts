import { FeatureQueue } from '../../common/feature_queue';
import type {
	GlyphRenderSubmission,
	HostImageRenderSubmission,
	MeshRenderSubmission,
	ParticleRenderSubmission,
	PolyRenderSubmission,
	RectRenderSubmission,
} from './submissions';
import { shallowcopy } from '../../common/shallowcopy';
export type Host2DKind = 'img' | 'poly' | 'rect' | 'glyphs';
export type Host2DRef = HostImageRenderSubmission | PolyRenderSubmission | RectRenderSubmission | GlyphRenderSubmission;
export type Host2DSubmission =
	| ({ type: 'img' } & HostImageRenderSubmission)
	| ({ type: 'poly' } & PolyRenderSubmission)
	| ({ type: 'rect' } & RectRenderSubmission)
	| ({ type: 'glyphs' } & GlyphRenderSubmission);

const meshQueue = new FeatureQueue<MeshRenderSubmission>(256);
const particleQueue = new FeatureQueue<ParticleRenderSubmission>(1024);
const host2dKindQueue = new FeatureQueue<Host2DKind>(512);
const host2dRefQueue = new FeatureQueue<Host2DRef>(512);
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
	{
		hasFront: () => host2dRefQueue.sizeFront() > 0,
		hasBack: () => host2dRefQueue.sizeBack() > 0,
		swap: () => { host2dKindQueue.swap(); host2dRefQueue.swap(); },
		clearBack: () => { host2dKindQueue.clearBack(); host2dRefQueue.clearBack(); },
		clearAll: () => { host2dKindQueue.clearAll(); host2dRefQueue.clearAll(); },
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

export function submitSprite(item: HostImageRenderSubmission): void {
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

export function host2DQueueKind(index: number): Host2DKind {
	return activeQueueSource === 'back' ? host2dKindQueue.getBack(index) : host2dKindQueue.getFront(index);
}

export function host2DQueueRef(index: number): Host2DRef {
	return activeQueueSource === 'back' ? host2dRefQueue.getBack(index) : host2dRefQueue.getFront(index);
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
