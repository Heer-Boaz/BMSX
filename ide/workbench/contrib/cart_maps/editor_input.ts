import { create_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import { resourceIdentityKey } from '../../../common/resource';
import type { EditorTextModel } from '../../../editor/model/text_model';
import { EditorEditStateType } from '../../../editor/model/edit_state';
import { mapTrackedTextRange, type TrackedTextRange } from '../../../editor/text/text_change';
import { WorkingCopyEditorInput } from '../../common/editor_input';
import type { FullWidthWorkbenchLayout } from '../../common/layout';
import { createWorkbenchActionBar } from '../../ui/action_bar';
import { sourceTabDescription } from '../../ui/tab/titles';
import { ScrollableWorkbenchTree } from '../../ui/scrollable_tree';
import { CartMapGrid, type MapGridContent, type MapGridMarker } from './grid';
import type { PietiousObject, PietiousSource } from './pietious_source';
import type { NemesisMarker, NemesisSource } from './nemesis_source';

export type CartMapKind = 'pietious' | 'nemesis';
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

/** A retained source projection, not a second map document or a runtime scene. */
export class CartMapInput extends WorkingCopyEditorInput<`map:${string}`, 'cart_map'> {
	public version = -1;
	public viewRevision = 0;
	public activeSheet: string | undefined;
	public restoredScroll: { x: number; y: number; tree: number } | undefined;
	public diagnostic: string | null = null;
	public readonly selectionRange: TrackedTextRange = { start: 0, end: 0 };
	public readonly tree = new ScrollableWorkbenchTree<CartMapTreeElement>();
	public readonly grid = new CartMapGrid();
	public readonly actionBar = createWorkbenchActionBar('cartMap.title');
	public readonly fieldBounds = [create_rect_bounds(), create_rect_bounds()] as const;
	public readonly layout: FullWidthWorkbenchLayout & { gridLeft: number; sourceTitle: string; outlineTitle: string; selectionTitle: string; selectionLabel: string; sourceVersion: number; sourceBounds: RectBounds; selectionBounds: RectBounds } = {
		left: 0, top: 0, right: 0, bottom: 0, rowHeight: 0, font: null, gridLeft: 0, sourceTitle: '', outlineTitle: '', selectionTitle: '', selectionLabel: '', sourceVersion: -1,
		sourceBounds: create_rect_bounds(), selectionBounds: create_rect_bounds(),
	};
	public get selected(): CartMapItem | undefined { return this.tree.rows[this.tree.selectionIndex]?.element.item; }
	public constructor(public readonly workingCopy: EditorTextModel, public readonly mapKind: CartMapKind) {
		super(`map:${resourceIdentityKey(workingCopy.resource)}`, 'cart_map', 'MAP EDITOR', true);
		this.setLabel(this.title, sourceTabDescription(workingCopy.resource));
		this.disposables.add({ dispose: workingCopy.onDidChangeContent(event => {
			if (event.editState?.is(cartMapEditSelection)) {
				this.selectionRange.start = event.editState.value.start;
				this.selectionRange.end = event.editState.value.end;
			} else mapTrackedTextRange(this.selectionRange, event.changes);
		}) });
	}
	public override toResourceEditor() { return { resource: this.workingCopy.resource, editorId: WORKBENCH_CART_MAP_EDITOR_ID }; }
}
