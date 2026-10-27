import type { CodeEditorInputId } from '../../../common/editor_context';
import { resourceIdentityKey, type ResourceIdentity } from '../../../common/resource';

/** Logical Source matching key within an editor group, not a live view identity. */
export function buildCodeTabId(resource: ResourceIdentity): CodeEditorTabId {
	return `code:${resourceIdentityKey(resource)}`;
}

export type CodeEditorTabId = CodeEditorInputId;
export type ResourceViewerTabId = `resource:${string}`;
export type BehaviorLensTabId = `behavior:${string}`;
export type ScenarioLabTabId = 'scenario-lab';
export type BuildLogTabId = `build-log:${string}`;
export type SceneEditorTabId = `scene:${string}`;
export type ActorLabTabId = 'actor-lab' | `actor-lab:${string}`;
export type GameViewTabId = `game-view:${number}`;
export type EventViewerTabId = `events:${number}`;
export type GteDebuggerTabId = `gte-debugger:${number}`;
export type GpuDebuggerTabId = `gpu-debugger:${number}`;
export type EditorTabId = 'home' | BuildLogTabId | 'play-session' | `animation:${string}` | 'host-error' | `rom-inspector:${number}` | `map:${string}` | EventViewerTabId | GteDebuggerTabId | GpuDebuggerTabId | `aem:${string}` | `program:${string}` | CodeEditorTabId | ResourceViewerTabId | BehaviorLensTabId | ScenarioLabTabId | SceneEditorTabId | 'terminal' | ActorLabTabId | GameViewTabId | 'assistant' | 'codex-conversations' | `edit-review:${number}`;
