import type { EditorGroupView } from '../workbench/services/editor/editor_group';
import type { EditorInput } from '../workbench/common/editor_inputs';
import type { EditorCommandDocument } from './context';
import type { HostExecutionControl } from '../../hosts/common/execution_control';
import { openCreateResourcePrompt } from '../workbench/contrib/resources/create/index';
import { TextEditorInput } from '../workbench/common/editor_input';
import type { TextFileSaveService } from '../workbench/services/working_copy/text_file_save';
import { saveTextFileFromCommand } from './source_save';
import { editorTextModelService } from '../editor/model/model_service';
import { captureEditorActionPresentation, performEditorAction } from './actions';
import type { BootService } from '../workbench/services/execution/boot';
import type { HotResumeService } from '../workbench/services/execution/hot_resume';
import type { HostClock } from '../../hosts/common/clock';
import type { LogOutput } from '../../hosts/common/log';
import type { EditorCommandId, EditorWorkspaceCommandId } from '../common/commands';
import type { CartEditor } from '../cart_editor';
import type { Blua32SourceImage, RuntimeSourceState } from '../runtime/sources';
import type { OverlayRenderer } from '../runtime/overlay_renderer';
import type { EditorActionRequest } from './action_request';
import { CARTRIDGE_RESOURCE_DOMAINS } from '../common/resource';
import { TextQuickPickProvider } from '../workbench/services/quick_input/text_provider';
import type { ActionPromptRequest } from '../workbench/contrib/modal/action_prompt_view';
import type { RunTargetSelection } from '../workbench/services/execution/run_target';
import type { RuntimeTaskQueue } from '../../hosts/common/runtime_task_queue';
import { inputFocus, type FocusCommandInvocation, type InputFocusTarget } from '../input/focus';

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

export function isEditorWorkspaceCommand(command: EditorCommandId): command is EditorWorkspaceCommandId {
	switch (command) {
		case 'createResource':
		case 'hot-resume':
		case 'reboot':
		case 'runCurrentFile':
		case 'runProject':
		case 'save':
		case 'theme-toggle':
			return true;
		default:
			return false;
	}
}

export function isEditorWorkspaceCommandEnabled(command: EditorWorkspaceCommandId, group: EditorGroupView | undefined,
	input: EditorInput | null | undefined, sources: RuntimeSourceState, saves: TextFileSaveService, hotResumes: HotResumeService,
	boots: BootService, execution: HostExecutionControl, tasks: RuntimeTaskQueue): boolean {
	switch (command) {
		case 'save': {
			if (group === undefined) return false;
			const pane = group.panes.activePane, focused = inputFocus.target;
			return saves.acceptingSaves && input instanceof TextEditorInput && (input.canSave()
				|| !input.readOnly && pane?.input === input && focused?.edit?.pending === true && pane.inputScope.contains(focused.scope));
		}
		case 'hot-resume': return hotResumes.acceptingRequests && !execution.launchPending;
		case 'reboot': return boots.acceptingRequests;
		case 'runCurrentFile': {
			if (group === undefined) return false;
			const resource = input?.resource;
			if (!boots.acceptingRequests || !tasks.ready || resource === undefined
				|| sources.catalog.getContext(resource.contextId).programDomain !== 'cart') return false;
			const source = sources.catalog.resolveLuaSource(resource);
			return source !== null && source.record.sourceKind !== 'source-only' && !source.record.generated;
		}
		case 'runProject': return group !== undefined && boots.acceptingRequests && tasks.ready
			&& sources.cartridgeSlots.some(cart => cart !== null && sources.catalog.getContext(cart.contextId).luaSources.can_boot_from_source);
		case 'createResource': case 'theme-toggle': return true;
	}
}

/** Capture the UI subject before accepting its draft; source services remain independent of controls. */
export function captureEditorWorkspaceCommand(
	editor: CartEditor,
	sources: RuntimeSourceState,
	hotResumes: HotResumeService,
	boots: BootService,
	execution: HostExecutionControl,
	overlayRenderer: OverlayRenderer,
	clock: HostClock,
	logOutput: LogOutput,
	textFileSaves: TextFileSaveService,
	command: EditorWorkspaceCommandId,
	destination: EditorGroupView,
	document: EditorCommandDocument | undefined,
	runTargets: RunTargetSelection,
	tasks: RuntimeTaskQueue,
	target: InputFocusTarget | null,
): FocusCommandInvocation | undefined {
	const enabled = () => isEditorWorkspaceCommandEnabled(command, document?.group, document?.input,
		sources, textFileSaves, hotResumes, boots, execution, tasks);
	const requestAction = (request: EditorActionRequest): void => {
		if (request.action !== 'theme-toggle' && editorTextModelService.dirtyWorkingCopies.length !== 0) {
			void editor.actionPrompt.show(ACTION_PROMPTS[request.action]).then(choice => {
				if (choice !== 'cancel') return editor.commands.executeConfirmedAction(request, choice === 'primary');
			}).catch(error => editor.handleRuntimeTaskError(error, 'Source action failed'));
			return;
		}
		performEditorAction(editor, hotResumes, boots, execution, overlayRenderer, logOutput, request, runTargets);
	};
	switch (command) {
		case 'createResource': return { isEnabled: enabled, run: () => openCreateResourcePrompt(editor, destination, sources.catalog, clock) };
		case 'theme-toggle': return { isEnabled: enabled, run: () => requestAction({ action: command }) };
		case 'hot-resume': case 'reboot': {
			const presentation = captureEditorActionPresentation(target);
			return { editScope: target?.commandContext.scope, isEnabled: enabled,
				run: () => requestAction({ action: command, presentation }) };
		}
	}
	if (document === undefined) return;
	const { group, input: subject } = document;
	const part = editor.editorParts.partForGroup(group);
	const resource = subject?.resource;
	const pane = group.panes.activePane, attachment = group.panes.openGeneration;
	const attached = pane !== null && pane.input === subject;
	const current = () => !part.retired && !group.surface.retired && editor.editorParts.partForGroup(group) === part
		&& (subject === null || group.model.contains(subject))
		&& (!attached || group.panes.openGeneration === attachment && group.panes.activePane === pane);
	const presentation = command === 'save' ? undefined : captureEditorActionPresentation(target);
	const editScope = command === 'save' ? attached ? pane.inputScope : undefined
		: target?.commandContext.scope;
	return { editScope, isEnabled: () => current()
		&& isEditorWorkspaceCommandEnabled(command, group, subject, sources, textFileSaves, hotResumes, boots, execution, tasks) && current(),
		run: () => {
			if (!current()) return;
			switch (command) {
				case 'save': {
					if (subject instanceof TextEditorInput) for (const model of subject.getWorkingCopies()) {
						if (!model.dirty || model.readOnly) continue;
						void saveTextFileFromCommand(textFileSaves, model, editor, sources);
					}
					return;
				}
				case 'runCurrentFile':
				case 'runProject': {
					const projects: Array<{ domain: 0 | 1; image: Blua32SourceImage; label: string; description: string; detail: string }> = [];
					for (const domain of CARTRIDGE_RESOURCE_DOMAINS) {
						const image = sources.currentBlua32Media.cartridgeSlots[domain];
						if (image === null || resource !== undefined && image.sourceContextId !== resource.contextId) continue;
						const context = sources.catalog.getContext(image.sourceContextId);
						if (command === 'runProject' && !context.luaSources.can_boot_from_source) continue;
						projects.push({ domain, image, label: context.projectRootPath, description: `Physical ${domain}`,
							detail: command === 'runCurrentFile' ? resource!.path : 'Run this installed source context' });
					}
					part.quickInput.pick(command === 'runCurrentFile' ? 'RUN CURRENT FILE' : 'RUN PROJECT', 'Choose the actual installed execution attachment', (_origin, lifetime) => {
						lifetime.add({ dispose: group.onWillDispose(() => part.quickInput.hide()) });
						if (subject !== null) lifetime.add({ dispose: subject.onWillDispose(() => part.quickInput.hide()) });
						return new TextQuickPickProvider(projects);
					}, project => {
						if (!current() || sources.currentBlua32Media.cartridgeSlots[project.domain] !== project.image) return;
						requestAction({ action: 'run', expectedImage: project.image, selectionRequest: runTargets.request(), entry: command === 'runCurrentFile'
							? { domain: project.domain, sourcePath: resource!.path } : { domain: project.domain },
							presentation });
					});
					return;
				}
			}
		} };
}
