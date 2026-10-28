import { mapTrackedTextRange, type EditorTextChange, type TrackedTextRange } from '../../../editor/text/text_change';
import { rebuildWorkbenchTreeRows, type WorkbenchTreeNode } from '../../ui/tree_view';
import { selectSceneOutlineRow, type SceneOutlineElement } from './outline';
import type { SceneEditorViewState, SceneEditorSection } from './view_state';
import type { SceneAuthoredSelectionReference, SceneAuthoredSourceReference } from './authoring_context';

export type SceneEditorViewSnapshot = {
	readonly section: SceneEditorSection;
	readonly selected: SceneAuthoredSelectionReference | undefined;
	readonly collapsed: readonly TrackedTextRange[];
	readonly outlineScroll: number;
	readonly detailsScroll: number;
};

export function captureSceneEditorView(input: SceneEditorViewState, reference: SceneAuthoredSourceReference = input.authoring.captureSourceReference()): SceneEditorViewSnapshot {
	const collapsed: TrackedTextRange[] = [];
	for (const root of input.outline.roots) if (root.collapsed) collapsed.push({ ...root.element.span });
	const position = input.position;
	return {
		section: input.section,
		selected: reference.selected,
		collapsed,
		outlineScroll: position?.outlineScroll === undefined ? input.outline.scroll : position.outlineScroll,
		detailsScroll: position === undefined ? input.details.scrollTop : position.detailsScroll,
	};
}

export function mapSceneEditorView(snapshot: SceneEditorViewSnapshot, changes: readonly EditorTextChange[]): void {
	if (snapshot.selected !== undefined) {
		mapTrackedTextRange(snapshot.selected.span, changes);
		mapTrackedTextRange(snapshot.selected.root, changes);
	}
	for (const span of snapshot.collapsed) mapTrackedTextRange(span, changes);
}

export function restoreSceneEditorView(input: SceneEditorViewState, snapshot: SceneEditorViewSnapshot): void {
	const selected = snapshot.selected;
	let node: WorkbenchTreeNode<SceneOutlineElement> | null = null;
	for (const root of input.outline.roots) {
		const span = root.element.span;
		root.collapsed = snapshot.collapsed.some(previous => previous.start !== previous.end && previous.start === span.start && previous.end === span.end);
		if (selected === undefined || selected.root.start === selected.root.end
			|| span.start !== selected.root.start || span.end !== selected.root.end) continue;
		if (selected.kind === 'scene') node = root;
		else {
			for (const child of root.children) {
				const source = child.element.span;
				if (source.start === selected.span.start && source.end === selected.span.end) {
					node = child;
					root.collapsed = false;
				}
			}
		}
	}
	rebuildWorkbenchTreeRows(input.outline, node);
	selectSceneOutlineRow(input, input.outline.selectionIndex);
	input.section = node === null ? 'outline' : snapshot.section;
	input.position = { outlineScroll: snapshot.outlineScroll, detailsScroll: snapshot.detailsScroll };
}
