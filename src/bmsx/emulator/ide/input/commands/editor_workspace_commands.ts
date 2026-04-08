import { ide_state } from '../../core/ide_state';
import { activateCodeTab, save } from '../../browser/editor_tabs';
import { performEditorAction } from './editor_actions';
import type { EditorCommandId } from './editor_commands';

export type EditorWorkspaceCommandId =
	| 'hot-resume'
	| 'reboot'
	| 'save'
	| 'theme-toggle';

export function isEditorWorkspaceCommand(command: EditorCommandId): command is EditorWorkspaceCommandId {
	return command === 'hot-resume'
		|| command === 'reboot'
		|| command === 'save'
		|| command === 'theme-toggle';
}

export function executeEditorWorkspaceCommand(command: EditorWorkspaceCommandId): void {
	switch (command) {
		case 'save':
			if (ide_state.dirty) {
				void save();
			}
			return;
		case 'theme-toggle':
		case 'hot-resume':
		case 'reboot':
			activateCodeTab();
			performEditorAction(command);
			return;
	}
}
