import type { ResourceViewerState } from '../../contrib/resources/model';
import type { BehaviorLensViewState } from '../../contrib/behavior_lens/view_model';
import type { ScenarioLabViewState } from '../../contrib/scenario_lab/view_model';
import type { CodeTabContext } from '../code_tab/model';
import type {
	BehaviorLensTabId,
	CodeEditorTabId,
	EditorTabId,
	ResourceViewerTabId,
	ScenarioLabTabId,
} from './id';

export type EditorTabKind = 'code_editor' | 'resource_view' | 'behavior_lens' | 'scenario_lab';

type EditorTabBase<TId extends EditorTabId, TKind extends EditorTabKind> = {
	id: TId;
	kind: TKind;
	title: string;
	closable: boolean;
};

export type CodeEditorTabDescriptor = EditorTabBase<CodeEditorTabId, 'code_editor'> & {
	context: CodeTabContext;
};

export type ResourceViewerTabDescriptor = EditorTabBase<ResourceViewerTabId, 'resource_view'> & {
	resource: ResourceViewerState;
};

export type BehaviorLensTabDescriptor = EditorTabBase<BehaviorLensTabId, 'behavior_lens'> & {
	view: BehaviorLensViewState;
};

export type ScenarioLabTabDescriptor = EditorTabBase<ScenarioLabTabId, 'scenario_lab'> & {
	view: ScenarioLabViewState;
};

export type EditorTabDescriptor =
	| CodeEditorTabDescriptor
	| ResourceViewerTabDescriptor
	| BehaviorLensTabDescriptor
	| ScenarioLabTabDescriptor;

export function editorTabDirty(tab: EditorTabDescriptor): boolean {
	return tab.kind === 'code_editor' && tab.context.model.dirty;
}

export type TabDragState = {
	tabId: EditorTabId;
	pointerOffset: number;
	startX: number;
	hasDragged: boolean;
};
