import { HostBitmap } from '../../../../machine/ts/render/host_overlay/bitmap';
import { decodeRomAssetImage, type RomTextureDecodeCache } from '../../../../toolchain/ts/rompack/asset_image';
import type { WorkspaceSourceCatalog } from '../../../workspace/source_catalog';
import { WorkbenchImageViewport } from '../../ui/image_viewport';
import type { AnimationSourceDocument } from './model';

/** Selected authored image reference, decoded from the admitted asset namespace, never animation playback. */
export class AnimationFramePreview {
	public readonly view = new WorkbenchImageViewport();
	public bitmap: HostBitmap | undefined;
	public label = '';
	private image: string | undefined;
	private rom: Uint8Array | undefined;
	private readonly texture: RomTextureDecodeCache = new Map();
	public update(document: AnimationSourceDocument | undefined, index: number, contextId: string, catalog: WorkspaceSourceCatalog): void {
		const image = document?.family === 'sprite' ? document.frames[index]?.image : undefined;
		if (image === undefined) {
			if (this.image !== undefined) { this.bitmap?.dispose(); this.bitmap = undefined; this.image = undefined; this.label = ''; }
			return;
		}
		const binding = catalog.resolveAsset(contextId, 'img', image);
		if (binding === undefined) { this.bitmap?.dispose(); this.bitmap = undefined; this.image = undefined; this.label = `${image} / unbound`; return; }
		const mounted = catalog.getContext(binding.contextId).previewRom;
		if (mounted === null) { this.bitmap?.dispose(); this.bitmap = undefined; this.image = undefined; this.label = `${image} / no packed preview`; return; }
		if (image === this.image && mounted.bytes === this.rom) return;
		this.bitmap?.dispose(); this.bitmap = undefined; this.image = image; this.label = '';
		if (this.rom !== mounted.bytes) this.texture.clear();
		this.rom = mounted.bytes;
		const asset = binding.value;
		this.label = image;
		const decoded = decodeRomAssetImage(mounted.bytes, mounted.index.entries, asset, this.texture);
		this.bitmap = new HostBitmap({ width: decoded.width, height: decoded.height, pixels: decoded.rgba });
		this.view.setImage(decoded.width, decoded.height);
	}
	public dispose(): void { this.bitmap?.dispose(); this.bitmap = undefined; this.texture.clear(); this.rom = undefined; }
}
