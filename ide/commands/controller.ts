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

export class IdeCommandController {
	public constructor(
		private readonly editor: CartEditor,
		private readonly sources: RuntimeSourceState,
		private readonly fault: RuntimeFaultState,
		private readonly luaTooling: RuntimeLuaTooling,
		private readonly debuggerState: RuntimeDebuggerState,
		private readonly input: Input,
		private readonly runtimeTasks: RuntimeTaskQueue,
		private readonly overlayRenderer: OverlayRenderer,
		private readonly runtime: Runtime,
		private readonly audioOutput: HostAudioOutput,
		private readonly storage: KeyValueStorage,
		private readonly clock: HostClock,
		private readonly logOutput: LogOutput,
	) {
	}

	public execute(command: EditorCommandId): void {
		switch (command) {
			case 'scenarioLab.run':
			case 'scenarioLab.rerun':
			case 'scenarioLab.cancel':
				this.editor.scenarioLab.executeCommand(command);
				return;
			case 'debugContinue':
				resumeRuntimeDebugger(this.debuggerState, RuntimeDebuggerResumeMode.Continue);
				clearExecutionStopHighlights();
				deactivateEditor(this.editor, this.overlayRenderer, this.audioOutput);
				return;
			case 'debugStepInto':
				resumeRuntimeDebugger(this.debuggerState, RuntimeDebuggerResumeMode.StepInto);
				clearExecutionStopHighlights();
				deactivateEditor(this.editor, this.overlayRenderer, this.audioOutput);
				return;
			case 'debugStepOut':
				resumeRuntimeDebugger(this.debuggerState, RuntimeDebuggerResumeMode.StepOut);
				clearExecutionStopHighlights();
				deactivateEditor(this.editor, this.overlayRenderer, this.audioOutput);
				return;
			case 'debugStepOver':
				resumeRuntimeDebugger(this.debuggerState, RuntimeDebuggerResumeMode.StepOver);
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
			executeEditorViewCommand(this.editor, command);
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
			this.overlayRenderer,
			this.runtime,
			this.audioOutput,
			this.storage,
			this.logOutput,
			action,
		);
	}

	public isEnabled(command: EditorCommandId): boolean {
		switch (command) {
			case 'scenarioLab.run':
			case 'scenarioLab.rerun':
			case 'scenarioLab.cancel':
				return this.editor.scenarioLab.isCommandEnabled(command);
			case 'debugContinue':
			case 'debugStepInto':
			case 'debugStepOver':
				return this.debuggerState.stopped;
			case 'debugStepOut':
				return this.debuggerState.stopped
					&& (this.debuggerState.stopInlineDepth > 0
						|| this.runtime.machine.cpu.getFrameDepth() > 1);
			case 'save': {
				const activeInput = getActiveTab();
				return activeInput instanceof WorkingCopyEditorInput
					&& !activeInput.workingCopy.readOnly
					&& activeInput.isDirty();
			}
			case 'behaviorLens':
			case 'symbolSearch':
			case 'symbolSearchGlobal':
			case 'referenceSearch':
			case 'goToDefinition':
			case 'callHierarchy':
				return isActiveLuaCodeTab();
			case 'scenarioLab':
				return true;
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
