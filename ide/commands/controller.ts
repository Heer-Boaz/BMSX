import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { HostAudioOutput } from '../../hosts/common/audio_output';
import type { Input } from '../../machine/ts/input/manager';
import type {
	HostClock,
	LogOutput,
	MicrotaskQueue,
	StorageService,
} from '../../machine/ts/platform/platform';
import type { CartEditor } from '../cart_editor';
import type { EditorCommandId } from '../common/commands';
import type { ActionPromptAction } from '../common/models';
import { renameController } from '../workbench/contrib/code_editor/rename/controller';
import { editorDocumentState } from '../editor/editing/document_state';
import { executeEditorSearchCommand, isEditorSearchCommand } from './search';
import { executeEditorSymbolNavigationCommand, isEditorSymbolNavigationCommand } from './symbol_navigation';
import { executeEditorViewCommand, isEditorViewCommand } from './view';
import { editorViewState } from '../editor/ui/view/state';
import { problemsPanel } from '../workbench/contrib/problems/panel/controller';
import { isCodeTabActive } from '../workbench/ui/code_tab/contexts';
import { executeEditorWorkspaceCommand, isEditorWorkspaceCommand } from './workspace';
import { performEditorAction } from './actions';
import { save } from '../workbench/ui/code_tab/io';
import type { RuntimeSourceState } from '../runtime/sources';
import type { RuntimeFaultState } from '../runtime/fault_state';
import type { RuntimeLuaTooling } from '../runtime/lua_tooling';
import type { GateGroup } from '../../machine/ts/common/taskgate';
import type { OverlayRenderer } from '../runtime/overlay_renderer';

export class IdeCommandController {
	public constructor(
		private readonly editor: CartEditor,
		private readonly sources: RuntimeSourceState,
		private readonly fault: RuntimeFaultState,
		private readonly luaTooling: RuntimeLuaTooling,
		private readonly luaGate: GateGroup,
		private readonly overlayRenderer: OverlayRenderer,
		private readonly runtime: Runtime,
		private readonly input: Input,
		private readonly audioOutput: HostAudioOutput,
		private readonly microtasks: MicrotaskQueue,
		private readonly storage: StorageService,
		private readonly clock: HostClock,
		private readonly logOutput: LogOutput,
	) {
	}

	public execute(command: EditorCommandId): void {
		if (isEditorSymbolNavigationCommand(command)) {
			executeEditorSymbolNavigationCommand(
				this.editor,
				this.sources,
				this.luaTooling,
				this.fault,
				this.runtime,
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
				this.luaGate,
				this.overlayRenderer,
				this.runtime,
				this.input,
				this.audioOutput,
				this.microtasks,
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
		saveBeforeAction: boolean,
	): Promise<boolean> {
		if (saveBeforeAction) {
			await save(
				this.storage,
				this.clock,
				this.editor,
				this.sources,
				this.runtime,
			);
			if (editorDocumentState.dirty) {
				return false;
			}
		}
		return performEditorAction(
			this.editor,
			this.sources,
			this.fault,
			this.luaTooling,
			this.luaGate,
			this.overlayRenderer,
			this.runtime,
			this.input,
			this.audioOutput,
			this.microtasks,
			this.storage,
			this.logOutput,
			action,
		);
	}

	public isEnabled(command: EditorCommandId): boolean {
		switch (command) {
			case 'save':
				return isCodeTabActive() && editorDocumentState.dirty;
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
			case 'filter':
				return this.editor.resourcePanel.getFilterMode() === 'lua_only';
			case 'wrap':
				return editorViewState.wordWrapEnabled;
			default:
				return false;
		}
	}
}
