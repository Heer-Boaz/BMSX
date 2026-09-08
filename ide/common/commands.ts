export type EditorSearchCommandId =
	| 'commandPalette'
	| 'symbolSearch'
	| 'symbolSearchGlobal'
	| 'resourceSearch'
	| 'runtimeErrorFocus'
	| 'createResource'
	| 'findGlobal'
	| 'findLocal'
	| 'lineJump'
	| 'referenceSearch'
	| 'rename';

export type EditorSymbolNavigationCommandId =
	| 'goToDefinition'
	| 'callHierarchy';

export type EditorViewCommandId =
	| 'resources'
	| 'problems'
	| 'behaviorLens'
	| 'behaviorLens.actionEffects'
	| 'behaviorLens.stateMachines'
	| 'behaviorLens.behaviorTrees'
	| 'scenarioLab'
	| 'sceneEditor'
	| 'sceneEditor.source'
	| 'behaviorLens.source'
	| 'filter'
	| 'wrap';

export type EditorWorkspaceCommandId =
	| 'hot-resume'
	| 'reboot'
	| 'save'
	| 'theme-toggle';

export type EditorDebugCommandId =
	| 'pause'
	| 'debugContinue'
	| 'debugStepInto'
	| 'debugStepOut'
	| 'debugStepOver';

export type EditorScenarioLabCommandId =
	| 'scenarioLab.run'
	| 'scenarioLab.rerun'
	| 'scenarioLab.cancel';

export type EditorCommandId =
	| 'undo'
	| 'redo'
	| 'sceneEditor.removeMember'
	| 'sceneEditor.moveMemberUp'
	| 'sceneEditor.moveMemberDown'
	| EditorSearchCommandId
	| EditorSymbolNavigationCommandId
	| EditorViewCommandId
	| EditorWorkspaceCommandId
	| EditorDebugCommandId
	| EditorScenarioLabCommandId;

export type EditorCommandEnablement = {
	isEnabled(command: EditorCommandId): boolean;
};
