import { findEditorGroup } from '../workbench/services/editor/editor_group';
import { openCreateResourcePrompt } from '../workbench/contrib/resources/create';
import { chooseBuild, chooseBuildOutput, showBuildJobs } from '../workbench/contrib/builds/commands';
import { createCartridge } from '../workbench/contrib/projects/commands';
import { importCartridgeFiles } from '../workbench/contrib/resources/import';
import { executeClipboardAction } from '../input/clipboard';
import type { RuntimeTransport } from '../runtime/transport';
import type { RunTargetSelection } from '../workbench/services/execution/run_target';
import { navigationState } from '../navigation/navigation_history';
import { openGameView } from '../workbench/contrib/game_view/editor_input';
import type { HostExecutionControl } from '../../hosts/common/execution_control';
import type { BootService } from '../workbench/services/execution/boot';
import type { HotResumeService } from '../workbench/services/execution/hot_resume';
import type { HostClock } from '../../hosts/common/clock';
import type { LogOutput } from '../../hosts/common/log';
import type { CartEditor } from '../cart_editor';
import type { EditorCommandId } from '../common/commands';
import type { EditorInput } from '../workbench/common/editor_inputs';
import type { EditorPaneConstraints } from '../workbench/services/editor/editor_pane';
import { editorViewState } from '../editor/ui/view/state';
import type { EditorActionRequest } from './action_request';
import { executeEditorSearchCommand, isEditorSearchCommand } from './search';
import { executeEditorViewCommand, isEditorViewCommand } from './view';
import { executeEditorWorkspaceCommand, isEditorWorkspaceCommand } from './workspace';
import { performEditorAction } from './actions';
import { TextEditorInput } from '../workbench/common/editor_input';
import { editorTextModelService } from '../editor/model/model_service';
import type { TextFileSaveService } from '../workbench/services/working_copy/text_file_save';
import { saveTextFileFromCommand } from './source_save';
import { type RuntimeSourceState } from '../runtime/sources';
import type { RuntimeFaultState } from '../runtime/fault_state';
import type { OverlayRenderer } from '../runtime/overlay_renderer';
import type { RuntimeTaskQueue } from '../../hosts/common/runtime_task_queue';
import {
	resumeRuntimeDebugger, RuntimeDebuggerResumeMode,
	type RuntimeDebuggerState,
} from '../runtime/debugger_state';
import { deactivateEditor } from '../workbench/overlay_modes';
import { inputFocus, type InputFocusTarget } from '../input/focus';
import { showServerConnection } from '../workbench/contrib/server/connection';
import { openObservedConversation } from '../workbench/contrib/conversations/quick_access';
import { CARTRIDGE_RESOURCE_DOMAINS, SYSTEM_RESOURCE_DOMAIN, type ResourceDomain } from '../common/resource';
import { TextQuickPickProvider } from '../workbench/services/quick_input/text_provider';
import type { Blua32SourceImage } from '../runtime/sources';
import { getTextFileRuntimeSourceInstallations } from '../workbench/services/working_copy/runtime_source_status';
import { showMoveDestination, showOpenWindows } from '../workbench/services/editor/open_windows';
import { findWorkbenchWindow } from '../workbench/ui/window/control';
import { showGroupOpenEditors } from '../workbench/services/editor/open_editors';
import { workspaceState } from '../workbench/workspace/state';

// Source-consuming commands accept the concrete control's value before dirty
// model selection, prompts or asynchronous source capture (Godot EditorData).
const SOURCE_COMMANDS = new Set<EditorCommandId>([
	'tabs.next', 'tabs.previous', 'window.copyEditor', 'window.moveEditor', 'group.move', 'group.focusTabs', 'group.splitRight', 'group.splitDown',
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
	'editor.source', 'editor.sourceToSide', 'animation.producerSourceToSide',
	'animation.edit', 'animation.remove', 'animation.producerSource',
	'animation.tracks', 'animation.keys', 'animation.details',
	'aem', 'aem.create', 'aem.edit', 'aem.add', 'aem.remove', 'aem.apply', 'aem.testEvent',
	'luaProgram.edit', 'luaProgram.add', 'luaProgram.remove', 'progression', 'inputBindings',
	'luaProgram.live', 'luaProgram.authoring', 'luaProgram.testInput', 'input.testActionString',
	'behaviorLens.addProperty', 'behaviorLens.removeProperty',
	'cartMap',
	'sceneEditor', 'behaviorLens', 'behaviorLens.details',
	'behaviorLens.preview',
	'behaviorLens.actionEffects', 'behaviorLens.stateMachines', 'behaviorLens.behaviorTrees',
]);

export class IdeCommandController {
	private readonly editorConstraints: EditorPaneConstraints = { minimumWidth: 0, minimumHeight: 0, companionWidth: undefined };
	public constructor(
		private readonly editor: CartEditor,
		private readonly sources: RuntimeSourceState,
		private readonly fault: RuntimeFaultState,
		private readonly debuggerState: RuntimeDebuggerState,
		private readonly hotResumes: HotResumeService,
		private readonly boots: BootService,
		private readonly runtimeTasks: RuntimeTaskQueue,
		private readonly execution: HostExecutionControl,
		private readonly overlayRenderer: OverlayRenderer,
		public readonly transport: RuntimeTransport,
		private readonly runTargets: RunTargetSelection,
		private readonly clock: HostClock,
		private readonly logOutput: LogOutput,
		private readonly textFileSaves: TextFileSaveService,
	) {}
	public execute(command: EditorCommandId, target: InputFocusTarget | null = inputFocus.target, input?: EditorInput,
		editorContext?: InputFocusTarget | null): void {
		if (editorContext === null) return;
		const targetScope = target?.scope, targetGeneration = targetScope?.contextGeneration;
		const commandScope = target?.commandContext.scope, contextGeneration = commandScope?.contextGeneration;
		const editorScope = editorContext?.commandContext.scope, editorGeneration = editorScope?.contextGeneration;
		const invocationScope = editorContext?.scope, invocationGeneration = invocationScope?.contextGeneration;
		const invocationTarget = editorContext === undefined ? target : editorContext;
		const originWindow = findWorkbenchWindow(target);
		if (originWindow === null) return;
		const originGroup = findEditorGroup(invocationTarget);
		if (originGroup === null) return;
		const originPart = this.editor.editorParts.partForTarget(invocationTarget);
		if (originPart === null) return;
		const implementation = input === undefined ? target?.resolveCommand(command) : undefined;
		if (implementation !== undefined) {
			const invocation = implementation.capture === undefined ? implementation : implementation.capture();
			if (invocation === undefined) return;
			// A concrete widget owns its draft even when it is not an editor-group
			// child. Resolving the later active group must not choose this authority.
			const scope = originGroup?.focusScope ?? invocationTarget?.commandContext.scope;
			const attachment = originGroup?.panes.openGeneration;
			if (SOURCE_COMMANDS.has(command)) {
				const focused = inputFocus.target;
				const edit = focused !== null && scope?.contains(focused.scope) ? focused.edit : undefined;
				if (edit !== undefined) {
					if (!edit.commit() || attachment !== originGroup?.panes.openGeneration) return;
					if (inputFocus.target !== null && !scope!.contains(inputFocus.target.scope)) return;
				}
			}
			if (targetScope?.contextGeneration !== targetGeneration || commandScope?.contextGeneration !== contextGeneration
				|| editorScope?.contextGeneration !== editorGeneration || invocationScope?.contextGeneration !== invocationGeneration) return;
			if (!invocation.isEnabled()) return;
			if (targetScope?.contextGeneration !== targetGeneration || commandScope?.contextGeneration !== contextGeneration
				|| editorScope?.contextGeneration !== editorGeneration || invocationScope?.contextGeneration !== invocationGeneration) return;
			invocation.run(originGroup?.focusTarget);
			return;
		}
		// Named regions settle only their own input at the Main owner; an unrelated document draft is not their subject.
		const activityId = this.editor.mainWorkspace.activities.idForCommand(command);
		if (activityId !== undefined) {
			const main = this.editor.mainWorkspace;
			if (main.activities.selectedId === activityId && main.regionLayout.activityVisible) main.setActivityVisible(false);
			else main.openActivity(activityId, { focus: true });
			return;
		}
		switch (command) {
			case 'status.focus': this.editor.statusBar.focus(); return;
			case 'status.details': this.editor.statusBar.showDetails(); return;
			case 'workspace.activity.hide': this.editor.mainWorkspace.setActivityVisible(false); return;
			case 'workspace.hierarchy.focus': this.editor.mainWorkspace.focusPrimary('hierarchy'); return;
			case 'workspace.details.focus': this.editor.mainWorkspace.focusPrimary('details'); return;
			case 'workspace.hierarchy.toggle': this.editor.mainWorkspace.toggleRegion('hierarchy'); return;
			case 'workspace.details.toggle': this.editor.mainWorkspace.toggleRegion('details'); return;
		}
		if (command === 'editor.source' || command === 'editor.sourceToSide') {
			if (targetScope?.contextGeneration !== targetGeneration || commandScope?.contextGeneration !== contextGeneration
				|| editorScope?.contextGeneration !== editorGeneration || invocationScope?.contextGeneration !== invocationGeneration) return;
			const placement = command === 'editor.sourceToSide' ? 'side' : 'default';
			const main = this.editor.mainWorkspace;
			if (input === undefined && (main.isPrimaryTarget(invocationTarget) || main.isActivityTarget(invocationTarget))) {
				if (main.canOpenSource(invocationTarget!)) void this.editor.navigation.openSource(main, { placement, target: invocationTarget! });
				return;
			}
			const group = originGroup ?? originPart?.activeGroup ?? this.editor.editorParts.activeGroup, pane = group.panes.activePane;
			if (pane === null || pane.input !== (input ?? group.model.activeTab) || !pane.canOpenSource) return;
			void this.editor.navigation.openSource(group, { placement, target: invocationTarget ?? undefined });
			return;
		}
		const group = originGroup ?? originPart?.activeGroup ?? this.editor.editorParts.activeGroup;
		if (input !== undefined && !group.model.contains(input)) return;
		const part = this.editor.editorParts.partForGroup(group);
		const selected = this.runTargets.selected;
		const runtimeContext = target?.scope.runtimeOwner?.runtime;
		const local = runtimeContext?.interaction;
		const transport = local === undefined ? selected?.transport : local.transport;
		// Committing the focused draft and choosing an action's target are distinct.
		// Pointer actions retain field focus but invoke their own explicit context.
		if (SOURCE_COMMANDS.has(command)) {
			const focused = inputFocus.target;
			const edit = findEditorGroup(focused) === group && (input === undefined || input === group.model.activeTab) ? focused?.edit : undefined;
			if (edit !== undefined) {
				const attachment = group.panes.openGeneration;
				if (!edit.commit() || attachment !== group.panes.openGeneration) return;
				if (inputFocus.target !== null && findEditorGroup(inputFocus.target) !== group) return;
			}
		}
		if (targetScope?.contextGeneration !== targetGeneration || commandScope?.contextGeneration !== contextGeneration || editorScope?.contextGeneration !== editorGeneration
			|| invocationScope?.contextGeneration !== invocationGeneration || input !== undefined && !group.model.contains(input)) return;
		const editor = input === undefined ? group.model.activeTab : input;
		switch (command) {
			case 'window.restoreMinimized': showOpenWindows(this.editor.editorParts, this.editor.quickInput, true); return;
			case 'window.showAll': showOpenWindows(this.editor.editorParts, this.editor.quickInput); return;
			case 'window.focusMain': this.editor.editorParts.main.focus(); return;
			case 'workspace.focusPrimary': this.editor.mainWorkspace.focusPrimary(); return;
			case 'workspace.clearPrimary': void this.editor.mainWorkspace.clearPrimary(this.editor.editorParts.closeController, target); return;
			case 'window.newEditor': this.editor.editorParts.createDocument().focus(); return;
			case 'group.close': void this.editor.editorParts.closeGroup(group, target); return;
			case 'group.move':
				if (this.isEnabled(command, target)) showMoveDestination(this.editor.editorParts, this.editor.quickInput, { kind: 'group', model: group.model }, target);
				return;
			case 'group.openEditors': showGroupOpenEditors(group, part.quickInput); return;
			case 'group.focusTabs': group.focus('tabs'); return;
			case 'group.splitRight': case 'group.splitDown': {
				const created = this.editor.editorParts.splitGroup(group, command === 'group.splitRight' ? 'right' : 'down');
				if (created !== undefined) created.focus();
				return;
			}
			case 'group.focusNext': case 'group.focusPrevious': {
				const groups = part.groups, index = groups.indexOf(group), direction = command === 'group.focusNext' ? 1 : -1;
				groups[(index + direction + groups.length) % groups.length].focus();
				return;
			}
			case 'group.maximize': part.arrangement.toggleMaximize(group); group.focus(); return;
			case 'window.moveEditor': {
				if (editor !== null && this.editor.editorParts.canMoveEditor(group, editor, { kind: 'window' }))
					showMoveDestination(this.editor.editorParts, this.editor.quickInput, { kind: 'editor', model: group.model, input: editor }, target);
				return;
			}
			case 'window.copyEditor': {
				if (editor?.createView === undefined || part.closing) return;
				const view = editor.createView();
				this.editor.editorParts.createDocument().activeGroup.openEditor(view, { pinned: true });
				return;
			}
			case 'window.snapLeft': case 'window.snapRight': case 'window.restore':
			case 'window.maximize': case 'window.minimize': case 'window.hide': {
				const window = originWindow === undefined ? part.window : originWindow;
				const implementation = window?.focusTarget.getCommand(command);
				if (implementation?.isEnabled()) implementation.run();
				return;
			}
			case 'play.reveal': case 'play.actors': case 'play.stop': case 'play.reset': case 'play.source': case 'play.breakpoints':
			case 'play.continue': case 'play.stepInto': case 'play.stepOver': case 'play.stepOut': {
				const active = group.model.activeTab;
				const input = active?.kind === 'play_session' ? active : this.editor.play.input;
				if (input !== undefined) this.editor.play.execute(command, input, group, part.quickInput);
				return;
			}
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
				this.editor.assistantCommands.execute(command, group, part.quickInput);
				return;
			case 'aem.testEvent': {
				const input = group.model.activeTab!;
				if (input.kind !== 'aem_editor') return;
				const property = input.tree.rows[input.tree.selectionIndex].element, event = property.path[1] as string;
				const choices = getTextFileRuntimeSourceInstallations(this.sources, input.workingCopy)
					.filter(installation => installation.status === 'applied' && this.editor.actorLab.canInteract(installation.domain))
					.map(installation => ({ ...installation, label: `Physical ${installation.domain}`, description: input.workingCopy.resource.contextLabel, detail: event }));
				part.quickInput.pick('AUDITION APPLIED EVENT', 'Choose the actual installed attachment', (_origin, lifetime) => {
					lifetime.add({ dispose: input.onWillDispose(() => part.quickInput.hide()) });
					lifetime.add({ dispose: input.workingCopy.onDidChangeContent(() => part.quickInput.hide()) });
					return new TextQuickPickProvider(choices);
				}, choice => {
					const image = choice.domain === SYSTEM_RESOURCE_DOMAIN ? this.sources.currentBlua32Media.system : this.sources.currentBlua32Media.cartridgeSlots[choice.domain];
					if (image === choice.image) this.editor.actorLab.auditionEvent(group, choice.domain, event);
				});
				return;
			}
			case 'input.testActionString': {
				const resource = group.model.activeTab?.resource;
				if (resource !== undefined && this.editor.actionStrings.canStart(resource.contextId)) { this.editor.actionStrings.open(resource.contextId, group, part.quickInput); return; }
				const contexts = [...this.sources.catalog.contexts.values()].filter(context => this.editor.actionStrings.canStart(context.id));
				part.quickInput.pick('INPUT EXPERIMENT PROJECT', 'Choose the authored project', () => new TextQuickPickProvider(contexts.map(context => ({
					label: context.projectRootPath, description: context.programDomain, detail: '', contextId: context.id,
				}))), item => this.editor.actionStrings.open(item.contextId, group, part.quickInput));
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
				part.quickInput.pick('TEST GRANTED EFFECT', 'Choose the actual installed attachment', (_origin, lifetime) => {
					lifetime.add({ dispose: input.onWillDispose(() => part.quickInput.hide()) });
					return new TextQuickPickProvider(choices);
				}, choice => {
					const image = choice.domain === SYSTEM_RESOURCE_DOMAIN ? this.sources.currentBlua32Media.system : this.sources.currentBlua32Media.cartridgeSlots[choice.domain];
					if (image === choice.image) this.editor.actorLab.testEffect(group, choice.domain);
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
			case 'builds.output.choose': chooseBuildOutput(this.editor); return;
			case 'server.connection':
				showServerConnection(this.editor);
				return;
			case 'conversations.history':
				openObservedConversation(group, this.editor.observedConversation, part.quickInput);
				return;
			case 'debugEvaluation':
				if (this.debuggerState.plans.controlSuspended && this.debuggerState.source.stop !== undefined) {
					resumeRuntimeDebugger(this.debuggerState, RuntimeDebuggerResumeMode.Continue);
				} else this.debuggerState.plans.setControlSuspended(!this.debuggerState.plans.controlSuspended);
				if (!this.debuggerState.plans.controlSuspended) this.execution.requestExecution(false);
				return;
			case 'tabs.close': {
				if (editor === null) void this.editor.editorParts.closeGroup(group, target);
				else void group.close(editor.id, target);
				return;
			}
			case 'tabs.next': group.cycle(1); return;
			case 'tabs.previous': group.cycle(-1); return;
			case 'tabs.scrollLeft': case 'tabs.scrollRight':
				group.tabStrip.scrollbar.setScroll(group.tabStrip.scrollbar.getScroll()
					+ (command === 'tabs.scrollLeft' ? -1 : 1) * (group.tabStrip.layoutState.viewportBounds.right - group.tabStrip.layoutState.viewportBounds.left) * 0.75);
				return;
			case 'pause': {
				if (selected === undefined) return;
				const playback = selected.transport;
				if (playback.execution.userPaused) {
					playback.resumeHere();
					if (playback === this.transport && selected.debuggerExecution.state.source.stop === undefined) {
						deactivateEditor(this.editor, this.overlayRenderer);
					}
				} else playback.pause();
				return;
			}
			case 'runtime.focusTimeline':
				if (runtimeContext !== undefined) group.timeline.setContext(runtimeContext);
				group.timeline.focus(); return;
			case 'runtime.hideTimeline': group.timeline.hide(); return;
			case 'runtime.toggleTimeline':
				if (group.timeline.requested) group.timeline.hide();
				else {
					if (runtimeContext !== undefined) group.timeline.setContext(runtimeContext);
					group.timeline.focus();
				}
				return;
			case 'problems.coverage': inputFocus.executeCommand(command, this.editor.problems.focusTarget); return;
			case 'runtime.pause':
				if (transport?.available !== true) return;
				if (local !== undefined) { local.running = false; this.editor.interaction.activateRuntime(target!); }
				transport.pause();
				return;
			case 'runtime.present':
			case 'runtime.accept':
				if (transport?.available !== true) return;
				if (local !== undefined) { local.running = false; this.editor.interaction.activateRuntime(target!); }
				transport.navigation.finishReview(command === 'runtime.present' ? 'present' : 'here');
				return;
			case 'runtime.resume':
				if (transport?.available !== true) return;
				if (local !== undefined) { local.running = true; this.editor.interaction.activateRuntime(target!); }
				transport.resumeHere();
				return;
			case 'runtime.playback': {
				if (transport?.playbackEnabled !== true) return;
				const running = transport.togglePlayback();
				if (local !== undefined) { local.running = running; this.editor.interaction.activateRuntime(target!); }
				return;
			}
			case 'gameView.togglePanel': this.editor.gamePanel.toggle(); return;
			case 'gameView.closePanel': this.editor.gamePanel.close(); return;
			case 'stepFrame':
			case 'stepFrameBack':
				if (transport?.available !== true) return;
				if (local !== undefined) { local.running = false; this.editor.interaction.activateRuntime(target!); }
				if (local === undefined && transport === this.transport) openGameView(group);
				transport.navigation.step(command === 'stepFrameBack' ? -1 : 1);
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
			case 'scenarioLab.cancel': {
				const input = group.model.activeTab;
				this.editor.scenarioLab.executeCommand(command, input?.kind === 'scenario_lab' ? input : undefined, group, part.quickInput);
				return;
			}
			case 'debugContinue':
			case 'debugStepInto':
			case 'debugStepOut':
			case 'debugStepOver':
				if (selected === undefined) return;
				selected.debuggerExecution.resume(command === 'debugStepInto' ? 'into' : command === 'debugStepOut' ? 'out'
					: command === 'debugStepOver' ? 'over' : 'continue', selected.transport === this.transport ? 'game' : 'workbench');
				if (selected.transport === this.transport) {
					deactivateEditor(this.editor, this.overlayRenderer);
				}
				return;
		}
		if (isEditorSearchCommand(command)) {
			executeEditorSearchCommand(this.editor, this.sources, command, group, invocationTarget, this.clock);
			return;
		}
		if (isEditorViewCommand(command)) {
			executeEditorViewCommand(this.editor, this.sources, this.fault, command, group, input);
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
				this.clock,
				this.logOutput,
				this.textFileSaves,
				command,
				group,
				this.runTargets,
				input,
			);
			return;
		}
	}

	public async executeConfirmedAction(
		request: EditorActionRequest,
		saveBeforeAction: boolean,
	): Promise<boolean> {
		if (request.action === 'run' && this.sources.currentBlua32Media.cartridgeSlots[request.entry.domain] !== request.expectedImage) return false;
		if (saveBeforeAction) {
			for (;;) {
				const workingCopies = editorTextModelService.dirtyWorkingCopies;
				if (workingCopies.length === 0) break;
				for (const model of workingCopies) {
					const result = await saveTextFileFromCommand(this.textFileSaves, model, this.editor, this.sources);
					if (result.status === 'failed' || model.dirty) return false;
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
			this.logOutput,
			request,
			this.runTargets,
		);
	}

	public isEnabled(command: EditorCommandId, focus: InputFocusTarget | null = inputFocus.target, input?: EditorInput): boolean {
		const originWindow = findWorkbenchWindow(focus);
		if (originWindow === null) return false;
		const originGroup = findEditorGroup(focus);
		if (originGroup === null) return false;
		const originPart = this.editor.editorParts.partForTarget(focus);
		if (originPart === null) return false;
		if (this.editor.mainWorkspace.activities.idForCommand(command) !== undefined) return this.editor.isActive;
		const implementation = input === undefined ? focus?.resolveCommand(command) : undefined;
		if (implementation !== undefined) return implementation.isEnabled();
		if ((command === 'editor.source' || command === 'editor.sourceToSide') && input === undefined && (this.editor.mainWorkspace.isPrimaryTarget(focus) || this.editor.mainWorkspace.isActivityTarget(focus)))
			return this.editor.mainWorkspace.canOpenSource(focus!);
		const group = originGroup ?? originPart?.activeGroup ?? this.editor.editorParts.activeGroup;
		if (input !== undefined && !group.model.contains(input)) return false;
		const part = this.editor.editorParts.partForGroup(group);
		const selected = this.runTargets.selected;
		const local = focus?.scope.runtimeOwner?.runtime?.interaction;
		const transport = local === undefined ? selected?.transport : local.transport;
		const editor = input === undefined ? group.model.activeTab : input;
		switch (command) {
			case 'editor.source': case 'editor.sourceToSide': {
				const pane = group.panes.activePane;
				return group.openingAdmitted && pane !== null && pane.input === editor && pane.canOpenSource;
			}
			case 'window.showAll': case 'window.focusMain': case 'window.newEditor': return true;
			case 'status.focus': return this.editor.isActive && this.editor.statusBar.canFocus;
			case 'status.details': return this.editor.isActive && this.editor.statusBar.hasDetails;
			case 'workspace.activity.hide': return this.editor.isActive && this.editor.mainWorkspace.regionLayout.activityVisible;
			case 'findGlobal': return workspaceState.context !== null;
			case 'workspace.focusPrimary': case 'workspace.clearPrimary':
			case 'workspace.hierarchy.focus': case 'workspace.details.focus':
			case 'workspace.hierarchy.toggle': case 'workspace.details.toggle': return this.editor.mainWorkspace.primary !== undefined;
			case 'window.restoreMinimized': return this.editor.editorParts.minimizedCount > 0;
			case 'group.close': return this.editor.editorParts.canCloseGroup(group);
			case 'group.move': return this.editor.editorParts.canMoveGroup(group, { kind: 'window' })
				|| part.groups.some(other => this.editor.editorParts.canMoveGroup(group, { kind: 'split', group: other, direction: 'right' }));
			case 'group.openEditors': return group.model.tabs.length > 0;
			case 'group.focusTabs': return group.openingAdmitted && group.model.tabs.length > 0;
			case 'group.splitRight': case 'group.splitDown': return part.operation === 'none';
			case 'group.focusNext': case 'group.focusPrevious': case 'group.maximize': return part.operation === 'none' && part.groups.length > 1;
			case 'window.moveEditor': {
				return editor !== null && this.editor.editorParts.canMoveEditor(group, editor, { kind: 'window' });
			}
			case 'window.copyEditor': return !part.closing && editor?.createView !== undefined;
			case 'window.snapLeft': case 'window.snapRight': case 'window.restore':
			case 'window.maximize': case 'window.minimize': case 'window.hide': {
				const window = originWindow === undefined ? part.window : originWindow;
				return window?.focusTarget.getCommand(command)?.isEnabled() === true;
			}
			case 'play.reveal': case 'play.actors': case 'play.stop': case 'play.reset': case 'play.source': case 'play.breakpoints':
			case 'play.continue': case 'play.stepInto': case 'play.stepOver': case 'play.stepOut': {
				const input = group.model.activeTab;
				return this.editor.play.isCommandEnabled(command, input?.kind === 'play_session' ? input : this.editor.play.input);
			}
			case 'menubar.focus': return this.editor.isActive && !this.editor.actionPrompt.visible && !part.quickInput.visible;
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
				return group.model.previewTab !== null && group.model.previewTab === editor;
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
				return this.editor.assistantCommands.isEnabled(command, group);
			case 'builds.start': return this.editor.builds !== undefined;
			case 'aem.create': case 'animation.create': case 'animation.createSprite': case 'progression.createProgram': case 'input.createBindings': case 'behaviorLens.createEffect': return this.isEnabled('createResource');
			case 'projects.createCartridge': return this.editor.projects !== undefined;
			case 'resources.import': return this.editor.importFiles !== undefined
				&& [...this.sources.catalog.contexts.values()].some(context => context.programDomain === 'cart');
			case 'builds.jobs': case 'builds.output.choose': return this.editor.builds !== undefined;
			case 'server.connection': return true;
			case 'conversations.history':
				return this.editor.observedConversation.available && !this.editor.observedConversation.pending;
			case 'debugEvaluation':
				return this.runtimeTasks.ready && this.debuggerState.plans.workbenchControlActive && this.fault.faultSnapshot === null;
			case 'tabs.close': {
				return editor === null ? part.groups.length > 1 && this.editor.editorParts.canCloseGroup(group) : group.openingAdmitted && editor.closable;
			}
			case 'tabs.next': case 'tabs.previous': return group.model.tabs.length > 1;
			case 'tabs.scrollLeft': return group.tabStrip.scrollbar.getScroll() > 0;
			case 'tabs.scrollRight': return group.tabStrip.scrollbar.getScroll() < group.tabStrip.scrollbar.getMaximumScroll();
			case 'openEditors': return true;
			case 'pause':
				return selected?.transport.playbackEnabled === true;
			case 'stepFrame':
			case 'stepFrameBack':
				return transport?.available === true && transport.navigation.canStep(command === 'stepFrameBack' ? -1 : 1);
			case 'runtime.focusTimeline': return this.editor.isActive && (local === undefined ? group.timeline.available : transport?.available === true);
			case 'runtime.hideTimeline': return this.editor.isActive && group.timeline.canHide;
			case 'runtime.toggleTimeline': return this.editor.isActive && ((local === undefined ? group.timeline.available : transport?.available === true) || group.timeline.requested);
			case 'problems.coverage': return this.editor.isActive && this.editor.problems.focusTarget.getCommand(command)!.isEnabled();
			case 'runtime.pause': return transport?.playbackEnabled === true;
			case 'runtime.present':
			case 'runtime.accept':
				return transport?.available === true && transport.navigation.canFinishReview;
			case 'runtime.resume':
				return transport?.available === true && transport.rewind.active && transport.navigation.active === undefined
					&& transport.playbackEnabled;
			case 'gameView.togglePanel': {
				if (!this.editor.isActive || editor === null) return false;
				group.panes.measure(editor, editorViewState.font, true, this.editorConstraints);
				return this.editorConstraints.companionWidth !== undefined;
			}
			case 'gameView.closePanel': return this.editor.gamePanel.enabled;
			case 'runtime.playback': return transport?.playbackEnabled === true;
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
			case 'scenarioLab.cancel': {
				const input = group.model.activeTab;
				return this.editor.scenarioLab.isCommandEnabled(command, input?.kind === 'scenario_lab' ? input : undefined);
			}
			case 'debugContinue':
				return selected !== undefined && selected.debuggerExecution.state.source.stop !== undefined
					&& selected.debuggerExecution.canResume('continue');
			case 'debugStepInto':
			case 'debugStepOver':
			case 'debugStepOut':
				return selected?.debuggerExecution.canResume(command === 'debugStepInto' ? 'into' : command === 'debugStepOver' ? 'over' : 'out') === true;
			case 'save': {
				return this.textFileSaves.acceptingSaves && editor instanceof TextEditorInput
					&& (editor.canSave() || !editor.readOnly && editor === group.model.activeTab && focus?.edit?.pending === true);
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
				return this.editor.resourcePanel.isVisible();
			default:
				return isEditorSearchCommand(command)
					|| isEditorViewCommand(command) || isEditorWorkspaceCommand(command);
		}
	}

	public isActive(command: EditorCommandId, target: InputFocusTarget | null = inputFocus.target, input?: EditorInput): boolean {
		const originWindow = findWorkbenchWindow(target);
		if (originWindow === null) return false;
		const originGroup = findEditorGroup(target);
		if (originGroup === null) return false;
		const originPart = this.editor.editorParts.partForTarget(target);
		if (originPart === null) return false;
		const activityId = this.editor.mainWorkspace.activities.idForCommand(command);
		if (activityId !== undefined) return this.editor.mainWorkspace.regionLayout.activityVisible
			&& this.editor.mainWorkspace.activities.selectedId === activityId;
		const group = originGroup ?? originPart?.activeGroup ?? this.editor.editorParts.activeGroup;
		if (input !== undefined && !group.model.contains(input)) return false;
		const implementation = input === undefined ? target?.resolveCommand(command) : undefined;
		if (implementation !== undefined) return implementation.isChecked?.() === true;
		const part = this.editor.editorParts.partForGroup(group);
		switch (command) {
			case 'window.snapLeft': case 'window.snapRight': case 'window.maximize': {
				const window = originWindow === undefined ? part.window : originWindow;
				return window?.focusTarget.getCommand(command)?.isChecked?.() === true;
			}
			case 'group.maximize': return part.arrangement.maximized === group;
			case 'workspace.hierarchy.toggle': return this.editor.mainWorkspace.regionLayout.hierarchyVisible;
			case 'workspace.details.toggle': return this.editor.mainWorkspace.regionLayout.detailsVisible;
			case 'runtime.toggleTimeline': return group.timeline.requested;
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
				return this.runTargets.selected?.transport.execution.userPaused === true;
			case 'resources':
				return this.editor.resourcePanel.visible;
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
