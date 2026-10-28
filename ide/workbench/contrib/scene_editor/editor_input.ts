import { WorkbenchMenu } from '../../ui/menu/model';
import { SCENE_TITLE_ACTIONS, SCENE_CONTEXT_ACTIONS } from './menus';
import { create_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import type { LuaTableField } from '../../../../toolchain/ts/lua/syntax/ast';
import type { EditorTextModel } from '../../../editor/model/text_model';
import type { TrackedTextRange } from '../../../editor/text/text_change';
import { resourceIdentityKey } from '../../../common/resource';
import { WorkingCopyEditorInput } from '../../common/editor_input';
import type { SceneEditorTabId } from '../../ui/tab/id';
import type { WorkbenchTreeState } from '../../ui/tree_view';
import { createWorkbenchActionBar } from '../../ui/action_bar';
import type { SceneOutlineElement } from './outline';
import type { FullWidthWorkbenchLayout } from '../../common/layout';
import { WorkbenchScrollViewport } from '../../ui/scroll_viewport';
import { computeResourceTabTitle, sourceTabDescription } from '../../ui/tab/titles';
import type { SceneOptionProperty } from './option_properties';
import { SceneAuthoringContext } from './authoring_context';
import type { SceneSourceDocuments } from './source_documents';
import type { SceneSourceDocument } from './model';

export const POSITION_AXES = ['x', 'y', 'z'] as const;
export type SceneEditorSection = 'outline' | 'details';

export class SceneEditorInput extends WorkingCopyEditorInput<SceneEditorTabId, 'scene_editor'> {
	public readonly createView?: () => SceneEditorInput;
	public override canMove(): boolean { return true; }
	public readonly authoring: SceneAuthoringContext;
	public outlineDocument: SceneSourceDocument | undefined;
	public outlineRevision = -1;
	public outlineSourceVersion = -1;
	public readonly outlineRanges = new Map<SceneOutlineElement, TrackedTextRange>();
	public override getWorkingCopies(): readonly EditorTextModel[] { return this.authoring.getWorkingCopies(); }
	public section: SceneEditorSection = 'outline';
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

	public constructor(public readonly workingCopy: EditorTextModel, documents: SceneSourceDocuments,
		createView?: (source: SceneEditorInput) => SceneEditorInput) {
		super(`scene:${resourceIdentityKey(workingCopy.resource)}`, 'scene_editor', 'SCENE EDITOR', true);
		this.authoring = this.disposables.add(new SceneAuthoringContext(workingCopy, documents));
		if (createView !== undefined) this.createView = () => createView(this);
		this.sourceCaption = computeResourceTabTitle(workingCopy.resource);
		this.setLabel(this.title, sourceTabDescription(workingCopy.resource));
		this.disposables.add({ dispose: workingCopy.trackRanges(this.outlineRanges) });
	}
}
