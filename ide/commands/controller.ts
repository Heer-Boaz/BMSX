import { findEditorGroup } from '../workbench/services/editor/editor_group';
import { openCreateResourcePrompt } from '../workbench/contrib/resources/create';
import { chooseBuild, showBuildJobs } from '../workbench/contrib/builds/commands';
import { createCartridge } from '../workbench/contrib/projects/commands';
import { importCartridgeFiles } from '../workbench/contrib/resources/import';
import type { RuntimeDebuggerExecution } from '../runtime/debugger_execution';
import { executeClipboardAction } from '../input/clipboard';
import type { RuntimeFrameNavigation } from '../runtime/frame_navigation';
import { RuntimeTransport } from '../runtime/transport';
import { navigationState } from '../navigation/navigation_history';
import { openGameView } from '../workbench/contrib/game_view/editor_input';
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
import { executeEditorSearchCommand, isEditorSearchCommand } from './search';
import { executeEditorViewCommand, isEditorViewCommand } from './view';
import { problemsPanel } from '../workbench/contrib/problems/panel/controller';
import { executeEditorWorkspaceCommand, isEditorWorkspaceCommand } from './workspace';
import { performEditorAction } from './actions';
import { TextEditorInput } from '../workbench/common/editor_input';
import type { TextFileSaveService } from '../workbench/services/working_copy/text_file_save';
import { saveTextFileFromCommand } from './source_save';
import type { EditorTextModel } from '../editor/model/text_model';
import { type RuntimeSourceState } from '../runtime/sources';
import type { ScenarioRunService } from '../workbench/services/testing/scenario_runs';
import type { RuntimeFaultState } from '../runtime/fault_state';
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
import { CARTRIDGE_RESOURCE_DOMAINS, SYSTEM_RESOURCE_DOMAIN, type ResourceDomain } from '../common/resource';
import { TextQuickPickProvider } from '../workbench/services/quick_input/text_provider';
import type { Blua32SourceImage } from '../runtime/sources';
import { getTextFileRuntimeSourceInstallations } from '../workbench/services/working_copy/runtime_source_status';

// Source-consuming commands accept the concrete control's value before dirty
// model selection, prompts or asynchronous source capture (Godot EditorData).
const SOURCE_COMMANDS = new Set<EditorCommandId>([
	'tabs.next', 'tabs.previous',
	'save', 'hot-resume', 'reboot', 'runCurrentFile', 'runProject', 'scenarioLab.run', 'scenarioLab.rerun', 'scenarioLab.debug',
	'scenarioLab.play', 'play.reset', 'play.source',
	'scenarioLab.runWithCompanion', 'scenarioLab.debugWithCompanion', 'scenarioLab.playWithCompanion',
	'sceneEditor.removeMember', 'sceneEditor.moveMemberUp', 'sceneEditor.moveMemberDown',
	'behaviorLens.moveChildEarlier', 'behaviorLens.moveChildLater', 'behaviorLens.removeChild', 'behaviorLens.duplicateChild',
	'behaviorLens.setInitialState', 'behaviorLens.editProperty',
	'progression.createProgram', 'input.createBindings', 'behaviorLens.createEffect',
	'animation', 'animation.create', 'animation.createSprite', 'animation.addTrack', 'animation.addKey',
	'animation.addClip', 'animation.addFrame', 'animation.addProperty', 'animation.openClip',
	'animation.duplicate', 'animation.earlier', 'animation.later', 'animation.fit', 'animation.snap',
	'animation.edit', 'animation.remove', 'animation.source', 'animation.producerSource',
	'animation.tracks', 'animation.keys', 'animation.details',
	'aem', 'aem.create', 'aem.edit', 'aem.add', 'aem.remove', 'aem.source', 'aem.apply', 'aem.testEvent',
	'luaProgram.edit', 'luaProgram.add', 'luaProgram.remove', 'luaProgram.source', 'progression', 'inputBindings',
	'luaProgram.live', 'luaProgram.authoring', 'luaProgram.testInput', 'input.testActionString',
	'behaviorLens.addProperty', 'behaviorLens.removeProperty',
	'cartMap', 'cartMap.source',
	'sceneEditor', 'behaviorLens', 'sceneEditor.source', 'behaviorLens.source', 'behaviorLens.details',
	'behaviorLens.preview',
	'behaviorLens.actionEffects', 'behaviorLens.stateMachines', 'behaviorLens.behaviorTrees',
]);

export class IdeCommandController {
	public readonly transport: RuntimeTransport;
	public constructor(
		private readonly editor: CartEditor,
		private readonly sources: RuntimeSourceState,
		private readonly fault: RuntimeFaultState,
		private readonly debuggerState: RuntimeDebuggerState,
		private readonly hotResumes: HotResumeService,
		private readonly boots: BootService,
		private readonly runtimeTasks: RuntimeTaskQueue,
		private readonly execution: HostExecutionControl,
		private readonly rewind: HostRewind,
		private readonly overlayRenderer: OverlayRenderer,
		runtime: Runtime,
		private readonly audioOutput: HostAudioOutput,
		private readonly clock: HostClock,
		private readonly logOutput: LogOutput,
		scenarioRuns: ScenarioRunService,
		private readonly textFileSaves: TextFileSaveService,
		private readonly frameNavigation: RuntimeFrameNavigation,
		private readonly debuggerExecution: RuntimeDebuggerExecution,
	) {
		this.transport = new RuntimeTransport(runtime, execution, rewind, frameNavigation, () => runtimeTasks.ready
			&& !execution.frameStepPending && fault.hostFrameFailure === undefined && fault.faultSnapshot === null
			&& debuggerState.source.stop === undefined && !debuggerState.plans.controlActive && !scenarioRuns.active);
	}
	public execute(command: EditorCommandId, target: InputFocusTarget | null = inputFocus.target): void {
		const originGroup = findEditorGroup(target);
		if (originGroup === null) return;
		const group = originGroup ?? navigationState.activeGroup ?? this.editor.editorGroup;
		const transport = group.panes.activePane?.runtimeTransport ?? this.transport;
		// Committing the focused draft and choosing an action's target are distinct.
		// Pointer actions retain field focus but invoke their own explicit context.
		if (SOURCE_COMMANDS.has(command)) {
			const focused = inputFocus.target;
			const edit = findEditorGroup(focused) === group ? focused?.edit : undefined;
			if (edit !== undefined) {
				const attachment = group.panes.openGeneration;
				if (!edit.commit() || attachment !== group.panes.openGeneration) return;
			}
		}
		const implementation = target?.getCommand(command);
		if (implementation !== undefined) {
			if (implementation.isEnabled()) implementation.run();
			return;
		}
		switch (command) {
			case 'play.reveal': case 'play.actors': case 'play.stop': case 'play.reset': case 'play.source': case 'play.breakpoints':
			case 'play.continue': case 'play.stepInto': case 'play.stepOver': case 'play.stepOut':
				this.editor.play.execute(command); return;
			case 'copy': case 'cut': case 'paste':
				void executeClipboardAction(this.editor.clipboard, command, target);
				return;
			case 'menubar.focus': this.editor.menubar.toggleFocus(); return;
			case 'navigateBack':
				void this.editor.navigation.goBackward();
				return;
			case 'navigateForward':
				void this.editor.navigation.goForward();
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
				const input = group.model.activeTab!;
				if (input.kind !== 'aem_editor') return;
				const property = input.tree.rows[input.tree.selectionIndex].element, event = property.path[1] as string;
				const choices = getTextFileRuntimeSourceInstallations(this.sources, input.workingCopy)
					.filter(installation => installation.status === 'applied' && this.editor.actorLab.canInteract(installation.domain))
					.map(installation => ({ ...installation, label: `Physical ${installation.domain}`, description: input.workingCopy.resource.contextLabel, detail: event }));
				this.editor.quickInput.pick('AUDITION APPLIED EVENT', 'Choose the actual installed attachment', (_origin, lifetime) => {
					lifetime.add({ dispose: input.onWillDispose(() => this.editor.quickInput.hide()) });
					lifetime.add({ dispose: input.workingCopy.onDidChangeContent(() => this.editor.quickInput.hide()) });
					return new TextQuickPickProvider(choices);
				}, choice => {
					const image = choice.domain === SYSTEM_RESOURCE_DOMAIN ? this.sources.currentBlua32Media.system : this.sources.currentBlua32Media.cartridgeSlots[choice.domain];
					if (image === choice.image) this.editor.actorLab.auditionEvent(choice.domain, event);
				});
				return;
			}
			case 'input.testActionString': {
				const resource = group.model.activeTab?.resource;
				if (resource !== undefined && this.editor.actionStrings.canStart(resource.contextId)) { this.editor.actionStrings.open(resource.contextId); return; }
				const contexts = [...this.sources.catalog.contexts.values()].filter(context => this.editor.actionStrings.canStart(context.id));
				this.editor.quickInput.pick('INPUT EXPERIMENT PROJECT', 'Choose the authored project', () => new TextQuickPickProvider(contexts.map(context => ({
					label: context.projectRootPath, description: context.programDomain, detail: '', contextId: context.id,
				}))), item => this.editor.actionStrings.open(item.contextId));
				return;
			}
			case 'behaviorLens.testEffect': {
				const input = group.model.activeTab!;
				if (input.kind !== 'behavior_lens') return;
				const choices: Array<{ domain: ResourceDomain; image: Blua32SourceImage; label: string; description: string; detail: string }> = [];
				for (const domain of [SYSTEM_RESOURCE_DOMAIN, ...CARTRIDGE_RESOURCE_DOMAINS] as const) {
					const image = domain === SYSTEM_RESOURCE_DOMAIN ? this.sources.currentBlua32Media.system : this.sources.currentBlua32Media.cartridgeSlots[domain];
					if (image === null || image.sourceContextId !== input.workingCopy.resource.contextId || !this.editor.actorLab.canInteract(domain)) continue;
					choices.push({ domain, image, label: `Physical ${domain}`, description: input.workingCopy.resource.contextLabel, detail: 'Choose a granted runtime effect on this attachment' });
				}
				this.editor.quickInput.pick('TEST GRANTED EFFECT', 'Choose the actual installed attachment', (_origin, lifetime) => {
					lifetime.add({ dispose: input.onWillDispose(() => this.editor.quickInput.hide()) });
					return new TextQuickPickProvider(choices);
				}, choice => {
					const image = choice.domain === SYSTEM_RESOURCE_DOMAIN ? this.sources.currentBlua32Media.system : this.sources.currentBlua32Media.cartridgeSlots[choice.domain];
					if (image === choice.image) this.editor.actorLab.testEffect(choice.domain);
				});
				return;
			}
			case 'progression.createProgram': openCreateResourcePrompt(this.editor, group, this.sources.catalog, this.clock, 'progression'); return;
			case 'aem.create': openCreateResourcePrompt(this.editor, group, this.sources.catalog, this.clock, 'aem'); return;
			case 'animation.createSprite': openCreateResourcePrompt(this.editor, group, this.sources.catalog, this.clock, 'sprite_animation'); return;
			case 'animation.create': openCreateResourcePrompt(this.editor, group, this.sources.catalog, this.clock, 'animation'); return;
			case 'input.createBindings': openCreateResourcePrompt(this.editor, group, this.sources.catalog, this.clock, 'input'); return;
			case 'behaviorLens.createEffect': openCreateResourcePrompt(this.editor, group, this.sources.catalog, this.clock, 'action_effect'); return;
			case 'builds.start': void chooseBuild(this.editor); return;
			case 'projects.createCartridge': createCartridge(this.editor); return;
			case 'resources.import': importCartridgeFiles(this.editor, this.sources.catalog); return;
			case 'builds.jobs': showBuildJobs(this.editor); return;
			case 'server.connection':
				showServerConnection(this.editor);
				return;
			case 'conversations.history':
				openObservedConversation(group, this.editor.observedConversation, this.editor.quickInput);
				return;
			case 'debugEvaluation':
				if (this.debuggerState.plans.controlSuspended && this.debuggerState.source.stop !== undefined) {
					resumeRuntimeDebugger(this.debuggerState, RuntimeDebuggerResumeMode.Continue);
					clearExecutionStopHighlights(group);
				} else this.debuggerState.plans.setControlSuspended(!this.debuggerState.plans.controlSuspended);
				if (!this.debuggerState.plans.controlSuspended) this.execution.requestExecution(false);
				return;
			case 'tabs.close': void group.close(group.model.activeTab!.id, target); return;
			case 'tabs.next': group.cycle(1); return;
			case 'tabs.previous': group.cycle(-1); return;
			case 'tabs.scrollLeft': case 'tabs.scrollRight':
				group.tabStrip.scrollbar.setScroll(group.tabStrip.scrollbar.getScroll()
					+ (command === 'tabs.scrollLeft' ? -1 : 1) * (group.tabStrip.layoutState.viewportBounds.right - group.tabStrip.layoutState.viewportBounds.left) * 0.75);
				return;
			case 'pause':
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
			case 'runtime.focusTimeline': this.editor.runtimeTimeline.focus(); return;
			case 'runtime.hideTimeline': this.editor.runtimeTimeline.hide(); return;
			case 'runtime.toggleTimeline':
				if (this.editor.runtimeTimeline.requested) this.editor.runtimeTimeline.hide();
				else this.editor.runtimeTimeline.focus();
				return;
			case 'problems.coverage': inputFocus.executeCommand(command, problemsPanel.focusTarget); return;
			case 'runtime.pause':
				group.panes.activePane?.setRuntimeCaptureRunning?.(false);
				transport.pause();
				return;
			case 'runtime.present':
			case 'runtime.accept':
				group.panes.activePane?.setRuntimeCaptureRunning?.(false);
				transport.navigation.finishReview(command === 'runtime.present' ? 'present' : 'here');
				return;
			case 'runtime.resume':
				group.panes.activePane?.setRuntimeCaptureRunning?.(true);
				transport.resumeHere();
				return;
			case 'gameView.playback': {
				const running = transport.togglePlayback();
				group.panes.activePane?.setRuntimeCaptureRunning?.(running);
				return;
			}
			case 'gameView.togglePanel': this.editor.gamePanel.toggle(); return;
			case 'gameView.closePanel': this.editor.gamePanel.close(); return;
			case 'stepFrame':
			case 'stepFrameBack':
				openGameView(group);
				this.frameNavigation.step(command === 'stepFrameBack' ? -1 : 1);
				return;
			case 'scenarioLab.debug':
			case 'scenarioLab.play':
			case 'scenarioLab.debugWithCompanion':
			case 'scenarioLab.playWithCompanion':
			case 'scenarioLab.runWithCompanion':
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
				clearExecutionStopHighlights(group);
				deactivateEditor(this.editor, this.overlayRenderer, this.audioOutput);
				return;
		}
		if (isEditorSearchCommand(command)) {
			executeEditorSearchCommand(this.editor, this.sources, command, group, target);
			return;
		}
		if (isEditorViewCommand(command)) {
			executeEditorViewCommand(this.editor, this.sources, this.fault, command, group);
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
				group,
			);
			return;
		}
	}

	public async executeConfirmedAction(
		request: EditorActionRequest,
		workingCopies: readonly EditorTextModel[],
		saveBeforeAction: boolean,
	): Promise<boolean> {
		if (request.action === 'run' && this.sources.currentBlua32Media.cartridgeSlots[request.entry.domain] !== request.expectedImage) return false;
		if (saveBeforeAction) {
			for (let index = 0; index < workingCopies.length; index += 1) {
				const result = await saveTextFileFromCommand(this.textFileSaves, workingCopies[index], this.editor, this.sources);
				if (result.status === 'failed' || workingCopies[index].dirty) {
					return false;
				}
			}
		}
		if (request.action === 'run' && this.sources.currentBlua32Media.cartridgeSlots[request.entry.domain] !== request.expectedImage) return false;
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
		const originGroup = findEditorGroup(focus);
		if (originGroup === null) return false;
		const group = originGroup ?? navigationState.activeGroup ?? this.editor.editorGroup;
		const transport = group.panes.activePane?.runtimeTransport ?? this.transport;
		const implementation = focus?.getCommand(command);
		if (implementation !== undefined) return implementation.isEnabled();
		switch (command) {
			case 'play.reveal': case 'play.actors': case 'play.stop': case 'play.reset': case 'play.source': case 'play.breakpoints':
			case 'play.continue': case 'play.stepInto': case 'play.stepOver': case 'play.stepOut':
				return this.editor.play.isCommandEnabled(command);
			case 'menubar.focus': return this.editor.isActive && !this.editor.actionPrompt.visible && !this.editor.quickInput.visible;
			case 'hostError': return this.fault.hostFrameFailure !== undefined;
			case 'assistant': return this.editor.assistant.available;
			case 'terminal': return this.editor.terminal.canOpen;
			case 'conversations': return this.editor.observedConversation.available;
			case 'copy': case 'cut': case 'paste':
				return focus?.clipboard?.[command] !== undefined && (command === 'copy' || !focus.clipboard.readOnly)
					&& (command !== 'paste' || this.editor.clipboard.canRead);
			case 'hot-resume':
				return this.hotResumes.acceptingRequests && !this.execution.launchPending;
			case 'reboot':
				return this.boots.acceptingRequests;
			case 'runCurrentFile': {
				const resource = group.model.activeTab?.resource;
				if (!this.boots.acceptingRequests || !this.runtimeTasks.ready || resource === undefined
					|| this.sources.catalog.getContext(resource.contextId).programDomain !== 'cart') return false;
				const source = this.sources.catalog.resolveLuaSource(resource);
				return source !== null && source.record.sourceKind !== 'source-only' && !source.record.generated;
			}
			case 'runProject':
				return this.boots.acceptingRequests && this.runtimeTasks.ready
					&& this.sources.cartridgeSlots.some(cart => cart !== null && this.sources.catalog.getContext(cart.contextId).luaSources.can_boot_from_source);
			case 'keepEditor':
				return group.model.previewTab !== null && group.model.previewTab === group.model.activeTab;
			case 'navigateBack':
				return navigationState.captureSuspendDepth === 0 && navigationState.back.length > 0;
			case 'navigateForward':
				return navigationState.captureSuspendDepth === 0 && navigationState.forward.length > 0;
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
			case 'aem.create': case 'animation.create': case 'animation.createSprite': case 'progression.createProgram': case 'input.createBindings': case 'behaviorLens.createEffect': return this.isEnabled('createResource');
			case 'projects.createCartridge': return this.editor.projects !== undefined;
			case 'resources.import': return this.editor.importFiles !== undefined
				&& [...this.sources.catalog.contexts.values()].some(context => context.programDomain === 'cart');
			case 'builds.jobs': return this.editor.builds !== undefined;
			case 'server.connection': return true;
			case 'conversations.history':
				return this.editor.observedConversation.available && !this.editor.observedConversation.pending;
			case 'debugEvaluation':
				return this.runtimeTasks.ready && this.debuggerState.plans.workbenchControlActive && this.fault.faultSnapshot === null;
			case 'tabs.close': return group.model.activeTab?.closable === true;
			case 'tabs.next': case 'tabs.previous': return group.model.tabs.length > 1;
			case 'tabs.scrollLeft': return group.tabStrip.scrollbar.getScroll() > 0;
			case 'tabs.scrollRight': return group.tabStrip.scrollbar.getScroll() < group.tabStrip.scrollbar.getMaximumScroll();
			case 'openEditors': return group.model.tabs.length > 0;
			case 'pause':
				return !this.execution.userPaused || this.runtimeTasks.mutationReady;
			case 'stepFrame':
			case 'stepFrameBack':
				return this.frameNavigation.canStep(command === 'stepFrameBack' ? -1 : 1);
			case 'runtime.focusTimeline': return this.editor.isActive && this.editor.runtimeTimeline.available;
			case 'runtime.hideTimeline': return this.editor.isActive && this.editor.runtimeTimeline.canHide;
			case 'runtime.toggleTimeline': return this.editor.isActive && (this.editor.runtimeTimeline.available || this.editor.runtimeTimeline.requested);
			case 'problems.coverage': return this.editor.isActive && problemsPanel.focusTarget.getCommand(command)!.isEnabled();
			case 'runtime.pause': return transport.playbackEnabled;
			case 'runtime.present':
			case 'runtime.accept':
				return transport.navigation.canFinishReview;
			case 'runtime.resume':
				return transport.rewind.active && transport.navigation.active === undefined
					&& transport.playbackEnabled;
			case 'gameView.togglePanel': return this.editor.isActive && group.panes.activePane?.companionGameMinimumWidth !== undefined;
			case 'gameView.closePanel': return this.editor.gamePanel.enabled;
			case 'gameView.playback':
				return this.editor.gamePanel.visible && transport.playbackEnabled;
			case 'scenarioLab.play':
			case 'scenarioLab.debug':
			case 'scenarioLab.debugWithCompanion':
			case 'scenarioLab.playWithCompanion':
			case 'scenarioLab.runWithCompanion':
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
				const activeInput = group.model.activeTab;
				return this.textFileSaves.acceptingSaves && activeInput instanceof TextEditorInput
					&& (activeInput.canSave() || !activeInput.readOnly && focus?.edit?.pending === true);
			}
			case 'aem.testEvent': {
				const input = group.model.activeTab;
				if (input?.kind !== 'aem_editor') return false;
				const property = input.tree.rows[input.tree.selectionIndex]?.element;
				return property !== undefined && property.path[0] === 'events' && property.path.length >= 2
					&& getTextFileRuntimeSourceInstallations(this.sources, input.workingCopy).some(installation =>
						installation.status === 'applied' && this.editor.actorLab.canInteract(installation.domain));
			}
			case 'aem': return true;
			case 'input.testActionString': return [...this.sources.catalog.contexts.keys()].some(contextId => this.editor.actionStrings.canStart(contextId));
			case 'behaviorLens.testEffect': {
				const input = group.model.activeTab;
				return input?.kind === 'behavior_lens' && input.view.presentation.kind === 'properties'
					&& ([SYSTEM_RESOURCE_DOMAIN, ...CARTRIDGE_RESOURCE_DOMAINS] as const).some(domain => {
						const image = domain === SYSTEM_RESOURCE_DOMAIN ? this.sources.currentBlua32Media.system : this.sources.currentBlua32Media.cartridgeSlots[domain];
						return image !== null && image.sourceContextId === input.workingCopy.resource.contextId && this.editor.actorLab.canInteract(domain);
					});
			}
			case 'animation': case 'progression': case 'inputBindings':
			case 'scenarioLab':
			case 'behaviorLens':
			case 'behaviorLens.preview':
			case 'behaviorLens.actionEffects':
			case 'behaviorLens.stateMachines':
			case 'behaviorLens.behaviorTrees':
			case 'cartMap':
			case 'sceneEditor':
			case 'gameView':
				return true;
			case 'filter':
				return this.editor.resourcePanel.isVisible()
					&& this.editor.resourcePanel.getMode() === 'resources';
			default:
				return isEditorSearchCommand(command)
					|| isEditorViewCommand(command) || isEditorWorkspaceCommand(command);
		}
	}

	public isActive(command: EditorCommandId, target: InputFocusTarget | null = inputFocus.target): boolean {
		const originGroup = findEditorGroup(target);
		if (originGroup === null) return false;
		const group = originGroup ?? navigationState.activeGroup ?? this.editor.editorGroup;
		const implementation = target?.getCommand(command);
		if (implementation !== undefined) return implementation.isChecked?.() === true;
		switch (command) {
			case 'runtime.toggleTimeline': return this.editor.runtimeTimeline.requested;
			case 'gameView.togglePanel': return this.editor.gamePanel.enabled;
			case 'romInspector.hold': {
				const input = group.model.activeTab;
				return input?.kind === 'rom_inspector' && input.readerHeld;
			}
			case 'romInspector.collision': {
				const input = group.model.activeTab;
				return input?.kind === 'rom_inspector' && input.reader.showCollision;
			}
			case 'romInspector.assets': case 'romInspector.structure': case 'romInspector.code': {
				const input = group.model.activeTab;
				return input?.kind === 'rom_inspector' && command === `romInspector.${input.model.mode}`;
			}

			case 'debugEvaluation':
				return this.debuggerState.plans.controlSuspended;
			case 'pause':
				return this.execution.userPaused;
			case 'resources':
				return this.editor.resourcePanel.visible;
			case 'problems':
				return problemsPanel.isVisible;
			case 'behaviorLens':
				return (group.model.activeTab?.kind === 'behavior_lens');
			case 'scenarioLab':
				return (group.model.activeTab?.kind === 'scenario_lab');
			case 'filter':
				return this.editor.resourcePanel.getFilterMode() === 'lua_only';
			default:
				return false;
		}
	}
}
