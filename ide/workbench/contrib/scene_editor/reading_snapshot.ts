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
	for (const root of view.hierarchy.outline.roots) if (root.collapsed) collapsed.push({ ...root.element.span });
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
	for (const root of tree.roots) {
		const span = root.element.span;
		root.collapsed = snapshot.collapsed.some(previous => previous.start !== previous.end && previous.start === span.start && previous.end === span.end);
	}
	rebuildWorkbenchTreeRows(tree, null);
	projectSceneSelection(view.hierarchy);
	if (!request.isCurrent()) return false;
	view.hierarchy.position = snapshot.outlineScroll;
	view.details.position = snapshot.detailsScroll;
	return true;
}
