import type { TrackedTextRange } from '../../../editor/text/text_change';
import type { SceneAuthoringContext } from './authoring_context';
import type { SceneSourceDocument } from './model';
import { installSceneOutline, projectSceneSelection, type SceneOutlineElement } from './outline';
import type { WorkbenchTreeState } from '../../ui/tree_view';
import type { FullWidthWorkbenchLayout } from '../../common/layout';

/** A hierarchy's disclosure and reading state over one admitted authored context. */
export class SceneHierarchyViewState {
	public outlineDocument: SceneSourceDocument | undefined;
	public outlineRevision = -1;
	public outlineSourceVersion = -1;
	public position: number | undefined;
	public readonly outlineRanges = new Map<SceneOutlineElement, TrackedTextRange>();
	public readonly layout: FullWidthWorkbenchLayout = { left: 0, top: 0, right: 0, bottom: 0, rowHeight: 0, font: null };
	public readonly outline: WorkbenchTreeState<SceneOutlineElement> = {
		roots: [], rows: [], selectionIndex: -1, scroll: 0, hoverIndex: -1,
		layout: { contentLeft: 0, contentTop: 0, contentRight: 0, contentBottom: 0, rowHeight: 0, visibleRowCount: 0, indentWidth: 0, twistieWidth: 0 },
	};
	private readonly changeListeners = new Set<() => void>();
	private readonly releaseRanges: () => void;

	public constructor(public readonly authoring: SceneAuthoringContext) {
		this.releaseRanges = authoring.workingCopy.trackRanges(this.outlineRanges);
	}
	public refresh(): void {
		this.authoring.refresh();
		if (this.outlineDocument === this.authoring.document && this.outlineSourceVersion === this.authoring.workingCopy.version) {
			if (this.outlineRevision !== this.authoring.revision) projectSceneSelection(this);
			return;
		}
		installSceneOutline(this);
	}
	public onDidChange(listener: () => void): () => void { this.changeListeners.add(listener); return () => this.changeListeners.delete(listener); }
	public notifyPresentationChanged(): void { for (const listener of this.changeListeners) listener(); }
	public dispose(): void { this.releaseRanges(); this.changeListeners.clear(); }
}
