import { ide_state } from '../ide_state';
import { RuntimeDebuggerCommandExecutor } from '../ide_debugger';
import { toggleProblemsPanel } from '../problems_panel';
import { toggleWordWrap } from '../editor_view';
import { activateCodeTab, save } from '../editor_tabs';
import { performEditorAction } from './editor_actions';
import { focusRuntimeErrorOverlay } from '../runtime_error_navigation';
import { openSearch } from '../editor_search';
import { openGlobalSymbolSearch, openLineJump, openReferenceSearchPopup, openResourceSearch, openSymbolSearch, openRenamePrompt } from '../search_bars';
import { openCreateResourcePrompt } from '../create_resource';

export const MENU_IDS = ['file', 'run', 'view', 'debug'] as const;
export const MENU_COMMANDS = [
	'hot-resume',
	'reboot',
	'save',
	'resources',
	'problems',
	'filter',
	'wrap',
	'debugContinue',
	'debugStepOver',
	'debugStepInto',
	'debugStepOut',
] as const;

export type EditorCommandId =
	| (typeof MENU_COMMANDS)[number]
	| 'theme-toggle'
	| 'symbolSearch'
	| 'symbolSearchGlobal'
	| 'resourceSearch'
	| 'resourceFilter'
	| 'runtimeErrorFocus'
	| 'createResource'
	| 'findGlobal'
	| 'findLocal'
	| 'lineJump'
	| 'referenceSearch'
	| 'rename';

export function executeTopBarCommand(command: (typeof MENU_COMMANDS)[number]): void {
	executeEditorCommand(command);
}

export function executeEditorCommand(command: EditorCommandId): void {
	switch (command) {
		case 'debugContinue':
			RuntimeDebuggerCommandExecutor.instance.issueDebuggerCommand('continue');
			return;
		case 'debugStepOver':
			RuntimeDebuggerCommandExecutor.instance.issueDebuggerCommand('step_over');
			return;
		case 'debugStepInto':
			RuntimeDebuggerCommandExecutor.instance.issueDebuggerCommand('step_into');
			return;
		case 'debugStepOut':
			RuntimeDebuggerCommandExecutor.instance.issueDebuggerCommand('step_out');
			return;
		case 'symbolSearch':
			openSymbolSearch();
			return;
		case 'symbolSearchGlobal':
			openGlobalSymbolSearch();
			return;
		case 'resourceSearch':
			openResourceSearch();
			return;
		case 'runtimeErrorFocus':
			if (!focusRuntimeErrorOverlay()) {
				openResourceSearch();
			}
			return;
		case 'createResource':
			openCreateResourcePrompt();
			return;
		case 'findGlobal':
			openSearch(true, 'global');
			return;
		case 'findLocal':
			openSearch(true, 'local');
			return;
		case 'lineJump':
			openLineJump();
			return;
		case 'referenceSearch':
			openReferenceSearchPopup();
			return;
		case 'rename':
			openRenamePrompt();
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
		case 'resources':
			ide_state.resourcePanel.togglePanel();
			return;
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
