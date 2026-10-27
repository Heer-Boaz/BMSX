import type { RectBounds } from '../../../../machine/ts/common/rect';
import type { SerializedEditorGroup } from './editor_serialization';
import type { WindowPlacement } from '../../ui/window/model';

/** Requested placement belongs to the document part, not its constrained render bounds. */
export type SerializedDocumentEditorPart = {
	readonly group: SerializedEditorGroup;
	readonly requestedBounds: Readonly<RectBounds>;
	readonly placement: WindowPlacement;
	readonly minimized: boolean;
};

/** Part references use their positions in this memento: main is 0, documents follow. */
export type SerializedEditorParts = {
	readonly main: SerializedEditorGroup;
	readonly documents: readonly SerializedDocumentEditorPart[];
	readonly active: number;
	readonly mru: readonly number[];
};
