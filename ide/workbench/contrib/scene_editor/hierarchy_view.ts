import type { TrackedTextRange } from '../../../editor/text/text_change';
import type { SceneAuthoringContext } from './authoring_context';
import type { SceneSourceDefinition, SceneSourceDocument, SceneSourceObject } from './model';
import { installSceneOutline, projectSceneSelection, type SceneOutlineElement } from './outline';
import { ScrollableWorkbenchTree } from '../../ui/scrollable_tree';
import type { FullWidthWorkbenchLayout } from '../../common/layout';

/** A hierarchy's disclosure and reading state over one admitted authored context. */
export class SceneHierarchyViewState {
	public outlineDocument: SceneSourceDocument | undefined;
	public outlineRevision = -1;
	public outlineSourceVersion = -1;
	public outlineGeneration = 0;
	public outlineParentGeneration: object | undefined;
	public position: number | undefined;
	public readonly outlineRanges = new Map<SceneOutlineElement, TrackedTextRange>();
	public readonly outlineParents = new Map<SceneSourceDefinition, ReadonlyMap<SceneSourceObject, SceneSourceObject | undefined>>();
	public readonly layout: FullWidthWorkbenchLayout = { left: 0, top: 0, right: 0, bottom: 0, rowHeight: 0, font: null };
	public readonly outline = new ScrollableWorkbenchTree<SceneOutlineElement>();
	public measuredRowsRevision = -1;
	private readonly changeListeners = new Set<() => void>();
	private readonly releaseRanges: () => void;

	public constructor(public readonly authoring: SceneAuthoringContext) {
		this.releaseRanges = authoring.workingCopy.trackRanges(this.outlineRanges);
	}
	public refresh(): void {
		this.authoring.refresh();
		if (this.outlineDocument === this.authoring.document && this.outlineSourceVersion === this.authoring.workingCopy.version) {
			let topologyChanged = false;
			if (this.outlineParentGeneration !== this.authoring.spatialGeneration) {
				topologyChanged = this.outlineParents.size !== this.authoring.scenes.length;
				if (!topologyChanged) for (const scene of this.authoring.scenes) {
					if (this.outlineParents.get(scene) !== this.authoring.getSpatialParents(scene)) { topologyChanged = true; break; }
				}
				this.outlineParentGeneration = this.authoring.spatialGeneration;
			}
			if (!topologyChanged) {
				if (this.outlineRevision !== this.authoring.revision) projectSceneSelection(this);
				return;
			}
		}
		installSceneOutline(this);
	}
	public onDidChange(listener: () => void): () => void { this.changeListeners.add(listener); return () => this.changeListeners.delete(listener); }
	public notifyPresentationChanged(): void { for (const listener of this.changeListeners) listener(); }
	public dispose(): void { this.releaseRanges(); this.outlineParents.clear(); this.changeListeners.clear(); }
}
