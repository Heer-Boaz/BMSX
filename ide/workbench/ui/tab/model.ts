import type { HomeInput } from '../../contrib/home/editor_input';
import type { AnimationEditorInput } from '../../contrib/animation/editor_input';
import type { PlayEditorInput } from '../../contrib/play/editor_input';
import type { HostErrorInput } from '../../contrib/host_error/editor_input';
import type { BuildLogInput } from '../../contrib/builds/editor_input';
import type { RomInspectorInput } from '../../contrib/rom_inspector/editor_input';
import type { CartMapInput } from '../../contrib/cart_maps/editor_input';
import type { EventViewerInput } from '../../contrib/events/editor_input';
import type { GpuDebuggerInput } from '../../contrib/gpu_debugger/editor_input';
import type { GteDebuggerInput } from '../../contrib/gte_debugger/editor_input';
import type { AemEditorInput } from '../../contrib/aem/editor_input';
import type { LuaProgramInput } from '../../contrib/lua_program/editor_input';
import type { ConversationObserverInput } from '../../contrib/conversations/editor_input';
import type { AssistantInput } from '../../contrib/assistant/editor_input';
import type { TerminalInput } from '../../contrib/terminal/editor_input';
import type { BehaviorLensInput } from '../../contrib/behavior_lens/editor_input';
import type { CodeEditorInput } from '../../contrib/code_editor/editor_input';
import type { ResourceViewerInput } from '../../contrib/resources/editor_input';
import type { ScenarioLabInput } from '../../contrib/scenario_lab/editor_input';
import type { SceneEditorInput } from '../../contrib/scene_editor/editor_input';
import type { EditorTabId } from './id';
import type { ActorLabInput } from '../../contrib/actor_lab/editor_input';
import type { GameViewInput } from '../../contrib/game_view/editor_input';
import type { WorkspaceEditReviewInput } from '../../contrib/edit_review/editor_input';

export type EditorInput =
	| HomeInput
	| PlayEditorInput
	| AnimationEditorInput
	| HostErrorInput
	| BuildLogInput
	| RomInspectorInput
	| EventViewerInput
	| GteDebuggerInput
	| GpuDebuggerInput
	| ConversationObserverInput
	| TerminalInput
	| CodeEditorInput
	| ResourceViewerInput
	| BehaviorLensInput
	| ScenarioLabInput
	| ActorLabInput
	| GameViewInput
	| AssistantInput
	| WorkspaceEditReviewInput
	| SceneEditorInput
	| CartMapInput
	| LuaProgramInput
	| AemEditorInput;

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
	pointerX: number;
	pointerY: number;
	pointerTime: number;
	revision: number;
	targetDirty: boolean;
	targetLayoutRevision: number;
	targetScroll: number;
	targetIndex: number;
	markerX: number;
};
