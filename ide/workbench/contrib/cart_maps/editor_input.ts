import { create_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import { resourceIdentityKey } from '../../../common/resource';
import type { EditorTextModel } from '../../../editor/model/text_model';
import { EditorEditStateType, type EditorEditSource } from '../../../editor/model/edit_state';
import { mapTrackedTextRange, type TrackedTextRange } from '../../../editor/text/text_change';
import { WorkingCopyEditorInput } from '../../common/editor_input';
import type { FullWidthWorkbenchLayout } from '../../common/layout';
import type { EditorFont } from '../../../editor/ui/view/font';
import { createWorkbenchActionBar } from '../../ui/action_bar';
import { computeResourceTabTitle, sourceTabDescription } from '../../ui/tab/titles';
import { ScrollableWorkbenchTree } from '../../ui/scrollable_tree';
import { CartMapGrid, type MapGridContent, type MapGridMarker } from './grid';
import type { PietiousObject, PietiousSource } from './pietious_source';
import type { NemesisMarker, NemesisSource } from './nemesis_source';
import { captureCartMapView, restoreCartMapView } from './view_snapshot';

export type CartMapKind = 'pietious' | 'nemesis';
export type CartMapSection = 'outline' | 'map';
export type CartMapLayoutMode = 'split' | CartMapSection;
export const WORKBENCH_CART_MAP_EDITOR_ID = 'bmsx.cartMap';
export const cartMapEditSelection = new EditorEditStateType<Readonly<TrackedTextRange>>();
export type CartMapItem = MapGridMarker & (
	{ readonly kind: 'object'; readonly document: PietiousSource; readonly source: PietiousObject }
	| { readonly kind: 'marker'; readonly document: NemesisSource; readonly source: NemesisMarker }
);
export type CartMapSheet = MapGridContent & {
	readonly key: string;
	readonly range: TrackedTextRange;
	readonly markers: readonly CartMapItem[];
};
export type CartMapTreeElement = {
	readonly label: string;
	displayLabel: string;
	readonly range: TrackedTextRange;
	readonly sheet: CartMapSheet;
	readonly item?: CartMapItem;
	readonly diagnostic: string | null;
};
export type CartMapLayout = FullWidthWorkbenchLayout & {
	minimumFont: EditorFont | undefined;
	mode: CartMapLayoutMode;
	splitMinimumWidth: number;
	outlineMinimumWidth: number;
	mapMinimumWidth: number;
	fieldMinimumWidth: number;
	axisLabelWidth: number;
	gridLeft: number;
	sourceTitle: string;
	outlineTitle: string;
	selectionTitle: string;
	selectionLabel: string;
	sourceVersion: number;
	sourceBounds: RectBounds;
	selectionBounds: RectBounds;
};

/** A retained source projection, not a second map document or a runtime scene. */
export class CartMapInput extends WorkingCopyEditorInput<`map:${string}`, 'cart_map'> {
	public override canMove(): boolean { return true; }
	public readonly editSource: EditorEditSource = Symbol('cart-map-view');
	public version = -1;
	public viewRevision = 0;
	public activeSheet: string | undefined;
	public section: CartMapSection = 'outline';
	public restoredTreeScroll: number | undefined;
	public readonly sourceCaption: string;
	public diagnostic: string | null = null;
	public readonly selectionRange: TrackedTextRange = { start: 0, end: 0 };
	public readonly tree = new ScrollableWorkbenchTree<CartMapTreeElement>();
	public readonly grid = new CartMapGrid();
	public readonly actionBar = createWorkbenchActionBar('cartMap.title');
	public readonly fieldBounds = [create_rect_bounds(), create_rect_bounds()] as const;
	public readonly layout: CartMapLayout = {
		minimumFont: undefined,
		mode: 'outline', splitMinimumWidth: 0, outlineMinimumWidth: 0, mapMinimumWidth: 0, fieldMinimumWidth: 0, axisLabelWidth: 0,
		left: 0, top: 0, right: 0, bottom: 0, rowHeight: 0, font: null, gridLeft: 0, sourceTitle: '', outlineTitle: '', selectionTitle: '', selectionLabel: '', sourceVersion: -1,
		sourceBounds: create_rect_bounds(), selectionBounds: create_rect_bounds(),
	};
	public get selected(): CartMapItem | undefined { return this.tree.rows[this.tree.selectionIndex]?.element.item; }
	public constructor(public readonly workingCopy: EditorTextModel, public readonly mapKind: CartMapKind) {
		super(`map:${resourceIdentityKey(workingCopy.resource)}`, 'cart_map', 'MAP EDITOR', true);
		this.sourceCaption = computeResourceTabTitle(workingCopy.resource);
		this.setLabel(this.title, sourceTabDescription(workingCopy.resource));
		this.disposables.add({ dispose: workingCopy.onDidChangeContent(event => {
			if (event.editState?.is(cartMapEditSelection) && event.editSource === this.editSource) {
				this.selectionRange.start = event.editState.value.start;
				this.selectionRange.end = event.editState.value.end;
			} else mapTrackedTextRange(this.selectionRange, event.changes);
		}) });
	}
	public createView(): CartMapInput {
		const view = captureCartMapView(this), input = new CartMapInput(this.workingCopy, this.mapKind);
		restoreCartMapView(input, view);
		return input;
	}
	public override toResourceEditor() { return { resource: this.workingCopy.resource, editorId: WORKBENCH_CART_MAP_EDITOR_ID }; }
}
