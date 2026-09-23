import { navigationState } from '../navigation/navigation_history';
import { openGameView } from '../workbench/contrib/game_view/editor_input';
import { editorTabGroup } from '../workbench/ui/tab/group_model';
import type { HostRewind } from '../../hosts/common/rewind';
import { HostPauseReason, type HostExecutionControl } from '../../hosts/common/execution_control';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { HostAudioOutput } from '../../hosts/common/audio_output';
import type { BootService } from '../workbench/services/execution/boot';
import type { HotResumeService } from '../workbench/services/execution/hot_resume';
import type { HostClock } from '../../hosts/common/clock';
import type { LogOutput } from '../../hosts/common/log';
import type { KeyValueStorage } from '../workspace/key_value_storage';
import type { CartEditor } from '../cart_editor';
import type { EditorCommandId } from '../common/commands';
import type { EditorActionRequest } from './action_request';
import { renameController } from '../workbench/contrib/code_editor/rename/controller';
import { activeCodeEditor } from '../editor/ui/code_editor_state';
import { executeEditorSearchCommand, isEditorSearchCommand } from './search';
import { executeEditorSymbolNavigationCommand, isEditorSymbolNavigationCommand } from './symbol_navigation';
import { executeEditorViewCommand, isEditorViewCommand } from './view';
import { editorViewState } from '../editor/ui/view/state';
import { problemsPanel } from '../workbench/contrib/problems/panel/controller';
import { isActiveLuaCodeTab } from '../workbench/ui/code_tab/contexts';
import { getActiveTab, isBehaviorLensActive, isCodeTabActive, isScenarioLabActive } from '../workbench/ui/tabs';
import { executeEditorWorkspaceCommand, isEditorWorkspaceCommand } from './workspace';
import { performEditorAction } from './actions';
import { TextEditorInput } from '../workbench/common/editor_input';
import type { TextFileSaveService } from '../workbench/services/working_copy/text_file_save';
import { saveTextFileFromCommand } from './source_save';
import type { EditorTextModel } from '../editor/model/text_model';
import { resolveRuntimeLuaSource, type RuntimeSourceState } from '../runtime/sources';
import type { ScenarioRunService } from '../workbench/contrib/scenario_lab/run_service';
import type { RuntimeFaultState } from '../runtime/fault_state';
import type { RuntimeLuaTooling } from '../runtime/lua_tooling';
import type { OverlayRenderer } from '../runtime/overlay_renderer';
import type { RuntimeTaskQueue } from '../../hosts/common/runtime_task_queue';
import {
	resumeRuntimeDebugger,
	RuntimeDebuggerResumeMode,
	type RuntimeDebuggerState,
} from '../runtime/debugger_state';
import { clearExecutionStopHighlights } from '../runtime_error/navigation';
import { deactivateEditor } from '../workbench/overlay_modes';
import { inputFocus, type InputFocusTarget } from '../input/focus';

// Source-consuming commands accept the concrete control's value before dirty
// model selection, prompts or asynchronous source capture (Godot EditorData).
const SOURCE_COMMANDS = new Set<EditorCommandId>([
	'navigateBack', 'navigateForward',
	'save', 'hot-resume', 'reboot', 'runCurrentFile', 'runProject', 'scenarioLab.run', 'scenarioLab.rerun',
	'sceneEditor.removeMember', 'sceneEditor.moveMemberUp', 'sceneEditor.moveMemberDown',
	'behaviorLens.moveChildEarlier', 'behaviorLens.moveChildLater', 'behaviorLens.removeChild', 'behaviorLens.duplicateChild',
	'behaviorLens.setInitialState', 'behaviorLens.editProperty',
	'sceneEditor', 'behaviorLens', 'sceneEditor.source', 'behaviorLens.source', 'behaviorLens.details',
	'behaviorLens.preview',
	'behaviorLens.actionEffects', 'behaviorLens.stateMachines', 'behaviorLens.behaviorTrees',
]);

export class IdeCommandController {
	public constructor(
		private readonly editor: CartEditor,
		private readonly sources: RuntimeSourceState,
		private readonly fault: RuntimeFaultState,
		private readonly luaTooling: RuntimeLuaTooling,
		private readonly debuggerState: RuntimeDebuggerState,
		private readonly hotResumes: HotResumeService,
		private readonly boots: BootService,
		private readonly runtimeTasks: RuntimeTaskQueue,
		private readonly execution: HostExecutionControl,
		private readonly rewind: HostRewind,
		private readonly overlayRenderer: OverlayRenderer,
		private readonly runtime: Runtime,
		private readonly audioOutput: HostAudioOutput,
		private readonly storage: KeyValueStorage,
		private readonly clock: HostClock,
		private readonly logOutput: LogOutput,
		private readonly scenarioRuns: ScenarioRunService,
		private readonly textFileSaves: TextFileSaveService,
	) {
	}

	public get gamePlaybackState(): 'SEEKING' | 'PAUSED' | 'REPLAY' | 'LIVE' {
		if (this.rewind.seeking) return 'SEEKING';
		if (this.execution.paused || this.rewind.active && !this.rewind.playing) return 'PAUSED';
		return this.rewind.active ? 'REPLAY' : 'LIVE';
	}

	/** Shared transport for game previews; reviewing keeps the recorded future. */
	public toggleGamePlayback(): boolean {
		const playing = this.gamePlaybackState === 'PAUSED';
		if (!playing) {
			if (this.rewind.active) this.rewind.pauseSeek();
			this.execution.setPauseReason(HostPauseReason.Requested, true);
		} else if (this.rewind.active && this.rewind.positionCycles < this.runtime.history.latestCycles) {
			if (!this.rewind.playing) this.rewind.togglePlayback();
			this.execution.setPauseReason(HostPauseReason.Requested, false);
		} else {
			if (this.rewind.active) this.rewind.resumeHere();
			this.execution.requestExecution(true);
		}
		return playing;
	}

	public execute(command: EditorCommandId): void {
		const edit = inputFocus.target?.commandContext.edit;
		if (SOURCE_COMMANDS.has(command) && edit !== undefined && !edit.commit()) return;
		switch (command) {
			case 'navigateBack':
				void this.editor.navigation.goBackward();
				return;
			case 'navigateForward':
				void this.editor.navigation.goForward();
				return;
			case 'behaviorLens.moveChildEarlier':
				this.editor.behaviorLens.moveSelectedChild(-1);
				return;
			case 'behaviorLens.moveChildLater':
				this.editor.behaviorLens.moveSelectedChild(1);
				return;
			case 'sceneEditor.moveMemberUp':
				this.editor.sceneEditor.moveSelectedMember(-1);
				return;
			case 'sceneEditor.moveMemberDown':
				this.editor.sceneEditor.moveSelectedMember(1);
				return;
			case 'sceneEditor.removeMember':
				this.editor.sceneEditor.removeSelectedMember();
				return;
			case 'graph.zoomIn':
			case 'graph.zoomOut':
			case 'graph.resetZoom':
			case 'actorLab.playback':
			case 'actorLab.select':
			case 'actorLab.spawn':
			case 'actorLab.emit':
			case 'actorLab.actions':
			case 'actorLab.call':
			case 'actorLab.details':
			case 'behaviorLens.details':
			case 'behaviorLens.inspectRuntimeEffect':
			case 'behaviorLens.inspectRuntimeStateMachine':
			case 'behaviorLens.inspectRuntimeTree':
			case 'behaviorLens.inspectRegisteredDefinitions':
			case 'behaviorLens.editProperty':
			case 'scenarioLab.details':
			case 'contextMenu':
			case 'propertyInspector.source':
			case 'propertyInspector.close':
			case 'sourceEditReview.apply':
			case 'assistant.connect':
			case 'assistant.disconnect':
			case 'assistant.signIn':
			case 'assistant.cancelLogin':
			case 'assistant.signOut':
			case 'assistant.openLogin':
			case 'assistant.copyCode':
			case 'assistant.send':
			case 'assistant.stop':
			case 'assistant.review':
			case 'assistant.copy':
			case 'workspaceEditReview.apply':
			case 'workspaceEditReview.discard':
			case 'sourceEditReview.discard':
			case 'sourceEditReview.source':
			case 'undo':
			case 'redo':
			case 'behaviorLens.removeChild':
			case 'behaviorLens.duplicateChild':
			case 'behaviorLens.setInitialState':
				inputFocus.executeCommand(command);
				return;
			case 'debugEvaluation':
				this.debuggerState.plans.setControlSuspended(!this.debuggerState.plans.controlSuspended);
				if (!this.debuggerState.plans.controlSuspended) this.execution.requestExecution(false);
				return;
			case 'pause':
				if (this.execution.userPaused) {
					if (this.rewind.active) this.rewind.resumeHere();
					this.execution.requestExecution(true);
					if (!this.debuggerState.stopped) {
						deactivateEditor(this.editor, this.overlayRenderer, this.audioOutput);
					}
				} else {
					if (this.rewind.active) this.rewind.pauseSeek();
					this.execution.setPauseReason(HostPauseReason.Requested, true);
				}
				return;
			case 'gameView.playback':
				this.toggleGamePlayback();
				return;
			case 'stepFrame':
			case 'stepFrameBack':
				openGameView(this.editor.editorPanes);
				this.execution.setPauseReason(HostPauseReason.Requested, true);
				if (command === 'stepFrameBack') this.rewind.stepFrame(-1);
				else if (this.rewind.active && this.rewind.frameStepCycles(1) > this.rewind.positionCycles) {
					this.rewind.stepFrame(1);
				} else {
					if (this.rewind.active) this.rewind.resumeHere();
					this.execution.requestFrameStep();
				}
				return;
			case 'scenarioLab.run':
			case 'scenarioLab.rerun':
			case 'scenarioLab.cancel':
				this.editor.scenarioLab.executeCommand(command);
				return;
			case 'debugContinue':
			case 'debugStepInto':
			case 'debugStepOut':
			case 'debugStepOver':
				if (this.rewind.active) this.rewind.resumeHere();
				this.execution.requestExecution(command === 'debugContinue');
				resumeRuntimeDebugger(this.debuggerState,
					command === 'debugStepInto' ? RuntimeDebuggerResumeMode.StepInto
						: command === 'debugStepOut' ? RuntimeDebuggerResumeMode.StepOut
							: command === 'debugStepOver' ? RuntimeDebuggerResumeMode.StepOver
								: RuntimeDebuggerResumeMode.Continue);
				clearExecutionStopHighlights();
				deactivateEditor(this.editor, this.overlayRenderer, this.audioOutput);
				return;
		}
		if (isEditorSymbolNavigationCommand(command)) {
			executeEditorSymbolNavigationCommand(
				this.editor,
				this.luaTooling,
				command,
			);
			return;
		}
		if (isEditorSearchCommand(command)) {
			executeEditorSearchCommand(this.editor, this.sources, this.luaTooling, renameController, command);
			return;
		}
		if (isEditorViewCommand(command)) {
			executeEditorViewCommand(this.editor, this.sources, command);
			return;
		}
		if (isEditorWorkspaceCommand(command)) {
			executeEditorWorkspaceCommand(
				this.editor,
				this.sources,
				this.hotResumes,
				this.boots,
				this.execution,
				this.overlayRenderer,
				this.audioOutput,
				this.storage,
				this.clock,
				this.logOutput,
				this.textFileSaves,
				command,
			);
			return;
		}
		throw new Error(`Unhandled editor command: ${command}`);
	}

	public async executeConfirmedAction(
		request: EditorActionRequest,
		workingCopies: readonly EditorTextModel[],
		saveBeforeAction: boolean,
	): Promise<boolean> {
		if (saveBeforeAction) {
			for (let index = 0; index < workingCopies.length; index += 1) {
				const result = await saveTextFileFromCommand(this.textFileSaves, workingCopies[index], this.editor, this.sources);
				if (result.status === 'failed' || workingCopies[index].dirty) {
					return false;
				}
			}
		}
		return performEditorAction(
			this.editor,
			this.hotResumes,
			this.boots,
			this.execution,
			this.overlayRenderer,
			this.audioOutput,
			this.logOutput,
			request,
		);
	}

	public isEnabled(command: EditorCommandId, focus: InputFocusTarget | null = inputFocus.target): boolean {
		const context = focus?.commandContext;
		switch (command) {
			case 'hot-resume':
				return this.hotResumes.acceptingRequests && !this.execution.launchPending;
			case 'reboot':
				return this.boots.acceptingRequests;
			case 'runCurrentFile': {
				const resource = getActiveTab().resource;
				if (!this.boots.acceptingRequests || !this.runtimeTasks.ready || !resource || resource.domain === -1) return false;
				const source = resolveRuntimeLuaSource(this.sources, resource);
				return source !== null && source.record.program_module && !source.record.generated;
			}
			case 'runProject':
				return this.boots.acceptingRequests && this.runtimeTasks.ready
					&& this.sources.cartridgeSlots.some(cart => cart?.luaSources.can_boot_from_source);
			case 'keepEditor':
				return editorTabGroup.previewTab !== null && editorTabGroup.previewTab === editorTabGroup.activeTab;
			case 'navigateBack':
				return navigationState.captureSuspendDepth === 0 && navigationState.back.length > 0;
			case 'navigateForward':
				return navigationState.captureSuspendDepth === 0 && navigationState.forward.length > 0;
			case 'behaviorLens.moveChildEarlier':
				return this.editor.behaviorLens.canMoveSelectedChild(-1);
			case 'behaviorLens.moveChildLater':
				return this.editor.behaviorLens.canMoveSelectedChild(1);
			case 'sceneEditor.moveMemberUp':
				return this.editor.sceneEditor.canMoveSelectedMember(-1);
			case 'sceneEditor.moveMemberDown':
				return this.editor.sceneEditor.canMoveSelectedMember(1);
			case 'sceneEditor.removeMember':
				return this.editor.sceneEditor.canRemoveSelectedMember();
			case 'graph.zoomIn':
			case 'graph.zoomOut':
			case 'graph.resetZoom':
			case 'actorLab.playback':
			case 'actorLab.select':
			case 'actorLab.spawn':
			case 'actorLab.emit':
			case 'actorLab.actions':
			case 'actorLab.call':
			case 'actorLab.details':
			case 'behaviorLens.details':
			case 'behaviorLens.inspectRuntimeEffect':
			case 'behaviorLens.inspectRuntimeStateMachine':
			case 'behaviorLens.inspectRuntimeTree':
			case 'behaviorLens.inspectRegisteredDefinitions':
			case 'behaviorLens.editProperty':
			case 'scenarioLab.details':
			case 'contextMenu':
			case 'propertyInspector.source':
			case 'propertyInspector.close':
			case 'sourceEditReview.apply':
			case 'assistant.connect':
			case 'assistant.disconnect':
			case 'assistant.signIn':
			case 'assistant.cancelLogin':
			case 'assistant.signOut':
			case 'assistant.openLogin':
			case 'assistant.copyCode':
			case 'assistant.send':
			case 'assistant.stop':
			case 'assistant.review':
			case 'assistant.copy':
			case 'workspaceEditReview.apply':
			case 'workspaceEditReview.discard':
			case 'sourceEditReview.discard':
			case 'sourceEditReview.source':
			case 'undo':
			case 'redo':
			case 'behaviorLens.removeChild':
			case 'behaviorLens.duplicateChild':
			case 'behaviorLens.setInitialState': {
				const implementation = context?.getCommand(command);
				return implementation !== undefined && implementation.isEnabled();
			}
			case 'debugEvaluation':
				return this.runtimeTasks.ready && this.debuggerState.plans.workbenchControlActive && this.fault.faultSnapshot === null;
			case 'pause':
				return !this.execution.userPaused || this.runtimeTasks.mutationReady;
			case 'stepFrame':
			case 'stepFrameBack':
			case 'gameView.playback':
				return this.runtimeTasks.ready && !this.execution.frameStepPending
					&& !this.fault.hostFrameFailed && this.fault.faultSnapshot === null
					&& !this.debuggerState.stopped && !this.debuggerState.plans.controlActive
					&& !this.scenarioRuns.active && !this.rewind.seeking
					&& (command !== 'stepFrameBack' || this.rewind.available && this.rewind.frameStepCycles(-1) < this.rewind.positionCycles);
			case 'scenarioLab.run':
			case 'scenarioLab.rerun':
			case 'scenarioLab.cancel':
				return this.editor.scenarioLab.isCommandEnabled(command);
			case 'debugContinue':
				return this.runtimeTasks.ready && this.debuggerState.stopped;
			case 'debugStepInto':
			case 'debugStepOver':
				return this.runtimeTasks.ready && !this.rewind.seeking && this.debuggerState.stopped;
			case 'debugStepOut':
				return this.runtimeTasks.ready && !this.rewind.seeking && this.debuggerState.stopped
					&& (this.debuggerState.stopInlineDepth > 0
						|| this.runtime.machine.cpu.getFrameDepth() > 1);
			case 'save': {
				const activeInput = getActiveTab();
				return this.textFileSaves.acceptingSaves && activeInput instanceof TextEditorInput
					&& (activeInput.canSave() || !activeInput.readOnly && context?.edit?.pending === true);
			}
			case 'symbolSearch':
			case 'symbolSearchGlobal':
			case 'referenceSearch':
			case 'goToDefinition':
			case 'callHierarchy':
				return isActiveLuaCodeTab();
			case 'scenarioLab':
			case 'behaviorLens':
			case 'behaviorLens.preview':
			case 'behaviorLens.actionEffects':
			case 'behaviorLens.stateMachines':
			case 'behaviorLens.behaviorTrees':
			case 'sceneEditor':
			case 'gameView':
				return true;
			case 'sceneEditor.source':
				return getActiveTab().kind === 'scene_editor';
			case 'behaviorLens.source':
				return getActiveTab().kind === 'behavior_lens';
			case 'rename':
			case 'renamePreview':
				return isActiveLuaCodeTab() && !activeCodeEditor.model.readOnly;
			case 'findGlobal':
			case 'findLocal':
			case 'lineJump':
			case 'wrap':
				return isCodeTabActive();
			case 'filter':
				return this.editor.resourcePanel.isVisible()
					&& this.editor.resourcePanel.getMode() === 'resources';
			default:
				return true;
		}
	}

	public isActive(command: EditorCommandId): boolean {
		switch (command) {
			case 'debugEvaluation':
				return this.debuggerState.plans.controlSuspended;
			case 'pause':
				return this.execution.userPaused;
			case 'resources':
				return this.editor.resourcePanel.isVisible();
			case 'problems':
				return problemsPanel.isVisible;
			case 'behaviorLens':
				return isBehaviorLensActive();
			case 'scenarioLab':
				return isScenarioLabActive();
			case 'filter':
				return this.editor.resourcePanel.getFilterMode() === 'lua_only';
			case 'wrap':
				return editorViewState.wordWrapEnabled;
			default:
				return false;
		}
	}
}
