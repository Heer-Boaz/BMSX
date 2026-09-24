export type EditorSearchCommandId =
	| 'commandPalette'
	| 'symbolSearch'
	| 'symbolSearchGlobal'
	| 'resourceSearch'
	| 'runtimeErrorFocus'
	| 'findGlobal'
	| 'findLocal'
	| 'lineJump'
	| 'referenceSearch'
	| 'rename'
	| 'renamePreview';

export type EditorSymbolNavigationCommandId =
	| 'goToDefinition'
	| 'callHierarchy';

export type EditorViewCommandId =
	| 'terminal'
	| 'assistant'
	| 'gameView'
	| 'resources'
	| 'problems'
	| 'behaviorLens'
	| 'behaviorLens.preview'
	| 'keepEditor'
	| 'behaviorLens.actionEffects'
	| 'behaviorLens.stateMachines'
	| 'behaviorLens.behaviorTrees'
	| 'scenarioLab'
	| 'sceneEditor'
	| 'actorLab'
	| 'sceneEditor.source'
	| 'behaviorLens.source'
	| 'filter'
	| 'wrap';

export type EditorWorkspaceCommandId =
	| 'createResource'
	| 'hot-resume'
	| 'reboot'
	| 'runCurrentFile'
	| 'runProject'
	| 'save'
	| 'theme-toggle';

export type EditorDebugCommandId =
	| 'pause'
	| 'stepFrame'
	| 'stepFrameBack'
	| 'debugEvaluation'
	| 'debugContinue'
	| 'debugStepInto'
	| 'debugStepOut'
	| 'debugStepOver';

export type EditorScenarioLabCommandId =
	| 'scenarioLab.run'
	| 'scenarioLab.rerun'
	| 'scenarioLab.cancel';

export type EditorCommandId =
	| 'terminal.evaluate' | 'terminal.pause' | 'terminal.continue' | 'terminal.clear' | 'terminal.copy'
	| 'assistant.signIn'
	| 'assistant.cancelLogin'
	| 'assistant.signOut'
	| 'assistant.openLogin'
	| 'assistant.copyCode'
	| 'assistant.send'
	| 'assistant.queue'
	| 'assistant.direct'
	| 'assistant.history'
	| 'assistant.new'
	| 'assistant.commands'
	| 'assistant.stop'
	| 'assistant.review'
	| 'assistant.copy'
	| 'workspaceEditReview.apply'
	| 'workspaceEditReview.discard'
	| 'gameView.playback'
	| 'actorLab.playback' | 'actorLab.select' | 'actorLab.spawn' | 'actorLab.emit' | 'actorLab.actions' | 'actorLab.call' | 'actorLab.details'
	| 'scenarioLab.details'
	| 'graph.zoomIn'
	| 'graph.zoomOut'
	| 'graph.resetZoom'
	| 'behaviorLens.details'
	| 'behaviorLens.inspectRuntimeEffect'
	| 'behaviorLens.inspectRuntimeStateMachine'
	| 'behaviorLens.inspectRuntimeTree'
	| 'behaviorLens.inspectRegisteredDefinitions'
	| 'behaviorLens.editProperty'
	| 'propertyInspector.source'
	| 'propertyInspector.close'
	| 'contextMenu'
	| 'navigateBack'
	| 'navigateForward'
	| 'sourceEditReview.apply'
	| 'sourceEditReview.discard'
	| 'sourceEditReview.source'
	| 'undo'
	| 'redo'
	| 'behaviorLens.moveChildEarlier'
	| 'behaviorLens.moveChildLater'
	| 'behaviorLens.removeChild'
	| 'behaviorLens.duplicateChild'
	| 'behaviorLens.setInitialState'
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

export interface EditorCommandRunner extends EditorCommandEnablement {
	execute(command: EditorCommandId): void;
}
