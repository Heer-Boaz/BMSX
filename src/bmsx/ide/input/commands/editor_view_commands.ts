import { ide_state } from '../../core/ide_state';
import { toggleProblemsPanel } from '../../contrib/problems/problems_panel';
import { toggleWordWrap } from '../../ui/editor_view';
import type { EditorCommandId } from './editor_commands';

export type EditorViewCommandId =
	| 'resources'
	| 'problems'
	| 'filter'
	| 'wrap';

export function isEditorViewCommand(command: EditorCommandId): command is EditorViewCommandId {
	return command === 'resources'
		|| command === 'problems'
		|| command === 'filter'
		|| command === 'wrap';
}

export function executeEditorViewCommand(command: EditorViewCommandId): void {
	switch (command) {
		case 'resources':
			ide_state.resourcePanel.togglePanel();
			return;
		case 'problems':
			toggleProblemsPanel();
			return;
		case 'filter':
			ide_state.resourcePanel.toggleFilterMode();
			return;
		case 'wrap':
			toggleWordWrap();
			return;
	}
}
