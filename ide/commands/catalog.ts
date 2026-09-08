import type { EditorCommandId } from '../common/commands';

export type EditorCommandPresentation = {
	readonly title: string;
	readonly category: string;
	readonly shortTitle?: string;
	readonly activeTitle?: string;
};

/** Human-facing command metadata. Execution and enablement stay in the controller. */
export const EDITOR_COMMAND_PRESENTATION: Readonly<
	Record<EditorCommandId, EditorCommandPresentation>
> = {
	commandPalette: { category: 'View', title: 'Command Palette' },
	undo: { category: 'Edit', title: 'Undo' },
	redo: { category: 'Edit', title: 'Redo' },
	symbolSearch: { category: 'Go', title: 'Go to Symbol' },
	symbolSearchGlobal: { category: 'Go', title: 'Go to Symbol in Workspace' },
	resourceSearch: { category: 'Go', title: 'Go to File' },
	runtimeErrorFocus: { category: 'Go', title: 'Go to Runtime Error' },
	createResource: { category: 'File', title: 'New Resource' },
	findGlobal: { category: 'Go', title: 'Find in Workspace' },
	findLocal: { category: 'Go', title: 'Find' },
	lineJump: { category: 'Go', title: 'Go to Line' },
	referenceSearch: { category: 'Go', title: 'Go to References' },
	rename: { category: 'Go', title: 'Rename Symbol' },
	goToDefinition: { category: 'Go', title: 'Go to Definition' },
	callHierarchy: { category: 'Go', title: 'Show Call Hierarchy' },
	resources: { category: 'View', title: 'Show Files', activeTitle: 'Hide Files' },
	problems: { category: 'View', title: 'Problems Panel' },
	behaviorLens: { category: 'View', title: 'Behavior Lens' },
	scenarioLab: { category: 'View', title: 'Scenario Lab' },
	sceneEditor: { category: 'View', title: 'Scene Editor' },
	'sceneEditor.source': { category: 'Scene Editor', title: 'Open Source', shortTitle: 'Source' },
	'behaviorLens.source': { category: 'Behavior Lens', title: 'Open Source', shortTitle: 'Source' },
	'sceneEditor.removeMember': { category: 'Scene Editor', title: 'Remove Member', shortTitle: 'Remove' },
	'sceneEditor.moveMemberUp': { category: 'Scene Editor', title: 'Move Member Up', shortTitle: 'Up' },
	'sceneEditor.moveMemberDown': { category: 'Scene Editor', title: 'Move Member Down', shortTitle: 'Down' },
	filter: { category: 'View', title: 'All Resources', activeTitle: 'Lua Files Only' },
	wrap: { category: 'View', title: 'Word Wrap' },
	'hot-resume': { category: 'Run', title: 'Hot Resume' },
	reboot: { category: 'Run', title: 'Reboot' },
	save: { category: 'File', title: 'Save' },
	'theme-toggle': { category: 'View', title: 'Toggle Theme' },
	debugContinue: { category: 'Debug', title: 'Continue' },
	pause: { category: 'Run', title: 'Pause', activeTitle: 'Resume' },
	debugStepInto: { category: 'Debug', title: 'Step Into' },
	debugStepOut: { category: 'Debug', title: 'Step Out' },
	debugStepOver: { category: 'Debug', title: 'Step Over' },
	'scenarioLab.run': { category: 'Scenario Lab', title: 'Run Scenarios', shortTitle: 'Run' },
	'scenarioLab.rerun': { category: 'Scenario Lab', title: 'Rerun Scenarios', shortTitle: 'Rerun' },
	'scenarioLab.cancel': { category: 'Scenario Lab', title: 'Cancel Run', shortTitle: 'Cancel' },
};

export const EDITOR_COMMAND_IDS = Object.keys(EDITOR_COMMAND_PRESENTATION) as EditorCommandId[];

export function editorCommandTitle(command: EditorCommandId, active: boolean): string {
	const presentation = EDITOR_COMMAND_PRESENTATION[command];
	return active && presentation.activeTitle !== undefined
		? presentation.activeTitle
		: presentation.title;
}
