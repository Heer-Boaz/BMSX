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
	| 'conversations'
	| 'assistant'
	| 'gameView'
	| 'resources'
	| 'problems'
	| 'behaviorLens'
	| 'behaviorLens.preview'
	| 'keepEditor'
	| 'openEditors'
	| 'aem' | 'progression' | 'inputBindings'
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
	| 'scenarioLab.debug'
	| 'scenarioLab.continue' | 'scenarioLab.stepInto' | 'scenarioLab.stepOver' | 'scenarioLab.stepOut' | 'scenarioLab.pause' | 'scenarioLab.breakpoints'
	| 'scenarioLab.run'
	| 'scenarioLab.revealRun'
	| 'scenarioLab.rerun'
	| 'scenarioLab.cancel';

export type EditorCommandId =
	| 'resources.import'
	| 'projects.createCartridge'
	| 'conversations.history' | 'conversations.older'
	| 'terminal.evaluate' | 'terminal.context' | 'terminal.pause' | 'terminal.continue' | 'terminal.clear' | 'terminal.copy'
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
	| 'runtime.pause' | 'runtime.present'
	| 'gameView.playback'
	| 'gameView.togglePanel' | 'gameView.closePanel'
	| 'actorLab.playback' | 'actorLab.select' | 'actorLab.spawn' | 'actorLab.emit' | 'actorLab.actions' | 'actorLab.call' | 'actorLab.details'
	| 'scenarioLab.details'
	| 'scenarioLab.inspectTarget'
	| 'scenarioLab.inspectStop'
	| 'scenarioLab.closeTarget'
	| 'graph.zoomIn'
	| 'graph.zoomOut'
	| 'graph.resetZoom'
	| 'behaviorLens.details'
	| 'behaviorLens.more'
	| 'behaviorLens.inspectRuntimeEffect'
	| 'behaviorLens.inspectRuntimeStateMachine'
	| 'behaviorLens.inspectRuntimeTree'
	| 'behaviorLens.inspectRegisteredDefinitions'
	| 'behaviorLens.editProperty'
	| 'behaviorLens.addProperty' | 'behaviorLens.removeProperty'
	| 'propertyInspector.source'
	| 'propertyInspector.close'
	| 'luaProgram.edit' | 'luaProgram.add' | 'luaProgram.remove' | 'luaProgram.source' | 'luaProgram.live' | 'luaProgram.authoring' | 'luaProgram.selectInstance' | 'luaProgram.more' | 'luaProgram.testInput'
	| 'tabs.scrollLeft' | 'tabs.scrollRight'
	| 'progression.createProgram' | 'input.createBindings' | 'behaviorLens.createEffect' | 'aem.edit' | 'aem.add' | 'aem.remove' | 'aem.source' | 'aem.testEvent'
	| 'input.testActionString' | 'behaviorLens.testEffect'
	| 'builds.start' | 'builds.jobs'
	| 'server.connection'
	| 'contextMenu'
	| 'navigateBack'
	| 'navigateForward'
	| 'sourceEditReview.apply'
	| 'sourceEditReview.discard'
	| 'sourceEditReview.source'
	| 'undo'
	| 'redo'
	| 'copy' | 'cut' | 'paste'
	| 'suggest.accept'
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
