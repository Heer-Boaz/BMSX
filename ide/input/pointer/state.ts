import type { PointerSnapshot, VisualLineSegment } from '../../common/models';

type PointerRowResolution = {
	visualIndex: number;
	segment: VisualLineSegment;
};

type EditorPointerState = {
	lastPointerSnapshot: PointerSnapshot;
	pointerSelecting: boolean;
	lastPointerClickTimeMs: number;
	lastPointerClickRow: number;
	lastPointerClickColumn: number;
	lastPointerRowResolution: PointerRowResolution;
};

export const editorPointerState: EditorPointerState = {
	lastPointerSnapshot: null,
	pointerSelecting: false,
	lastPointerClickTimeMs: 0,
	lastPointerClickRow: -1,
	lastPointerClickColumn: -1,
	lastPointerRowResolution: null,
};

export function resetPointerClickTracking(): void {
	editorPointerState.lastPointerClickTimeMs = 0;
	editorPointerState.lastPointerClickRow = -1;
	editorPointerState.lastPointerClickColumn = -1;
}

export function clearEditorPointerSelectionState(): void {
	editorPointerState.pointerSelecting = false;
	resetPointerClickTracking();
}
