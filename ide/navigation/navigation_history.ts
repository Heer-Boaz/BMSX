import { resourceIdentityEquals } from '../common/resource';
import { DisposableStore } from '../common/lifecycle';
import type { ResourceEditorIdentity } from '../workbench/common/editor_input';
import type { EditorInput } from '../workbench/common/editor_inputs';
import type { EditorMoveEvent, EditorGroupView } from '../workbench/services/editor/editor_group';
import type { EditorPaneSelection } from '../workbench/services/editor/editor_selection';

const NAVIGATION_HISTORY_LIMIT = 64;

export type EditorNavigationHistoryTarget =
	| { readonly kind: 'input'; readonly input: EditorInput }
	| ({ readonly kind: 'resource' } & ResourceEditorIdentity);

/** Captured by the real active frontend owner, independently of keyboard leaf focus. */
export interface NavigationHistorySource {
	captureNavigationEntry(): NavigationHistoryEntry | null;
}

/** The contribution owns source correspondence and primary-subject admission. */
export interface PrimaryNavigationLocation {
	readonly isDisposed: boolean;
	matches(other: PrimaryNavigationLocation): boolean;
	onDidRetire(listener: () => void): () => void;
	restore(options: { readonly isCurrent: () => boolean; readonly preserveFocus: boolean }): Promise<boolean>;
	dispose(): void;
}

export type PrimaryNavigationHistoryTarget = { readonly kind: 'primary'; readonly location: PrimaryNavigationLocation };
export type NavigationHistoryTarget = EditorNavigationHistoryTarget | PrimaryNavigationHistoryTarget;

/** Entries own inert locations, never an additional authoring consumer or control attachment. */
export class NavigationHistoryEntry extends DisposableStore {
	private ownerValue: EditorGroupView | undefined;
	private editorTarget: EditorNavigationHistoryTarget | undefined;
	private readonly primaryTarget: PrimaryNavigationHistoryTarget | undefined;
	private unbindOwner: (() => void) | undefined;
	private unbindMove: (() => void) | undefined;
	private unbindInput: (() => void) | undefined;
	public readonly selection: EditorPaneSelection | undefined;
	public get owner(): EditorGroupView | undefined { return this.ownerValue; }
	public get target(): NavigationHistoryTarget { return this.primaryTarget === undefined ? this.editorTarget! : this.primaryTarget; }

	public constructor(target: PrimaryNavigationHistoryTarget);
	public constructor(target: EditorNavigationHistoryTarget, selection: EditorPaneSelection | undefined, owner: EditorGroupView);
	public constructor(target: NavigationHistoryTarget, selection?: EditorPaneSelection, owner?: EditorGroupView) {
		super();
		this.selection = selection;
		if (target.kind === 'primary') {
			this.primaryTarget = target;
			if (target.location.isDisposed) { super.dispose(); return; }
			this.add({ dispose: target.location.onDidRetire(this.retire) });
			this.add(target.location);
		} else {
			this.editorTarget = target;
			this.ownerValue = owner;
			if (selection?.isDisposed) { super.dispose(); return; }
			this.unbindOwner = owner!.onWillDispose(this.retire);
			this.unbindMove = owner!.onDidMoveEditor(this.followMove);
			if (selection !== undefined) {
				this.add({ dispose: selection.onDidRetire(this.retire) });
				this.add(selection);
			}
			if (target.kind === 'input') this.unbindInput = target.input.onWillDispose(this.retire);
		}
	}

	/** Pending captures and stacked entries follow the same actual group handoff. */
	private readonly followMove = (event: EditorMoveEvent): void => {
		const target = this.editorTarget!;
		if (target.kind === 'input') {
			if (target.input !== event.input) return;
			this.unbindInput!();
			this.editorTarget = { kind: 'input', input: event.replacement };
			this.unbindInput = event.replacement.onWillDispose(this.retire);
		} else {
			const identity = event.input.toResourceEditor?.();
			if (identity === undefined || identity.editorId !== target.editorId || !resourceIdentityEquals(identity.resource, target.resource)) return;
		}
		this.unbindOwner!(); this.unbindMove!();
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
		this.unbindOwner?.(); this.unbindMove?.(); this.unbindInput?.();
		super.dispose();
	}
}

export const navigationState = {
	back: [] as NavigationHistoryEntry[],
	forward: [] as NavigationHistoryEntry[],
	captureSuspendDepth: 0,
	activeOwner: null as NavigationHistorySource | null,
};

/** The frontend binds an actual capture owner; child construction never selects this owner. */
export function initializeNavigationState(owner: NavigationHistorySource): () => void {
	resetNavigationHistoryState();
	navigationState.activeOwner = owner;
	return () => {
		navigationState.activeOwner = null;
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
	if (left.kind === 'primary') return right.kind === 'primary' && left.location.matches(right.location);
	if (right.kind === 'primary') return false;
	if (left.kind === 'input') {
		if (right.kind !== 'input' || left.input !== right.input) return false;
	} else if (right.kind !== 'resource' || left.editorId !== right.editorId
		|| left.resource.contextId !== right.resource.contextId || left.resource.path !== right.resource.path) return false;
	return a.selection === undefined ? b.selection === undefined
		: b.selection !== undefined && a.selection.matches(b.selection);
}

export function createNavigationEntry(): NavigationHistoryEntry | null {
	const owner = navigationState.activeOwner;
	return owner === null ? null : owner.captureNavigationEntry();
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
