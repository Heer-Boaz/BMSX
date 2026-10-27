import { resourceIdentityEquals } from '../common/resource';
import { DisposableStore } from '../common/lifecycle';
import type { ResourceEditorIdentity } from '../workbench/common/editor_input';
import type { EditorInput } from '../workbench/common/editor_inputs';
import type { EditorMoveEvent, EditorGroupView } from '../workbench/services/editor/editor_group';
import type { EditorPaneSelection } from '../workbench/services/editor/editor_selection';

const NAVIGATION_HISTORY_LIMIT = 64;

export type NavigationHistoryTarget =
	| { readonly kind: 'input'; readonly input: EditorInput }
	| ({ readonly kind: 'resource' } & ResourceEditorIdentity);

/** Retains a selection only while its capturing pane owner and retained input survive. */
export class NavigationHistoryEntry extends DisposableStore {
	private ownerValue: EditorGroupView;
	private targetValue: NavigationHistoryTarget;
	private unbindOwner: () => void;
	private unbindMove: () => void;
	private unbindInput: (() => void) | undefined;
	public get owner(): EditorGroupView { return this.ownerValue; }
	public get target(): NavigationHistoryTarget { return this.targetValue; }

	public constructor(target: NavigationHistoryTarget, public readonly selection: EditorPaneSelection | undefined,
		owner: EditorGroupView) {
		super();
		this.targetValue = target;
		this.ownerValue = owner;
		this.unbindOwner = owner.onWillDispose(this.retire);
		this.unbindMove = owner.onDidMoveEditor(this.followMove);
		if (selection !== undefined) this.add(selection);
		if (target.kind === 'input') this.unbindInput = target.input.onWillDispose(this.retire);
	}

	/** Pending captures and stacked entries follow the same actual group handoff. */
	private readonly followMove = (event: EditorMoveEvent): void => {
		const target = this.targetValue;
		if (target.kind === 'input') {
			if (target.input !== event.input) return;
			this.unbindInput!();
			this.targetValue = { kind: 'input', input: event.replacement };
			this.unbindInput = event.replacement.onWillDispose(this.retire);
		} else {
			const identity = event.input.toResourceEditor?.();
			if (identity === undefined || identity.editorId !== target.editorId || !resourceIdentityEquals(identity.resource, target.resource)) return;
		}
		this.unbindOwner(); this.unbindMove();
		this.ownerValue = event.destination;
		this.unbindOwner = event.destination.onWillDispose(this.retire);
		this.unbindMove = event.destination.onDidMoveEditor(this.followMove);
	};

	private readonly retire = (): void => {
		removeNavigationEntry(navigationState.back, this);
		removeNavigationEntry(navigationState.forward, this);
		this.dispose();
	};

	public override dispose(): void {
		this.unbindOwner(); this.unbindMove(); this.unbindInput?.();
		super.dispose();
	}
}

export const navigationState = {
	back: [] as NavigationHistoryEntry[],
	forward: [] as NavigationHistoryEntry[],
	captureSuspendDepth: 0,
	activeGroup: null as EditorGroupView | null,
};

/** The frontend binds its editor group; child pane construction never selects this owner. */
export function initializeNavigationState(group: EditorGroupView): () => void {
	resetNavigationHistoryState();
	navigationState.activeGroup = group;
	return () => {
		navigationState.activeGroup = null;
		resetNavigationHistoryState();
	};
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
	// Replacement can close the departure input during this navigation. Its
	// lifetime listener has already retired the pending entry as well as the stacks.
	if (previous !== null && !previous.isDisposed) {
		if (next === null || !areNavigationEntriesEqual(previous, next)) {
			pushUniqueNavigationEntry(navigationState.back, previous);
			clearForwardNavigationHistory();
		} else previous.dispose();
	} else if (next !== null) clearForwardNavigationHistory();
	next?.dispose();
}

/** One explicit navigation may change a retained input before opening its pane. */
export function captureNavigation<T>(operation: () => T): T {
	const previous = beginNavigationCapture();
	navigationState.captureSuspendDepth += 1;
	try {
		return operation();
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
	if (a.owner !== b.owner) return false;
	const left = a.target;
	const right = b.target;
	if (left.kind === 'input') {
		if (right.kind !== 'input' || left.input !== right.input) return false;
	} else if (right.kind !== 'resource' || left.editorId !== right.editorId
		|| left.resource.contextId !== right.resource.contextId || left.resource.path !== right.resource.path) return false;
	return a.selection === undefined ? b.selection === undefined
		: b.selection !== undefined && a.selection.matches(b.selection);
}

export function createNavigationEntry(): NavigationHistoryEntry | null {
	const owner = navigationState.activeGroup;
	if (owner === null) return null; // No frontend or active editor group is attached.
	const pane = owner.panes.activePane;
	if (pane === null) return null; // The editor group can be empty.
	const resourceEditor = pane.input.toResourceEditor?.();
	return new NavigationHistoryEntry(resourceEditor === undefined
		? { kind: 'input', input: pane.input } : { kind: 'resource', ...resourceEditor }, pane.getSelection?.(), owner);
}

export function withNavigationCaptureSuspended<T>(operation: () => T): T {
	navigationState.captureSuspendDepth += 1;
	try {
		return operation();
	} finally {
		navigationState.captureSuspendDepth -= 1;
	}
}

/** Resolution borrows a destination; only admitted navigation consumes its stack entry. */
export class NavigationHistorySelection {
	private finished = false;
	public constructor(public readonly target: NavigationHistoryEntry,
		private departure: NavigationHistoryEntry | null,
		private readonly source: NavigationHistoryEntry[], private readonly destination: NavigationHistoryEntry[]) {}

	public get isCurrent(): boolean {
		return !this.finished && !this.target.isDisposed && this.source.at(-1) === this.target;
	}

	public accept(): boolean {
		if (!this.isCurrent) return false;
		this.source.pop();
		if (this.departure !== null && !this.departure.isDisposed) pushUniqueNavigationEntry(this.destination, this.departure);
		this.departure = null;
		this.finished = true;
		this.target.dispose();
		return true;
	}

	public dispose(): void {
		if (this.finished) return;
		this.finished = true;
		this.departure?.dispose();
		this.departure = null;
	}
}

export function selectNavigationHistoryEntry(direction: 'back' | 'forward', currentEntry: NavigationHistoryEntry | null): NavigationHistorySelection | null {
	const source = navigationState[direction], target = source.at(-1);
	if (target === undefined) {
		currentEntry?.dispose();
		return null;
	}
	return new NavigationHistorySelection(target, currentEntry, source, direction === 'back' ? navigationState.forward : navigationState.back);
}
