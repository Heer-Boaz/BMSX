import { getActiveTab } from '../workbench/ui/tabs';
import { showActionPrompt } from '../workbench/contrib/modal/action_prompt';
import { WorkingCopyEditorInput } from '../workbench/common/editor_input';
import { saveTextFileWorkingCopy } from '../workbench/services/working_copy/text_file_save';
import { editorTextModelService } from '../editor/model/model_service';
import { performEditorAction } from './actions';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { HostAudioOutput } from '../../hosts/common/audio_output';
import type { Input } from '../../hosts/common/input/manager';
import type { HostClock } from '../../hosts/common/clock';
import type { LogOutput } from '../../hosts/common/log';
import type { KeyValueStorage } from '../workspace/key_value_storage';
import type { EditorCommandId, EditorWorkspaceCommandId } from '../common/commands';
import type { CartEditor } from '../cart_editor';
import type { RuntimeSourceState } from '../runtime/sources';
import type { RuntimeFaultState } from '../runtime/fault_state';
import type { RuntimeLuaTooling } from '../runtime/lua_tooling';
import type { OverlayRenderer } from '../runtime/overlay_renderer';
import type { RuntimeTaskQueue } from '../../hosts/common/runtime_task_queue';
import type { RuntimeDebuggerState } from '../runtime/debugger_state';

export function isEditorWorkspaceCommand(command: EditorCommandId): command is EditorWorkspaceCommandId {
	switch (command) {
		case 'hot-resume':
		case 'reboot':
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
	fault: RuntimeFaultState,
	luaTooling: RuntimeLuaTooling,
	debuggerState: RuntimeDebuggerState,
	input: Input,
	runtimeTasks: RuntimeTaskQueue,
	overlayRenderer: OverlayRenderer,
	runtime: Runtime,
	audioOutput: HostAudioOutput,
	storage: KeyValueStorage,
	clock: HostClock,
	logOutput: LogOutput,
	command: EditorWorkspaceCommandId,
): void {
	switch (command) {
		case 'save': {
			const activeInput = getActiveTab();
			if (activeInput instanceof WorkingCopyEditorInput && activeInput.isDirty()) {
				void saveTextFileWorkingCopy(
					activeInput.workingCopy,
					storage,
					clock,
					editor,
					sources,
					luaTooling,
					runtime,
					runtimeTasks,
				);
			}
			return;
		}
		case 'hot-resume':
		case 'reboot': {
			const dirtyWorkingCopies = editorTextModelService.dirtyWorkingCopies;
			if (dirtyWorkingCopies.length !== 0) {
				showActionPrompt(command, dirtyWorkingCopies);
				return;
			}
			performEditorAction(
				editor,
				sources,
				fault,
				luaTooling,
				debuggerState,
				input,
				runtimeTasks,
				overlayRenderer,
				runtime,
				audioOutput,
				storage,
				logOutput,
				command,
			);
			return;
		}
		case 'theme-toggle':
			performEditorAction(
				editor,
				sources,
				fault,
				luaTooling,
				debuggerState,
				input,
				runtimeTasks,
				overlayRenderer,
				runtime,
				audioOutput,
				storage,
				logOutput,
				command,
			);
			return;
	}
}
