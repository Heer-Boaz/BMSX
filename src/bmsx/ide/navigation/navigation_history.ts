import { clamp } from '../../common/clamp';
import { setActiveTab, activateCodeTab } from '../workbench/ui/tabs';
import { getActiveCodeTabContext, getCodeTabContextById, isCodeTabActive } from '../workbench/ui/code_tab/contexts';
import { setCursorPosition, ensureCursorVisible } from '../editor/ui/view/caret/caret';
import * as TextEditing from '../editor/editing/text_editing_and_selection';
import { editorCaretState } from '../editor/ui/view/caret/state';
import { editorDocumentState } from '../editor/editing/document_state';

const NAVIGATION_HISTORY_LIMIT = 64;

export type NavigationHistoryEntry = {
	contextId: string;
	path: string;
	row: number;
	column: number;
};

export const navigationState = {
	back: [] as NavigationHistoryEntry[],
	forward: [] as NavigationHistoryEntry[],
	current: null as NavigationHistoryEntry,
	captureSuspended: false,
};

export function initializeNavigationState(): void {
	navigationState.back.length = 0;
	navigationState.forward.length = 0;
	navigationState.current = createNavigationEntry();
	navigationState.captureSuspended = false;
}

export function clearForwardNavigationHistory(): void {
	navigationState.forward.length = 0;
}

export function resetNavigationHistoryState(): void {
	navigationState.back.length = 0;
	navigationState.forward.length = 0;
	navigationState.current = null;
	navigationState.captureSuspended = false;
}

export function beginNavigationCapture(): NavigationHistoryEntry {
	if (navigationState.captureSuspended) {
		return null;
	}
	if (!navigationState.current) {
		navigationState.current = createNavigationEntry();
	}
	const current = createNavigationEntry();
	if (current) {
		navigationState.current = current;
		return { ...current };
	}
	return null;
}

export function completeNavigation(previous: NavigationHistoryEntry): void {
	if (navigationState.captureSuspended) {
		return;
	}
	const next = createNavigationEntry();
	const backStack = navigationState.back;
	if (previous && next && !areNavigationEntriesEqual(previous, next)) {
		pushUniqueNavigationEntry(backStack, previous);
		navigationState.forward.length = 0;
	} else if (previous && !next) {
		pushUniqueNavigationEntry(backStack, previous);
		navigationState.forward.length = 0;
	} else if (previous === null && next) {
		navigationState.forward.length = 0;
	}
	navigationState.current = next;
}

export function pushUniqueNavigationEntry(stack: NavigationHistoryEntry[], entry: NavigationHistoryEntry): void {
	const last = stack[stack.length - 1];
	if (!last || !areNavigationEntriesEqual(last, entry)) {
		pushNavigationEntry(stack, entry);
	}
}

export function pushNavigationEntry(stack: NavigationHistoryEntry[], entry: NavigationHistoryEntry): void {
	stack.push(entry);
	const overflow = stack.length - NAVIGATION_HISTORY_LIMIT;
	if (overflow > 0) {
		stack.splice(0, overflow);
	}
}

export function areNavigationEntriesEqual(a: NavigationHistoryEntry, b: NavigationHistoryEntry): boolean {
	return a.contextId === b.contextId
		&& a.path === b.path
		&& a.row === b.row
		&& a.column === b.column;
}

export function createNavigationEntry(): NavigationHistoryEntry {
	if (!isCodeTabActive()) {
		return null;
	}
	const context = getActiveCodeTabContext();
	if (!context) {
		return null;
	}
	const path = context.descriptor.path;
	const maxRowIndex = Math.max(0, editorDocumentState.buffer.getLineCount() - 1);
	const row = clamp(editorDocumentState.cursorRow, 0, maxRowIndex);
	const lineLen = editorDocumentState.buffer.getLineEndOffset(row) - editorDocumentState.buffer.getLineStartOffset(row);
	const column = clamp(editorDocumentState.cursorColumn, 0, lineLen);
	return {
		contextId: context.id,
		path,
		row,
		column,
	};
}

export function withNavigationCaptureSuspended<T>(operation: () => T): T {
	const previous = navigationState.captureSuspended;
	navigationState.captureSuspended = true;
	try {
		return operation();
	} finally {
		navigationState.captureSuspended = previous;
	}
}

export function activateNavigationEntryContext(entry: NavigationHistoryEntry): boolean {
	const existingContext = getCodeTabContextById(entry.contextId);
	if (existingContext) {
		setActiveTab(entry.contextId);
		return true;
	}
	return false;
}

export function applyNavigationEntryPosition(entry: NavigationHistoryEntry): void {
	if (!isCodeTabActive()) {
		activateCodeTab();
	}
	if (!isCodeTabActive()) {
		return;
	}
	const maxRowIndex = Math.max(0, editorDocumentState.buffer.getLineCount() - 1);
	const targetRow = clamp(entry.row, 0, maxRowIndex);
	const line = editorDocumentState.buffer.getLineContent(targetRow);
	const targetColumn = clamp(entry.column, 0, line.length);
	setCursorPosition(targetRow, targetColumn);
	TextEditing.clearSelection();
	editorCaretState.cursorRevealSuspended = false;
	ensureCursorVisible();
}

export function takeBackwardNavigationEntry(): NavigationHistoryEntry | null {
	if (navigationState.back.length === 0) {
		return null;
	}
	const currentEntry = navigationState.current ?? createNavigationEntry();
	if (currentEntry) {
		pushUniqueNavigationEntry(navigationState.forward, currentEntry);
	}
	return navigationState.back.pop()!;
}

export function takeForwardNavigationEntry(): NavigationHistoryEntry | null {
	if (navigationState.forward.length === 0) {
		return null;
	}
	const currentEntry = navigationState.current ?? createNavigationEntry();
	if (currentEntry) {
		pushUniqueNavigationEntry(navigationState.back, currentEntry);
	}
	return navigationState.forward.pop()!;
}

export function completeNavigationHistoryJump(target: NavigationHistoryEntry): void {
	navigationState.current = createNavigationEntry() ?? target;
}
