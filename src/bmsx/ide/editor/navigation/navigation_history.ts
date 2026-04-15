import { clamp } from '../../../utils/clamp';
import { setActiveTab, activateCodeTab } from '../../workbench/ui/tabs';
import { focusChunkSource } from '../../workbench/contrib/resources/resource_navigation';
import { getActiveCodeTabContext, getCodeTabContextById, isCodeTabActive } from '../../workbench/ui/code_tab_contexts';
import { setCursorPosition, ensureCursorVisible } from '../ui/caret';
import * as TextEditing from '../editing/text_editing_and_selection';
import { editorCaretState } from '../ui/caret_state';
import { editorDocumentState } from '../editing/editor_document_state';

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
		const lastBack = backStack[backStack.length - 1];
		if (!lastBack || !areNavigationEntriesEqual(lastBack, previous)) {
			pushNavigationEntry(backStack, previous);
		}
		navigationState.forward.length = 0;
	} else if (previous && !next) {
		const lastBack = backStack[backStack.length - 1];
		if (!lastBack || !areNavigationEntriesEqual(lastBack, previous)) {
			pushNavigationEntry(backStack, previous);
		}
		navigationState.forward.length = 0;
	} else if (previous === null && next) {
		navigationState.forward.length = 0;
	}
	navigationState.current = next;
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

export function applyNavigationEntry(entry: NavigationHistoryEntry): void {
	const existingContext = getCodeTabContextById(entry.contextId);
	if (existingContext) {
		setActiveTab(entry.contextId);
	} else {
		focusChunkSource(entry.path);
		if (entry.contextId) {
			setActiveTab(entry.contextId);
		}
	}
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

export function goBackwardInNavigationHistory(): void {
	if (navigationState.back.length === 0) {
		return;
	}
	const currentEntry = navigationState.current ?? createNavigationEntry();
	if (currentEntry) {
		const forwardStack = navigationState.forward;
		const lastForward = forwardStack[forwardStack.length - 1];
		if (!lastForward || !areNavigationEntriesEqual(lastForward, currentEntry)) {
			pushNavigationEntry(forwardStack, currentEntry);
		}
	}
	const target = navigationState.back.pop()!;
	withNavigationCaptureSuspended(() => {
		applyNavigationEntry(target);
	});
	navigationState.current = createNavigationEntry() ?? target;
}

export function goForwardInNavigationHistory(): void {
	if (navigationState.forward.length === 0) {
		return;
	}
	const currentEntry = navigationState.current ?? createNavigationEntry();
	if (currentEntry) {
		const backStack = navigationState.back;
		const lastBack = backStack[backStack.length - 1];
		if (!lastBack || !areNavigationEntriesEqual(lastBack, currentEntry)) {
			pushNavigationEntry(backStack, currentEntry);
		}
	}
	const target = navigationState.forward.pop()!;
	withNavigationCaptureSuspended(() => {
		applyNavigationEntry(target);
	});
	navigationState.current = createNavigationEntry() ?? target;
}
