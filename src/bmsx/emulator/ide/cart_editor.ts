import { ide_state } from './ide_state';
import { clearWorkspaceDirtyBuffers } from './workspace_storage';

import { renderFaultOverlay, renderRuntimeFaultOverlay, showRuntimeError, showRuntimeErrorInChunk } from './render/render_error_overlay';
import {
	activateRuntimeEditor as activate,
	deactivateRuntimeEditor as deactivate,
	draw,
	shutdownRuntimeEditor as shutdown,
	tickInput,
	update,
} from './editor_runtime';
import { initializeCartEditor } from './editor_bootstrap';
import {
	setFontVariant,
	updateViewport,
} from './editor_view';
import { Viewport } from '../../rompack/rompack';
import { clearRuntimeErrorOverlay, clearAllRuntimeErrorOverlays } from './runtime_error_navigation';
import { getSourceForChunk } from './text_utils';

export { activate, deactivate, draw, shutdown, tickInput, update };

export type CartEditor = {
	readonly blocksRuntimePipeline: true;
	isActive: boolean;
	activate: typeof activate;
	deactivate: typeof deactivate;
	tickInput: typeof tickInput;
	update: typeof update;
	draw: typeof draw;
	shutdown: typeof shutdown;
	updateViewport: typeof updateViewport;
	setFontVariant: typeof setFontVariant;
	showRuntimeErrorInChunk: typeof showRuntimeErrorInChunk;
	showRuntimeError: typeof showRuntimeError;
	clearRuntimeErrorOverlay: typeof clearRuntimeErrorOverlay;
	clearAllRuntimeErrorOverlays: typeof clearAllRuntimeErrorOverlays;
	getSourceForChunk: typeof getSourceForChunk;
	clearWorkspaceDirtyBuffers: typeof clearWorkspaceDirtyBuffers;
	renderFaultOverlay: typeof renderFaultOverlay;
	renderRuntimeFaultOverlay: typeof renderRuntimeFaultOverlay;
};

const editorRuntimeApi: CartEditor = {
	blocksRuntimePipeline: true,
	get isActive(): boolean { return ide_state.active; },
	activate,
	deactivate,
	tickInput,
	update,
	draw,
	shutdown,
	updateViewport,
	setFontVariant,
	showRuntimeErrorInChunk,
	showRuntimeError,
	clearRuntimeErrorOverlay,
	clearAllRuntimeErrorOverlays,
	getSourceForChunk,
	clearWorkspaceDirtyBuffers,
	renderFaultOverlay,
	renderRuntimeFaultOverlay,
};

export function createCartEditor(viewport: Viewport): CartEditor {
	initializeCartEditor(viewport);
	return editorRuntimeApi;
}

// Re-exports for backward compatibility — consumers should migrate to the canonical modules.
export { getSourceForChunk, invalidateLineRange, getLineRangeForMovement, currentLine } from './text_utils';
export { prepareUndo, applyUndoableReplace, undo, redo, breakUndoSequence, captureSnapshot, restoreSnapshot, type RestoreSnapshotOptions } from './undo_controller';
export { openLuaCodeTab, focusChunkSource, listResourcesStrict, openResourceDescriptor, isActive, focusEditorFromResourcePanel, closeActiveTab, resetEditorContent, save, recordEditContext, applySourceToDocument } from './editor_tabs';
export { clearRuntimeErrorOverlay, clearAllRuntimeErrorOverlays, setActiveRuntimeErrorOverlay, setExecutionStopHighlight, clearExecutionStopHighlights, syncRuntimeErrorOverlayFromContext, tryShowLuaErrorOverlay } from './runtime_error_navigation';
export { getBuiltinIdentifiersSnapshot, getBuiltinIdentifierSet, safeInspectLuaExpression, applyDefinitionSelection, findFunctionDefinitionRowInActiveFile } from './intellisense';
export { processDiagnosticsQueue, scheduleDiagnosticsComputation, executeDiagnosticsComputation, enqueueDiagnosticsJob, collectDiagnosticsBatch, runDiagnosticsForContexts, createDiagnosticProviders, updateDiagnosticsAggregates, refreshActiveDiagnostics, markDiagnosticsDirtyForChunk, getActiveSemanticDefinitions, getLuaModuleAliases, findContextByChunk, getDiagnosticsForRow, gotoDiagnostic } from './diagnostics_controller';
export { cancelSearchJob, applySearchFieldText, processInlineFieldPointer } from './editor_search';
export { updateDesiredColumn } from './caret';
export { beginNavigationCapture, completeNavigation, pushNavigationEntry, areNavigationEntriesEqual, createNavigationEntry, withNavigationCaptureSuspended, applyNavigationEntry, goBackwardInNavigationHistory, goForwardInNavigationHistory } from './navigation_history';
export { toggleLineComments, addLineComments, removeLineComments, firstNonWhitespaceIndex, shiftPositionsForInsertion, shiftPositionsForRemoval } from './line_comments';
export { handleRuntimeTaskError } from './editor_runtime';
