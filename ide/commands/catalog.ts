import type { EditorCommandId } from '../common/commands';

export type EditorCommandPresentation = {
	readonly title: string;
	readonly activeTitle?: string;
};

/** Human-facing command metadata. Execution and enablement stay in the controller. */
export const EDITOR_COMMAND_PRESENTATION: Readonly<
	Record<EditorCommandId, EditorCommandPresentation>
> = {
	symbolSearch: { title: 'Go to Symbol' },
	symbolSearchGlobal: { title: 'Go to Symbol in Workspace' },
	resourceSearch: { title: 'Go to File' },
	runtimeErrorFocus: { title: 'Go to Runtime Error' },
	createResource: { title: 'New Resource' },
	findGlobal: { title: 'Find in Workspace' },
	findLocal: { title: 'Find' },
	lineJump: { title: 'Go to Line' },
	referenceSearch: { title: 'Go to References' },
	rename: { title: 'Rename Symbol' },
	goToDefinition: { title: 'Go to Definition' },
	callHierarchy: { title: 'Show Call Hierarchy' },
	resources: { title: 'Show Files', activeTitle: 'Hide Files' },
	problems: { title: 'Problems Panel' },
	behaviorLens: { title: 'Behavior Lens' },
	scenarioLab: { title: 'Scenario Lab' },
	filter: { title: 'All Resources', activeTitle: 'Lua Files Only' },
	wrap: { title: 'Word Wrap' },
	'hot-resume': { title: 'Hot Resume' },
	reboot: { title: 'Reboot' },
	save: { title: 'Save' },
	'theme-toggle': { title: 'Toggle Theme' },
	debugContinue: { title: 'Continue' },
	debugStepInto: { title: 'Step Into' },
	debugStepOut: { title: 'Step Out' },
	debugStepOver: { title: 'Step Over' },
	'scenarioLab.run': { title: 'Run' },
	'scenarioLab.rerun': { title: 'Rerun' },
	'scenarioLab.cancel': { title: 'Cancel' },
};

export function editorCommandTitle(command: EditorCommandId, active: boolean): string {
	const presentation = EDITOR_COMMAND_PRESENTATION[command];
	return active && presentation.activeTitle !== undefined
		? presentation.activeTitle
		: presentation.title;
}
