import { mapTrackedTextRange, type EditorTextChange, type TrackedTextRange } from '../../../editor/text/text_change';
import { rebuildWorkbenchTreeRows } from '../../ui/tree_view';
import { projectSceneSelection } from './outline';
import type { SceneEditorViewState, SceneEditorSection } from './view_state';
import type { SceneAuthoredSelectionReference, SceneAuthoredSourceReference, SceneSelectionRequest } from './authoring_context';

export type SceneEditorViewSnapshot = {
	readonly section: SceneEditorSection;
	readonly selected: SceneAuthoredSelectionReference | undefined;
	readonly collapsed: readonly TrackedTextRange[];
	readonly outlineScroll: number;
	readonly detailsScroll: number;
};

export function captureSceneEditorView(input: SceneEditorViewState, reference: SceneAuthoredSourceReference = input.authoring.captureSourceReference()): SceneEditorViewSnapshot {
	const collapsed: TrackedTextRange[] = [];
	for (const root of input.hierarchy.outline.roots) if (root.collapsed) collapsed.push({ ...root.element.span });
	return {
		section: input.section, selected: reference.selected, collapsed,
		outlineScroll: input.hierarchy.position ?? input.hierarchy.outline.scroll,
		detailsScroll: input.details.position ?? input.details.viewport.scrollTop,
	};
}

export function mapSceneEditorView(snapshot: SceneEditorViewSnapshot, changes: readonly EditorTextChange[]): void {
	if (snapshot.selected !== undefined) {
		mapTrackedTextRange(snapshot.selected.span, changes);
		mapTrackedTextRange(snapshot.selected.root, changes);
	}
	for (const span of snapshot.collapsed) mapTrackedTextRange(span, changes);
}

export function restoreSceneEditorView(input: SceneEditorViewState, snapshot: SceneEditorViewSnapshot,
	request: SceneSelectionRequest = input.authoring.captureSelectionRequest()): void {
	if (!request.restore(snapshot.selected)) return;
	input.hierarchy.refresh();
	if (!request.isCurrent()) return;
	const tree = input.hierarchy.outline;
	for (const root of tree.roots) {
		const span = root.element.span;
		root.collapsed = snapshot.collapsed.some(previous => previous.start !== previous.end && previous.start === span.start && previous.end === span.end);
	}
	rebuildWorkbenchTreeRows(tree, null);
	projectSceneSelection(input.hierarchy);
	if (!request.isCurrent()) return;
	input.hierarchy.position = snapshot.outlineScroll;
	input.details.position = snapshot.detailsScroll;
	input.section = snapshot.section;
}
