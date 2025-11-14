import { clamp } from '../../utils/clamp';;
import type { StackTraceFrame } from 'bmsx/lua/runtime';

export interface RuntimeErrorOverlayNavigationHost {
	getLineCount(): number;
	setCursorPosition(row: number, column: number): void;
	centerCursorVertically(): void;
	revealCursor(): void;
	resetBlink(): void;
	setCursorRevealSuspended(value: boolean): void;
	focusChunkSource(chunkName: string | null): void;
	showMessage(text: string, color: number, durationSeconds: number): void;
}

export type RuntimeErrorOverlayNavigationOptions = {
	successColor: number;
	successDuration: number;
	failureColor: number;
	failureDuration: number;
};

export function navigateToRuntimeErrorFrame(
	host: RuntimeErrorOverlayNavigationHost,
	frame: StackTraceFrame,
	options: RuntimeErrorOverlayNavigationOptions
): void {
	if (frame.origin !== 'lua') {
		return;
	}
	const chunkName = frame.source ?? null;
	try {
		host.focusChunkSource(chunkName);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		host.showMessage(`Failed to open call frame: ${message}`, options.failureColor, options.failureDuration);
		return;
	}
	if (frame.line !== null) {
		const lastRowIndex = Math.max(0, host.getLineCount() - 1);
		const targetRow = clamp(frame.line - 1, 0, lastRowIndex);
		let targetColumn = 0;
		if (frame.column !== null) {
			targetColumn = Math.max(0, frame.column - 1);
		}
		host.setCursorPosition(targetRow, targetColumn);
		host.centerCursorVertically();
		host.revealCursor();
		host.setCursorRevealSuspended(false);
		host.resetBlink();
	} else {
		host.revealCursor();
	}
	host.showMessage('Navigated to call site', options.successColor, options.successDuration);
}
