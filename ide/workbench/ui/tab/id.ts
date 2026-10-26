import type { CodeEditorInputId } from '../../../common/editor_context';

export type CodeEditorTabId = CodeEditorInputId;
export type ResourceViewerTabId = `resource:${string}`;
export type BehaviorLensTabId = `behavior:${string}`;
export type ScenarioLabTabId = 'scenario-lab';
export type BuildLogTabId = `build-log:${string}`;
export type SceneEditorTabId = `scene:${string}`;
export type ActorLabTabId = 'actor-lab' | `actor-lab:${string}`;
export type EditorTabId = 'home' | BuildLogTabId | 'play-session' | `animation:${string}` | 'host-error' | `rom-inspector:${number}` | `map:${string}` | 'events' | 'gte-debugger' | 'gpu-debugger' | `aem:${string}` | `program:${string}` | CodeEditorTabId | ResourceViewerTabId | BehaviorLensTabId | ScenarioLabTabId | SceneEditorTabId | 'terminal' | ActorLabTabId | 'game-view' | 'assistant' | 'codex-conversations' | `edit-review:${number}`;
