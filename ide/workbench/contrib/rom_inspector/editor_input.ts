import { HostBitmap } from '../../../../machine/ts/render/host_overlay/bitmap';
import { decodeRomAssetImage, type RomTextureDecodeCache } from '../../../../toolchain/ts/rompack/asset_image';
import type { RomAsset } from '../../../../toolchain/ts/rompack/assets';
import { create_rect_bounds } from '../../../../machine/ts/common/rect';
import { ReadonlyEditorInput } from '../../common/editor_input';
import type { FullWidthWorkbenchLayout } from '../../common/layout';
import { createWorkbenchActionBar } from '../../ui/action_bar';
import { Scrollbar } from '../../ui/scrollbar';
import { WorkbenchScrollViewport } from '../../ui/scroll_viewport';
import { RomInspectorModel, type RomInspectorSnapshot } from './model';

let snapshotSequence = 0;

/** A retained mounted-image snapshot; reopening a changed image creates another input. */
export class RomInspectorInput extends ReadonlyEditorInput<`rom-inspector:${number}`, 'rom_inspector'> {
	public readonly model: RomInspectorModel;
	public preview: HostBitmap | undefined;
	private previewAsset: RomAsset | undefined;
	private readonly texture: RomTextureDecodeCache = {};
	public readonly actions = createWorkbenchActionBar('romInspector.title');
	public readonly list = new WorkbenchScrollViewport();
	public readonly bytes = new WorkbenchScrollViewport();
	public readonly horizontal = new Scrollbar('horizontal');
	public readonly horizontalTrack = create_rect_bounds();
	public readonly filterBounds = create_rect_bounds();
	public readonly detailsBounds = create_rect_bounds();
	public readonly mapBounds = create_rect_bounds();
	public readonly layout: FullWidthWorkbenchLayout = { left: 0, top: 0, right: 0, bottom: 0, rowHeight: 0, font: null };
	public get resource(): undefined { return undefined; }
	public constructor(public readonly snapshot: RomInspectorSnapshot) {
		const sequence = ++snapshotSequence;
		super(`rom-inspector:${sequence}`, 'rom_inspector', `${snapshot.domain === -1 ? 'SYSTEM ROM' : `ROM ${snapshot.label.toUpperCase()}`} #${sequence}`, true);
		this.setLabel(this.title, 'Mounted ROM snapshot');
		this.model = new RomInspectorModel(snapshot);
	}
	/** Decode only the selected image; the owning input releases its host texture. */
	public updatePreview(): void {
		const selected = this.model.mode === 'assets' ? this.model.selection?.asset : undefined;
		const asset = selected?.type === 'image' || selected?.type === 'texture' ? selected : undefined;
		if (asset === this.previewAsset) return;
		this.preview?.dispose();
		this.preview = undefined;
		this.previewAsset = asset;
		if (asset !== undefined) {
			const image = decodeRomAssetImage(this.snapshot.rom, this.snapshot.assets, asset, this.texture);
			this.preview = new HostBitmap({ width: image.width, height: image.height, pixels: image.rgba });
		}
	}
	public override dispose(): void {
		this.preview?.dispose();
		this.preview = undefined;
		this.previewAsset = undefined;
		this.texture.current = undefined;
		super.dispose();
	}

}
