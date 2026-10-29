import { create_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import { WorkbenchMenu } from '../../ui/menu/model';
import { createWorkbenchActionBar } from '../../ui/action_bar';
import type { FullWidthWorkbenchLayout } from '../../common/layout';
import { computeResourceTabTitle } from '../../ui/tab/titles';
import type { SceneAuthoringContext } from './authoring_context';
import { SceneDetailsViewState } from './details_view';
import { SceneHierarchyViewState } from './hierarchy_view';
import { SCENE_TITLE_ACTIONS, SCENE_CONTEXT_ACTIONS } from './menus';

export type SceneEditorSection = 'outline' | 'details';

/** Document/Main composition of independently retained hierarchy and Details presentations. */
export class SceneEditorViewState {
	public readonly hierarchy: SceneHierarchyViewState;
	public readonly details: SceneDetailsViewState;
	private sectionValue: SceneEditorSection = 'outline';
	private readonly changeListeners = new Set<() => void>();
	public get section(): SceneEditorSection { return this.sectionValue; }
	public set section(value: SceneEditorSection) {
		if (this.sectionValue === value) return;
		this.sectionValue = value;
		this.notifyPresentationChanged();
	}
	public sourceText = '';
	public readonly sourceCaption: string;
	public readonly contextActions = new WorkbenchMenu(SCENE_CONTEXT_ACTIONS, this);
	public readonly actionBar = createWorkbenchActionBar(new WorkbenchMenu(SCENE_TITLE_ACTIONS, this), true, this.contextActions);
	public readonly layout: FullWidthWorkbenchLayout & {
		mode: 'split' | SceneEditorSection;
		splitMinimumWidth: number;
		detailsLeft: number;
		outlineTitle: string;
		detailsTitle: string;
		sourceBounds: RectBounds;
		hierarchyBounds: RectBounds;
		detailsBounds: RectBounds;
	} = {
		left: 0, top: 0, right: 0, bottom: 0, rowHeight: 0, font: null,
		mode: 'outline', splitMinimumWidth: 0, detailsLeft: 0, outlineTitle: '', detailsTitle: '',
		sourceBounds: create_rect_bounds(), hierarchyBounds: create_rect_bounds(), detailsBounds: create_rect_bounds(),
	};
	private readonly subscriptions: readonly (() => void)[];

	public constructor(public readonly authoring: SceneAuthoringContext) {
		this.sourceCaption = computeResourceTabTitle(authoring.workingCopy.resource);
		this.hierarchy = new SceneHierarchyViewState(authoring);
		this.details = new SceneDetailsViewState(authoring);
		this.subscriptions = [
			authoring.workingCopy.onDidChangeContent(() => this.notifyPresentationChanged()),
			authoring.onDidChangeSelection(() => this.notifyPresentationChanged()),
			this.hierarchy.onDidChange(() => this.notifyPresentationChanged()),
			this.details.onDidChange(() => this.notifyPresentationChanged()),
		];
	}
	public onDidChange(listener: () => void): () => void { this.changeListeners.add(listener); return () => this.changeListeners.delete(listener); }
	public notifyPresentationChanged(): void { for (const listener of this.changeListeners) listener(); }
	public refresh(): void { this.hierarchy.refresh(); this.details.refresh(); }
	public dispose(): void {
		for (const unbind of this.subscriptions) unbind();
		this.hierarchy.dispose(); this.details.dispose(); this.changeListeners.clear();
	}
}
