import { openCreateResourcePrompt } from '../workbench/contrib/resources/create';
import { chooseBuild, showBuildJobs } from '../workbench/contrib/builds/commands';
import { createCartridge } from '../workbench/contrib/projects/commands';
import { importCartridgeFiles } from '../workbench/contrib/resources/import';
import type { RuntimeDebuggerExecution } from '../runtime/debugger_execution';
import { executeClipboardAction } from '../input/clipboard';
import type { RuntimeFrameNavigation } from '../runtime/frame_navigation';
import { navigationState } from '../navigation/navigation_history';
import { openGameView } from '../workbench/contrib/game_view/editor_input';
import { editorTabGroup } from '../workbench/ui/tab/group_model';
import { editorChromeState } from '../workbench/ui/chrome_state';
import type { HostRewind } from '../../hosts/common/rewind';
import { HostPauseReason, type HostExecutionControl } from '../../hosts/common/execution_control';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { HostAudioOutput } from '../../hosts/common/audio_output';
import type { BootService } from '../workbench/services/execution/boot';
import type { HotResumeService } from '../workbench/services/execution/hot_resume';
import type { HostClock } from '../../hosts/common/clock';
import type { LogOutput } from '../../hosts/common/log';
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
import type { ScenarioRunService } from '../workbench/services/testing/scenario_runs';
import type { RuntimeFaultState } from '../runtime/fault_state';
import type { RuntimeLuaTooling } from '../runtime/lua_tooling';
import type { OverlayRenderer } from '../runtime/overlay_renderer';
import type { RuntimeTaskQueue } from '../../hosts/common/runtime_task_queue';
import {
	resumeRuntimeDebugger, RuntimeDebuggerResumeMode,
	type RuntimeDebuggerState,
} from '../runtime/debugger_state';
import { clearExecutionStopHighlights } from '../runtime_error/navigation';
import { deactivateEditor } from '../workbench/overlay_modes';
import { inputFocus, type InputFocusTarget } from '../input/focus';
import { showServerConnection } from '../workbench/contrib/server/connection';
import { openObservedConversation } from '../workbench/contrib/conversations/quick_access';
import { getTextFileRuntimeSourceStatus } from '../workbench/services/working_copy/runtime_source_status';

// Source-consuming commands accept the concrete control's value before dirty
// model selection, prompts or asynchronous source capture (Godot EditorData).
const SOURCE_COMMANDS = new Set<EditorCommandId>([
	'navigateBack', 'navigateForward',
	'save', 'hot-resume', 'reboot', 'runCurrentFile', 'runProject', 'scenarioLab.run', 'scenarioLab.rerun', 'scenarioLab.debug',
	'sceneEditor.removeMember', 'sceneEditor.moveMemberUp', 'sceneEditor.moveMemberDown',
	'behaviorLens.moveChildEarlier', 'behaviorLens.moveChildLater', 'behaviorLens.removeChild', 'behaviorLens.duplicateChild',
	'behaviorLens.setInitialState', 'behaviorLens.editProperty',
	'progression.createProgram', 'input.createBindings', 'behaviorLens.createEffect',
	'aem', 'aem.edit', 'aem.add', 'aem.remove', 'aem.source', 'aem.testEvent',
	'luaProgram.edit', 'luaProgram.add', 'luaProgram.remove', 'luaProgram.source', 'progression', 'inputBindings',
	'luaProgram.live', 'luaProgram.authoring', 'luaProgram.testInput', 'input.testActionString',
	'behaviorLens.addProperty', 'behaviorLens.removeProperty',
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
		private readonly clock: HostClock,
		private readonly logOutput: LogOutput,
		private readonly scenarioRuns: ScenarioRunService,
		private readonly textFileSaves: TextFileSaveService,
		private readonly frameNavigation: RuntimeFrameNavigation,
		private readonly debuggerExecution: RuntimeDebuggerExecution,
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

	public execute(command: EditorCommandId, target: InputFocusTarget | null = inputFocus.target): void {
		// Committing the focused draft and choosing an action's target are distinct.
		// Pointer actions retain field focus but invoke their own explicit context.
		const edit = inputFocus.target?.commandContext.edit;
		if (SOURCE_COMMANDS.has(command) && edit !== undefined && !edit.commit()) return;
		switch (command) {
			case 'copy': case 'cut': case 'paste':
				void executeClipboardAction(this.editor.clipboard, command, this.editor.clipboardTarget);
				return;
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
			case 'assistant.signIn':
			case 'assistant.cancelLogin':
			case 'assistant.signOut':
			case 'assistant.openLogin':
			case 'assistant.copyCode':
			case 'assistant.history':
			case 'assistant.new':
			case 'assistant.commands':
			case 'assistant.stop':
				this.editor.assistantCommands.execute(command);
				return;
			case 'aem.testEvent': {
				const input = getActiveTab()!;
				if (input.kind === 'aem_editor') {
					const property = input.tree.rows[input.tree.selectionIndex].element;
					this.editor.actorLab.auditionEvent(input.workingCopy.resource.domain, property.path[1] as string);
				}
				return;
			}
			case 'input.testActionString': this.editor.actionStrings.open(this.sources.activeCartridgeSlot); return;
			case 'behaviorLens.testEffect': { const input = getActiveTab()!; if (input.kind === 'behavior_lens') this.editor.actorLab.testEffect(input.workingCopy.resource.domain); return; }
			case 'progression.createProgram': openCreateResourcePrompt(this.editor, this.sources, this.clock, 'progression'); return;
			case 'input.createBindings': openCreateResourcePrompt(this.editor, this.sources, this.clock, 'input'); return;
			case 'behaviorLens.createEffect': openCreateResourcePrompt(this.editor, this.sources, this.clock, 'action_effect'); return;
			case 'builds.start': void chooseBuild(this.editor); return;
			case 'projects.createCartridge': createCartridge(this.editor); return;
			case 'resources.import': importCartridgeFiles(this.editor, this.sources); return;
			case 'builds.jobs': showBuildJobs(this.editor); return;
			case 'server.connection':
				showServerConnection(this.editor);
				return;
			case 'conversations.history':
				openObservedConversation(this.editor.editorPanes, this.editor.observedConversation, this.editor.quickInput);
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
			case 'actorLab.stateGraph': case 'actorLab.outline':
			case 'behaviorLens.details':
			case 'behaviorLens.more':
			case 'behaviorLens.inspectRuntimeEffect':
			case 'behaviorLens.inspectRuntimeStateMachine':
			case 'behaviorLens.inspectRuntimeTree':
			case 'behaviorLens.inspectRegisteredDefinitions':
			case 'aem.edit': case 'aem.add': case 'aem.remove': case 'aem.source':
			case 'luaProgram.edit': case 'luaProgram.add': case 'luaProgram.remove': case 'luaProgram.source':
			case 'luaProgram.live': case 'luaProgram.authoring': case 'luaProgram.selectInstance': case 'luaProgram.more': case 'luaProgram.testInput':
			case 'behaviorLens.editProperty':
			case 'behaviorLens.addProperty': case 'behaviorLens.removeProperty':
			case 'scenarioLab.details':
			case 'scenarioLab.inspectTarget':
			case 'scenarioLab.inspectStop':
			case 'scenarioLab.closeTarget':
			case 'contextMenu':
			case 'propertyInspector.source':
			case 'propertyInspector.close':
			case 'sourceEditReview.apply':
			case 'conversations.older':
			case 'terminal.evaluate':
			case 'terminal.context':
			case 'terminal.pause':
			case 'terminal.continue':
			case 'terminal.clear':
			case 'terminal.copy':
			case 'assistant.send':
			case 'assistant.queue':
			case 'assistant.direct':
			case 'assistant.review':
			case 'assistant.copy':
			case 'workspaceEditReview.apply':
			case 'workspaceEditReview.discard':
			case 'sourceEditReview.discard':
			case 'sourceEditReview.source':
			case 'undo':
			case 'redo':
			case 'suggest.accept':
			case 'behaviorLens.removeChild':
			case 'behaviorLens.duplicateChild':
			case 'behaviorLens.setInitialState':
				inputFocus.executeCommand(command, target);
				return;
			case 'debugEvaluation':
				if (this.debuggerState.plans.controlSuspended && this.debuggerState.source.stop !== undefined) {
					resumeRuntimeDebugger(this.debuggerState, RuntimeDebuggerResumeMode.Continue);
					clearExecutionStopHighlights();
				} else this.debuggerState.plans.setControlSuspended(!this.debuggerState.plans.controlSuspended);
				if (!this.debuggerState.plans.controlSuspended) this.execution.requestExecution(false);
				return;
			case 'tabs.scrollLeft': case 'tabs.scrollRight':
				editorChromeState.tabScrollbar.setScroll(editorChromeState.tabScrollbar.getScroll()
					+ (command === 'tabs.scrollLeft' ? -1 : 1) * editorChromeState.tabViewportBounds.right * 0.75);
				return;
			case 'pause':
				if (inputFocus.getCommand(command, target) !== undefined) { inputFocus.executeCommand(command, target); return; }
				if (this.execution.userPaused) {
					if (this.rewind.active) this.rewind.resumeHere();
					this.execution.requestExecution(true);
					if (this.debuggerState.source.stop === undefined) {
						deactivateEditor(this.editor, this.overlayRenderer, this.audioOutput);
					}
				} else {
					if (this.rewind.active) this.rewind.pauseSeek();
					this.execution.setPauseReason(HostPauseReason.Requested, true);
				}
				return;
			case 'runtime.pause':
				inputFocus.executeCommand(command, target);
				if (this.rewind.active) this.rewind.pauseSeek();
				this.execution.setPauseReason(HostPauseReason.Requested, true);
				return;
			case 'runtime.present':
				this.execute('runtime.pause', target);
				this.rewind.returnToPresent();
				return;
			case 'runtime.resume':
				inputFocus.executeCommand(command, this.editor.editorPanes.activePane!.runtimeControlContext!);
				this.rewind.resumeHere();
				this.execution.requestExecution(true);
				return;
			case 'gameView.playback':
				this.toggleGamePlayback();
				return;
			case 'gameView.togglePanel': this.editor.gamePanel.toggle(); return;
			case 'gameView.closePanel': this.editor.gamePanel.close(); return;
			case 'stepFrame':
			case 'stepFrameBack':
				if (inputFocus.getCommand(command, target) !== undefined) { inputFocus.executeCommand(command, target); return; }
				openGameView(this.editor.editorPanes);
				this.frameNavigation.step(command === 'stepFrameBack' ? -1 : 1);
				return;
			case 'scenarioLab.debug':
			case 'scenarioLab.continue': case 'scenarioLab.stepInto': case 'scenarioLab.stepOver':
			case 'scenarioLab.stepOut': case 'scenarioLab.pause': case 'scenarioLab.breakpoints':
			case 'scenarioLab.run':
			case 'scenarioLab.revealRun':
			case 'scenarioLab.rerun':
			case 'scenarioLab.cancel':
				this.editor.scenarioLab.executeCommand(command);
				return;
			case 'debugContinue':
			case 'debugStepInto':
			case 'debugStepOut':
			case 'debugStepOver':
				this.debuggerExecution.resume(command === 'debugStepInto' ? 'into' : command === 'debugStepOut' ? 'out'
					: command === 'debugStepOver' ? 'over' : 'continue', 'game');
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
			case 'assistant': return this.editor.assistant.available;
			case 'conversations': return this.editor.observedConversation.available;
			case 'copy': case 'cut': case 'paste':
				return focus?.clipboard?.[command] !== undefined && (command === 'copy' || !focus.clipboard.readOnly)
					&& (command !== 'paste' || this.editor.clipboard.canRead);
			case 'hot-resume':
				return this.hotResumes.acceptingRequests && !this.execution.launchPending;
			case 'reboot':
				return this.boots.acceptingRequests;
			case 'runCurrentFile': {
				const resource = getActiveTab()?.resource;
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
			case 'assistant.signIn':
			case 'assistant.cancelLogin':
			case 'assistant.signOut':
			case 'assistant.openLogin':
			case 'assistant.copyCode':
			case 'assistant.history':
			case 'assistant.new':
			case 'assistant.commands':
			case 'assistant.stop':
				return this.editor.assistantCommands.isEnabled(command);
			case 'builds.start': return this.editor.builds !== undefined;
			case 'progression.createProgram': case 'input.createBindings': case 'behaviorLens.createEffect': return this.isEnabled('createResource');
			case 'projects.createCartridge': return this.editor.projects !== undefined;
			case 'resources.import': return this.editor.importFiles !== undefined
				&& (this.sources.cartridgeSlots[0] !== null || this.sources.cartridgeSlots[1] !== null);
			case 'builds.jobs': return this.editor.builds !== undefined;
			case 'server.connection': return true;
			case 'conversations.history':
				return this.editor.observedConversation.available && !this.editor.observedConversation.pending;
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
			case 'actorLab.stateGraph': case 'actorLab.outline':
			case 'behaviorLens.details':
			case 'behaviorLens.more':
			case 'behaviorLens.inspectRuntimeEffect':
			case 'behaviorLens.inspectRuntimeStateMachine':
			case 'behaviorLens.inspectRuntimeTree':
			case 'behaviorLens.inspectRegisteredDefinitions':
			case 'aem.edit': case 'aem.add': case 'aem.remove': case 'aem.source':
			case 'luaProgram.edit': case 'luaProgram.add': case 'luaProgram.remove': case 'luaProgram.source':
			case 'luaProgram.live': case 'luaProgram.authoring': case 'luaProgram.selectInstance': case 'luaProgram.more': case 'luaProgram.testInput':
			case 'behaviorLens.editProperty':
			case 'behaviorLens.addProperty': case 'behaviorLens.removeProperty':
			case 'scenarioLab.details':
			case 'scenarioLab.inspectTarget':
			case 'scenarioLab.inspectStop':
			case 'scenarioLab.closeTarget':
			case 'contextMenu':
			case 'propertyInspector.source':
			case 'propertyInspector.close':
			case 'sourceEditReview.apply':
			case 'conversations.older':
			case 'terminal.evaluate':
			case 'terminal.context':
			case 'terminal.pause':
			case 'terminal.continue':
			case 'terminal.clear':
			case 'terminal.copy':
			case 'assistant.send':
			case 'assistant.queue':
			case 'assistant.direct':
			case 'assistant.review':
			case 'assistant.copy':
			case 'workspaceEditReview.apply':
			case 'workspaceEditReview.discard':
			case 'sourceEditReview.discard':
			case 'sourceEditReview.source':
			case 'undo':
			case 'redo':
			case 'suggest.accept':
			case 'behaviorLens.removeChild':
			case 'behaviorLens.duplicateChild':
			case 'behaviorLens.setInitialState': {
				const implementation = context?.getCommand(command);
				return implementation !== undefined && implementation.isEnabled();
			}
			case 'debugEvaluation':
				return this.runtimeTasks.ready && this.debuggerState.plans.workbenchControlActive && this.fault.faultSnapshot === null;
			case 'tabs.scrollLeft': return editorChromeState.tabScrollbar.getScroll() > 0;
			case 'tabs.scrollRight': return editorChromeState.tabScrollbar.getScroll() < editorChromeState.tabScrollbar.getMaximumScroll();
			case 'openEditors': return editorTabGroup.tabs.length > 0;
			case 'pause':
				if (context?.getCommand(command) !== undefined) return context.getCommand(command)!.isEnabled();
				return !this.execution.userPaused || this.runtimeTasks.mutationReady;
			case 'stepFrame':
			case 'stepFrameBack':
				if (context?.getCommand(command) !== undefined) return context.getCommand(command)!.isEnabled();
				return this.frameNavigation.canStep(command === 'stepFrameBack' ? -1 : 1);
			case 'runtime.pause': return this.runtimeTasks.ready;
			case 'runtime.present':
			case 'runtime.resume':
				return this.editor.editorPanes.activePane?.runtimeControlContext !== undefined && this.rewind.active
					&& this.frameNavigation.active === undefined && this.isEnabled('gameView.playback', focus);
			case 'gameView.togglePanel': return this.editor.isActive;
			case 'gameView.closePanel': return this.editor.gamePanel.visible;
			case 'gameView.playback':
				return this.runtimeTasks.ready && !this.execution.frameStepPending
					&& !this.fault.hostFrameFailed && this.fault.faultSnapshot === null
					&& this.debuggerState.source.stop === undefined && !this.debuggerState.plans.controlActive
					&& !this.scenarioRuns.active && !this.rewind.seeking;
			case 'scenarioLab.debug':
			case 'scenarioLab.continue': case 'scenarioLab.stepInto': case 'scenarioLab.stepOver':
			case 'scenarioLab.stepOut': case 'scenarioLab.pause': case 'scenarioLab.breakpoints':
			case 'scenarioLab.run':
			case 'scenarioLab.revealRun':
			case 'scenarioLab.rerun':
			case 'scenarioLab.cancel':
				return this.editor.scenarioLab.isCommandEnabled(command);
			case 'debugContinue':
				return this.debuggerState.source.stop !== undefined && this.debuggerExecution.canResume('continue');
			case 'debugStepInto':
			case 'debugStepOver':
			case 'debugStepOut':
				return this.debuggerExecution.canResume(command === 'debugStepInto' ? 'into' : command === 'debugStepOver' ? 'over' : 'out');
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
			case 'aem.testEvent': {
				const input = getActiveTab();
				if (input?.kind !== 'aem_editor') return false;
				const property = input.tree.rows[input.tree.selectionIndex]?.element;
				return property !== undefined && property.path[0] === 'events' && property.path.length >= 2
					&& getTextFileRuntimeSourceStatus(this.sources, input.workingCopy) === 'applied'
					&& this.editor.actorLab.canInteract(input.workingCopy.resource.domain);
			}
			case 'aem': return true;
			case 'input.testActionString': return this.editor.actionStrings.canStart(this.sources.activeCartridgeSlot);
			case 'behaviorLens.testEffect': {
				const input = getActiveTab();
				return input?.kind === 'behavior_lens' && input.view.presentation.kind === 'properties'
					&& this.editor.actorLab.canInteract(input.workingCopy.resource.domain);
			}
			case 'progression': case 'inputBindings':
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
				return getActiveTab()?.kind === 'scene_editor';
			case 'behaviorLens.source':
				return getActiveTab()?.kind === 'behavior_lens';
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
