import { DisposableStore } from '../common/lifecycle';
import type { ResourceEditorIdentity } from '../workbench/common/editor_input';
import type { EditorInput } from '../workbench/ui/tab/model';
import type { EditorPanes } from '../workbench/services/editor/editor_panes';
import type { EditorPaneSelection } from '../workbench/services/editor/editor_selection';

const NAVIGATION_HISTORY_LIMIT = 64;

export type NavigationHistoryTarget =
	| { readonly kind: 'input'; readonly input: EditorInput }
	| ({ readonly kind: 'resource' } & ResourceEditorIdentity);

/** Owns the captured selection and, for non-reopenable inputs, its close listener. */
export class NavigationHistoryEntry extends DisposableStore {
	public constructor(public readonly target: NavigationHistoryTarget, public readonly selection: EditorPaneSelection | undefined) {
		super();
		if (selection !== undefined) this.add(selection);
		if (target.kind === 'input') this.add({ dispose: target.input.onWillDispose(() => {
			removeNavigationEntry(navigationState.back, this);
			removeNavigationEntry(navigationState.forward, this);
			this.dispose();
		}) });
	}
}

export const navigationState = {
	back: [] as NavigationHistoryEntry[],
	forward: [] as NavigationHistoryEntry[],
	captureSuspendDepth: 0,
	editorPanes: null as EditorPanes,
};

export function initializeNavigationState(editorPanes: EditorPanes): void {
	resetNavigationHistoryState();
	navigationState.editorPanes = editorPanes;
}

export function clearForwardNavigationHistory(): void {
	for (const entry of navigationState.forward) entry.dispose();
	navigationState.forward.length = 0;
}

export function resetNavigationHistoryState(): void {
	for (const entry of navigationState.back) entry.dispose();
	navigationState.back.length = 0;
	clearForwardNavigationHistory();
	navigationState.captureSuspendDepth = 0;
}

export function beginNavigationCapture(): NavigationHistoryEntry | null {
	return navigationState.captureSuspendDepth > 0 ? null : createNavigationEntry();
}

export function completeNavigation(previous: NavigationHistoryEntry | null): void {
	if (navigationState.captureSuspendDepth > 0) {
		previous?.dispose();
		return;
	}
	const next = createNavigationEntry();
	if (previous !== null) {
		if (next === null || !areNavigationEntriesEqual(previous, next)) {
			pushUniqueNavigationEntry(navigationState.back, previous);
			clearForwardNavigationHistory();
		} else previous.dispose();
	} else if (next !== null) clearForwardNavigationHistory();
	next?.dispose();
}

/** One explicit navigation may change a retained input before opening its pane. */
export function captureNavigation(operation: () => void): void {
	const previous = beginNavigationCapture();
	navigationState.captureSuspendDepth += 1;
	try {
		operation();
	} finally {
		navigationState.captureSuspendDepth -= 1;
		completeNavigation(previous);
	}
}

export function pushUniqueNavigationEntry(stack: NavigationHistoryEntry[], entry: NavigationHistoryEntry): void {
	const last = stack[stack.length - 1];
	if (last !== undefined && areNavigationEntriesEqual(last, entry)) entry.dispose();
	else pushNavigationEntry(stack, entry);
}

export function pushNavigationEntry(stack: NavigationHistoryEntry[], entry: NavigationHistoryEntry): void {
	stack.push(entry);
	if (stack.length > NAVIGATION_HISTORY_LIMIT) stack.shift()!.dispose();
}

function removeNavigationEntry(stack: NavigationHistoryEntry[], entry: NavigationHistoryEntry): void {
	const index = stack.indexOf(entry);
	if (index >= 0) stack.splice(index, 1);
}

export function areNavigationEntriesEqual(a: NavigationHistoryEntry, b: NavigationHistoryEntry): boolean {
	const left = a.target;
	const right = b.target;
	if (left.kind === 'input') {
		if (right.kind !== 'input' || left.input !== right.input) return false;
	} else if (right.kind !== 'resource' || left.editorId !== right.editorId
		|| left.resource.domain !== right.resource.domain || left.resource.path !== right.resource.path) return false;
	return a.selection === undefined ? b.selection === undefined
		: b.selection !== undefined && a.selection.matches(b.selection);
}

export function createNavigationEntry(): NavigationHistoryEntry | null {
	const pane = navigationState.editorPanes.activePane;
	if (pane === null) return null; // The editor group can be empty.
	const resourceEditor = pane.input.toResourceEditor?.();
	return new NavigationHistoryEntry(resourceEditor === undefined
		? { kind: 'input', input: pane.input } : { kind: 'resource', ...resourceEditor }, pane.getSelection?.());
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
		currentEntry?.dispose();
		return null;
	}
	if (currentEntry !== null) pushUniqueNavigationEntry(navigationState.forward, currentEntry);
	return navigationState.back.pop()!;
}

export function takeForwardNavigationEntry(currentEntry: NavigationHistoryEntry | null): NavigationHistoryEntry | null {
	if (navigationState.forward.length === 0) {
		currentEntry?.dispose();
		return null;
	}
	if (currentEntry !== null) pushUniqueNavigationEntry(navigationState.back, currentEntry);
	return navigationState.forward.pop()!;
}
