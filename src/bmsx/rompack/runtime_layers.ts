import type { RawRomSource } from './source';
import type { CartridgeLayerId, RomAsset, RomImgAsset, RuntimeRomPackage } from './format';
import type { RuntimeRomLayer } from './loader';

export type RuntimeRomCollectionKey = 'img' | 'audio' | 'model' | 'data' | 'bin' | 'audioevents';
export type RuntimeRomLayerLookup = Partial<Record<CartridgeLayerId, RuntimeRomLayer>>;

export class RuntimeRomLayers {
	public biosLayer: RuntimeRomLayer = null;
	public cartLayer: RuntimeRomLayer = null;
	public overlayLayer: RuntimeRomLayer = null;
	public activeSource: RawRomSource = null;
	private layerLookup: RuntimeRomLayerLookup = {};

	public setLayers(layers: ReadonlyArray<RuntimeRomLayer>): void {
		const lookup: RuntimeRomLayerLookup = {};
		for (let index = 0; index < layers.length; index += 1) {
			const layer = layers[index]!;
			lookup[layer.id] = layer;
		}
		this.layerLookup = lookup;
	}

	public listLayers(): ReadonlyArray<RuntimeRomLayer | null> {
		return [this.biosLayer, this.cartLayer, this.overlayLayer];
	}

	public systemPackage(): RuntimeRomPackage {
		return this.biosLayer.package;
	}

	public activeCartPackage(): RuntimeRomPackage {
		return (this.overlayLayer ?? this.cartLayer).package;
	}

	public getImageRecord(id: string, source?: RawRomSource): RomImgAsset {
		return this.resolveById<RomImgAsset>(source || this.requireActiveSource(), 'img', id);
	}

	public getDataRecord(id: string, source?: RawRomSource): unknown {
		return this.resolveById<unknown>(source || this.requireActiveSource(), 'data', id);
	}

	public listImageRecords(source?: RawRomSource): RomImgAsset[] {
		const records = (source || this.requireActiveSource()).list();
		const images: RomImgAsset[] = [];
		for (let index = 0; index < records.length; index += 1) {
			const record = records[index];
			if (record.type !== 'image' && record.type !== 'atlas') {
				continue;
			}
			images.push(this.resolveFromEntry<RomImgAsset>('img', record));
		}
		return images;
	}

	private resolveById<T>(source: RawRomSource, kind: RuntimeRomCollectionKey, id: string): T {
		const entry = source.getEntry(id);
		if (!entry) {
			throw new Error(`${kind} ROM entry '${id}' not found.`);
		}
		return this.resolveFromEntry<T>(kind, entry);
	}

	private resolveFromEntry<T>(kind: RuntimeRomCollectionKey, entry: RomAsset): T {
		const payloadId = entry.payload_id;
		if (!payloadId) {
			throw new Error(`ROM entry '${entry.resid}' missing payload_id.`);
		}
		const layer = this.layerLookup[payloadId];
		if (!layer) {
			throw new Error(`ROM layer '${payloadId}' not configured.`);
		}
		const records = getRuntimeLayerRecords(layer, kind) as Record<string, T>;
		const record = records[entry.resid];
		if (!record) {
			throw new Error(`${kind} ROM entry '${entry.resid}' missing from '${payloadId}' layer.`);
		}
		return record;
	}

	private requireActiveSource(): RawRomSource {
		if (!this.activeSource) {
			throw new Error('active ROM source is not configured.');
		}
		return this.activeSource;
	}
}

function getRuntimeLayerRecords(layer: RuntimeRomLayer, kind: RuntimeRomCollectionKey): RuntimeRomPackage[RuntimeRomCollectionKey] {
	switch (kind) {
		case 'img': return layer.package.img;
		case 'audio': return layer.package.audio;
		case 'model': return layer.package.model;
		case 'data': return layer.package.data;
		case 'bin': return layer.package.bin;
		case 'audioevents': return layer.package.audioevents;
	}
}
