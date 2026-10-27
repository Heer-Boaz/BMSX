import type { RectBounds } from '../../../../machine/ts/common/rect';
import type { SerializedEditorGroup } from './editor_serialization';
import type { WindowPlacement } from '../../ui/window/model';

/** Group references are depth-first leaf positions, independent of live control identities. */
export type SerializedEditorGroupLayout =
	| { readonly kind: 'group'; readonly group: SerializedEditorGroup }
	| { readonly kind: 'split'; readonly orientation: 'horizontal' | 'vertical'; readonly ratio: number;
		readonly first: SerializedEditorGroupLayout; readonly second: SerializedEditorGroupLayout };

export type SerializedEditorPart = {
	readonly layout: SerializedEditorGroupLayout;
	readonly active: number;
	readonly mru: readonly number[];
	readonly scrollX: number;
	readonly scrollY: number;
	readonly maximized?: { readonly group: number; readonly scrollX: number; readonly scrollY: number };
};

/** Floating placement is distinct from group arrangement and constrained render bounds. */
export type SerializedDocumentEditorPart = SerializedEditorPart & {
	readonly requestedBounds: Readonly<RectBounds>;
	readonly placement: WindowPlacement;
	readonly minimized: boolean;
};

/** Part references use their positions in this memento: main is 0, documents follow. */
export type SerializedEditorParts = {
	readonly main: SerializedEditorPart;
	readonly documents: readonly SerializedDocumentEditorPart[];
	readonly active: number;
	readonly mru: readonly number[];
};
