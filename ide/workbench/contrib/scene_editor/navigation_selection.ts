import { EditorPaneSelection } from '../../services/editor/editor_selection';
import { mapTrackedTextRange, type TrackedTextRange } from '../../../editor/text/text_change';
import { rebuildWorkbenchTreeRows, type WorkbenchTreeNode } from '../../ui/tree_view';
import { selectSceneOutlineRow, type SceneOutlineElement } from './outline';
import type { SceneEditorInput } from './editor_input';

/** Track the member's containing registration as well as its authored field. */
export class SceneEditorNavigationSelection extends EditorPaneSelection {
	public readonly selected: { readonly kind: SceneOutlineElement['kind']; readonly span: TrackedTextRange; readonly root: TrackedTextRange } | undefined;
	private readonly collapsed: TrackedTextRange[] = [];
	public readonly outlineScroll: number;
	public readonly detailsScroll: number;

	public constructor(input: SceneEditorInput) {
		super();
		const selected = input.outline.rows[input.outline.selectionIndex];
		this.selected = selected === undefined ? undefined : {
			kind: selected.element.kind, span: { ...selected.element.span },
			root: { ...(selected.parent === null ? selected : selected.parent).element.span },
		};
		this.outlineScroll = input.outline.scroll;
		this.detailsScroll = input.details.scrollTop;
		for (const root of input.outline.roots) if (root.collapsed) this.collapsed.push({ ...root.element.span });
		this.add({ dispose: input.workingCopy.onDidChangeContent(event => {
			if (this.selected !== undefined) {
				mapTrackedTextRange(this.selected.span, event.changes);
				mapTrackedTextRange(this.selected.root, event.changes);
			}
			for (const span of this.collapsed) mapTrackedTextRange(span, event.changes);
		}) });
	}

	public matches(other: SceneEditorNavigationSelection): boolean {
		const a = this.selected;
		const b = other.selected;
		return a === undefined || b === undefined ? a === b : a.kind === b.kind
			&& a.span.start === b.span.start && a.span.end === b.span.end && a.root.start === b.root.start && a.root.end === b.root.end;
	}

	public restore(input: SceneEditorInput): void {
		const selected = this.selected;
		let node: WorkbenchTreeNode<SceneOutlineElement> | null = null;
		for (const root of input.outline.roots) {
			const span = root.element.span;
			root.collapsed = this.collapsed.some(previous => previous.start !== previous.end && previous.start === span.start && previous.end === span.end);
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
	}
}
