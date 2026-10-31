import { mapTrackedTextRange, type EditorTextChange, type TrackedTextRange } from '../../../editor/text/text_change';
import { rebuildWorkbenchTreeRows } from '../../ui/tree_view';
import type { SceneAuthoredSelectionReference, SceneAuthoredSourceReference, SceneAuthoringContext, SceneSelectionRequest } from './authoring_context';
import type { SceneHierarchyViewState } from './hierarchy_view';
import type { SceneDetailsViewState } from './details_view';
import { projectSceneSelection } from './outline';

export type SceneReadingView = {
	readonly authoring: SceneAuthoringContext;
	readonly hierarchy: SceneHierarchyViewState;
	readonly details: SceneDetailsViewState;
};
export type SceneReadingSnapshot = {
	readonly selected: SceneAuthoredSelectionReference | undefined;
	readonly collapsed: readonly TrackedTextRange[];
	readonly outlineScroll: number;
	readonly detailsScroll: number;
};

/** Passive reading correspondence is shared by the document and the primary context, not their placement. */
export function captureSceneReading(view: SceneReadingView, reference: SceneAuthoredSourceReference = view.authoring.captureSourceReference()): SceneReadingSnapshot {
	const collapsed: TrackedTextRange[] = [];
	const pending = [...view.hierarchy.outline.roots];
	while (pending.length > 0) {
		const node = pending.pop()!;
		if (node.collapsed) collapsed.push({ ...node.element.span });
		for (const child of node.children) pending.push(child);
	}
	return { selected: reference.selected, collapsed, outlineScroll: view.hierarchy.position ?? view.hierarchy.outline.scroll,
		detailsScroll: view.details.position ?? view.details.viewport.scrollTop };
}

export function mapSceneReading(snapshot: SceneReadingSnapshot, changes: readonly EditorTextChange[]): void {
	if (snapshot.selected !== undefined) {
		mapTrackedTextRange(snapshot.selected.span, changes);
		mapTrackedTextRange(snapshot.selected.root, changes);
	}
	for (const span of snapshot.collapsed) mapTrackedTextRange(span, changes);
}

export function restoreSceneReading(view: SceneReadingView, snapshot: SceneReadingSnapshot, request: SceneSelectionRequest): boolean {
	if (!request.restore(snapshot.selected)) return false;
	view.hierarchy.refresh();
	if (!request.isCurrent()) return false;
	const tree = view.hierarchy.outline;
	const collapsedEnds = new Map<number, number>();
	for (const span of snapshot.collapsed) if (span.start !== span.end) collapsedEnds.set(span.start, span.end);
	const pending = [...tree.roots];
	while (pending.length > 0) {
		const node = pending.pop()!, span = node.element.span;
		node.collapsed = collapsedEnds.get(span.start) === span.end;
		for (const child of node.children) pending.push(child);
	}
	rebuildWorkbenchTreeRows(tree, null);
	projectSceneSelection(view.hierarchy);
	if (!request.isCurrent()) return false;
	view.hierarchy.position = snapshot.outlineScroll;
	view.details.position = snapshot.detailsScroll;
	return true;
}
