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
	| 'home'
	| 'hostError'
	| 'romInspector'
	| 'events'
	| 'gteDebugger'
	| 'gpuDebugger'
	| 'terminal'
	| 'conversations'
	| 'assistant'
	| 'gameView'
	| 'resources'
	| 'resources.focus'
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
	| 'scenarioLab.playWithCompanion'
	| 'scenarioLab.debug'
	| 'scenarioLab.debugWithCompanion'
	| 'scenarioLab.continue' | 'scenarioLab.stepInto' | 'scenarioLab.stepOver' | 'scenarioLab.stepOut' | 'scenarioLab.pause' | 'scenarioLab.breakpoints'
	| 'scenarioLab.run'
	| 'scenarioLab.runWithCompanion'
	| 'scenarioLab.revealRun'
	| 'scenarioLab.rerun'
	| 'scenarioLab.cancel';

export type EditorPlayCommandId =
	| 'play.reveal' | 'play.actors' | 'play.stop' | 'play.reset' | 'play.source' | 'play.breakpoints'
	| 'play.continue' | 'play.stepInto' | 'play.stepOver' | 'play.stepOut'
	| 'play.details' | 'play.more';

export type EditorCommandId =
	| 'romInspector.inspect' | 'romInspector.hold' | 'romInspector.key' | 'romInspector.assets' | 'romInspector.structure' | 'romInspector.code' | 'romInspector.sort' | 'romInspector.source' | 'romInspector.content' | 'romInspector.zoom' | 'romInspector.collision'
	| 'events.clear' | 'events.filter' | 'events.details' | 'events.goToFrame' | 'events.previousFrame' | 'events.nextFrame' | 'events.more'
	| 'gpu.follow' | 'gpu.view' | 'gpu.details' | 'gpu.goToFrame' | 'gpu.filter' | 'gpu.clear'
	| 'gte.follow' | 'gte.view' | 'gte.details' | 'gte.source' | 'gte.goToFrame' | 'gte.filter' | 'gte.clear'
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
	| 'workspaceEditReview.source'
	| 'workspaceEditReview.impacts'
	| 'runtime.pause' | 'runtime.present' | 'runtime.accept' | 'runtime.resume' | 'runtime.focusTimeline' | 'runtime.hideTimeline' | 'runtime.toggleTimeline'
	| 'runtime.playback'
	| 'gameView.togglePanel' | 'gameView.closePanel'
	| 'actorLab.playback' | 'actorLab.select' | 'actorLab.spawn' | 'actorLab.emit' | 'actorLab.actions' | 'actorLab.call' | 'actorLab.details'
	| 'actorLab.stateGraph' | 'actorLab.outline' | 'actorLab.follow' | 'actorLab.revealActive' | 'actorLab.more' | 'actorLab.find'
	| 'actorLab.pinProperty' | 'actorLab.unpinProperty' | 'actorLab.revealPinnedProperty' | 'actorLab.lockDetails'
	| 'scenarioLab.details'
	| 'scenarioLab.inspectTarget'
	| 'scenarioLab.inspectStop'
	| 'scenarioLab.closeTarget'
	| 'graph.zoomIn'
	| 'graph.zoomOut'
	| 'graph.resetZoom'
	| 'behaviorLens.details'
	| 'behaviorLens.source'
	| 'behaviorLens.inspectRuntimeEffect'
	| 'behaviorLens.inspectRuntimeStateMachine'
	| 'behaviorLens.inspectRuntimeTree'
	| 'behaviorLens.inspectRegisteredDefinitions'
	| 'behaviorLens.editProperty'
	| 'behaviorLens.addProperty' | 'behaviorLens.removeProperty'
	| 'propertyInspector.source'
	| 'propertyInspector.close'
	| 'problems.coverage'
	| 'window.minimize' | 'window.maximize' | 'window.hide' | 'window.snapLeft' | 'window.snapRight' | 'window.restore'
	| 'window.showAll' | 'window.restoreMinimized' | 'window.focusMain' | 'window.newEditor' | 'window.copyEditor'
	| 'luaProgram.edit' | 'luaProgram.add' | 'luaProgram.remove' | 'luaProgram.source' | 'luaProgram.live' | 'luaProgram.authoring' | 'luaProgram.selectInstance' | 'luaProgram.more' | 'luaProgram.testInput'
	| 'tabs.close' | 'tabs.next' | 'tabs.previous'
	| 'tabs.scrollLeft' | 'tabs.scrollRight'
	| 'progression.createProgram' | 'input.createBindings' | 'behaviorLens.createEffect' | 'aem.create' | 'aem.edit' | 'aem.add' | 'aem.remove' | 'aem.source' | 'aem.apply' | 'aem.testEvent'
	| 'animation.create' | 'animation.createSprite' | 'animation.addTrack' | 'animation.addKey'
	| 'animation.edit' | 'animation.remove' | 'animation.source' | 'animation.producerSource'
	| 'animation.fit' | 'animation.snap' | 'animation.addClip' | 'animation.addFrame' | 'animation.addProperty'
	| 'animation.openClip' | 'animation.duplicate' | 'animation.earlier' | 'animation.later' | 'animation.more'
	| 'animation.tracks' | 'animation.keys' | 'animation.details'
	| 'input.testActionString' | 'behaviorLens.testEffect'
	| 'builds.start' | 'builds.jobs'
	| 'buildLog.refresh' | 'buildLog.copyAll' | 'buildLog.output' | 'buildLog.error'
	| 'text.find' | 'text.findNext' | 'text.findPrevious'
	| 'server.connection'
	| 'cartMap.source'
	| 'cartMap.map' | 'cartMap.outline'
	| 'contextMenu'
	| 'list.find'
	| 'menubar.focus'
	| 'navigateBack'
	| 'navigateForward'
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
	| 'sceneEditor.source' | 'sceneEditor.details' | 'sceneEditor.outline'
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
