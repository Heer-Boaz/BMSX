import type { EditorGroupView } from '../workbench/services/editor/editor_group';
import type { HostExecutionControl } from '../../hosts/common/execution_control';
import { openCreateResourcePrompt } from '../workbench/contrib/resources/create/index';
import { TextEditorInput } from '../workbench/common/editor_input';
import type { TextFileSaveService } from '../workbench/services/working_copy/text_file_save';
import { saveTextFileFromCommand } from './source_save';
import { editorTextModelService } from '../editor/model/model_service';
import { performEditorAction } from './actions';
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

export function executeEditorWorkspaceCommand(
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
	group: EditorGroupView,
	runTargets: RunTargetSelection,
): void {
	const part = editor.editorParts.partForGroup(group);
	switch (command) {
		case 'createResource':
			openCreateResourcePrompt(editor, group, sources.catalog, clock);
			return;
		case 'save': {
			const activeInput = group.model.activeTab;
			if (activeInput instanceof TextEditorInput) for (const model of activeInput.getWorkingCopies()) {
				if (!model.dirty || model.readOnly) continue;
				void saveTextFileFromCommand(textFileSaves, model, editor, sources);
			}
			return;
		}
		case 'hot-resume':
		case 'reboot':
		case 'runCurrentFile':
		case 'runProject':
		case 'theme-toggle': {
			const requestAction = (request: EditorActionRequest): void => {
				const dirtyWorkingCopies = editorTextModelService.dirtyWorkingCopies;
				if (request.action !== 'theme-toggle' && dirtyWorkingCopies.length !== 0) {
					void editor.actionPrompt.show(ACTION_PROMPTS[request.action]).then(choice => {
						if (choice !== 'cancel') return editor.commands.executeConfirmedAction(request, choice === 'primary');
					}).catch(error => editor.handleRuntimeTaskError(error, 'Source action failed'));
					return;
				}
				performEditorAction(editor, hotResumes, boots, execution, overlayRenderer, logOutput, request, runTargets);
			};
			if (command === 'runCurrentFile' || command === 'runProject') {
				const input = group.model.activeTab, resource = input?.resource;
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
					if (input !== undefined) lifetime.add({ dispose: input.onWillDispose(() => part.quickInput.hide()) });
					return new TextQuickPickProvider(projects);
				}, project => {
					if (sources.currentBlua32Media.cartridgeSlots[project.domain] !== project.image) return;
					requestAction({ action: 'run', expectedImage: project.image, selectionRequest: runTargets.request(), entry: command === 'runCurrentFile'
						? { domain: project.domain, sourcePath: resource!.path } : { domain: project.domain },
						presentation: { group, generation: group.panes.openGeneration } });
				});
				return;
			}
			if (command === 'reboot' || command === 'hot-resume')
				requestAction({ action: command, presentation: { group, generation: group.panes.openGeneration } });
			else requestAction({ action: command });
			return;
		}
	}
}
