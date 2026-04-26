import { renderGate, runGate, taskGate } from '../../../core/taskgate';
import { syncLuaAssetField } from '../../firmware/js_bridge';
import type { Memory } from '../memory';
import {
	ENGINE_ATLAS_INDEX,
	generateAtlasName,
	type ImgMeta,
	type RomAsset,
	type RomImgAsset,
	type RuntimeAssets,
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
import { runtimeFault } from '../../runtime/runtime_fault';

export class RuntimeAssetState {
	public biosLayer: RuntimeAssetLayer = null;
	public cartLayer: RuntimeAssetLayer = null;
	public overlayLayer: RuntimeAssetLayer = null;
	public activeSource: RawAssetSource = null;
	public layerLookup: RuntimeLayerLookup = {};

	private readonly memoryGate = taskGate.group('asset:ram');
	private readonly imageMetaByHandle = new Map<number, ImgMeta>();

	public setLayers(layers: ReadonlyArray<RuntimeAssetLayer>): void {
		this.layerLookup = buildRuntimeLayerLookup(layers);
	}

	public getImageMetaByHandle(handle: number): ImgMeta {
		const meta = this.imageMetaByHandle.get(handle);
		if (!meta) {
			throw runtimeFault(`image metadata missing for handle ${handle}.`);
		}
		return meta;
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
			const assetSource = params && params.source ? params.source : this.requireActiveSource();
			const engineSource = runtime.engineAssetSource;
			if (!engineSource) {
				throw runtimeFault('engine asset source not configured.');
			}
			const memory = runtime.machine.memory;
			if (mode === 'cart') {
				memory.resetCartAssets();
			} else {
				memory.resetAssetMemory();
			}
			const imageMemory = registerImageMemory(memory, engineSource.list(), assetSource.list());
			runtime.machine.vdp.registerVramAssets(imageMemory.atlasMemory);
			this.rebuildMetaCaches(assetSource, memory);
			memory.finalizeAssetTable();
			this.applyImageHandlesToActiveLayers(runtime);
			memory.markAllAssetsDirty();
		} finally {
			runGate.end(runToken);
			renderGate.end(renderToken);
			this.memoryGate.end(token);
		}
	}

	public rebuildMetaCaches(source: RawAssetSource, memory: Memory): void {
		this.imageMetaByHandle.clear();
		const engineAtlasId = generateAtlasName(ENGINE_ATLAS_INDEX);
		const entries = source.list();
		for (let index = 0; index < entries.length; index += 1) {
			const entry = entries[index];
			if (entry.type !== 'image' && entry.type !== 'atlas') {
				continue;
			}
			const asset = this.getImageAssetByEntry(entry);
			if (asset.type === 'atlas' && asset.resid !== engineAtlasId) {
				continue;
			}
			const meta = asset.imgmeta;
			if (!meta) {
				throw runtimeFault(`image asset '${asset.resid}' missing metadata.`);
			}
			const handle = memory.resolveAssetHandle(asset.resid);
			this.imageMetaByHandle.set(handle, meta);
		}
	}

	public applyImageHandlesToActiveLayers(runtime: Runtime): void {
		if (this.biosLayer) {
			applyImageHandlesToLayer(runtime, this.biosLayer.assets);
		}
		if (this.cartLayer) {
			applyImageHandlesToLayer(runtime, this.cartLayer.assets);
		}
		if (this.overlayLayer) {
			applyImageHandlesToLayer(runtime, this.overlayLayer.assets);
		}
	}

	private requireActiveSource(): RawAssetSource {
		if (!this.activeSource) {
			throw runtimeFault('active asset source is not configured.');
		}
		return this.activeSource;
	}
}

function applyImageHandlesToLayer(runtime: Runtime, assets: RuntimeAssets): void {
	const memory = runtime.machine.memory;
	for (const entry of Object.values(assets.img)) {
		if (!memory.hasAsset(entry.resid)) {
			delete entry.handle;
			syncLuaAssetField(runtime, entry, 'handle', null);
			continue;
		}
		entry.handle = memory.resolveAssetHandle(entry.resid);
		syncLuaAssetField(runtime, entry, 'handle', entry.handle);
	}
}
