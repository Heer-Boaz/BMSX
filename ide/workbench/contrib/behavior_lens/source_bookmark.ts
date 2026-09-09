import { EditorEditStateType } from '../../../editor/model/edit_state';
import { mapTrackedTextRange, type EditorTextChange, type TrackedTextRange } from '../../../editor/text/text_change';
import type { BehaviorSourceNode, BehaviorSourceRowKey } from './model';
import type { BehaviorLensViewState } from './view_model';

export type BehaviorSourceBookmarkStep = TrackedTextRange & Pick<BehaviorSourceNode, 'kind' | 'behaviorKind'>;

/** Source occurrences from registration to selection, not authored initializer ids. */
export type BehaviorSourceBookmark = {
	readonly kind: 'node' | 'tree-edge';
	readonly path: readonly BehaviorSourceBookmarkStep[];
};

export const behaviorSourceEditState = new EditorEditStateType<BehaviorSourceBookmark>();

export function captureBehaviorSourceBookmark(
	view: BehaviorLensViewState, rowKey: BehaviorSourceRowKey, kind: BehaviorSourceBookmark['kind'],
): BehaviorSourceBookmark {
	const path: BehaviorSourceBookmarkStep[] = [];
	let key: BehaviorSourceRowKey | null = rowKey;
	while (key !== null) {
		const node = view.nodesByRowKey.get(key)!;
		path.push({ ...view.sourceRanges.get(key)!, kind: node.kind, behaviorKind: node.behaviorKind });
		key = view.parentRowKeyByRowKey.get(key)!;
	}
	path.reverse();
	return { kind, path };
}

/** A live pending selection may track edits; history values themselves are never mapped. */
export function mapBehaviorSourceBookmark(bookmark: BehaviorSourceBookmark, changes: readonly EditorTextChange[]): void {
	for (const step of bookmark.path) mapTrackedTextRange(step, changes);
}

export function resolveBehaviorSourceBookmark(
	bookmark: BehaviorSourceBookmark, view: BehaviorLensViewState,
): BehaviorSourceNode[] | undefined {
	const path: BehaviorSourceNode[] = [];
	let candidates: readonly BehaviorSourceNode[] = view.document.definitions;
	for (const step of bookmark.path) {
		const node = candidates.find(candidate => {
			if (candidate.kind !== step.kind || candidate.behaviorKind !== step.behaviorKind) return false;
			const span = view.sourceRanges.get(candidate.rowKey)!;
			return step.start !== step.end && span.start === step.start && span.end === step.end;
		});
		if (node === undefined) return undefined; // A later source edit can delete the selected occurrence.
		path.push(node);
		candidates = node.children;
	}
	return path;
}
