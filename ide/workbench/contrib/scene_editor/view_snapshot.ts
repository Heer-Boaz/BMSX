import { mapTrackedTextRange, type EditorTextChange, type TrackedTextRange } from '../../../editor/text/text_change';
import { rebuildWorkbenchTreeRows, type WorkbenchTreeNode } from '../../ui/tree_view';
import { selectSceneOutlineRow, type SceneOutlineElement } from './outline';
import type { SceneEditorInput } from './editor_input';

export type SceneEditorViewSnapshot = {
	readonly selected: { readonly kind: SceneOutlineElement['kind']; readonly span: TrackedTextRange; readonly root: TrackedTextRange } | undefined;
	readonly collapsed: readonly TrackedTextRange[];
	readonly outlineScroll: number;
	readonly detailsScroll: number;
};

export function captureSceneEditorView(input: SceneEditorInput): SceneEditorViewSnapshot {
	const selected = input.outline.rows[input.outline.selectionIndex];
	const collapsed: TrackedTextRange[] = [];
	for (const root of input.outline.roots) if (root.collapsed) collapsed.push({ ...root.element.span });
	const position = input.position;
	return {
		selected: selected === undefined ? undefined : {
			kind: selected.element.kind,
			// The retained selection range is mapped even while the pane is hidden.
			span: { ...input.selectionRange },
			root: { ...(selected.parent === null ? selected : selected.parent).element.span },
		},
		collapsed,
		outlineScroll: position === undefined ? input.outline.scroll : position.outlineScroll,
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

export function restoreSceneEditorView(input: SceneEditorInput, snapshot: SceneEditorViewSnapshot): void {
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
	input.position = { outlineScroll: snapshot.outlineScroll, detailsScroll: snapshot.detailsScroll };
}
