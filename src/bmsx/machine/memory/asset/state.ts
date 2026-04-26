import { renderGate, runGate, taskGate } from '../../../core/taskgate';
import {
	type RomAsset,
	type RomImgAsset,
} from '../../../rompack/format';
import type { RawAssetSource } from '../../../rompack/source';
import { type RuntimeAssetLayer } from '../../../rompack/loader';
import {
	buildRuntimeLayerLookup,
	resolveRuntimeLayerAssetById,
	resolveRuntimeLayerAssetFromEntry,
	type RuntimeLayerLookup,
} from './layers';
import { registerImageMemory } from './images';
import type { Runtime } from '../../runtime/runtime';
import type { VdpAtlasDimensions } from '../../devices/vdp/vdp';

const ATLAS_ASSET_ID_PATTERN = /^_atlas_(\d+)$/;

function resolveAtlasId(entry: RomAsset): number | null {
	if (entry.type !== 'atlas') {
		return null;
	}
	if (typeof entry.imgmeta?.atlasid === 'number') {
		return entry.imgmeta.atlasid;
	}
	const match = ATLAS_ASSET_ID_PATTERN.exec(entry.resid);
	return match ? Number(match[1]) : null;
}

function collectAtlasDimensions(layers: ReadonlyArray<RuntimeAssetLayer | null>): Map<number, VdpAtlasDimensions> {
	const atlasDimensions = new Map<number, VdpAtlasDimensions>();
	for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
		const layer = layers[layerIndex];
		if (!layer) {
			continue;
		}
		for (const entry of Object.values(layer.assets.img)) {
			const atlasId = resolveAtlasId(entry);
			const meta = entry.imgmeta;
			if (atlasId === null || !meta || meta.width <= 0 || meta.height <= 0) {
				continue;
			}
			atlasDimensions.set(atlasId, { width: meta.width, height: meta.height });
		}
	}
	return atlasDimensions;
}

export class RuntimeAssetState {
	public biosLayer: RuntimeAssetLayer = null;
	public cartLayer: RuntimeAssetLayer = null;
	public overlayLayer: RuntimeAssetLayer = null;
	public activeSource: RawAssetSource = null;
	public layerLookup: RuntimeLayerLookup = {};

	private readonly memoryGate = taskGate.group('asset:ram');

	public setLayers(layers: ReadonlyArray<RuntimeAssetLayer>): void {
		this.layerLookup = buildRuntimeLayerLookup(layers);
	}

	public getImageAssetByEntry(entry: RomAsset): RomImgAsset {
		return resolveRuntimeLayerAssetFromEntry<RomImgAsset>(this.layerLookup, 'img', entry);
	}

	public getImageAsset(id: string, source?: RawAssetSource): RomImgAsset {
		const assetSource = source || this.requireActiveSource();
		return resolveRuntimeLayerAssetById<RomImgAsset>(this.layerLookup, assetSource, 'img', id);
	}

	public getDataAsset(id: string, source?: RawAssetSource): unknown {
		const assetSource = source || this.requireActiveSource();
		return resolveRuntimeLayerAssetById<unknown>(this.layerLookup, assetSource, 'data', id);
	}

	public listImageAssets(source?: RawAssetSource): RomImgAsset[] {
		const assetSource = source || this.requireActiveSource();
		const entries = assetSource.list();
		const assets: RomImgAsset[] = [];
		for (let index = 0; index < entries.length; index += 1) {
			const entry = entries[index];
			if (entry.type !== 'image' && entry.type !== 'atlas') {
				continue;
			}
			assets.push(this.getImageAssetByEntry(entry));
		}
		return assets;
	}

	public async buildMemory(runtime: Runtime, params?: { source?: RawAssetSource; mode?: 'full' | 'cart' }): Promise<void> {
		const token = this.memoryGate.begin({ blocking: true, category: 'asset', tag: 'asset_memory' });
		const renderToken = renderGate.begin({ blocking: true, category: 'asset', tag: 'asset_memory' });
		const runToken = runGate.begin({ blocking: true, category: 'asset', tag: 'asset_memory' });
		try {
			const mode = params?.mode ?? 'full';
			const engineSource = runtime.engineAssetSource;
			if (!engineSource) {
				throw new Error('engine asset source not configured.');
			}
			const memory = runtime.machine.memory;
			if (mode === 'cart') {
				memory.resetCartAssets();
			} else {
				memory.resetAssetMemory();
			}
			registerImageMemory(memory, engineSource.list());
			runtime.machine.vdp.registerVramAssets(collectAtlasDimensions([this.biosLayer, this.cartLayer, this.overlayLayer]));
			memory.finalizeAssetTable();
			memory.markAllAssetsDirty();
		} finally {
			runGate.end(runToken);
			renderGate.end(renderToken);
			this.memoryGate.end(token);
		}
	}

	private requireActiveSource(): RawAssetSource {
		if (!this.activeSource) {
			throw new Error('active asset source is not configured.');
		}
		return this.activeSource;
	}
}
