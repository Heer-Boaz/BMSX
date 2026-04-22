import type { RuntimeErrorOverlay } from '../../../common/models';
import { editorDocumentState } from '../../editing/document_state';
import { editorViewState } from '../../ui/view/state';
import { runtimeErrorState } from './state';

export function clearRuntimeErrorOverlay(): void {
	setActiveRuntimeErrorOverlay(null);
}

export function setActiveRuntimeErrorOverlay(overlay: RuntimeErrorOverlay): void {
	if (overlay && overlay.hidden === undefined) {
		overlay.hidden = false;
	}
	runtimeErrorState.activeOverlay = overlay;
}

export function setExecutionStopHighlight(row: number): void {
	let nextRow = row;
	if (nextRow !== null) {
		nextRow = editorViewState.layout.clampBufferRow(editorDocumentState.buffer, nextRow);
	}
	runtimeErrorState.executionStopRow = nextRow;
}

export function clearExecutionStopHighlight(): void {
	runtimeErrorState.executionStopRow = null;
}
