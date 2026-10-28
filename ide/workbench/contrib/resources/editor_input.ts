import { ReadonlyEditorInput } from '../../common/editor_input';
import { resourceIdentityKey, type RuntimeResource } from '../../../common/resource';
import type { WorkspaceSourceCatalog } from '../../../workspace/source_catalog';
import type { ResourceViewerTabId } from '../../ui/tab/id';
import type { ResourceViewerContent, ResourceViewerState } from './model';
import type { ResourceEditorIdentity } from '../../common/editor_input';
import { computeResourceTabTitle, sourceTabDescription } from '../../ui/tab/titles';
import { buildResourceViewerContent } from './viewer';
import { HostBitmap } from '../../../../machine/ts/render/host_overlay/bitmap';
import { decodeRomAssetImage } from '../../../../toolchain/ts/rompack/asset_image';
import { WorkbenchImageViewport, type WorkbenchImageViewState } from '../../ui/image_viewport';
import type { RomAsset } from '../../../../toolchain/ts/rompack/assets';
import type { RomToolingLayer } from '../../../../toolchain/ts/rompack/loader';

export const WORKBENCH_RESOURCE_VIEWER_ID = 'workbench.editor.resourceViewer';

export type ResourceImagePreview = {
	readonly asset: RomAsset;
	readonly rom: Uint8Array;
	readonly bitmap: HostBitmap;
	readonly view: WorkbenchImageViewport;
};

/** Retained input for one read-only resource projection. */
export class ResourceViewerInput extends ReadonlyEditorInput<ResourceViewerTabId, 'resource_view'> {
	public readonly view: ResourceViewerState;
	private content: ResourceViewerContent | undefined;
	public preview: ResourceImagePreview | undefined;
	public imagePosition: WorkbenchImageViewState | undefined;
	public override canMove(): boolean { return true; }

	public constructor(private readonly catalog: WorkspaceSourceCatalog, public readonly resource: RuntimeResource) {
		const title = computeResourceTabTitle(resource);
		super(`resource:${resourceIdentityKey(resource)}`, 'resource_view', title, true);
		const input = this;
		this.view = { get content() { return input.content ??= buildResourceViewerContent(input.catalog, input.resource); },
			scroll: 0, scrollLeft: 0, contentView: resource.source.type === 'image' ? 'preview' : 'info' };
		this.setLabel(title, sourceTabDescription(resource));
	}

	/** An explicit open resolves the live projection; the retained viewport stays with this input. */
	public refreshContent(): void { this.content = undefined; }

	/** Visible image pixels belong to this exact admitted resource and packed generation. */
	public preparePreview(asset: RomAsset, rom: RomToolingLayer): ResourceImagePreview {
		if (this.preview?.asset === asset && this.preview.rom === rom.bytes) return this.preview;
		this.preview?.bitmap.dispose();
		const decoded = decodeRomAssetImage(rom.bytes, rom.index.entries, asset, {});
		const view = new WorkbenchImageViewport();
		view.setImage(decoded.width, decoded.height);
		return this.preview = { asset, rom: rom.bytes, bitmap: new HostBitmap({ width: decoded.width, height: decoded.height, pixels: decoded.rgba }), view };
	}

	public createView(): ResourceViewerInput {
		const input = new ResourceViewerInput(this.catalog, this.resource);
		input.view.scroll = this.view.scroll;
		input.view.scrollLeft = this.view.scrollLeft;
		input.view.contentView = this.view.contentView;
		input.imagePosition = this.imagePosition ?? this.preview?.view.saveState();
		return input;
	}

	public override dispose(): void {
		super.dispose();
		this.preview?.bitmap.dispose();
		this.preview = undefined;
	}

	public override toResourceEditor(): ResourceEditorIdentity {
		return { resource: this.resource, editorId: WORKBENCH_RESOURCE_VIEWER_ID };
	}
}
