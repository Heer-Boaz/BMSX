import { activateCodeTab } from '../workbench/ui/tabs';
import { save } from '../workbench/ui/code_tab/io';
import { showActionPrompt } from '../workbench/contrib/modal/action_prompt';
import { performEditorAction } from './actions';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { HostAudioOutput } from '../../hosts/common/audio_output';
import type { Input } from '../../hosts/common/input/manager';
import type { HostClock } from '../../hosts/common/clock';
import type { LogOutput } from '../../hosts/common/log';
import type { KeyValueStorage } from '../workspace/key_value_storage';
import type { EditorCommandId, EditorWorkspaceCommandId } from '../common/commands';
import { activeCodeEditor } from '../editor/ui/code_editor_state';
import type { CartEditor } from '../cart_editor';
import type { RuntimeSourceState } from '../runtime/sources';
import type { RuntimeFaultState } from '../runtime/fault_state';
import type { RuntimeLuaTooling } from '../runtime/lua_tooling';
import type { OverlayRenderer } from '../runtime/overlay_renderer';
import type { RuntimeTaskQueue } from '../runtime/task_queue';
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
		case 'save':
			if (activeCodeEditor.model.dirty) {
				void save(
					storage,
					clock,
					editor,
					sources,
					luaTooling,
					runtime,
				);
			}
			return;
		case 'hot-resume':
		case 'reboot':
			activateCodeTab(editor.editorPanes);
			if (activeCodeEditor.model.dirty) {
				showActionPrompt(command);
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
		case 'theme-toggle':
			activateCodeTab(editor.editorPanes);
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
