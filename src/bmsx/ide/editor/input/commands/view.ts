import { resourcePanel } from '../../../workbench/contrib/resources/panel/controller';
import { toggleProblemsPanel } from '../../../workbench/contrib/problems/panel/controller';
import { toggleWordWrap } from '../../ui/view/view';
import type { EditorCommandId } from './dispatcher';

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
			resourcePanel.togglePanel();
			return;
		case 'problems':
			toggleProblemsPanel();
			return;
		case 'filter':
			resourcePanel.toggleFilterMode();
			return;
		case 'wrap':
			toggleWordWrap();
			return;
	}
}
