import { HostBitmap } from '../../machine/ts/render/host_overlay/bitmap';
import { decodeRomAssetImage, type RomTextureDecodeCache } from '../../toolchain/ts/rompack/asset_image';
import type { RomAsset } from '../../toolchain/ts/rompack/assets';
import type { WorkspaceSourceCatalog, WorkspaceSourceContext } from './source_catalog';

type ImageBinding = {
	readonly provider: WorkspaceSourceContext;
	readonly asset: RomAsset;
	readonly rom: Uint8Array;
	readonly view: WorkspaceImageAsset;
	epoch: number;
};
type AtlasBinding = { readonly bitmap: HostBitmap; epoch: number };
type TextureBinding = { readonly rom: Uint8Array; readonly cache: RomTextureDecodeCache; readonly atlases: Map<string | undefined, AtlasBinding> };

export type WorkspaceImageAsset = {
	readonly bitmap: HostBitmap;
	readonly width: number;
	readonly height: number;
	readonly u0: number; readonly v0: number; readonly u1: number; readonly v1: number;
};

/** One reader's shared atlas resources and image regions, bound to exact providers and packed generations. */
export class WorkspaceImageAssets {
	private readonly images = new Map<string, ImageBinding>();
	private readonly textures = new Map<WorkspaceSourceContext, TextureBinding>();
	private epoch = 0;
	public constructor(private readonly catalog: WorkspaceSourceCatalog) {}

	/** Source/catalog changes replace the used set; steady drawing only borrows prepared bitmaps. */
	public update(contextId: string, imageIds: ReadonlySet<string>): void {
		const epoch = ++this.epoch;
		for (const id of imageIds) {
			const binding = this.catalog.resolveAsset(contextId, 'img', id);
			if (binding === undefined) continue;
			const provider = this.catalog.getContext(binding.contextId), mounted = provider.previewRom;
			if (mounted === null) continue;
			let texture = this.textures.get(provider);
			if (texture === undefined || texture.rom !== mounted.bytes) {
				if (texture !== undefined) for (const atlas of texture.atlases.values()) atlas.bitmap.dispose();
				texture = { rom: mounted.bytes, cache: new Map(), atlases: new Map() };
				this.textures.set(provider, texture);
			}
			const image = binding.value.imgmeta!, atlasId = image.gx_atlas_id;
			let atlas = texture.atlases.get(atlasId);
			if (atlas === undefined) {
				const decoded = decodeRomAssetImage(mounted.bytes, mounted.index.entries, binding.value, texture.cache, 'atlas');
				atlas = { epoch, bitmap: new HostBitmap({ width: decoded.width, height: decoded.height, pixels: decoded.rgba }) };
				texture.atlases.set(atlasId, atlas);
			} else atlas.epoch = epoch;
			const previous = this.images.get(id);
			if (previous?.provider === provider && previous.asset === binding.value && previous.rom === mounted.bytes) {
				previous.epoch = epoch; continue;
			}
			const bitmap = atlas.bitmap, width = bitmap.image.width, height = bitmap.image.height;
			this.images.set(id, { provider, asset: binding.value, rom: mounted.bytes, epoch,
				view: { bitmap, width: image.width, height: image.height, u0: image.texture_u / width, v0: image.texture_v / height,
					u1: (image.texture_u + image.width) / width, v1: (image.texture_v + image.height) / height } });
		}
		for (const [id, image] of this.images) if (image.epoch !== epoch) this.images.delete(id);
		for (const [provider, texture] of this.textures) {
			for (const [id, atlas] of texture.atlases) if (atlas.epoch !== epoch) {
				atlas.bitmap.dispose(); texture.atlases.delete(id);
				if (id !== undefined) texture.cache.delete(id);
			}
			if (texture.atlases.size === 0) this.textures.delete(provider);
		}
	}
	public get(id: string): WorkspaceImageAsset | undefined { return this.images.get(id)?.view; }
	public dispose(): void {
		for (const texture of this.textures.values()) for (const atlas of texture.atlases.values()) atlas.bitmap.dispose();
		this.images.clear(); this.textures.clear();
	}
}
