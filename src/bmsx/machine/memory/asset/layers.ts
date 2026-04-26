import type { RawAssetSource } from '../../../rompack/source';
import type { CartridgeLayerId, RomAsset, RuntimeAssets } from '../../../rompack/format';
import type { RuntimeAssetLayer } from '../../../rompack/loader';
import {
	CART_ROM_BASE,
	OVERLAY_ROM_BASE,
	SYSTEM_ROM_BASE,
} from '../map';

export type RuntimeAssetCollectionKey = 'img' | 'audio' | 'model' | 'data' | 'bin' | 'audioevents';
export type RuntimeLayerLookup = Partial<Record<CartridgeLayerId, RuntimeAssetLayer>>;

export function buildRuntimeLayerLookup(layers: ReadonlyArray<RuntimeAssetLayer>): RuntimeLayerLookup {
	const lookup: RuntimeLayerLookup = {};
	for (let index = 0; index < layers.length; index += 1) {
		const layer = layers[index]!;
		lookup[layer.id] = layer;
	}
	return lookup;
}

function getRuntimeLayerAssets(layer: RuntimeAssetLayer, kind: RuntimeAssetCollectionKey): RuntimeAssets[RuntimeAssetCollectionKey] {
	switch (kind) {
		case 'img': return layer.assets.img;
		case 'audio': return layer.assets.audio;
		case 'model': return layer.assets.model;
		case 'data': return layer.assets.data;
		case 'bin': return layer.assets.bin;
		case 'audioevents': return layer.assets.audioevents;
	}
}

export function romBaseForPayload(payloadId: CartridgeLayerId): number {
	switch (payloadId) {
		case 'system': return SYSTEM_ROM_BASE;
		case 'overlay': return OVERLAY_ROM_BASE;
		case 'cart': return CART_ROM_BASE;
	}
}

export function resolveRuntimeLayerAssetFromEntry<T>(lookup: RuntimeLayerLookup, kind: RuntimeAssetCollectionKey, entry: RomAsset): T {
	const payloadId = entry.payload_id;
	if (!payloadId) {
		throw new Error(`asset '${entry.resid}' missing payload_id.`);
	}
	const layer = lookup[payloadId];
	const assets = getRuntimeLayerAssets(layer, kind) as Record<string, T>;
	const asset = assets[entry.resid];
	if (!asset) {
		throw new Error(`${kind} asset '${entry.resid}' missing from '${payloadId}' layer.`);
	}
	return asset;
}

export function resolveRuntimeLayerAssetById<T>(lookup: RuntimeLayerLookup, source: RawAssetSource, kind: RuntimeAssetCollectionKey, id: string): T {
	const entry = source.getEntry(id);
	if (!entry) {
		throw new Error(`${kind} asset '${id}' not found.`);
	}
	return resolveRuntimeLayerAssetFromEntry<T>(lookup, kind, entry);
}
