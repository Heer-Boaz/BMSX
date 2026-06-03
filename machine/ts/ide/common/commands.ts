export type EditorDebugCommandId =
	| 'debugContinue'
	| 'debugStepOver'
	| 'debugStepInto'
	| 'debugStepOut';

export type EditorSearchCommandId =
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
	| 'filter'
	| 'wrap';

export type EditorWorkspaceCommandId =
	| 'hot-resume'
	| 'reboot'
	| 'save'
	| 'theme-toggle';

export type EditorCommandId =
	| EditorDebugCommandId
	| EditorSearchCommandId
	| EditorSymbolNavigationCommandId
	| EditorViewCommandId
	| EditorWorkspaceCommandId;

export type TopBarButtonId = Extract<
	EditorCommandId,
	| 'hot-resume'
	| 'reboot'
	| 'save'
	| 'resources'
	| 'problems'
	| 'filter'
	| 'wrap'
	| 'debugContinue'
	| 'debugStepOver'
	| 'debugStepInto'
	| 'debugStepOut'
>;
