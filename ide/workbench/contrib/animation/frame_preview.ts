import { HostBitmap } from '../../../../machine/ts/render/host_overlay/bitmap';
import { decodeRomAssetImage, type RomTextureDecodeCache } from '../../../../toolchain/ts/rompack/asset_image';
import type { ResourceDomain } from '../../../common/resource';
import type { RuntimeSourceState } from '../../../runtime/sources';
import { WorkbenchImageViewport } from '../../ui/image_viewport';
import type { AnimationSourceDocument } from './model';

/** Selected authored image reference, decoded from the mounted ROM, never animation playback. */
export class AnimationFramePreview {
	public readonly view = new WorkbenchImageViewport();
	public bitmap: HostBitmap | undefined;
	public label = '';
	private image: string | undefined;
	private rom: Uint8Array | undefined;
	private readonly texture: RomTextureDecodeCache = {};
	public update(document: AnimationSourceDocument | undefined, index: number, domain: ResourceDomain, sources: RuntimeSourceState): void {
		const image = document?.frames[index]?.image;
		if (image === undefined) {
			if (this.image !== undefined) { this.bitmap?.dispose(); this.bitmap = undefined; this.image = undefined; this.label = ''; }
			return;
		}
		const mounted = domain === -1 ? sources.systemRom : sources.cartridgeSlots[domain]!.rom;
		if (image === this.image && mounted.bytes === this.rom) return;
		this.bitmap?.dispose(); this.bitmap = undefined; this.image = image; this.label = '';
		if (this.rom !== mounted.bytes) this.texture.current = undefined;
		this.rom = mounted.bytes;
		const asset = mounted.index.entries.find(asset => asset.type === 'image' && asset.resid === image);
		this.label = image;
		if (asset === undefined) { this.label += ' / not packed'; return; }
		const decoded = decodeRomAssetImage(mounted.bytes, mounted.index.entries, asset, this.texture);
		this.bitmap = new HostBitmap({ width: decoded.width, height: decoded.height, pixels: decoded.rgba });
		this.view.setImage(decoded.width, decoded.height);
	}
	public dispose(): void { this.bitmap?.dispose(); this.bitmap = undefined; this.texture.current = undefined; this.rom = undefined; }
}
