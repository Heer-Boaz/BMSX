import { $, renderGate, runGate } from '../../core/engine';
import { taskGate } from '../../core/taskgate';
import { decodeBinary, decodeBinaryWithPropTable } from '../../common/serializer/binencoder';
import { syncLuaAssetField } from '../firmware/js_bridge';
import {
	CART_ROM_BASE,
	OVERLAY_ROM_BASE,
	SYSTEM_ROM_BASE,
} from './map';
import type { Memory } from './memory';
import {
	ENGINE_ATLAS_INDEX,
	generateAtlasName,
	type AudioMeta,
	type CartridgeLayerId,
	type ImgMeta,
	type RomAsset,
	type RomImgAsset,
	type RuntimeAssets,
	type id2res,
} from '../../rompack/format';
import type { RawAssetSource } from '../../rompack/source';
import { parseCartHeader, type RuntimeAssetLayer } from '../../rompack/loader';
import { parseRomMetadataSection } from '../../rompack/metadata';
import { registerAudioAssets as registerAudioAssetsFromSource } from './audio_assets';
import {
	buildRuntimeLayerLookup,
	resolveLayerForPayload,
	resolveRuntimeLayerAssetById,
	resolveRuntimeLayerAssetFromEntry,
	type RuntimeLayerLookup,
} from './asset_layers';
import { runtimeFault } from '../../ide/runtime/lua_pipeline';
import type { Runtime } from '../runtime/runtime';

type RomAssetRangeLookupResult = {
	found: boolean;
	deleted: boolean;
	romBase: number;
	start: number;
	end: number;
};

export class RuntimeAssetState {
	public biosLayer: RuntimeAssetLayer = null;
	public cartLayer: RuntimeAssetLayer = null;
	public overlayLayer: RuntimeAssetLayer = null;
	public layerLookup: RuntimeLayerLookup = {};

	private readonly memoryGate = taskGate.group('asset:ram');
	private readonly imageMetaByHandle = new Map<number, ImgMeta>();
	private readonly audioMetaByHandle = new Map<number, AudioMeta>();

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

	public getImageAsset(id: string, source: RawAssetSource = $.source): RomImgAsset {
		return resolveRuntimeLayerAssetById<RomImgAsset>(this.layerLookup, source, 'img', id);
	}

	public getAudioAssetByEntry(entry: RomAsset): RomAsset {
		return resolveRuntimeLayerAssetFromEntry<RomAsset>(this.layerLookup, 'audio', entry);
	}

	public getDataAsset(id: string, source: RawAssetSource = $.source): unknown {
		return resolveRuntimeLayerAssetById<unknown>(this.layerLookup, source, 'data', id);
	}

	public listImageAssets(source: RawAssetSource = $.source): RomImgAsset[] {
		const entries = source.list();
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

	public resolveRomAssetRange(assetId: string, scope: 'cart' | 'sys'): { romBase: number; start: number; end: number } {
		if (this.overlayLayer !== null) {
			const overlayResult = resolveRomAssetRangeFromLayer(this.overlayLayer, assetId);
			if (overlayResult.found) {
				if (overlayResult.deleted) {
					throw runtimeFault(`asset '${assetId}' does not exist.`);
				}
				return overlayResult;
			}
		}

		if (this.cartLayer !== null) {
			const cartResult = resolveRomAssetRangeFromLayer(this.cartLayer, assetId);
			if (cartResult.found) {
				if (cartResult.deleted) {
					throw runtimeFault(`asset '${assetId}' does not exist.`);
				}
				return cartResult;
			}
		}

		if (scope === 'sys') {
			const systemResult = resolveRomAssetRangeFromLayer(this.biosLayer, assetId);
			if (systemResult.found) {
				if (systemResult.deleted) {
					throw runtimeFault(`asset '${assetId}' does not exist.`);
				}
				return systemResult;
			}
		}

		throw runtimeFault(`asset '${assetId}' does not exist.`);
	}

	public registerAudioAssets(source: RawAssetSource, memory: Memory): void {
		registerAudioAssetsFromSource(source, memory);
	}

	public async buildMemory(runtime: Runtime, params?: { source?: RawAssetSource; mode?: 'full' | 'cart' }): Promise<void> {
		const token = this.memoryGate.begin({ blocking: true, category: 'asset', tag: 'asset_memory' });
		const renderToken = renderGate.begin({ blocking: true, category: 'asset', tag: 'asset_memory' });
		const runToken = runGate.begin({ blocking: true, category: 'asset', tag: 'asset_memory' });
		try {
			const mode = params?.mode ?? 'full';
			const assetSource = params?.source ?? $.source;
			if (!assetSource) {
				throw runtimeFault('asset source not configured.');
			}
			if (mode === 'cart') {
				runtime.machine.memory.resetCartAssets();
			} else {
				runtime.machine.memory.resetAssetMemory();
			}
			await runtime.machine.vdp.registerImageAssets(assetSource);
			this.registerAudioAssets(assetSource, runtime.machine.memory);
			this.rebuildMetaCaches(assetSource, runtime.machine.memory);
			runtime.machine.memory.finalizeAssetTable();
			this.applyHandlesToActiveLayers(runtime);
			runtime.machine.memory.markAllAssetsDirty();
		} finally {
			runGate.end(runToken);
			renderGate.end(renderToken);
			this.memoryGate.end(token);
		}
	}

	public rebuildMetaCaches(source: RawAssetSource, memory: Memory): void {
		this.imageMetaByHandle.clear();
		this.audioMetaByHandle.clear();
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
		const audioEntries = source.list('audio');
		for (let index = 0; index < audioEntries.length; index += 1) {
			const asset = this.getAudioAssetByEntry(audioEntries[index]!);
			const meta = asset.audiometa;
			if (!meta) {
				throw runtimeFault(`audio asset '${asset.resid}' missing metadata.`);
			}
			const handle = memory.resolveAssetHandle(asset.resid);
			this.audioMetaByHandle.set(handle, meta);
		}
	}

	public applyHandlesToActiveLayers(runtime: Runtime): void {
		if (this.biosLayer) {
			applyAssetHandlesToLayer(runtime, this.biosLayer.assets);
		}
		if (this.cartLayer) {
			applyAssetHandlesToLayer(runtime, this.cartLayer.assets);
		}
		if (this.overlayLayer) {
			applyAssetHandlesToLayer(runtime, this.overlayLayer.assets);
		}
	}

	public buildAudioResourcesForSoundMaster(memory: Memory): id2res {
		const resources: id2res = {};
		const source = $.source;
		if (!source) {
			throw runtimeFault('asset source not configured.');
		}
		const sharedMetadataByPayloadId = new Map<CartridgeLayerId, readonly string[] | null>();
		const entries = source.list('audio');
		for (let index = 0; index < entries.length; index += 1) {
			const entry = entries[index];
			if (typeof entry.start !== 'number' || typeof entry.end !== 'number') {
				throw runtimeFault(`audio asset '${entry.resid}' missing ROM buffer offsets.`);
			}
			if (typeof entry.metabuffer_start !== 'number' || typeof entry.metabuffer_end !== 'number') {
				throw runtimeFault(`audio asset '${entry.resid}' missing metadata offsets.`);
			}
			const metaBytes = source.getBytesView({
				...entry,
				start: entry.metabuffer_start,
				end: entry.metabuffer_end,
			});
			const payloadId = entry.payload_id ?? 'cart';
			let sharedPropNames = sharedMetadataByPayloadId.get(payloadId);
			if (sharedPropNames === undefined) {
				const payload = resolveLayerForPayload(this.layerLookup, payloadId).payload;
				const header = parseCartHeader(payload);
				if (header.metadataLength > 0) {
					const metadataSection = payload.subarray(header.metadataOffset, header.metadataOffset + header.metadataLength);
					sharedPropNames = parseRomMetadataSection(metadataSection).propNames;
				} else {
					sharedPropNames = null;
				}
				sharedMetadataByPayloadId.set(payloadId, sharedPropNames);
			}
			const audiometa = (sharedPropNames ? decodeBinaryWithPropTable(metaBytes, sharedPropNames) : decodeBinary(metaBytes)) as AudioMeta;
			resources[entry.resid] = {
				resid: entry.resid,
				type: 'audio',
				start: entry.start,
				end: entry.end,
				audiometa,
				payload_id: entry.payload_id ?? 'cart',
			};
		}
		for (const [handle, meta] of this.audioMetaByHandle.entries()) {
			const entry = memory.getAssetEntryByHandle(handle);
			if (entry.type !== 'audio' || entry.baseSize <= 0) {
				continue;
			}
			resources[entry.id] = {
				resid: entry.id,
				type: 'audio',
				start: entry.baseAddr,
				end: entry.baseAddr + entry.baseSize,
				audiometa: meta,
				payload_id: 'cart',
			};
		}
		return resources;
	}

	public getAudioBytesById(memory: Memory, id: string): Uint8Array {
		if (memory.hasAsset(id)) {
			const entry = memory.getAssetEntry(id);
			if (entry.type === 'audio' && entry.baseSize > 0) {
				return memory.getAudioBytes(entry);
			}
		}
		const source = $.source;
		if (!source) {
			throw runtimeFault('asset source not configured.');
		}
		const entry = source.getEntry(id);
		if (!entry) {
			throw runtimeFault(`audio asset '${id}' not found in ROM.`);
		}
		if (typeof entry.start !== 'number' || typeof entry.end !== 'number') {
			throw runtimeFault(`audio asset '${id}' missing ROM buffer offsets.`);
		}
		return source.getBytesView(entry);
	}
}

function resolveRomAssetRangeFromLayer(layer: RuntimeAssetLayer | null, assetId: string): RomAssetRangeLookupResult {
	if (layer === null) {
		return { found: false, deleted: false, romBase: 0, start: 0, end: 0 };
	}
	const entries = layer.index.assets;
	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index];
		if (entry.resid !== assetId) {
			continue;
		}
		if (entry.op === 'delete') {
			return { found: true, deleted: true, romBase: 0, start: 0, end: 0 };
		}
		if (entry.start === undefined || entry.end === undefined) {
			throw runtimeFault(`asset '${assetId}' is missing ROM range.`);
		}
		const romBase = layer.id === 'system'
			? SYSTEM_ROM_BASE
			: layer.id === 'overlay'
				? OVERLAY_ROM_BASE
				: CART_ROM_BASE;
		return {
			found: true,
			deleted: false,
			romBase,
			start: entry.start,
			end: entry.end,
		};
	}
	return { found: false, deleted: false, romBase: 0, start: 0, end: 0 };
}

function applyAssetHandlesToLayer(runtime: Runtime, assets: RuntimeAssets): void {
	const maps = [assets.img, assets.audio];
	for (let mapIndex = 0; mapIndex < maps.length; mapIndex += 1) {
		const map = maps[mapIndex];
		for (const entry of Object.values(map)) {
			if (!entry || typeof entry.resid !== 'string') {
				continue;
			}
			if (!runtime.machine.memory.hasAsset(entry.resid)) {
				continue;
			}
			entry.handle = runtime.machine.memory.resolveAssetHandle(entry.resid);
			syncLuaAssetField(runtime, entry, 'handle', entry.handle);
		}
	}
}
