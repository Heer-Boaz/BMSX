import type { HostExecutionControl } from '../../hosts/common/execution_control';
import { getActiveTab } from '../workbench/ui/tabs';
import { openCreateResourcePrompt } from '../workbench/contrib/resources/create/index';
import { showActionPrompt } from '../workbench/contrib/modal/action_prompt';
import { TextEditorInput } from '../workbench/common/editor_input';
import type { TextFileSaveService } from '../workbench/services/working_copy/text_file_save';
import { saveTextFileFromCommand } from './source_save';
import { editorTextModelService } from '../editor/model/model_service';
import { performEditorAction } from './actions';
import type { HostAudioOutput } from '../../hosts/common/audio_output';
import type { BootService } from '../workbench/services/execution/boot';
import type { HotResumeService } from '../workbench/services/execution/hot_resume';
import type { HostClock } from '../../hosts/common/clock';
import type { LogOutput } from '../../hosts/common/log';
import type { KeyValueStorage } from '../workspace/key_value_storage';
import type { EditorCommandId, EditorWorkspaceCommandId } from '../common/commands';
import type { CartEditor } from '../cart_editor';
import type { RuntimeSourceState } from '../runtime/sources';
import type { OverlayRenderer } from '../runtime/overlay_renderer';
import type { EditorActionRequest } from './action_request';
import { CARTRIDGE_RESOURCE_DOMAINS } from '../common/resource';
import { TextQuickPickProvider } from '../workbench/services/quick_input/text_provider';

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
	audioOutput: HostAudioOutput,
	storage: KeyValueStorage,
	clock: HostClock,
	logOutput: LogOutput,
	textFileSaves: TextFileSaveService,
	command: EditorWorkspaceCommandId,
): void {
	switch (command) {
		case 'createResource':
			openCreateResourcePrompt(editor, sources, storage, clock);
			return;
		case 'save': {
			const activeInput = getActiveTab();
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
					showActionPrompt(request, dirtyWorkingCopies);
					return;
				}
				performEditorAction(editor, hotResumes, boots, execution, overlayRenderer, audioOutput, logOutput, request);
			};
			if (command === 'runCurrentFile' || command === 'runProject') {
				const resource = getActiveTab()?.resource;
				if (resource && resource.domain !== -1
					&& (command === 'runCurrentFile' || sources.cartridgeSlots[resource.domain]!.luaSources.can_boot_from_source)) {
					requestAction({ action: 'run', entry: command === 'runCurrentFile'
						? { domain: resource.domain, sourcePath: resource.path }
						: { domain: resource.domain } });
					return;
				}
				const projects = CARTRIDGE_RESOURCE_DOMAINS
					.filter(domain => sources.cartridgeSlots[domain]?.luaSources.can_boot_from_source)
					.map(domain => ({ domain, label: sources.cartridgeSlots[domain]!.projectRootPath,
						description: `CART ${domain}`, detail: '' }));
				editor.quickInput.pick('RUN PROJECT', 'Choose project', () => new TextQuickPickProvider(projects),
					project => requestAction({ action: 'run', entry: { domain: project.domain } }));
				return;
			}
			requestAction({ action: command });
			return;
		}
	}
}
