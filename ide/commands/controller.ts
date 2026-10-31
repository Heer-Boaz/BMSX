import { findEditorGroup } from '../workbench/services/editor/editor_group';
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
import { resolveEditorCommandGroup } from './context';
import { executeEditorDocumentCommand, isEditorDocumentCommand, isEditorDocumentCommandEnabled } from './document';
import { captureEditorWorkspaceCommand, isEditorWorkspaceCommand, isEditorWorkspaceCommandEnabled } from './workspace';
import { performEditorAction } from './actions';
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
import { inputFocus, type FocusCommandInvocation, type InputFocusTarget } from '../input/focus';
import { showServerConnection } from '../workbench/contrib/server/connection';
import { openObservedConversation } from '../workbench/contrib/conversations/quick_access';
import { TextQuickPickProvider } from '../workbench/services/quick_input/text_provider';
import { showMoveDestination } from '../workbench/services/editor/open_windows';
import { showOpenWindows } from '../workbench/ui/window/picker';
import { findWorkbenchWindowSurface, minimizedWorkbenchWindowCount, workbenchWindowForSurface } from '../workbench/ui/window/control';
import { showGroupOpenEditors } from '../workbench/services/editor/open_editors';
import { workspaceState } from '../workbench/workspace/state';
import { WORKBENCH_VIEW_SIZING_COMMANDS, isWorkbenchViewSizingEnabled, executeWorkbenchViewSizing } from './layout';
import type { ActionPromptRequest } from '../workbench/contrib/modal/action_prompt_view';
import { showMainScenePicker } from '../workbench/contrib/scene_editor/quick_access';

const ACTION_PROMPTS: Readonly<Record<Exclude<EditorActionRequest['action'], 'theme-toggle'>, ActionPromptRequest>> = {
	'hot-resume': { title: 'UNSAVED CHANGES DETECTED.', message: 'SAVE CHANGES BEFORE HOT-RESUME?',
		primary: 'SAVE & RESUME', secondary: 'RESUME WITHOUT SAVING', primaryEnabled: true, defaultChoice: 'primary' },
	reboot: { title: 'UNSAVED CHANGES DETECTED.', message: 'SAVE CHANGES BEFORE REBOOT?',
		primary: 'SAVE & REBOOT', secondary: 'REBOOT WITHOUT SAVING', primaryEnabled: true, defaultChoice: 'primary' },
	run: { title: 'UNSAVED CHANGES DETECTED.', message: 'SAVE CHANGES BEFORE RUNNING?',
		primary: 'SAVE & RUN', secondary: 'RUN WITHOUT SAVING', primaryEnabled: true, defaultChoice: 'primary' },
	close: { title: 'UNSAVED CHANGES DETECTED.', message: 'SAVE BEFORE HIDING THE EDITOR?',
		primary: 'SAVE & HIDE', secondary: 'HIDE WITHOUT SAVING', primaryEnabled: true, defaultChoice: 'primary' },
};

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
		if (this.editor.isClosing) return;
		if (editorContext === null) return;
		const targetScope = target?.scope, targetGeneration = targetScope?.contextGeneration;
		const commandScope = target?.commandContext.scope, contextGeneration = commandScope?.contextGeneration;
		const editorScope = editorContext?.commandContext.scope, editorGeneration = editorScope?.contextGeneration;
		const invocationScope = editorContext?.scope, invocationGeneration = invocationScope?.contextGeneration;
		const invocationTarget = editorContext === undefined ? target : editorContext;
		const originWindowSurface = findWorkbenchWindowSurface(target, this.editor.surfaces);
		if (originWindowSurface === null) return;
		const originGroup = findEditorGroup(invocationTarget);
		if (originGroup === null) return;
		const originPart = this.editor.editorParts.partForTarget(invocationTarget);
		if (originPart === null) return;
		const group = originGroup ?? originPart?.activeGroup ?? this.editor.editorParts.activeGroup;
		const part = this.editor.editorParts.partForGroup(group);
		const documentGroup = resolveEditorCommandGroup(this.editor, target, input);
		if (documentGroup === null || input !== undefined && documentGroup === undefined) return;
		const implementation = input === undefined ? target?.resolveCommand(command) : undefined;
		const workspaceCommand = isEditorWorkspaceCommand(command) ? command : undefined;
		if (implementation !== undefined || workspaceCommand !== undefined) {
			let invocation: FocusCommandInvocation | undefined;
			if (implementation !== undefined) invocation = implementation.capture === undefined ? implementation : implementation.capture();
			else {
				invocation = captureEditorWorkspaceCommand(this.editor, this.sources, this.hotResumes, this.boots, this.execution,
						this.clock, this.textFileSaves, workspaceCommand!, group, documentGroup === undefined ? undefined
							: { group: documentGroup, input: input === undefined ? documentGroup.model.activeTab : input },
						this.runTargets, this.runtimeTasks, target);
			}
			if (invocation === undefined) return;
			if (targetScope?.contextGeneration !== targetGeneration || commandScope?.contextGeneration !== contextGeneration
				|| editorScope?.contextGeneration !== editorGeneration || invocationScope?.contextGeneration !== invocationGeneration) return;
			// A concrete widget owns its draft even when it is not an editor-group
			// child. Resolving the later active group must not choose this authority.
			const scope = invocation.editScope;
			if (scope !== undefined) {
				const subjectGroup = findEditorGroup(target), attachment = subjectGroup?.panes.openGeneration;
				if (!inputFocus.commitEdit(scope) || attachment !== subjectGroup?.panes.openGeneration) return;
			}
			if (targetScope?.contextGeneration !== targetGeneration || commandScope?.contextGeneration !== contextGeneration
				|| editorScope?.contextGeneration !== editorGeneration || invocationScope?.contextGeneration !== invocationGeneration) return;
			if (!invocation.isEnabled()) return;
			if (targetScope?.contextGeneration !== targetGeneration || commandScope?.contextGeneration !== contextGeneration
				|| editorScope?.contextGeneration !== editorGeneration || invocationScope?.contextGeneration !== invocationGeneration) return;
			invocation.run(originGroup?.focusTarget);
			return;
		}
		if (isEditorDocumentCommand(command)) {
			if (documentGroup !== undefined) executeEditorDocumentCommand(this.editor.editorParts, this.editor.quickInput, command,
				documentGroup, input === undefined ? documentGroup.model.activeTab : input, target);
			return;
		}
		// Named regions settle only their own input at the Main owner; an unrelated document draft is not their subject.
		const activityId = this.editor.mainWorkspace.activities.idForCommand(command);
		if (activityId !== undefined) {
			const main = this.editor.mainWorkspace;
			if (main.activities.selectedId === activityId && main.activityDisplayed) main.setActivityVisible(false);
			else main.openActivity(activityId, { focus: true });
			return;
		}
		const resize = WORKBENCH_VIEW_SIZING_COMMANDS[command];
		if (resize !== undefined) {
			executeWorkbenchViewSizing(this.editor, invocationTarget, resize);
			return;
		}
		switch (command) {
			case 'workspace.resetLayout': this.editor.resetLayout(); return;
			case 'sceneEditor': showMainScenePicker(this.editor, this.sources.catalog, invocationTarget); return;
			case 'workspace.focusNextRegion': this.editor.regionNavigation.focus(invocationTarget, 1); return;
			case 'workspace.focusPreviousRegion': this.editor.regionNavigation.focus(invocationTarget, -1); return;
			case 'status.focus': this.editor.statusBar.focus(); return;
			case 'status.details': this.editor.statusBar.showDetails(); return;
			case 'workspace.activity.hide': this.editor.mainWorkspace.setActivityVisible(false); return;
			case 'workspace.activity.float': this.editor.mainWorkspace.setActivityPlacement('floatingWindow'); return;
			case 'workspace.activity.dock': this.editor.mainWorkspace.setActivityPlacement('dockedMain'); return;
			case 'workspace.hierarchy.focus': this.editor.mainWorkspace.focusPrimary('hierarchy'); return;
			case 'workspace.details.focus': this.editor.mainWorkspace.focusPrimary('details'); return;
			case 'workspace.hierarchy.float': this.editor.mainWorkspace.setRegionPlacement('hierarchy', 'floatingWindow'); return;
			case 'workspace.details.float': this.editor.mainWorkspace.setRegionPlacement('details', 'floatingWindow'); return;
			case 'workspace.hierarchy.dock': this.editor.mainWorkspace.setRegionPlacement('hierarchy', 'dockedMain'); return;
			case 'workspace.details.dock': this.editor.mainWorkspace.setRegionPlacement('details', 'dockedMain'); return;
			case 'workspace.hierarchy.toggle': this.editor.mainWorkspace.toggleRegion('hierarchy'); return;
			case 'workspace.details.toggle': this.editor.mainWorkspace.toggleRegion('details'); return;
		}
		if (isEditorViewCommand(command)) {
			executeEditorViewCommand(this.editor, this.sources, this.fault, command, group, documentGroup === undefined ? undefined
				: { group: documentGroup, input: input === undefined ? documentGroup.model.activeTab : input });
			return;
		}
		if (command === 'editor.source' || command === 'editor.sourceToSide') {
			if (targetScope?.contextGeneration !== targetGeneration || commandScope?.contextGeneration !== contextGeneration
				|| editorScope?.contextGeneration !== editorGeneration || invocationScope?.contextGeneration !== invocationGeneration) return;
			const placement = command === 'editor.sourceToSide' ? 'side' : 'default';
			const main = this.editor.mainWorkspace;
			if (documentGroup === undefined) {
				if (target !== null && main.canOpenSource(target)) void this.editor.navigation.openSource(main, { placement, target, reference: group });
				return;
			}
			const pane = documentGroup.panes.activePane;
			if (pane === null || pane.input !== (input ?? documentGroup.model.activeTab) || !pane.canOpenSource) return;
			void this.editor.navigation.openSource(documentGroup, { placement, target: target ?? undefined, reference: group });
			return;
		}
		if (input !== undefined && !group.model.contains(input)) return;

		const selected = this.runTargets.selected;
		const runtimeContext = target?.scope.runtimeOwner?.runtime;
		const local = runtimeContext?.interaction;
		const transport = local === undefined ? selected?.transport : local.transport;
		if (targetScope?.contextGeneration !== targetGeneration || commandScope?.contextGeneration !== contextGeneration || editorScope?.contextGeneration !== editorGeneration
			|| invocationScope?.contextGeneration !== invocationGeneration || input !== undefined && !group.model.contains(input)) return;
		switch (command) {
			case 'window.restoreMinimized': showOpenWindows(this.editor.mainWorkspace, this.editor.editorParts, this.editor.surfaces, this.editor.quickInput, true); return;
			case 'window.showAll': showOpenWindows(this.editor.mainWorkspace, this.editor.editorParts, this.editor.surfaces, this.editor.quickInput); return;
			case 'window.focusMain': this.editor.mainWorkspace.focusTarget.focus(); return;
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
			case 'window.systemMenu': case 'window.move': case 'window.resize':
			case 'window.snapLeft': case 'window.snapRight': case 'window.restore':
			case 'window.maximize': case 'window.minimize': case 'window.hide': {
				const window = originWindowSurface === undefined ? part.window : workbenchWindowForSurface(originWindowSurface);
				const implementation = window?.focusTarget.getCommand(command);
				if (implementation?.isEnabled()) implementation.run();
				return;
			}
			case 'play.reveal': this.editor.play.revealCurrent(group); return;
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
			case 'input.testActionString': {
				const resource = (input === undefined ? documentGroup?.model.activeTab : input)?.resource;
				if (resource !== undefined && this.editor.actionStrings.canStart(resource.contextId)) { this.editor.actionStrings.open(resource.contextId, group, part.quickInput); return; }
				const contexts = [...this.sources.catalog.contexts.values()].filter(context => this.editor.actionStrings.canStart(context.id));
				part.quickInput.pick('INPUT EXPERIMENT PROJECT', 'Choose the authored project', () => new TextQuickPickProvider(contexts.map(context => ({
					label: context.projectRootPath, description: context.programDomain, detail: '', contextId: context.id,
				}))), item => this.editor.actionStrings.open(item.contextId, group, part.quickInput));
				return;
			}
			case 'builds.start': void chooseBuild(this.editor); return;
			case 'projects.createCartridge': createCartridge(this.editor); return;
			case 'resources.import': importCartridgeFiles(this.editor, this.sources.catalog); return;
			case 'builds.jobs': showBuildJobs(this.editor, group); return;
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
			case 'editors.closeAll': void this.editor.editorParts.closeEditors({ kind: 'workspace' }, target); return;
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
			case 'scenarioLab.revealRun': case 'scenarioLab.cancel': {
				this.editor.scenarioLab.executeCommand(command, undefined, group, part.quickInput);
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
	}

	/** One unconfirmed source action owns its unsaved decision before execution admission. */
	public requestAction(request: EditorActionRequest): void {
		if (this.editor.isClosing) return;
		if (request.action !== 'theme-toggle' && editorTextModelService.dirtyWorkingCopies.length !== 0) {
			void this.editor.actionPrompt.show(ACTION_PROMPTS[request.action]).then(choice => {
				if (choice !== 'cancel') return this.executeConfirmedAction(request, choice === 'primary');
			}).catch(error => this.editor.handleRuntimeTaskError(error, 'Source action failed'));
			return;
		}
		void this.executeConfirmedAction(request, false).catch(error => this.editor.handleRuntimeTaskError(error, 'Source action failed'));
	}

	public async executeConfirmedAction(
		request: EditorActionRequest,
		saveBeforeAction: boolean,
	): Promise<boolean> {
		if (this.editor.isClosing) return false;
		if (request.action === 'run' && this.sources.currentBlua32Media.cartridgeSlots[request.entry.domain] !== request.expectedImage) return false;
		if (saveBeforeAction) {
			for (;;) {
				const workingCopies = editorTextModelService.dirtyWorkingCopies;
				if (workingCopies.length === 0) break;
				for (const model of workingCopies) {
					const result = await saveTextFileFromCommand(this.textFileSaves, model, this.editor, this.sources);
					if (this.editor.isClosing || result.status === 'failed' || model.dirty) return false;
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
		if (this.editor.isClosing) return false;
		const originWindowSurface = findWorkbenchWindowSurface(focus, this.editor.surfaces);
		if (originWindowSurface === null) return false;
		const originGroup = findEditorGroup(focus);
		if (originGroup === null) return false;
		const originPart = this.editor.editorParts.partForTarget(focus);
		if (originPart === null) return false;
		if (this.editor.mainWorkspace.activities.idForCommand(command) !== undefined) return this.editor.isActive;
		const implementation = input === undefined ? focus?.resolveCommand(command) : undefined;
		if (implementation !== undefined) return implementation.isEnabled();
		if (isEditorDocumentCommand(command)) {
			const documentGroup = resolveEditorCommandGroup(this.editor, focus, input);
			return documentGroup != null && isEditorDocumentCommandEnabled(this.editor.editorParts, command,
				documentGroup, input === undefined ? documentGroup.model.activeTab : input);
		}
		const resize = WORKBENCH_VIEW_SIZING_COMMANDS[command];
		if (resize !== undefined) return isWorkbenchViewSizingEnabled(this.editor, focus, resize);
		const group = originGroup ?? originPart?.activeGroup ?? this.editor.editorParts.activeGroup;
		const part = this.editor.editorParts.partForGroup(group);
		const selected = this.runTargets.selected;
		const local = focus?.scope.runtimeOwner?.runtime?.interaction;
		const transport = local === undefined ? selected?.transport : local.transport;
		if (isEditorWorkspaceCommand(command)) {
			const documentGroup = resolveEditorCommandGroup(this.editor, focus, input);
			if (documentGroup === null || input !== undefined && documentGroup === undefined) return false;
			return isEditorWorkspaceCommandEnabled(command, documentGroup, input === undefined ? documentGroup?.model.activeTab : input,
				this.sources, this.textFileSaves, this.hotResumes, this.boots, this.execution, this.runtimeTasks, focus);
		}
		if (command === 'editor.source' || command === 'editor.sourceToSide') {
			const owner = resolveEditorCommandGroup(this.editor, focus, input);
			if (owner === null) return false;
			if (owner === undefined) return focus !== null && this.editor.mainWorkspace.canOpenSource(focus);
			const pane = owner.panes.activePane, subject = input === undefined ? owner.model.activeTab : input;
			return owner.openingAdmitted && pane !== null && pane.input === subject && pane.canOpenSource;
		}
		if (input !== undefined && !group.model.contains(input)) return false;
		switch (command) {
			case 'workspace.resetLayout': return this.editor.acceptsInput;
			case 'sceneEditor': return this.editor.isActive && this.editor.projectContent.acceptingQueries;
			case 'window.showAll': case 'window.focusMain': case 'window.newEditor': return true;
			case 'workspace.focusNextRegion': return this.editor.isActive && this.editor.regionNavigation.canNavigate(focus, 1);
			case 'workspace.focusPreviousRegion': return this.editor.isActive && this.editor.regionNavigation.canNavigate(focus, -1);
			case 'status.focus': return this.editor.isActive && this.editor.statusBar.canFocus;
			case 'status.details': return this.editor.isActive && this.editor.statusBar.hasDetails;
			case 'workspace.activity.hide': return this.editor.isActive && this.editor.mainWorkspace.regionLayout.activityVisible;
			case 'workspace.activity.float': return this.editor.isActive && this.editor.mainWorkspace.activityDisplayed
				&& this.editor.mainWorkspace.activityPlacement === 'dockedMain';
			case 'workspace.activity.dock': return this.editor.isActive && this.editor.mainWorkspace.regionLayout.activityVisible
				&& this.editor.mainWorkspace.activityPlacement === 'floatingWindow';
			case 'workspace.hierarchy.float': return this.editor.isActive && this.editor.mainWorkspace.primary !== undefined
				&& this.editor.mainWorkspace.regions.hierarchy.placement === 'dockedMain';
			case 'workspace.details.float': return this.editor.isActive && this.editor.mainWorkspace.primary !== undefined
				&& this.editor.mainWorkspace.regions.details.placement === 'dockedMain';
			case 'workspace.hierarchy.dock': return this.editor.isActive && this.editor.mainWorkspace.primary !== undefined
				&& this.editor.mainWorkspace.regions.hierarchy.placement === 'floatingWindow';
			case 'workspace.details.dock': return this.editor.isActive && this.editor.mainWorkspace.primary !== undefined
				&& this.editor.mainWorkspace.regions.details.placement === 'floatingWindow';
			case 'findGlobal': return workspaceState.context !== null;
			case 'workspace.focusPrimary': case 'workspace.clearPrimary':
			case 'workspace.hierarchy.focus': case 'workspace.details.focus':
			case 'workspace.hierarchy.toggle': case 'workspace.details.toggle': return this.editor.mainWorkspace.primary !== undefined;
			case 'window.restoreMinimized': return minimizedWorkbenchWindowCount(this.editor.surfaces) > 0;
			case 'group.close': return this.editor.editorParts.canCloseGroup(group);
			case 'group.move': return this.editor.editorParts.canMoveGroup(group, { kind: 'window' })
				|| part.groups.some(other => this.editor.editorParts.canMoveGroup(group, { kind: 'split', group: other, direction: 'right' }));
			case 'group.openEditors': return group.model.tabs.length > 0;
			case 'group.focusTabs': return group.openingAdmitted && group.model.tabs.length > 0;
			case 'group.splitRight': case 'group.splitDown': return part.operation === 'none';
			case 'group.focusNext': case 'group.focusPrevious': case 'group.maximize': return part.operation === 'none' && part.groups.length > 1;
			case 'window.systemMenu': case 'window.move': case 'window.resize':
			case 'window.snapLeft': case 'window.snapRight': case 'window.restore':
			case 'window.maximize': case 'window.minimize': case 'window.hide': {
				const window = originWindowSurface === undefined ? part.window : workbenchWindowForSurface(originWindowSurface);
				return window?.focusTarget.getCommand(command)?.isEnabled() === true;
			}
			case 'play.reveal': return this.editor.play.canRevealCurrent;
			case 'menubar.focus': return this.editor.isActive && !this.editor.actionPrompt.visible && !part.quickInput.visible;
			case 'hostError': return this.fault.hostFrameFailure !== undefined;
			case 'assistant': return this.editor.assistant.available;
			case 'terminal': return this.editor.terminal.canOpen;
			case 'conversations': return this.editor.observedConversation.available;
			case 'copy': case 'cut': case 'paste':
				return focus?.clipboard?.[command] !== undefined && (command === 'copy' || !focus.clipboard.readOnly)
					&& (command !== 'paste' || this.editor.clipboard.canRead);
			case 'keepEditor': {
				const owner = resolveEditorCommandGroup(this.editor, focus, input);
				return owner !== undefined && owner !== null && owner.model.previewTab !== null
					&& owner.model.previewTab === (input === undefined ? owner.model.activeTab : input);
			}
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
			case 'projects.createCartridge': return this.editor.projects !== undefined;
			case 'resources.import': return this.editor.importFiles !== undefined
				&& [...this.sources.catalog.contexts.values()].some(context => context.programDomain === 'cart');
			case 'builds.jobs': case 'builds.output.choose': return this.editor.builds !== undefined;
			case 'server.connection': return true;
			case 'conversations.history':
				return this.editor.observedConversation.available && !this.editor.observedConversation.pending;
			case 'debugEvaluation':
				return this.runtimeTasks.ready && this.debuggerState.plans.workbenchControlActive && this.fault.faultSnapshot === null;
			case 'editors.closeAll': return this.editor.editorParts.canCloseEditors({ kind: 'workspace' });
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
				const editor = input === undefined ? group.model.activeTab : input;
				if (!this.editor.isActive || editor === null) return false;
				group.panes.measure(editor, editorViewState.font, true, this.editorConstraints);
				return this.editorConstraints.companionWidth !== undefined;
			}
			case 'gameView.closePanel': return this.editor.gamePanel.enabled;
			case 'runtime.playback': return transport?.playbackEnabled === true;
			case 'scenarioLab.revealRun': case 'scenarioLab.cancel': {
				return this.editor.scenarioLab.isCommandEnabled(command, undefined);
			}
			case 'debugContinue':
				return selected !== undefined && selected.debuggerExecution.state.source.stop !== undefined
					&& selected.debuggerExecution.canResume('continue');
			case 'debugStepInto':
			case 'debugStepOver':
			case 'debugStepOut':
				return selected?.debuggerExecution.canResume(command === 'debugStepInto' ? 'into' : command === 'debugStepOver' ? 'over' : 'out') === true;
			case 'aem': return true;
			case 'input.testActionString': return [...this.sources.catalog.contexts.keys()].some(contextId => this.editor.actionStrings.canStart(contextId));
			case 'animation': case 'progression': case 'inputBindings':
			case 'scenarioLab':
			case 'behaviorLens':
			case 'behaviorLens.preview':
			case 'behaviorLens.actionEffects':
			case 'behaviorLens.stateMachines':
			case 'behaviorLens.behaviorTrees':
			case 'cartMap':
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
		if (this.editor.isClosing) return false;
		const originWindowSurface = findWorkbenchWindowSurface(target, this.editor.surfaces);
		if (originWindowSurface === null) return false;
		const originGroup = findEditorGroup(target);
		if (originGroup === null) return false;
		const originPart = this.editor.editorParts.partForTarget(target);
		if (originPart === null) return false;
		const activityId = this.editor.mainWorkspace.activities.idForCommand(command);
		if (activityId !== undefined) return this.editor.mainWorkspace.activityDisplayed
			&& this.editor.mainWorkspace.activities.selectedId === activityId;
		const group = originGroup ?? originPart?.activeGroup ?? this.editor.editorParts.activeGroup;
		if (input !== undefined && !group.model.contains(input)) return false;
		const implementation = input === undefined ? target?.resolveCommand(command) : undefined;
		if (implementation !== undefined) return implementation.isChecked?.() === true;
		const part = this.editor.editorParts.partForGroup(group);
		switch (command) {
			case 'window.snapLeft': case 'window.snapRight': case 'window.maximize': {
				const window = originWindowSurface === undefined ? part.window : workbenchWindowForSurface(originWindowSurface);
				return window?.focusTarget.getCommand(command)?.isChecked?.() === true;
			}
			case 'group.maximize': return part.arrangement.maximized === group;
			case 'workspace.hierarchy.toggle': return this.editor.mainWorkspace.regions.hierarchy.displayed;
			case 'workspace.details.toggle': return this.editor.mainWorkspace.regions.details.displayed;
			case 'runtime.toggleTimeline': return group.timeline.requested;
			case 'gameView.togglePanel': return this.editor.gamePanel.enabled;
			case 'debugEvaluation':
				return this.debuggerState.plans.controlSuspended;
			case 'pause':
				return this.runTargets.selected?.transport.execution.userPaused === true;
			case 'resources':
				return this.editor.resourcePanel.visible;
			case 'filter':
				return this.editor.resourcePanel.getFilterMode() === 'lua_only';
			default:
				return false;
		}
	}
}
