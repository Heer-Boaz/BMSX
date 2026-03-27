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
const sorted2DState: Sort2DPipelineState = {
	world: { count: 0, entries: sorted2DWorldEntries },
	ui: { count: 0, entries: sorted2DUIEntries },
	ide: { count: 0, entries: sorted2DIDEEntries },
};

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
		draw = {
			sourceIndex,
			atlasId: entry.atlasId,
			flags: entry.flags,
			assetHandle: entry.assetHandle,
			x: entry.x,
			y: entry.y,
			z: entry.z,
			w: entry.w,
			h: entry.h,
			u0: entry.u0,
			v0: entry.v0,
			u1: entry.u1,
			v1: entry.v1,
			r: entry.r,
			g: entry.g,
			b: entry.b,
			a: entry.a,
			layer: entry.layer,
			parallaxWeight: entry.parallaxWeight,
		};
		sorted2DDrawPool[sourceIndex] = draw;
		return draw;
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
	sorted2DWorldEntries.clear();
	sorted2DUIEntries.clear();
	sorted2DIDEEntries.clear();
	sorted2DStaticWorldEntries.clear();
	sorted2DStaticUIEntries.clear();
	sorted2DStaticIDEEntries.clear();
	sorted2DOamPatWorldEntries.clear();
	sorted2DOamPatUIEntries.clear();
	sorted2DOamPatIDEEntries.clear();
	let sourceIndex = 0;
	Runtime.instance.vdp.forEachSortedBgMap2dEntry((entry, bgSourceIndex) => {
		const draw = getSorted2DDraw(bgSourceIndex, entry);
		resolveBucket(entry.layer, sorted2DStaticWorldEntries, sorted2DStaticUIEntries, sorted2DStaticIDEEntries).push(draw);
		sourceIndex += 1;
	});
	Runtime.instance.vdp.forEachOamPat2dEntry((entry, oamPatSourceIndex) => {
		const draw = getSorted2DDraw(oamPatSourceIndex, entry);
		resolveBucket(entry.layer, sorted2DOamPatWorldEntries, sorted2DOamPatUIEntries, sorted2DOamPatIDEEntries).push(draw);
		sourceIndex += 1;
	});
	if (sourceIndex !== expectedCount) {
		throw new Error(`[Sort2D] begin2dRead count mismatch (${expectedCount} != ${sourceIndex}).`);
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
