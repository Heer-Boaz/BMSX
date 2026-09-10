import type { BehaviorLensInput } from '../../contrib/behavior_lens/editor_input';
import type { CodeEditorInput } from '../../contrib/code_editor/editor_input';
import type { ResourceViewerInput } from '../../contrib/resources/editor_input';
import type { ScenarioLabInput } from '../../contrib/scenario_lab/editor_input';
import type { SceneEditorInput } from '../../contrib/scene_editor/editor_input';
import type { EditorTabId } from './id';

export type EditorInput =
	| CodeEditorInput
	| ResourceViewerInput
	| BehaviorLensInput
	| ScenarioLabInput
	| SceneEditorInput;

export type EditorInputKind = EditorInput['kind'];

export type {
	BehaviorLensInput,
	CodeEditorInput,
	ResourceViewerInput,
	ScenarioLabInput,
	SceneEditorInput,
};

export type TabDragState = {
	tabId: EditorTabId;
	startX: number;
	startY: number;
	hasDragged: boolean;
	pointerTime: number;
	revision: number;
	targetIndex: number;
	markerX: number;
};
