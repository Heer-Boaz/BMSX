import { editorRuntimeState } from './editor/common/runtime_state';
import { clearWorkspaceDirtyBuffers } from './workbench/workspace/autosave';

import { renderFaultOverlay, renderRuntimeFaultOverlay, showRuntimeError, showRuntimeErrorInChunk } from './editor/render/error_overlay';
import {
	activateRuntimeEditor as activate,
	deactivateRuntimeEditor as deactivate,
	draw,
	shutdownRuntimeEditor as shutdown,
	tickInput,
	update,
} from './editor/ui/runtime';
import { initializeCartEditor } from './editor/ui/bootstrap';
import {
	setFontVariant,
	updateViewport,
} from './editor/ui/view/view';
import { Viewport } from '../rompack/format';
import { clearRuntimeErrorOverlay, clearAllRuntimeErrorOverlays } from './editor/contrib/runtime_error/navigation';
import { getSourceForChunk } from './editor/common/text_runtime';

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
	get isActive(): boolean { return editorRuntimeState.active; },
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
