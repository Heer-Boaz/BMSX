import type { EditorDocumentContextId } from '../../../common/editor_context';

export type CodeEditorTabId = EditorDocumentContextId;
export type ResourceViewerTabId = `resource:${string}`;
export type BehaviorLensTabId = `behavior:${string}`;
export type EditorTabId = CodeEditorTabId | ResourceViewerTabId | BehaviorLensTabId;
