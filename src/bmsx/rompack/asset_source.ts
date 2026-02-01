import type { asset_id, asset_type, CartridgeIndex, CartridgeLayerId, RomAsset } from './rompack';
import { tokenKeyFromAsset, tokenKeyFromId } from '../util/asset_tokens';

export type AssetSourceLayer = {
	id: CartridgeLayerId;
	index: CartridgeIndex;
	payload: Uint8Array;
};

export interface RawAssetSource {
	getEntry(id: asset_id): RomAsset | null;
	getEntryByPath(path: string): RomAsset | null;
	getBytes(entry: RomAsset): Uint8Array;
	getBytes(entry: RomAsset): Uint8Array;
	getBytesView(entry: RomAsset): Uint8Array;
	list(type?: asset_type): RomAsset[];
}

export class AssetSourceStack implements RawAssetSource {
	private readonly layers: AssetSourceLayer[];
	private readonly idMaps: Map<string, RomAsset>[];
	private readonly pathMaps: Map<string, RomAsset>[];
	private readonly payloads: Partial<Record<CartridgeLayerId, Uint8Array>>;

	public constructor(layers: AssetSourceLayer[]) {
		this.layers = layers;
		this.idMaps = layers.map(layer => {
			const map = new Map<string, RomAsset>();
			for (const asset of layer.index.assets) {
				map.set(tokenKeyFromAsset(asset), asset);
			}
			return map;
		});
		this.pathMaps = layers.map(layer => {
			const map = new Map<string, RomAsset>();
			for (const asset of layer.index.assets) {
				if (!asset.source_path) {
					continue;
				}
				map.set(asset.source_path, asset);
				if (asset.normalized_source_path && asset.normalized_source_path !== asset.source_path) {
					map.set(asset.normalized_source_path, asset);
				}
			}
			return map;
		});
		const payloads: Partial<Record<CartridgeLayerId, Uint8Array>> = {};
		for (const layer of layers) {
			payloads[layer.id] = layer.payload;
		}
		this.payloads = payloads;
	}

	public getEntry(id: asset_id): RomAsset | null {
		const tokenKey = tokenKeyFromId(id);
		for (let i = 0; i < this.layers.length; i++) {
			const asset = this.idMaps[i].get(tokenKey);
			if (!asset) {
				continue;
			}
			if (asset.op === 'delete') {
				return null;
			}
			return this.attachPayloadId(asset, this.layers[i].id);
		}
		return null;
	}

	public getEntryByPath(path: string): RomAsset | null {
		for (let i = 0; i < this.layers.length; i++) {
			const asset = this.pathMaps[i].get(path);
			if (!asset) {
				continue;
			}
			if (asset.op === 'delete') {
				return null;
			}
			return this.attachPayloadId(asset, this.layers[i].id);
		}
		return null;
	}

	public list(type?: asset_type): RomAsset[] {
		const resolved = new Map<string, RomAsset>();
		const blocked = new Set<string>();
		for (let layerIndex = 0; layerIndex < this.layers.length; layerIndex++) {
			const layer = this.layers[layerIndex];
			for (const asset of layer.index.assets) {
				if (type && asset.type !== type) {
					continue;
				}
				const id = tokenKeyFromAsset(asset);
				if (blocked.has(id)) {
					continue;
				}
				if (asset.op === 'delete') {
					blocked.add(id);
					resolved.delete(id);
					continue;
				}
				resolved.set(id, this.attachPayloadId(asset, layer.id));
				blocked.add(id);
			}
		}
		return Array.from(resolved.values());
	}

	public getBytes(entry: RomAsset): Uint8Array {
		const payload = this.payloads[entry.payload_id];
		return payload.slice(entry.start, entry.end);
	}

	public getBytesView(entry: RomAsset): Uint8Array {
		const payload = this.payloads[entry.payload_id];
		return payload.subarray(entry.start, entry.end);
	}

	private attachPayloadId(asset: RomAsset, payloadId: CartridgeLayerId): RomAsset {
		if (asset.payload_id === payloadId) {
			return asset;
		}
		return { ...asset, payload_id: payloadId };
	}
}
