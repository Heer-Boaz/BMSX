import type { InputFocusTarget } from '../input/focus';

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
	| 'hostError'
	| 'romInspector'
	| 'events'
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
	| 'aem' | 'progression' | 'inputBindings' | 'animation'
	| 'behaviorLens.actionEffects'
	| 'behaviorLens.stateMachines'
	| 'behaviorLens.behaviorTrees'
	| 'scenarioLab'
	| 'sceneEditor'
	| 'cartMap'
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
	| 'scenarioLab.play'
	| 'scenarioLab.debug'
	| 'scenarioLab.continue' | 'scenarioLab.stepInto' | 'scenarioLab.stepOver' | 'scenarioLab.stepOut' | 'scenarioLab.pause' | 'scenarioLab.breakpoints'
	| 'scenarioLab.run'
	| 'scenarioLab.revealRun'
	| 'scenarioLab.rerun'
	| 'scenarioLab.cancel';

export type EditorPlayCommandId =
	| 'play.reveal' | 'play.actors' | 'play.stop' | 'play.reset' | 'play.source' | 'play.breakpoints'
	| 'play.continue' | 'play.stepInto' | 'play.stepOver' | 'play.stepOut'
	| 'play.details' | 'play.more';

export type EditorCommandId =
	| 'romInspector.assets' | 'romInspector.structure' | 'romInspector.code' | 'romInspector.sort' | 'romInspector.source' | 'romInspector.content' | 'romInspector.zoom' | 'romInspector.collision'
	| 'events.clear' | 'events.filter' | 'events.details' | 'events.goToFrame' | 'events.previousFrame' | 'events.nextFrame' | 'events.more'
	| 'resources.import'
	| 'projects.createCartridge'
	| 'conversations.history' | 'conversations.older'
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
	| 'runtime.pause' | 'runtime.present' | 'runtime.resume'
	| 'gameView.playback'
	| 'gameView.togglePanel' | 'gameView.closePanel'
	| 'actorLab.playback' | 'actorLab.select' | 'actorLab.spawn' | 'actorLab.emit' | 'actorLab.actions' | 'actorLab.call' | 'actorLab.details'
	| 'actorLab.stateGraph' | 'actorLab.outline' | 'actorLab.follow' | 'actorLab.revealActive' | 'actorLab.more' | 'actorLab.find'
	| 'actorLab.pinProperty' | 'actorLab.unpinProperty' | 'actorLab.revealPinnedProperty'
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
	| 'animation.create' | 'animation.addTrack' | 'animation.addKey' | 'animation.edit' | 'animation.remove' | 'animation.source' | 'animation.more'
	| 'input.testActionString' | 'behaviorLens.testEffect'
	| 'builds.start' | 'builds.jobs'
	| 'server.connection'
	| 'cartMap.source'
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
	| EditorPlayCommandId
	| EditorScenarioLabCommandId;

export type EditorCommandEnablement = {
	isEnabled(command: EditorCommandId, target?: InputFocusTarget | null): boolean;
};

export interface EditorCommandRunner extends EditorCommandEnablement {
	execute(command: EditorCommandId, target?: InputFocusTarget | null): void;
}
