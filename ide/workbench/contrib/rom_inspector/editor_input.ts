import { create_rect_bounds } from '../../../../machine/ts/common/rect';
import { ReadonlyEditorInput } from '../../common/editor_input';
import type { FullWidthWorkbenchLayout } from '../../common/layout';
import { createWorkbenchActionBar, type WorkbenchActionBarState } from '../../ui/action_bar';
import { WorkbenchMenu } from '../../ui/menu/model';
import type { PropertyInspectorViewState } from '../../ui/property_inspector/model';
import { Scrollbar } from '../../ui/scrollbar';
import { WorkbenchScrollViewport } from '../../ui/scroll_viewport';
import { WorkbenchWindowModel } from '../../ui/window/model';
import { RomInspectorContentModel } from './content_model';
import { RomInspectorModel, type RomInspectorSnapshot } from './model';
import { ROM_READER_CONTENT_ACTIONS } from './menus';

let snapshotSequence = 0;

/** A retained mounted-image snapshot; catalog selection and held inspection are independent. */
export class RomInspectorInput extends ReadonlyEditorInput<`rom-inspector:${number}`, 'rom_inspector'> {
	public override canMove(): boolean { return true; }
	public override readonly serializable = false;
	public readonly model: RomInspectorModel;
	public readonly reader: RomInspectorContentModel;
	public readonly actions = createWorkbenchActionBar('romInspector.title', true);
	public readonly keyWindow = new WorkbenchWindowModel(undefined, 0, 0);
	public readonly keyActions = createWorkbenchActionBar('window.title');
	public readonly keyViewport = new WorkbenchScrollViewport();
	public readonly readerWindow = new WorkbenchWindowModel(undefined, 0, 0);
	public override readonly windowPlacements: readonly WorkbenchWindowModel[] = [this.keyWindow, this.readerWindow];
	public readonly readerActions = createWorkbenchActionBar('romInspector.reader.title');
	public readonly readerViewActions: WorkbenchActionBarState;
	public readonly readerBytes = new WorkbenchScrollViewport();
	public readerByteLayout: { lineHeight: number; unitsPerRow: number } | undefined;
	public readonly readerHorizontal = new Scrollbar('horizontal');
	public readonly readerHorizontalTrack = create_rect_bounds();
	public readonly readerContentBounds = create_rect_bounds();
	public readonly readerInfoView: PropertyInspectorViewState = { selectionIndex: -1, selectionVisible: false, anchorIndex: -1, anchorOffset: 0 };
	public readerHeld = false;
	public readonly list = new WorkbenchScrollViewport();
	public readonly filterBounds = create_rect_bounds();
	public readonly mapBounds = create_rect_bounds();
	public readonly layout: FullWidthWorkbenchLayout = { left: 0, top: 0, right: 0, bottom: 0, rowHeight: 0, font: null };
	public get resource(): undefined { return undefined; }
	public constructor(public readonly snapshot: RomInspectorSnapshot) {
		const sequence = ++snapshotSequence;
		super(`rom-inspector:${sequence}`, 'rom_inspector', `${snapshot.domain === -1 ? 'SYSTEM ROM' : `ROM ${snapshot.label.toUpperCase()}`} #${sequence}`, true);
		this.setLabel(this.title, 'Mounted ROM snapshot');
		this.model = new RomInspectorModel(snapshot);
		this.reader = new RomInspectorContentModel(snapshot);
		this.readerViewActions = createWorkbenchActionBar(new WorkbenchMenu(ROM_READER_CONTENT_ACTIONS, this.reader), true);
	}
	public override dispose(): void {
		this.reader.dispose();
		super.dispose();
	}
}
