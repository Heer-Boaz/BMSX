import type { EditorGroupView } from '../workbench/services/editor/editor_group';
import type { EditorInput } from '../workbench/common/editor_inputs';
import type { EditorCommandDocument } from './context';
import type { HostExecutionControl } from '../../hosts/common/execution_control';
import { openCreateResourcePrompt } from '../workbench/contrib/resources/create/index';
import { TextEditorInput } from '../workbench/common/editor_input';
import type { TextFileSaveService } from '../workbench/services/working_copy/text_file_save';
import { saveTextFileFromCommand } from './source_save';
import { captureEditorActionPresentation } from './actions';
import type { BootService } from '../workbench/services/execution/boot';
import type { HotResumeService } from '../workbench/services/execution/hot_resume';
import type { HostClock } from '../../hosts/common/clock';
import type { EditorCommandId, EditorResourceCreationCommandId, EditorWorkspaceCommandId } from '../common/commands';
import type { NewSourceKind } from '../workbench/contrib/resources/create/source_templates';
import type { CartEditor } from '../cart_editor';
import type { RuntimeSourceState } from '../runtime/sources';
import { canRunSource, showSourceRunPicker } from './run_source';
import type { RunTargetSelection } from '../workbench/services/execution/run_target';
import type { RuntimeTaskQueue } from '../../hosts/common/runtime_task_queue';
import { inputFocus, type FocusCommandInvocation, type InputFocusTarget } from '../input/focus';

const RESOURCE_CREATION_KINDS: Readonly<Record<EditorResourceCreationCommandId, NewSourceKind>> = {
	createResource: 'empty', 'aem.create': 'aem', 'animation.create': 'animation', 'animation.createSprite': 'sprite_animation',
	'progression.createProgram': 'progression', 'input.createBindings': 'input', 'behaviorLens.createEffect': 'action_effect',
};

export function isEditorWorkspaceCommand(command: EditorCommandId): command is EditorWorkspaceCommandId {
	switch (command) {
		case 'createResource':
		case 'aem.create': case 'animation.create': case 'animation.createSprite':
		case 'progression.createProgram': case 'input.createBindings': case 'behaviorLens.createEffect':
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
			if (group === undefined || !(input instanceof TextEditorInput) || !saves.acceptingSaves) return false;
			const pane = group.panes.activePane, focused = inputFocus.target;
			const pending = pane?.input === input && focused?.edit?.pending === true && pane.inputScope.contains(focused.scope);
			return input.canSave(saves, pending);
		}
		case 'hot-resume': return hotResumes.acceptingRequests && !execution.launchPending;
		case 'reboot': return boots.acceptingRequests;
		case 'runCurrentFile': {
			if (group === undefined) return false;
			const resource = input?.resource;
			if (resource === undefined
				|| sources.catalog.getContext(resource.contextId).programDomain !== 'cart') return false;
			const source = sources.catalog.resolveLuaSource(resource);
			return source !== null && source.record.sourceKind !== 'source-only' && !source.record.generated
				&& canRunSource(sources, boots, tasks, 'file', resource.contextId);
		}
		case 'runProject': return group !== undefined && canRunSource(sources, boots, tasks, 'project', input?.resource?.contextId);
		case 'createResource': case 'aem.create': case 'animation.create': case 'animation.createSprite':
		case 'progression.createProgram': case 'input.createBindings': case 'behaviorLens.createEffect':
		case 'theme-toggle': return true;
	}
}

/** Capture the UI subject before accepting its draft; source services remain independent of controls. */
export function captureEditorWorkspaceCommand(
	editor: CartEditor,
	sources: RuntimeSourceState,
	hotResumes: HotResumeService,
	boots: BootService,
	execution: HostExecutionControl,
	clock: HostClock,
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
	switch (command) {
		case 'save':
			if (!enabled()) return;
			break;
		case 'createResource': case 'aem.create': case 'animation.create': case 'animation.createSprite':
		case 'progression.createProgram': case 'input.createBindings': case 'behaviorLens.createEffect':
			return { isEnabled: enabled,
				run: () => openCreateResourcePrompt(editor, destination, sources.catalog, clock, document?.input?.resource, RESOURCE_CREATION_KINDS[command]) };
		case 'theme-toggle': return { isEnabled: enabled, run: () => editor.commands.requestAction({ action: command }) };
		case 'hot-resume': case 'reboot': {
			const presentation = captureEditorActionPresentation(target);
			return { editScope: target?.commandContext.scope, isEnabled: enabled,
				run: () => editor.commands.requestAction({ action: command, presentation }) };
		}
	}
	if (document === undefined) return;
	const { group, input: subject } = document;
	const part = editor.editorParts.partForGroup(group);
	const membership = subject === null ? undefined : group.model.captureMembership(subject);
	if (subject !== null && membership === undefined) return;
	const resource = subject?.resource;
	const pane = group.panes.activePane, attachment = group.panes.openGeneration;
	const attached = pane !== null && pane.input === subject;
	const current = () => !part.retired && !group.surface.retired && editor.editorParts.partForGroup(group) === part
		&& (subject === null || membership!())
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
						if (!model.dirty || !textFileSaves.canSave(model)) continue;
						void saveTextFileFromCommand(textFileSaves, model, editor, sources);
					}
					return;
				}
				case 'runCurrentFile':
				case 'runProject': {
					showSourceRunPicker(editor, sources, boots, tasks, runTargets, part.quickInput,
						command === 'runCurrentFile' ? { kind: 'file', resource: resource! } : { kind: 'project', contextId: resource?.contextId },
						current, presentation, lifetime => {
						lifetime.add({ dispose: group.onWillDispose(() => part.quickInput.hide()) });
						if (subject !== null) lifetime.add({ dispose: subject.onWillDispose(() => part.quickInput.hide()) });
					});
					return;
				}
			}
		} };
}
