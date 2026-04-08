import { clamp } from '../../../utils/clamp';
import { ide_state, type NavigationHistoryEntry, NAVIGATION_HISTORY_LIMIT } from '../core/ide_state';
import { getActiveCodeTabContext, setActiveTab, isCodeTabActive, activateCodeTab, focusChunkSource } from '../browser/editor_tabs';
import { setCursorPosition, ensureCursorVisible } from '../browser/caret';
import * as TextEditing from '../editing/text_editing_and_selection';

export function beginNavigationCapture(): NavigationHistoryEntry {
	if (ide_state.navigationCaptureSuspended) {
		return null;
	}
	if (!ide_state.navigationHistory.current) {
		ide_state.navigationHistory.current = createNavigationEntry();
	}
	const current = createNavigationEntry();
	if (current) {
		ide_state.navigationHistory.current = current;
		return { ...current };
	}
	return null;
}

export function completeNavigation(previous: NavigationHistoryEntry): void {
	if (ide_state.navigationCaptureSuspended) {
		return;
	}
	const next = createNavigationEntry();
	const backStack = ide_state.navigationHistory.back;
	if (previous && next && !areNavigationEntriesEqual(previous, next)) {
		const lastBack = backStack[backStack.length - 1];
		if (!lastBack || !areNavigationEntriesEqual(lastBack, previous)) {
			pushNavigationEntry(backStack, previous);
		}
		ide_state.navigationHistory.forward.length = 0;
	} else if (previous && !next) {
		const lastBack = backStack[backStack.length - 1];
		if (!lastBack || !areNavigationEntriesEqual(lastBack, previous)) {
			pushNavigationEntry(backStack, previous);
		}
		ide_state.navigationHistory.forward.length = 0;
	} else if (previous === null && next) {
		ide_state.navigationHistory.forward.length = 0;
	}
	ide_state.navigationHistory.current = next;
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
	const maxRowIndex = Math.max(0, ide_state.buffer.getLineCount() - 1);
	const row = clamp(ide_state.cursorRow, 0, maxRowIndex);
	const lineLen = ide_state.buffer.getLineEndOffset(row) - ide_state.buffer.getLineStartOffset(row);
	const column = clamp(ide_state.cursorColumn, 0, lineLen);
	return {
		contextId: context.id,
		path,
		row,
		column,
	};
}

export function withNavigationCaptureSuspended<T>(operation: () => T): T {
	const previous = ide_state.navigationCaptureSuspended;
	ide_state.navigationCaptureSuspended = true;
	try {
		return operation();
	} finally {
		ide_state.navigationCaptureSuspended = previous;
	}
}

export function applyNavigationEntry(entry: NavigationHistoryEntry): void {
	const existingContext = ide_state.codeTabContexts.get(entry.contextId);
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
	const maxRowIndex = Math.max(0, ide_state.buffer.getLineCount() - 1);
	const targetRow = clamp(entry.row, 0, maxRowIndex);
	const line = ide_state.buffer.getLineContent(targetRow);
	const targetColumn = clamp(entry.column, 0, line.length);
	setCursorPosition(targetRow, targetColumn);
	TextEditing.clearSelection();
	ide_state.cursorRevealSuspended = false;
	ensureCursorVisible();
}

export function goBackwardInNavigationHistory(): void {
	if (ide_state.navigationHistory.back.length === 0) {
		return;
	}
	const currentEntry = ide_state.navigationHistory.current ?? createNavigationEntry();
	if (currentEntry) {
		const forwardStack = ide_state.navigationHistory.forward;
		const lastForward = forwardStack[forwardStack.length - 1];
		if (!lastForward || !areNavigationEntriesEqual(lastForward, currentEntry)) {
			pushNavigationEntry(forwardStack, currentEntry);
		}
	}
	const target = ide_state.navigationHistory.back.pop()!;
	withNavigationCaptureSuspended(() => {
		applyNavigationEntry(target);
	});
	ide_state.navigationHistory.current = createNavigationEntry() ?? target;
}

export function goForwardInNavigationHistory(): void {
	if (ide_state.navigationHistory.forward.length === 0) {
		return;
	}
	const currentEntry = ide_state.navigationHistory.current ?? createNavigationEntry();
	if (currentEntry) {
		const backStack = ide_state.navigationHistory.back;
		const lastBack = backStack[backStack.length - 1];
		if (!lastBack || !areNavigationEntriesEqual(lastBack, currentEntry)) {
			pushNavigationEntry(backStack, currentEntry);
		}
	}
	const target = ide_state.navigationHistory.forward.pop()!;
	withNavigationCaptureSuspended(() => {
		applyNavigationEntry(target);
	});
	ide_state.navigationHistory.current = createNavigationEntry() ?? target;
}
