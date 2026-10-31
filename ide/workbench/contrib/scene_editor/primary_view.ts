import type { MainWorkspacePrimaryPartId } from '../../common/main_workspace_client';
import type { SceneAuthoringContext } from './authoring_context';
import { SceneHierarchyViewState } from './hierarchy_view';
import { SceneDetailsViewState } from './details_view';
import { SceneViewportViewState } from './viewport/view_state';

/** Primary reading state has no document tab, compact section or document layout. */
export class ScenePrimaryViewState {
	public readonly hierarchy: SceneHierarchyViewState;
	public readonly details: SceneDetailsViewState;
	public readonly viewport: SceneViewportViewState;
	private preferred: MainWorkspacePrimaryPartId = 'viewport';
	private readonly listeners = new Set<() => void>();
	private readonly subscriptions: readonly (() => void)[];
	public constructor(public readonly authoring: SceneAuthoringContext) {
		this.hierarchy = new SceneHierarchyViewState(authoring); this.details = new SceneDetailsViewState(authoring);
		this.viewport = new SceneViewportViewState(authoring);
		this.subscriptions = [authoring.workingCopy.onDidChangeContent(() => this.changed()),
			authoring.onDidChangeSelection(() => this.changed()), this.hierarchy.onDidChange(() => this.changed()), this.details.onDidChange(() => this.changed()),
			this.viewport.onDidChange(() => this.changed())];
	}
	public get preferredPart(): MainWorkspacePrimaryPartId { return this.preferred; }
	public set preferredPart(value: MainWorkspacePrimaryPartId) {
		if (this.preferred === value) return;
		this.preferred = value; this.changed();
	}
	public onDidChange(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
	private changed(): void { for (const listener of this.listeners) listener(); }
	public refresh(): void { this.hierarchy.refresh(); this.details.refresh(); }
	public dispose(): void {
		for (const unsubscribe of this.subscriptions) unsubscribe();
		this.hierarchy.dispose(); this.details.dispose(); this.viewport.dispose(); this.listeners.clear();
	}
}
