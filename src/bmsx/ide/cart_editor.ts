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
import { clearNativeMemberCompletionCache } from './editor/contrib/intellisense/engine';
import { getTextSnapshot } from './editor/text/source_text';
import { editorDocumentState } from './editor/editing/document_state';
import { findCodeTabContext, getActiveCodeTabContext } from './workbench/ui/code_tab/contexts';
import { buildDirtyFilePath } from './workbench/workspace/io';
import { getWorkspaceCachedSource } from './workspace/cache';
import * as luaPipeline from './runtime/lua_pipeline';
import { Runtime } from '../machine/runtime/runtime';

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
	clearNativeMemberCompletionCache: typeof clearNativeMemberCompletionCache;
};

export function getSourceForChunk(path: string): string {
	const asset = luaPipeline.resolveLuaSourceRecord(Runtime.instance, path);
	const context = findCodeTabContext(path);
	if (context) {
		if (context.id === getActiveCodeTabContext().id) {
			return getTextSnapshot(editorDocumentState.buffer);
		}
		return getTextSnapshot(context.buffer);
	}
	const dirtyPath = buildDirtyFilePath(asset.source_path);
	const cached = getWorkspaceCachedSource(asset.source_path) ?? getWorkspaceCachedSource(dirtyPath);
	if (cached !== null) {
		return cached;
	}
	return asset.src;
}

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
	clearNativeMemberCompletionCache,
};

export function createCartEditor(viewport: Viewport): CartEditor {
	initializeCartEditor(viewport);
	return editorRuntimeApi;
}
