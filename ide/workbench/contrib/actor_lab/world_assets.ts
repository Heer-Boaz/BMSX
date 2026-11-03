import { HostBitmap } from '../../../../machine/ts/render/host_overlay/bitmap';
import { CART_ROM_BASE } from '../../../../machine/ts/spec/bmsx/memory_map';
import { ModelRenderResources } from '../../../common/model_resources';
import type { RuntimeSourceState } from '../../../runtime/sources';
import { decodeImgDecStream } from '../../../../toolchain/ts/rompack/imgdec_codec';
import { decodeGxTextureImage } from '../../../../toolchain/ts/rompack/gx_texture_codec';
import { decodeRomAssetImage } from '../../../../toolchain/ts/rompack/asset_image';
import type { ModelAsset } from '../../../../toolchain/ts/rompack/model';
import type { WorldModelKey, WorldTexture } from './world_geometry';

/** Exact installed media, never the workspace's possibly newer preview assets.
 * Decoding is once per used immutable resource, not once per frame or camera move. */
export class ActorWorldAssets {
	private readonly textures = [new Map<number, HostBitmap>(), new Map<number, HostBitmap>(), new Map<number, HostBitmap>()];
	private readonly models = new Map<ModelAsset, ModelRenderResources>();
	private fixed: HostBitmap | undefined;
	public revision = 0;
	public constructor(private readonly sources: RuntimeSourceState) {}
	public texture(source: WorldTexture): HostBitmap {
		if (source.address === null) {
			if (this.fixed === undefined) {
				const rom = this.sources.systemRom, image = rom.index.entries.find(entry => entry.type === 'image' && entry.imgmeta.gx_atlas_id === undefined)!;
				const decoded = decodeRomAssetImage(rom.bytes, rom.index.entries, image, new Map(), 'atlas');
				this.fixed = new HostBitmap({ width: decoded.width, height: decoded.height, pixels: decoded.rgba });
			}
			return this.fixed;
		}
		const system = source.address < CART_ROM_BASE, domain = system ? -1 : source.domain, cache = this.textures[domain + 1];
		let bitmap = cache.get(source.address);
		if (bitmap === undefined) {
			const rom = system ? this.sources.systemRom : this.sources.cartridgeSlots[domain as 0 | 1]!.rom;
			const payload = decodeImgDecStream(rom.bytes, source.address - (system ? 0 : CART_ROM_BASE), source.bytes).payload;
			const decoded = decodeGxTextureImage(payload, { mode: source.mode, wordWidth: source.wordWidth, height: source.height });
			bitmap = new HostBitmap({ width: decoded.width, height: decoded.height, pixels: decoded.rgba }); cache.set(source.address, bitmap);
		}
		return bitmap;
	}
	public get(key: WorldModelKey): ModelRenderResources {
		const model = key.domain === -1 ? this.sources.systemPackage.model[key.id]
			: this.sources.cartridgeSlots[key.domain]!.package.model[key.id] ?? this.sources.systemPackage.model[key.id];
		let resources = this.models.get(model);
		if (resources === undefined) { resources = new ModelRenderResources(model); this.models.set(model, resources); }
		return resources;
	}
	public dispose(): void {
		for (const cache of this.textures) { for (const bitmap of cache.values()) bitmap.dispose(); cache.clear(); }
		for (const resources of this.models.values()) resources.dispose(); this.models.clear();
		this.fixed?.dispose(); this.fixed = undefined; this.revision++;
	}
}
