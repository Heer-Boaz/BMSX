import type { asset_id, asset_type, CartridgeIndex, CartridgeLayerId, RomAsset } from './format';

export type RomSourceLayer = {
	id: CartridgeLayerId;
	index: CartridgeIndex;
	payload: Uint8Array;
};

export interface RawRomSource {
	getEntry(id: asset_id): RomAsset | null;
	getEntryByPath(path: string): RomAsset | null;
	getBytes(entry: RomAsset): Uint8Array;
	getBytesView(entry: RomAsset): Uint8Array;
	list(type?: asset_type): RomAsset[];
}

export class RomSourceStack implements RawRomSource {
	private readonly layers: RomSourceLayer[];
	private readonly idMaps: Map<string, RomAsset>[];
	private readonly pathMaps: Map<string, RomAsset>[];
	private readonly payloads: Partial<Record<CartridgeLayerId, Uint8Array>>;

	public constructor(layers: RomSourceLayer[]) {
		this.layers = layers;
		this.idMaps = layers.map(layer => {
			const map = new Map<string, RomAsset>();
			for (const entry of layer.index.entries) {
				map.set(entry.resid, entry);
			}
			return map;
		});
		this.pathMaps = layers.map(layer => {
			const map = new Map<string, RomAsset>();
			for (const entry of layer.index.entries) {
				if (!entry.source_path) {
					continue;
				}
				map.set(entry.source_path, entry);
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
		for (let i = 0; i < this.layers.length; i++) {
			const asset = this.idMaps[i].get(id);
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
			for (const entry of layer.index.entries) {
				if (type && entry.type !== type) {
					continue;
				}
				const id = entry.resid;
				if (blocked.has(id)) {
					continue;
				}
				if (entry.op === 'delete') {
					blocked.add(id);
					resolved.delete(id);
					continue;
				}
				resolved.set(id, this.attachPayloadId(entry, layer.id));
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
