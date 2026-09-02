import { clamp } from '../../machine/ts/common/clamp';
import { getActiveTab } from '../workbench/ui/tabs';
import { editorDocumentState } from '../editor/editing/document_state';
import type { ResourceDomain } from '../common/resource';

const NAVIGATION_HISTORY_LIMIT = 64;

export type NavigationHistoryEntry = {
	domain: ResourceDomain;
	path: string;
	row: number;
	column: number;
};

export const navigationState = {
	back: [] as NavigationHistoryEntry[],
	forward: [] as NavigationHistoryEntry[],
	captureSuspendDepth: 0,
};

export function initializeNavigationState(): void {
	navigationState.back.length = 0;
	navigationState.forward.length = 0;
	navigationState.captureSuspendDepth = 0;
}

export function clearForwardNavigationHistory(): void {
	navigationState.forward.length = 0;
}

export function resetNavigationHistoryState(): void {
	navigationState.back.length = 0;
	navigationState.forward.length = 0;
	navigationState.captureSuspendDepth = 0;
}

export function beginNavigationCapture(): NavigationHistoryEntry | null {
	if (navigationState.captureSuspendDepth > 0) {
		return null;
	}
	return createNavigationEntry();
}

export function completeNavigation(previous: NavigationHistoryEntry | null): void {
	if (navigationState.captureSuspendDepth > 0) {
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
	return a.domain === b.domain
		&& a.path === b.path
		&& a.row === b.row
		&& a.column === b.column;
}

export function createNavigationEntry(): NavigationHistoryEntry | null {
	const activeTab = getActiveTab();
	if (activeTab.kind !== 'code_editor') {
		return null;
	}
	const context = activeTab.context;
	const path = context.resource.path;
	const maxRowIndex = Math.max(0, editorDocumentState.buffer.getLineCount() - 1);
	const row = clamp(editorDocumentState.cursorRow, 0, maxRowIndex);
	const lineLen = editorDocumentState.buffer.getLineEndOffset(row) - editorDocumentState.buffer.getLineStartOffset(row);
	const column = clamp(editorDocumentState.cursorColumn, 0, lineLen);
	return {
		domain: context.resource.domain,
		path,
		row,
		column,
	};
}

export async function withNavigationCaptureSuspended<T>(operation: () => Promise<T>): Promise<T> {
	navigationState.captureSuspendDepth += 1;
	try {
		return await operation();
	} finally {
		navigationState.captureSuspendDepth -= 1;
	}
}

export function takeBackwardNavigationEntry(currentEntry: NavigationHistoryEntry | null): NavigationHistoryEntry | null {
	if (navigationState.back.length === 0) {
		return null;
	}
	if (currentEntry) {
		pushUniqueNavigationEntry(navigationState.forward, currentEntry);
	}
	return navigationState.back.pop()!;
}

export function takeForwardNavigationEntry(currentEntry: NavigationHistoryEntry | null): NavigationHistoryEntry | null {
	if (navigationState.forward.length === 0) {
		return null;
	}
	if (currentEntry) {
		pushUniqueNavigationEntry(navigationState.back, currentEntry);
	}
	return navigationState.forward.pop()!;
}
