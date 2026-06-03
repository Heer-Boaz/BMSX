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
	private readonly idMaps: Map<string, number>[];
	private readonly pathMaps: Map<string, number>[];
	private readonly payloads: Partial<Record<CartridgeLayerId, Uint8Array>>;

	public constructor(layers: RomSourceLayer[]) {
		this.layers = layers;
		this.idMaps = new Array<Map<string, number>>(layers.length);
		this.pathMaps = new Array<Map<string, number>>(layers.length);
		for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
			const entries = layers[layerIndex].index.entries;
			const idMap = new Map<string, number>();
			const pathMap = new Map<string, number>();
			for (let index = 0; index < entries.length; index += 1) {
				const entry = entries[index];
				idMap.set(entry.resid, index);
				if (entry.source_path) {
					pathMap.set(entry.source_path, index);
				}
			}
			this.idMaps[layerIndex] = idMap;
			this.pathMaps[layerIndex] = pathMap;
		}
		const payloads: Partial<Record<CartridgeLayerId, Uint8Array>> = {};
		for (const layer of layers) {
			payloads[layer.id] = layer.payload;
		}
		this.payloads = payloads;
	}

	// disable-next-line single_line_method_pattern -- RawRomSource keeps separate id/path public pins; shared layered lookup ownership stays in findEntry.
	public getEntry(id: asset_id): RomAsset | null {
		return this.findEntry(id, this.idMaps);
	}

	// disable-next-line single_line_method_pattern -- RawRomSource keeps separate id/path public pins; shared layered lookup ownership stays in findEntry.
	public getEntryByPath(path: string): RomAsset | null {
		return this.findEntry(path, this.pathMaps);
	}

	public list(type?: asset_type): RomAsset[] {
		const out: RomAsset[] = [];
		const blocked = new Set<string>();
		for (let layerIndex = 0; layerIndex < this.layers.length; layerIndex += 1) {
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
					continue;
				}
				out.push(this.attachPayloadId(entry, layer.id));
				blocked.add(id);
			}
		}
		return out;
	}

	public getBytes(entry: RomAsset): Uint8Array {
		const payload = this.payloads[entry.payload_id];
		return payload.slice(entry.start, entry.end);
	}

	public getBytesView(entry: RomAsset): Uint8Array {
		const payload = this.payloads[entry.payload_id];
		return payload.subarray(entry.start, entry.end);
	}

	private findEntry(key: string, maps: Map<string, number>[]): RomAsset | null {
		for (let layerIndex = 0; layerIndex < this.layers.length; layerIndex += 1) {
			const entryIndex = maps[layerIndex].get(key);
			if (entryIndex === undefined) {
				continue;
			}
			const asset = this.layers[layerIndex].index.entries[entryIndex];
			if (asset.op === 'delete') {
				return null;
			}
			return this.attachPayloadId(asset, this.layers[layerIndex].id);
		}
		return null;
	}

	private attachPayloadId(asset: RomAsset, payloadId: CartridgeLayerId): RomAsset {
		if (asset.payload_id === payloadId) {
			return asset;
		}
		return { ...asset, payload_id: payloadId };
	}
}
