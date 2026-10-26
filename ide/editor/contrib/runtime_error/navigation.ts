import { pointerHover } from '../../../input/pointer/hover';
import type { RuntimeErrorOverlay } from './model';
import type { CodeEditorControl } from '../../ui/code_editor_control';

export function clearRuntimeErrorOverlay(code: CodeEditorControl): void {
	setActiveRuntimeErrorOverlay(code, null);
}

export function setActiveRuntimeErrorOverlay(code: CodeEditorControl, overlay: RuntimeErrorOverlay): void {
	if (code.runtimeError.activeOverlay !== overlay) pointerHover.release(code.runtimeErrorPointer);
	code.runtimeError.activeOverlay = overlay;
}

export function setExecutionStopHighlight(code: CodeEditorControl, row: number): void {
	let nextRow = row;
	if (nextRow !== null) {
		nextRow = code.model.clampRow(nextRow);
	}
	code.runtimeError.executionStopRow = nextRow;
}

export function clearExecutionStopHighlight(code: CodeEditorControl): void {
	code.runtimeError.executionStopRow = null;
}
