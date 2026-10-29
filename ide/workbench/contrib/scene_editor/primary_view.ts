import type { MainWorkspaceRegionId } from '../../common/main_workspace_client';
import type { SceneAuthoringContext } from './authoring_context';
import { SceneHierarchyViewState } from './hierarchy_view';
import { SceneDetailsViewState } from './details_view';

/** Primary reading state has no document tab, compact section or document layout. */
export class ScenePrimaryViewState {
	public readonly hierarchy: SceneHierarchyViewState;
	public readonly details: SceneDetailsViewState;
	private preferred: MainWorkspaceRegionId = 'hierarchy';
	private readonly listeners = new Set<() => void>();
	private readonly subscriptions: readonly (() => void)[];
	public constructor(public readonly authoring: SceneAuthoringContext) {
		this.hierarchy = new SceneHierarchyViewState(authoring); this.details = new SceneDetailsViewState(authoring);
		this.subscriptions = [authoring.workingCopy.onDidChangeContent(() => this.changed()),
			authoring.onDidChangeSelection(() => this.changed()), this.hierarchy.onDidChange(() => this.changed()), this.details.onDidChange(() => this.changed())];
	}
	public get preferredRegion(): MainWorkspaceRegionId { return this.preferred; }
	public set preferredRegion(value: MainWorkspaceRegionId) {
		if (this.preferred === value) return;
		this.preferred = value; this.changed();
	}
	public onDidChange(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
	private changed(): void { for (const listener of this.listeners) listener(); }
	public refresh(): void { this.hierarchy.refresh(); this.details.refresh(); }
	public dispose(): void {
		for (const unsubscribe of this.subscriptions) unsubscribe();
		this.hierarchy.dispose(); this.details.dispose(); this.listeners.clear();
	}
}
