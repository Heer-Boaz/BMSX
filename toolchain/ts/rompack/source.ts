import type { CartridgeIndex, RomAsset } from './assets';
import type { RomImageDomain } from '../../../machine/ts/rompack/image';
import type { AssetId, AssetType } from '../../../machine/ts/rompack/toc';

export type RomSourceLayer = {
	id: RomImageDomain;
	index: CartridgeIndex;
	bytes: Uint8Array;
};

export interface RawRomSource {
	getEntry(id: AssetId): RomAsset | null;
	getEntryByPath(path: string): RomAsset | null;
	getBytes(entry: RomAsset): Uint8Array;
	getBytesView(entry: RomAsset): Uint8Array;
	getCompiledBytesView(entry: RomAsset): Uint8Array;
	list(type?: AssetType): RomAsset[];
}

export class RomSourceStack implements RawRomSource {
	private readonly layers: RomSourceLayer[];
	private readonly idMaps: Map<string, number>[];
	private readonly pathMaps: Map<string, number>[];
	private readonly bytesByDomain: Partial<Record<RomImageDomain, Uint8Array>>;

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
		const bytesByDomain: Partial<Record<RomImageDomain, Uint8Array>> = {};
		for (const layer of layers) {
			bytesByDomain[layer.id] = layer.bytes;
		}
		this.bytesByDomain = bytesByDomain;
	}

	// disable-next-line single_line_method_pattern -- RawRomSource keeps separate id/path public pins; shared layered lookup ownership stays in findEntry.
	public getEntry(id: AssetId): RomAsset | null {
		return this.findEntry(id, this.idMaps);
	}

	// disable-next-line single_line_method_pattern -- RawRomSource keeps separate id/path public pins; shared layered lookup ownership stays in findEntry.
	public getEntryByPath(path: string): RomAsset | null {
		return this.findEntry(path, this.pathMaps);
	}

	public list(type?: AssetType): RomAsset[] {
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
				out.push(entry);
				blocked.add(id);
			}
		}
		return out;
	}

	public getBytes(entry: RomAsset): Uint8Array {
		const bytes = this.bytesByDomain[entry.payload_id];
		return bytes.slice(entry.start, entry.end);
	}

	public getBytesView(entry: RomAsset): Uint8Array {
		const bytes = this.bytesByDomain[entry.payload_id];
		return bytes.subarray(entry.start, entry.end);
	}

	public getCompiledBytesView(entry: RomAsset): Uint8Array {
		const bytes = this.bytesByDomain[entry.payload_id];
		return bytes.subarray(entry.compiled_start, entry.compiled_end);
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
			return asset;
		}
		return null;
	}
}
