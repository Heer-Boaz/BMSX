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
import { clearRuntimeErrorOverlay, clearAllRuntimeErrorOverlays } from './contrib/runtime_error/runtime_error_navigation';
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
