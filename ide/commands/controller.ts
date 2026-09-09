import { hasStateMachineDetails } from '../workbench/contrib/behavior_lens/state_machine_details';
import type { HostRewind } from '../../hosts/common/rewind';
import { HostPauseReason, type HostExecutionControl } from '../../hosts/common/execution_control';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { HostAudioOutput } from '../../hosts/common/audio_output';
import type { Input } from '../../hosts/common/input/manager';
import type { HostClock } from '../../hosts/common/clock';
import type { LogOutput } from '../../hosts/common/log';
import type { KeyValueStorage } from '../workspace/key_value_storage';
import type { CartEditor } from '../cart_editor';
import type { EditorCommandId } from '../common/commands';
import type { ActionPromptAction } from '../common/models';
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
import { WorkingCopyEditorInput } from '../workbench/common/editor_input';
import { saveTextFileWorkingCopy } from '../workbench/services/working_copy/text_file_save';
import type { EditorTextModel } from '../editor/model/text_model';
import type { RuntimeSourceState } from '../runtime/sources';
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
	'save', 'hot-resume', 'reboot', 'scenarioLab.run', 'scenarioLab.rerun',
	'sceneEditor.removeMember', 'sceneEditor.moveMemberUp', 'sceneEditor.moveMemberDown',
	'behaviorLens.moveChildEarlier', 'behaviorLens.moveChildLater',
	'sceneEditor', 'behaviorLens', 'sceneEditor.source', 'behaviorLens.source', 'behaviorLens.details',
	'behaviorLens.actionEffects', 'behaviorLens.stateMachines', 'behaviorLens.behaviorTrees',
]);

export class IdeCommandController {
	public constructor(
		private readonly editor: CartEditor,
		private readonly sources: RuntimeSourceState,
		private readonly fault: RuntimeFaultState,
		private readonly luaTooling: RuntimeLuaTooling,
		private readonly debuggerState: RuntimeDebuggerState,
		private readonly input: Input,
		private readonly runtimeTasks: RuntimeTaskQueue,
		private readonly execution: HostExecutionControl,
		private readonly rewind: HostRewind,
		private readonly overlayRenderer: OverlayRenderer,
		private readonly runtime: Runtime,
		private readonly audioOutput: HostAudioOutput,
		private readonly storage: KeyValueStorage,
		private readonly clock: HostClock,
		private readonly logOutput: LogOutput,
	) {
	}

	public execute(command: EditorCommandId): void {
		const edit = inputFocus.target?.edit;
		if (SOURCE_COMMANDS.has(command) && edit !== undefined && !edit.commit()) return;
		switch (command) {
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
			case 'undo':
			case 'redo':
			case 'behaviorLens.toggleBranch':
				inputFocus.executeCommand(command);
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
				this.fault,
				this.luaTooling,
				this.debuggerState,
				this.input,
				this.runtimeTasks,
				this.execution,
				this.overlayRenderer,
				this.runtime,
				this.audioOutput,
				this.storage,
				this.clock,
				this.logOutput,
				command,
			);
			return;
		}
		throw new Error(`Unhandled editor command: ${command}`);
	}

	public async executeConfirmedAction(
		action: ActionPromptAction,
		workingCopies: readonly EditorTextModel[],
		saveBeforeAction: boolean,
	): Promise<boolean> {
		if (saveBeforeAction) {
			for (let index = 0; index < workingCopies.length; index += 1) {
				await saveTextFileWorkingCopy(
					workingCopies[index],
					this.storage,
					this.clock,
					this.editor,
					this.sources,
					this.luaTooling,
					this.runtime,
					this.runtimeTasks,
				);
				if (workingCopies[index].dirty) {
					return false;
				}
			}
		}
		return performEditorAction(
			this.editor,
			this.sources,
			this.fault,
			this.luaTooling,
			this.debuggerState,
			this.input,
			this.runtimeTasks,
			this.execution,
			this.overlayRenderer,
			this.runtime,
			this.audioOutput,
			this.storage,
			this.logOutput,
			action,
		);
	}

	public isEnabled(command: EditorCommandId, focus: InputFocusTarget | null = inputFocus.target): boolean {
		switch (command) {
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
			case 'undo':
			case 'redo':
			case 'behaviorLens.toggleBranch': {
				const implementation = focus?.getCommand(command);
				return implementation !== undefined && implementation.isEnabled();
			}
			case 'pause':
				return !this.execution.userPaused || this.runtimeTasks.ready;
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
				return activeInput instanceof WorkingCopyEditorInput
					&& !activeInput.workingCopy.readOnly
					&& (activeInput.isDirty() || focus?.edit?.pending === true);
			}
			case 'symbolSearch':
			case 'symbolSearchGlobal':
			case 'referenceSearch':
			case 'goToDefinition':
			case 'callHierarchy':
				return isActiveLuaCodeTab();
			case 'scenarioLab':
			case 'behaviorLens':
			case 'behaviorLens.actionEffects':
			case 'behaviorLens.stateMachines':
			case 'behaviorLens.behaviorTrees':
			case 'sceneEditor':
				return true;
			case 'sceneEditor.source':
				return getActiveTab().kind === 'scene_editor';
			case 'behaviorLens.details': {
				const input = getActiveTab();
				if (input.kind !== 'behavior_lens' || input.view.selection === null) return false;
				if (input.view.nodesByRowKey.get(input.view.selection.rowKey)!.behaviorKind === 'state_machine') return hasStateMachineDetails(input.view);
				if (input.view.presentation.kind !== 'graph') return false;
				const item = input.view.presentation.viewport.selection;
				if (item === null) return false;
				return (item.kind === 'node' ? item : item.child).details.length > 0;
			}
			case 'behaviorLens.source':
				return getActiveTab().kind === 'behavior_lens';
			case 'rename':
				return isActiveLuaCodeTab() && !activeCodeEditor.model.readOnly;
			case 'createResource':
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
