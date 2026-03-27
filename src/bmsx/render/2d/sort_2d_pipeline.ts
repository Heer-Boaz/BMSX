import { Runtime } from '../../emulator/runtime';
import { drainOverlayFrameIntoSpriteQueue } from '../../emulator/render_facade';
import { ScratchBatch } from '../../utils/scratchbatch';
import type { RenderPassLibrary } from '../backend/renderpasslib';
import type { Sort2DPipelineState, Sorted2DDrawEntry } from '../backend/pipeline_interfaces';
import { OAM_LAYER_IDE, OAM_LAYER_UI } from '../shared/render_types';

const sorted2DWorldEntries = new ScratchBatch<Sorted2DDrawEntry>();
const sorted2DUIEntries = new ScratchBatch<Sorted2DDrawEntry>();
const sorted2DIDEEntries = new ScratchBatch<Sorted2DDrawEntry>();
const sorted2DStaticWorldEntries = new ScratchBatch<Sorted2DDrawEntry>();
const sorted2DStaticUIEntries = new ScratchBatch<Sorted2DDrawEntry>();
const sorted2DStaticIDEEntries = new ScratchBatch<Sorted2DDrawEntry>();
const sorted2DOamPatWorldEntries = new ScratchBatch<Sorted2DDrawEntry>();
const sorted2DOamPatUIEntries = new ScratchBatch<Sorted2DDrawEntry>();
const sorted2DOamPatIDEEntries = new ScratchBatch<Sorted2DDrawEntry>();
const sorted2DDrawPool: Sorted2DDrawEntry[] = [];
const sorted2DCapacityHints = {
	world: 0,
	ui: 0,
	ide: 0,
	draws: 0,
};
const sorted2DState: Sort2DPipelineState = {
	world: { count: 0, entries: sorted2DWorldEntries },
	ui: { count: 0, entries: sorted2DUIEntries },
	ide: { count: 0, entries: sorted2DIDEEntries },
};
let sorted2DWriteCount = 0;

function createSorted2DDraw(): Sorted2DDrawEntry {
	return {
		sourceIndex: 0,
		atlasId: 0,
		flags: 0,
		assetHandle: 0,
		x: 0,
		y: 0,
		z: 0,
		w: 0,
		h: 0,
		u0: 0,
		v0: 0,
		u1: 0,
		v1: 0,
		r: 0,
		g: 0,
		b: 0,
		a: 0,
		layer: 0,
		parallaxWeight: 0,
	};
}

function ensureSorted2DDrawPoolCapacity(capacity: number): void {
	while (sorted2DDrawPool.length < capacity) {
		sorted2DDrawPool.push(createSorted2DDraw());
	}
}

function reserveSorted2DBuckets(): void {
	if (sorted2DCapacityHints.world > 0) {
		sorted2DWorldEntries.reserve(sorted2DCapacityHints.world);
		sorted2DStaticWorldEntries.reserve(sorted2DCapacityHints.world);
		sorted2DOamPatWorldEntries.reserve(sorted2DCapacityHints.world);
	}
	if (sorted2DCapacityHints.ui > 0) {
		sorted2DUIEntries.reserve(sorted2DCapacityHints.ui);
		sorted2DStaticUIEntries.reserve(sorted2DCapacityHints.ui);
		sorted2DOamPatUIEntries.reserve(sorted2DCapacityHints.ui);
	}
	if (sorted2DCapacityHints.ide > 0) {
		sorted2DIDEEntries.reserve(sorted2DCapacityHints.ide);
		sorted2DStaticIDEEntries.reserve(sorted2DCapacityHints.ide);
		sorted2DOamPatIDEEntries.reserve(sorted2DCapacityHints.ide);
	}
	if (sorted2DCapacityHints.draws > 0) {
		ensureSorted2DDrawPoolCapacity(sorted2DCapacityHints.draws);
	}
}

function updateSorted2DCapacityHints(drawCount: number): void {
	sorted2DCapacityHints.draws = Math.max(sorted2DCapacityHints.draws, drawCount);
	sorted2DCapacityHints.world = Math.max(sorted2DCapacityHints.world, sorted2DWorldEntries.size, sorted2DStaticWorldEntries.size, sorted2DOamPatWorldEntries.size);
	sorted2DCapacityHints.ui = Math.max(sorted2DCapacityHints.ui, sorted2DUIEntries.size, sorted2DStaticUIEntries.size, sorted2DOamPatUIEntries.size);
	sorted2DCapacityHints.ide = Math.max(sorted2DCapacityHints.ide, sorted2DIDEEntries.size, sorted2DStaticIDEEntries.size, sorted2DOamPatIDEEntries.size);
}

function copySorted2DDraw(target: Sorted2DDrawEntry, sourceIndex: number, atlasId: number, flags: number, assetHandle: number, x: number, y: number, z: number, w: number, h: number, u0: number, v0: number, u1: number, v1: number, r: number, g: number, b: number, a: number, layer: Sorted2DDrawEntry['layer'], parallaxWeight: number): void {
	target.sourceIndex = sourceIndex;
	target.atlasId = atlasId;
	target.flags = flags;
	target.assetHandle = assetHandle;
	target.x = x;
	target.y = y;
	target.z = z;
	target.w = w;
	target.h = h;
	target.u0 = u0;
	target.v0 = v0;
	target.u1 = u1;
	target.v1 = v1;
	target.r = r;
	target.g = g;
	target.b = b;
	target.a = a;
	target.layer = layer;
	target.parallaxWeight = parallaxWeight;
}

function compareSorted2DDraws(a: Sorted2DDrawEntry, b: Sorted2DDrawEntry): number {
	const zDelta = a.z - b.z;
	if (zDelta !== 0) {
		return zDelta;
	}
	return a.sourceIndex - b.sourceIndex;
}

function getSorted2DDraw(sourceIndex: number, entry: Omit<Sorted2DDrawEntry, 'sourceIndex'>): Sorted2DDrawEntry {
	let draw = sorted2DDrawPool[sourceIndex];
	if (!draw) {
		draw = createSorted2DDraw();
		sorted2DDrawPool[sourceIndex] = draw;
	}
	copySorted2DDraw(
		draw,
		sourceIndex,
		entry.atlasId,
		entry.flags,
		entry.assetHandle,
		entry.x,
		entry.y,
		entry.z,
		entry.w,
		entry.h,
		entry.u0,
		entry.v0,
		entry.u1,
		entry.v1,
		entry.r,
		entry.g,
		entry.b,
		entry.a,
		entry.layer,
		entry.parallaxWeight,
	);
	return draw;
}

function appendSortedBgMap2dEntry(entry: Omit<Sorted2DDrawEntry, 'sourceIndex'>, sourceIndex: number): void {
	const draw = getSorted2DDraw(sourceIndex, entry);
	resolveBucket(entry.layer, sorted2DStaticWorldEntries, sorted2DStaticUIEntries, sorted2DStaticIDEEntries).push(draw);
	sorted2DWriteCount += 1;
}

function appendSortedOamPat2dEntry(entry: Omit<Sorted2DDrawEntry, 'sourceIndex'>, sourceIndex: number): void {
	const draw = getSorted2DDraw(sourceIndex, entry);
	resolveBucket(entry.layer, sorted2DOamPatWorldEntries, sorted2DOamPatUIEntries, sorted2DOamPatIDEEntries).push(draw);
	sorted2DWriteCount += 1;
}

function resolveBucket(layer: number, world: ScratchBatch<Sorted2DDrawEntry>, ui: ScratchBatch<Sorted2DDrawEntry>, ide: ScratchBatch<Sorted2DDrawEntry>): ScratchBatch<Sorted2DDrawEntry> {
	if (layer === OAM_LAYER_IDE) {
		return ide;
	}
	if (layer === OAM_LAYER_UI) {
		return ui;
	}
	return world;
}

function mergeSortedBuckets(target: ScratchBatch<Sorted2DDrawEntry>, staticEntries: ScratchBatch<Sorted2DDrawEntry>, dynamicEntries: ScratchBatch<Sorted2DDrawEntry>): number {
	target.clear();
	let staticIndex = 0;
	let dynamicIndex = 0;
	while (staticIndex < staticEntries.size && dynamicIndex < dynamicEntries.size) {
		if (compareSorted2DDraws(staticEntries.get(staticIndex), dynamicEntries.get(dynamicIndex)) <= 0) {
			target.push(staticEntries.get(staticIndex));
			staticIndex += 1;
			continue;
		}
		target.push(dynamicEntries.get(dynamicIndex));
		dynamicIndex += 1;
	}
	while (staticIndex < staticEntries.size) {
		target.push(staticEntries.get(staticIndex));
		staticIndex += 1;
	}
	while (dynamicIndex < dynamicEntries.size) {
		target.push(dynamicEntries.get(dynamicIndex));
		dynamicIndex += 1;
	}
	return target.size;
}

export function buildSorted2DState(): Sort2DPipelineState {
	const bgMapCount = Runtime.instance.vdp.beginBgMap2dRead();
	const oamPatCount = Runtime.instance.vdp.beginOamPat2dRead();
	const expectedCount = bgMapCount + oamPatCount;
	reserveSorted2DBuckets();
	ensureSorted2DDrawPoolCapacity(expectedCount);
	sorted2DWorldEntries.clear();
	sorted2DUIEntries.clear();
	sorted2DIDEEntries.clear();
	sorted2DStaticWorldEntries.clear();
	sorted2DStaticUIEntries.clear();
	sorted2DStaticIDEEntries.clear();
	sorted2DOamPatWorldEntries.clear();
	sorted2DOamPatUIEntries.clear();
	sorted2DOamPatIDEEntries.clear();
	sorted2DWriteCount = 0;
	Runtime.instance.vdp.forEachSortedBgMap2dEntry(appendSortedBgMap2dEntry);
	Runtime.instance.vdp.forEachOamPat2dEntry(appendSortedOamPat2dEntry);
	if (sorted2DWriteCount !== expectedCount) {
		throw new Error(`[Sort2D] begin2dRead count mismatch (${expectedCount} != ${sorted2DWriteCount}).`);
	}
	if (sorted2DOamPatWorldEntries.size > 1) {
		sorted2DOamPatWorldEntries.sort(compareSorted2DDraws);
	}
	if (sorted2DOamPatUIEntries.size > 1) {
		sorted2DOamPatUIEntries.sort(compareSorted2DDraws);
	}
	if (sorted2DOamPatIDEEntries.size > 1) {
		sorted2DOamPatIDEEntries.sort(compareSorted2DDraws);
	}
	sorted2DState.world.count = mergeSortedBuckets(sorted2DWorldEntries, sorted2DStaticWorldEntries, sorted2DOamPatWorldEntries);
	sorted2DState.ui.count = mergeSortedBuckets(sorted2DUIEntries, sorted2DStaticUIEntries, sorted2DOamPatUIEntries);
	sorted2DState.ide.count = mergeSortedBuckets(sorted2DIDEEntries, sorted2DStaticIDEEntries, sorted2DOamPatIDEEntries);
	updateSorted2DCapacityHints(expectedCount);
	return sorted2DState;
}

export function registerSort2DPass_WebGL(registry: RenderPassLibrary): void {
	registry.register({
		id: 'sort_2d',
		name: 'Sort2D',
		stateOnly: true,
		exec: () => {
			drainOverlayFrameIntoSpriteQueue();
			registry.setState('sort_2d', buildSorted2DState());
		},
	});
}
