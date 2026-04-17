import type { PointerSnapshot, TabDragState, VisualLineSegment } from '../../../common/models';

type PointerRowResolution = {
	visualIndex: number;
	segment: VisualLineSegment;
};

type EditorPointerState = {
	lastPointerSnapshot: PointerSnapshot;
	pointerSelecting: boolean;
	pointerPrimaryWasPressed: boolean;
	pointerSecondaryWasPressed: boolean;
	pointerAuxWasPressed: boolean;
	lastPointerClickTimeMs: number;
	lastPointerClickRow: number;
	lastPointerClickColumn: number;
	tabHoverId: string;
	tabDragState: TabDragState;
	lastPointerRowResolution: PointerRowResolution;
};

export const editorPointerState: EditorPointerState = {
	lastPointerSnapshot: null,
	pointerSelecting: false,
	pointerPrimaryWasPressed: false,
	pointerSecondaryWasPressed: false,
	pointerAuxWasPressed: false,
	lastPointerClickTimeMs: 0,
	lastPointerClickRow: -1,
	lastPointerClickColumn: -1,
	tabHoverId: null,
	tabDragState: null,
	lastPointerRowResolution: null,
};

export function resetPointerClickTracking(): void {
	editorPointerState.lastPointerClickTimeMs = 0;
	editorPointerState.lastPointerClickRow = -1;
	editorPointerState.lastPointerClickColumn = -1;
}
