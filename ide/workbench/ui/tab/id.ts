import type { CodeEditorInputId } from '../../../common/editor_context';

export type CodeEditorTabId = CodeEditorInputId;
export type ResourceViewerTabId = `resource:${string}`;
export type BehaviorLensTabId = `behavior:${string}`;
export type ScenarioLabTabId = 'scenario-lab';
export type EditorTabId = CodeEditorTabId | ResourceViewerTabId | BehaviorLensTabId | ScenarioLabTabId;
