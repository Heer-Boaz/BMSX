import { Runtime } from '../../emulator/runtime';
import { drainOverlayFrameIntoSpriteQueue } from '../../emulator/render_facade';
import { ScratchBatch } from '../../utils/scratchbatch';
import type { RenderPassLibrary } from '../backend/renderpasslib';
import type { Sort2DPipelineState, Sorted2DDrawEntry } from '../backend/pipeline_interfaces';
import { OAM_LAYER_IDE, OAM_LAYER_UI } from '../shared/render_types';

const sorted2DWorldEntries = new ScratchBatch<Sorted2DDrawEntry>();
const sorted2DUIEntries = new ScratchBatch<Sorted2DDrawEntry>();
const sorted2DIDEEntries = new ScratchBatch<Sorted2DDrawEntry>();
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

export function buildSorted2DState(): Sort2DPipelineState {
	const expectedCount = Runtime.instance.vdp.begin2dRead();
	sorted2DWorldEntries.clear();
	sorted2DUIEntries.clear();
	sorted2DIDEEntries.clear();
	let worldCount = 0;
	let uiCount = 0;
	let ideCount = 0;
	let sourceIndex = 0;
	Runtime.instance.vdp.forEach2dEntry((entry) => {
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
		} else {
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
		}
		if (entry.layer === OAM_LAYER_IDE) {
			sorted2DIDEEntries.push(draw);
			ideCount += 1;
		} else if (entry.layer === OAM_LAYER_UI) {
			sorted2DUIEntries.push(draw);
			uiCount += 1;
		} else {
			sorted2DWorldEntries.push(draw);
			worldCount += 1;
		}
		sourceIndex += 1;
	});
	if (sourceIndex !== expectedCount) {
		throw new Error(`[Sort2D] begin2dRead count mismatch (${expectedCount} != ${sourceIndex}).`);
	}
	if (worldCount > 1) {
		sorted2DWorldEntries.sort(compareSorted2DDraws);
	}
	if (uiCount > 1) {
		sorted2DUIEntries.sort(compareSorted2DDraws);
	}
	if (ideCount > 1) {
		sorted2DIDEEntries.sort(compareSorted2DDraws);
	}
	sorted2DState.world.count = worldCount;
	sorted2DState.ui.count = uiCount;
	sorted2DState.ide.count = ideCount;
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
