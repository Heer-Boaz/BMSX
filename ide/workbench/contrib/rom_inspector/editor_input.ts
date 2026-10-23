import { HostBitmap } from '../../../../machine/ts/render/host_overlay/bitmap';
import { decodeRomAssetImage, type RomTextureDecodeCache } from '../../../../toolchain/ts/rompack/asset_image';
import { decodeCollisionShapeVariant, type CollisionShapeVariant } from '../../../../toolchain/ts/rompack/collision_shape_codec';
import type { RomAsset } from '../../../../toolchain/ts/rompack/assets';
import { create_rect_bounds } from '../../../../machine/ts/common/rect';
import { ReadonlyEditorInput } from '../../common/editor_input';
import type { FullWidthWorkbenchLayout } from '../../common/layout';
import { createWorkbenchActionBar } from '../../ui/action_bar';
import { Scrollbar } from '../../ui/scrollbar';
import { WorkbenchScrollViewport } from '../../ui/scroll_viewport';
import { WorkbenchImageViewport } from '../../ui/image_viewport';
import { WorkbenchWindowModel } from '../../ui/window/model';
import { RomInspectorModel, type RomInspectorSnapshot, type RomInspectorRow } from './model';

let snapshotSequence = 0;

/** A retained mounted-image snapshot; reopening a changed image creates another input. */
export class RomInspectorInput extends ReadonlyEditorInput<`rom-inspector:${number}`, 'rom_inspector'> {
	public override readonly serializable = false;
	public readonly model: RomInspectorModel;
	public preview: HostBitmap | undefined;
	public readonly imageView = new WorkbenchImageViewport();
	public contentMode: 'preview' | 'bytes' = 'preview';
	public contentRevision = 0;
	public showCollision = false;
	public collision: CollisionShapeVariant | undefined;
	public collisionPaths: readonly number[][] = [];
	private previewRow: RomInspectorRow | undefined;
	private previewAsset: RomAsset | undefined;
	private readonly texture: RomTextureDecodeCache = {};
	public readonly actions = createWorkbenchActionBar('romInspector.title', true);
	public readonly keyWindow = new WorkbenchWindowModel({ left: 0, top: 0, right: 0, bottom: 0 }, 0, 0);
	public readonly keyActions = createWorkbenchActionBar('window.title');
	public readonly keyViewport = new WorkbenchScrollViewport();
	public keyPlacementInitialized = false;
	public readonly contentActions = createWorkbenchActionBar('romInspector.content', true);
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
		const row = this.model.selection;
		if (row !== this.previewRow) {
			this.previewRow = row;
			this.contentMode = this.model.canPreviewImage ? 'preview' : 'bytes';
			this.contentRevision++;
		}
		const asset = this.model.canPreviewImage ? row!.asset : undefined;
		if (asset === this.previewAsset) return;
		this.preview?.dispose();
		this.preview = undefined;
		this.previewAsset = asset;
		this.collisionPaths = [];
		this.collision = undefined;
		if (asset !== undefined) {
			const image = decodeRomAssetImage(this.snapshot.rom, this.snapshot.assets, asset, this.texture);
			this.preview = new HostBitmap({ width: image.width, height: image.height, pixels: image.rgba });
			this.imageView.setImage(image.width, image.height);
			if (asset.collision_bin_start !== undefined) {
				this.collision = decodeCollisionShapeVariant(this.snapshot.rom.subarray(asset.collision_bin_start, asset.collision_bin_end));
				const pieces = this.collision.pieces;
				if (pieces !== undefined) this.collisionPaths = pieces.map(piece => {
					if (piece.kind === 'convex_poly') return piece.vertices.concat(piece.vertices[0], piece.vertices[1]);
					const { left, top, right, bottom } = piece.bounds;
					return [left, top, right, top, right, bottom, left, bottom, left, top];
				});
			}
		}
	}
	public get showingImage(): boolean { return this.contentMode === 'preview' && this.preview !== undefined; }
	public get hasCollision(): boolean { return this.collision !== undefined; }
	public override dispose(): void {
		this.preview?.dispose();
		this.preview = undefined;
		this.previewAsset = undefined;
		this.texture.current = undefined;
		super.dispose();
	}

}
