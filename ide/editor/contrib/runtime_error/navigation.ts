import type { RuntimeErrorOverlay } from './model';
import { activeCodeEditor } from '../../ui/code_editor_state';
import { editorViewState } from '../../ui/view/state';
import { runtimeErrorState } from './state';

export function clearRuntimeErrorOverlay(): void {
	setActiveRuntimeErrorOverlay(null);
}

export function setActiveRuntimeErrorOverlay(overlay: RuntimeErrorOverlay): void {
	runtimeErrorState.activeOverlay = overlay;
}

export function setExecutionStopHighlight(row: number): void {
	let nextRow = row;
	if (nextRow !== null) {
		nextRow = editorViewState.layout.clampBufferRow(activeCodeEditor.model.buffer, nextRow);
	}
	runtimeErrorState.executionStopRow = nextRow;
}

export function clearExecutionStopHighlight(): void {
	runtimeErrorState.executionStopRow = null;
}
