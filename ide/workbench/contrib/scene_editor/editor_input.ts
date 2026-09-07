import { create_rect_bounds } from '../../../../machine/ts/common/rect';
import type { LuaTableField } from '../../../../toolchain/ts/lua/syntax/ast';
import type { EditorTextModel } from '../../../editor/model/text_model';
import { resourceIdentityKey } from '../../../common/resource';
import { WorkingCopyEditorInput } from '../../common/editor_input';
import type { SceneEditorTabId } from '../../ui/tab/id';
import type { WorkbenchListState } from '../../ui/list_view';
import { createWorkbenchActionBar } from '../../ui/action_bar';
import type { SceneSourceEntry } from './model';
import type { FullWidthWorkbenchLayout } from '../../common/layout';

export const POSITION_AXES = ['x', 'y', 'z'] as const;

export type SceneMemberRow = {
	sourceId: string;
	sceneLabel: string;
	label: string;
	displayLabel: string;
	definition: string;
	entry: SceneSourceEntry;
};

export class SceneEditorInput extends WorkingCopyEditorInput<SceneEditorTabId, 'scene_editor'> {
	public version = 0;
	public partial = false;
	public sceneText = '';
	public definitionText = '';
	public readonly members: WorkbenchListState<SceneMemberRow> = {
		rows: [], selectionIndex: -1, scroll: 0, hoverIndex: -1,
		layout: { contentLeft: 0, contentTop: 0, contentRight: 0, contentBottom: 0, rowHeight: 0, visibleRowCount: 0 },
	};
	public readonly actionBar = createWorkbenchActionBar('sceneEditor.title');
	public readonly properties = POSITION_AXES.map(axis => ({
		axis, label: axis.toUpperCase(), field: null as LuaTableField | null,
		value: null as number | null, sourceText: '', text: '', bounds: create_rect_bounds(),
	}));
	public readonly layout: FullWidthWorkbenchLayout & { detailsLeft: number } = {
		left: 0, top: 0, right: 0, bottom: 0, rowHeight: 0, font: null,
		viewportWidth: -1, viewportHeight: -1, codeAreaTop: -1, codeAreaBottom: -1,
		detailsLeft: 0,
	};

	public constructor(public readonly workingCopy: EditorTextModel, sourceTitle: string) {
		super(`scene:${resourceIdentityKey(workingCopy.resource)}`, 'scene_editor', `SCENE ${sourceTitle}`, true);
	}
}
