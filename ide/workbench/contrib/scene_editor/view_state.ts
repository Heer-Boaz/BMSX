import { WorkbenchMenu } from '../../ui/menu/model';
import { SCENE_TITLE_ACTIONS, SCENE_CONTEXT_ACTIONS } from './menus';
import { create_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import type { LuaTableField } from '../../../../toolchain/ts/lua/syntax/ast';
import type { TrackedTextRange } from '../../../editor/text/text_change';
import type { WorkbenchTreeState } from '../../ui/tree_view';
import { createWorkbenchActionBar } from '../../ui/action_bar';
import type { SceneOutlineElement } from './outline';
import type { FullWidthWorkbenchLayout } from '../../common/layout';
import { WorkbenchScrollViewport } from '../../ui/scroll_viewport';
import { computeResourceTabTitle } from '../../ui/tab/titles';
import type { SceneOptionProperty } from './option_properties';
import type { SceneAuthoringContext } from './authoring_context';
import type { SceneSourceDocument } from './model';
import { installSceneOutline } from './outline';

export const POSITION_AXES = ['x', 'y', 'z'] as const;
export type SceneEditorSection = 'outline' | 'details';

/** Retained presentation for one Scene context; no editor input or container identity. */
export class SceneEditorViewState {
	public outlineDocument: SceneSourceDocument | undefined;
	public outlineRevision = -1;
	public outlineSourceVersion = -1;
	public readonly outlineRanges = new Map<SceneOutlineElement, TrackedTextRange>();
	private sectionValue: SceneEditorSection = 'outline';
	private readonly changeListeners = new Set<() => void>();
	public get section(): SceneEditorSection { return this.sectionValue; }
	public set section(value: SceneEditorSection) {
		if (this.sectionValue === value) return;
		this.sectionValue = value;
		this.notifyPresentationChanged();
	}
	public position: { outlineScroll: number | undefined; readonly detailsScroll: number } | undefined;
	public sourceText = '';
	public readonly sourceCaption: string;
	public readonly details = new WorkbenchScrollViewport();
	public readonly detailsText: { text: string; top: number; warning: boolean }[] = [];
	public readonly wrappedLines: string[] = [];
	public readonly outline: WorkbenchTreeState<SceneOutlineElement> = {
		roots: [], rows: [], selectionIndex: -1, scroll: 0, hoverIndex: -1,
		layout: { contentLeft: 0, contentTop: 0, contentRight: 0, contentBottom: 0, rowHeight: 0, visibleRowCount: 0, indentWidth: 0, twistieWidth: 0 },
	};
	public readonly contextActions = new WorkbenchMenu(SCENE_CONTEXT_ACTIONS, this);
	public readonly actionBar = createWorkbenchActionBar(new WorkbenchMenu(SCENE_TITLE_ACTIONS, this), true, this.contextActions);
	public readonly properties = POSITION_AXES.map(axis => ({
		axis, label: axis.toUpperCase(), field: null as LuaTableField | null,
		value: null as number | null, sourceText: '', text: '', contentBounds: create_rect_bounds(), bounds: create_rect_bounds(),
	}));
	public optionProperties: readonly SceneOptionProperty[] = [];
	public readonly layout: FullWidthWorkbenchLayout & { mode: 'split' | SceneEditorSection; splitMinimumWidth: number; detailsLeft: number; projectedOffsetTop: number; outlineTitle: string; detailsTitle: string; sourceBounds: RectBounds } = {
		left: 0, top: 0, right: 0, bottom: 0, rowHeight: 0, font: null,
		mode: 'outline', splitMinimumWidth: 0, detailsLeft: 0, projectedOffsetTop: 0, outlineTitle: '', detailsTitle: '', sourceBounds: create_rect_bounds(),
	};

	private readonly releaseRanges: () => void;
	private readonly unsubscribeContent: () => void;
	private readonly unsubscribeSelection: () => void;
	private readonly unsubscribeDetailsScroll: () => void;

	public constructor(public readonly authoring: SceneAuthoringContext) {
		this.sourceCaption = computeResourceTabTitle(authoring.workingCopy.resource);
		this.releaseRanges = authoring.workingCopy.trackRanges(this.outlineRanges);
		this.unsubscribeContent = authoring.workingCopy.onDidChangeContent(() => this.notifyPresentationChanged());
		this.unsubscribeSelection = authoring.onDidChangeSelection(() => this.notifyPresentationChanged());
		this.unsubscribeDetailsScroll = this.details.scrollbar.onDidScroll(() => this.notifyPresentationChanged());
	}
	public onDidChange(listener: () => void): () => void {
		this.changeListeners.add(listener);
		return () => { this.changeListeners.delete(listener); };
	}
	public notifyPresentationChanged(): void {
		for (const listener of this.changeListeners) listener();
	}

	public refresh(): void {
		this.authoring.refresh();
		if (this.outlineDocument === this.authoring.document && this.outlineRevision === this.authoring.revision) return;
		installSceneOutline(this);
	}

	public dispose(): void {
		this.unsubscribeContent(); this.unsubscribeSelection(); this.unsubscribeDetailsScroll();
		this.releaseRanges(); this.changeListeners.clear();
	}
}
