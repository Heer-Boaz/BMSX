import { EditorEditStateType } from '../../../editor/model/edit_state';
import { mapTrackedTextRange, type EditorTextChange, type TrackedTextRange } from '../../../editor/text/text_change';
import type { BehaviorSourceNode, BehaviorSourceRowKey } from './model';
import type { BehaviorLensViewState } from './view_model';
import type { BehaviorSourceSelection } from './source_selection';
import { copyStateMachineSourceBookmark, mapStateMachineSourceSelection, stateMachineSourceBookmarksEqual, type StateMachineSourceBookmark } from './state_machine_selection';

export type BehaviorSourceBookmarkStep = TrackedTextRange & Pick<BehaviorSourceNode, 'kind' | 'behaviorKind'>;

/** Source occurrences from registration to selection, not authored initializer ids. */
export type BehaviorSourceBookmark = ({ readonly kind: 'node' } | { readonly kind: 'tree-edge' } | StateMachineSourceBookmark) & {
	readonly path: readonly BehaviorSourceBookmarkStep[];
};

export const behaviorSourceEditState = new EditorEditStateType<BehaviorSourceBookmark>();

export function captureBehaviorSourceBookmark<S extends BehaviorSourceSelection>(
	view: BehaviorLensViewState, selection: S,
): BehaviorSourceBookmark & Pick<S, 'kind'>;
export function captureBehaviorSourceBookmark(
	view: BehaviorLensViewState, selection: BehaviorSourceSelection,
): BehaviorSourceBookmark {
	const path: BehaviorSourceBookmarkStep[] = [];
	let key: BehaviorSourceRowKey | null = selection.rowKey;
	while (key !== null) {
		const node = view.source.nodesByRowKey.get(key)!;
		path.push({ ...view.source.ranges.get(key)!, kind: node.kind, behaviorKind: node.behaviorKind });
		key = view.source.parentByRowKey.get(key)!;
	}
	path.reverse();
	return selection.kind === 'node' || selection.kind === 'tree-edge' ? { kind: selection.kind, path }
		: { ...copyStateMachineSourceBookmark(selection), path };
}

/** Undo records own immutable values; live selections and navigation own mapped copies. */
export function copyBehaviorSourceBookmark<S extends BehaviorSourceBookmark>(bookmark: S): BehaviorSourceBookmark & Pick<S, 'kind'>;
export function copyBehaviorSourceBookmark(bookmark: BehaviorSourceBookmark): BehaviorSourceBookmark {
	const path = bookmark.path.map(step => ({ ...step }));
	return bookmark.kind === 'node' || bookmark.kind === 'tree-edge' ? { kind: bookmark.kind, path }
		: { ...copyStateMachineSourceBookmark(bookmark), path };
}

/** Map a live selection or navigation bookmark, never an immutable undo record. */
export function mapBehaviorSourceBookmark(bookmark: BehaviorSourceBookmark, changes: readonly EditorTextChange[]): void {
	for (const step of bookmark.path) mapTrackedTextRange(step, changes);
	if (bookmark.kind === 'state-outcome' || bookmark.kind === 'state-entry') mapStateMachineSourceSelection(bookmark, changes);
}

export function resolveBehaviorSourceBookmark(
	bookmark: BehaviorSourceBookmark, view: BehaviorLensViewState,
): BehaviorSourceNode[] | undefined {
	const path: BehaviorSourceNode[] = [];
	let candidates: readonly BehaviorSourceNode[] = view.document.definitions;
	for (const step of bookmark.path) {
		const node = candidates.find(candidate => {
			if (candidate.kind !== step.kind || candidate.behaviorKind !== step.behaviorKind) return false;
			const span = view.source.ranges.get(candidate.rowKey)!;
			return step.start !== step.end && span.start === step.start && span.end === step.end;
		});
		if (node === undefined) return undefined; // A later source edit can delete the selected occurrence.
		path.push(node);
		candidates = node.children;
	}
	return path;
}

export function behaviorSourceBookmarksEqual(a: BehaviorSourceBookmark | undefined, b: BehaviorSourceBookmark | undefined): boolean {
	if (a === undefined || b === undefined) return a === b;
	if (a.kind !== b.kind || a.path.length !== b.path.length) return false;
	for (let index = 0; index < a.path.length; index += 1) {
		const left = a.path[index];
		const right = b.path[index];
		if (left.kind !== right.kind || left.behaviorKind !== right.behaviorKind || left.start !== right.start || left.end !== right.end) return false;
	}
	if (a.kind === 'node' || a.kind === 'tree-edge') return true;
	return b.kind !== 'node' && b.kind !== 'tree-edge' && stateMachineSourceBookmarksEqual(a, b);
}
