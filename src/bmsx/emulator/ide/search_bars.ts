import { scheduleMicrotask } from '../../platform/platform';
import { clamp } from '../../utils/clamp';
import * as constants from './constants';
import { ide_state } from './ide_state';
import { clearReferenceHighlights, extractHoverExpression, navigateToLuaDefinition } from './intellisense';
import { closeSearch } from './editor_search';
import { getActiveCodeTabContext, listResourcesStrict, openResourceDescriptor } from './editor_tabs';
import { resetBlink } from './render/render_caret';
import { setFieldText } from './inline_text_field';
import {
	resourceSearchWindowCapacity,
	symbolSearchPageSize,
} from './editor_view';
import { refreshSymbolCatalog } from './symbol_catalog';
import { symbolPriority } from './semantic_model';
import { getTextSnapshot, splitText } from './text/source_text';
import {
	buildReferenceCatalogForExpression as buildProjectReferenceCatalog,
	type ProjectReferenceEnvironment,
	type ReferenceCatalogEntry,
	type ReferenceSymbolEntry,
	filterReferenceCatalog,
} from './reference_sources';
import { resolveReferenceLookup } from './reference_navigation';
import type { CodeTabContext, SymbolSearchResult } from './types';
import type { ReferenceMatchInfo } from './reference_state';
import { getOrCreateSemanticWorkspace } from './semantic_workspace_sync';
import type { ResourceDescriptor } from '../types';
import { Runtime } from '../runtime';
import * as runtimeLuaPipeline from '../runtime_lua_pipeline';
import { beginNavigationCapture, completeNavigation } from './navigation_history';
import { ensureCursorVisible, setCursorPosition, updateDesiredColumn } from './caret';
import { breakUndoSequence } from './undo_controller';
import * as TextEditing from './text_editing_and_selection';
import { $ } from '../../core/engine_core';

// ── Resource search lifecycle ────────────────────────────────────

export function openResourceSearch(initialQuery: string = ''): void {
	clearReferenceHighlights();
	closeSearch(false, true);
	closeLineJump(false);
	closeSymbolSearch(false);
	ide_state.renameController.cancel();
	ide_state.resourceSearchVisible = true;
	ide_state.resourceSearchActive = true;
	applyResourceSearchFieldText(initialQuery, true);
	refreshResourceCatalog();
	updateResourceSearchMatches();
	ide_state.resourceSearchHoverIndex = -1;
	resetBlink();
}

export function closeResourceSearch(clearQuery: boolean): void {
	if (clearQuery) {
		applyResourceSearchFieldText('', true);
	}
	ide_state.resourceSearchActive = false;
	ide_state.resourceSearchVisible = false;
	ide_state.resourceSearchMatches = [];
	ide_state.resourceSearchSelectionIndex = -1;
	ide_state.resourceSearchDisplayOffset = 0;
	ide_state.resourceSearchHoverIndex = -1;
	ide_state.resourceSearchField.selectionAnchor = null;
	ide_state.resourceSearchField.pointerSelecting = false;
	resetBlink();
}

export function focusEditorFromResourceSearch(): void {
	if (!ide_state.resourceSearchActive && !ide_state.resourceSearchVisible) {
		return;
	}
	ide_state.resourceSearchActive = false;
	if (ide_state.resourceSearchQuery.length === 0) {
		ide_state.resourceSearchVisible = false;
		ide_state.resourceSearchMatches = [];
		ide_state.resourceSearchSelectionIndex = -1;
		ide_state.resourceSearchDisplayOffset = 0;
	}
	ide_state.resourceSearchField.selectionAnchor = null;
	ide_state.resourceSearchField.pointerSelecting = false;
	resetBlink();
}

export function refreshResourceCatalog(): void {
	try {
		const descriptors = listResourcesStrict();
		const augmented = descriptors.slice();
		const imgAssets = Object.values($.assets.img);
		for (const asset of imgAssets) {
			if (asset.type !== 'atlas') {
				continue;
			}
			const key = asset.resid;
			if (key !== '_atlas_primary' && !key.startsWith('atlas') && !key.startsWith('_atlas_')) {
				continue;
			}
			if (augmented.some(entry => entry.asset_id === key)) {
				continue;
			}
			augmented.push({ path: `atlas/${key}`, type: 'atlas', asset_id: key });
		}
		ide_state.resourceCatalog = augmented.map((descriptor) => {
			const displayPathSource = descriptor.path.length > 0 ? descriptor.path : (descriptor.asset_id ?? '');
			const displayPath = displayPathSource.length > 0 ? displayPathSource : '<unnamed>';
			const typeLabel = descriptor.type ? descriptor.type.toUpperCase() : '';
			const assetLabel = descriptor.asset_id && descriptor.asset_id !== displayPath ? descriptor.asset_id : null;
			const searchKey = [displayPath, descriptor.asset_id ?? '', descriptor.type ?? '']
				.filter(part => part.length > 0)
				.map(part => part.toLowerCase())
				.join(' ');
			return {
				descriptor,
				displayPath,
				searchKey,
				typeLabel,
				assetLabel,
			};
		});
		ide_state.resourceCatalog.sort((a, b) => a.displayPath.localeCompare(b.displayPath));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		ide_state.resourceCatalog = [];
		ide_state.resourceSearchMatches = [];
		ide_state.resourceSearchSelectionIndex = -1;
		ide_state.resourceSearchDisplayOffset = 0;
		ide_state.resourceSearchHoverIndex = -1;
		ide_state.showMessage(`Failed to list resources: ${message}`, constants.COLOR_STATUS_ERROR, 3.0);
		return;
	}
}

export function updateResourceSearchMatches(): void {
	ide_state.resourceSearchMatches = [];
	ide_state.resourceSearchSelectionIndex = -1;
	ide_state.resourceSearchDisplayOffset = 0;
	ide_state.resourceSearchHoverIndex = -1;
	if (ide_state.resourceCatalog.length === 0) {
		return;
	}
	const query = ide_state.resourceSearchQuery.trim().toLowerCase();
	if (query.length === 0) {
		ide_state.resourceSearchMatches = ide_state.resourceCatalog.map(entry => ({ entry, matchIndex: 0 }));
		return;
	}
	const tokens = query.split(/\s+/).filter(token => token.length > 0);
	const matches = ide_state.resourceCatalog
		.filter((entry) => {
			for (const token of tokens) {
				if (entry.searchKey.indexOf(token) === -1) {
					return false;
				}
			}
			return true;
		})
		.map((entry) => {
			let matchIndex = Number.POSITIVE_INFINITY;
			for (const token of tokens) {
				const index = entry.searchKey.indexOf(token);
				if (index < matchIndex) {
					matchIndex = index;
				}
			}
			return { entry, matchIndex };
		});
	if (matches.length === 0) {
		return;
	}
	matches.sort((a, b) => {
		if (a.matchIndex !== b.matchIndex) {
			return a.matchIndex - b.matchIndex;
		}
		if (a.entry.displayPath.length !== b.entry.displayPath.length) {
			return a.entry.displayPath.length - b.entry.displayPath.length;
		}
		return a.entry.displayPath.localeCompare(b.entry.displayPath);
	});
	ide_state.resourceSearchMatches = matches;
	ide_state.resourceSearchSelectionIndex = 0;
}

export function ensureResourceSearchSelectionVisible(): void {
	if (ide_state.resourceSearchSelectionIndex < 0) {
		ide_state.resourceSearchDisplayOffset = 0;
		return;
	}
	const windowSize = Math.max(1, resourceSearchWindowCapacity());
	if (ide_state.resourceSearchSelectionIndex < ide_state.resourceSearchDisplayOffset) {
		ide_state.resourceSearchDisplayOffset = ide_state.resourceSearchSelectionIndex;
	}
	if (ide_state.resourceSearchSelectionIndex >= ide_state.resourceSearchDisplayOffset + windowSize) {
		ide_state.resourceSearchDisplayOffset = ide_state.resourceSearchSelectionIndex - windowSize + 1;
	}
	if (ide_state.resourceSearchDisplayOffset < 0) {
		ide_state.resourceSearchDisplayOffset = 0;
	}
	const maxOffset = Math.max(0, ide_state.resourceSearchMatches.length - windowSize);
	if (ide_state.resourceSearchDisplayOffset > maxOffset) {
		ide_state.resourceSearchDisplayOffset = maxOffset;
	}
}

export function moveResourceSearchSelection(delta: number): void {
	if (ide_state.resourceSearchMatches.length === 0) {
		return;
	}
	let next = ide_state.resourceSearchSelectionIndex;
	if (next === -1) {
		next = delta > 0 ? 0 : ide_state.resourceSearchMatches.length - 1;
	} else {
		next = clamp(next + delta, 0, ide_state.resourceSearchMatches.length - 1);
	}
	if (next === ide_state.resourceSearchSelectionIndex) {
		return;
	}
	ide_state.resourceSearchSelectionIndex = next;
	ensureResourceSearchSelectionVisible();
	resetBlink();
}

export function applyResourceSearchSelection(index: number): void {
	if (index < 0 || index >= ide_state.resourceSearchMatches.length) {
		ide_state.showMessage('Resource not found', constants.COLOR_STATUS_WARNING, 1.5);
		return;
	}
	const match = ide_state.resourceSearchMatches[index];
	closeResourceSearch(true);
	scheduleMicrotask(() => {
		openResourceDescriptor(match.entry.descriptor);
	});
}

export function findResourceDescriptorForChunk(path: string): ResourceDescriptor | null {
	const runtime = Runtime.instance;
	const registries = runtimeLuaPipeline.listLuaSourceRegistries(runtime);
	for (const entry of registries) {
		const asset = entry.registry.path2lua[path];
		if (asset) {
			return { asset_id: asset.resid, path: asset.source_path, type: asset.type, readOnly: entry.readOnly };
		}
	}
	return null;
}

export function applyResourceSearchFieldText(value: string, moveCursorToEnd: boolean): void {
	ide_state.resourceSearchQuery = value;
	setFieldText(ide_state.resourceSearchField, value, moveCursorToEnd);
}

// ── Symbol search lifecycle ──────────────────────────────────────

export function openSymbolSearch(initialQuery: string = ''): void {
	clearReferenceHighlights();
	closeSearch(false, true);
	closeLineJump(false);
	closeResourceSearch(false);
	ide_state.renameController.cancel();
	ide_state.symbolSearchMode = 'symbols';
	ide_state.referenceCatalog = [];
	ide_state.symbolSearchGlobal = false;
	ide_state.symbolSearchVisible = true;
	ide_state.symbolSearchActive = true;
	applySymbolSearchFieldText(initialQuery, true);
	refreshSymbolCatalog(true);
	updateSymbolSearchMatches();
	ide_state.symbolSearchHoverIndex = -1;
	resetBlink();
}

export function openGlobalSymbolSearch(initialQuery: string = ''): void {
	clearReferenceHighlights();
	closeSearch(false, true);
	closeLineJump(false);
	closeResourceSearch(false);
	ide_state.renameController.cancel();
	ide_state.symbolSearchMode = 'symbols';
	ide_state.referenceCatalog = [];
	ide_state.symbolSearchGlobal = true;
	ide_state.symbolSearchVisible = true;
	ide_state.symbolSearchActive = true;
	applySymbolSearchFieldText(initialQuery, true);
	refreshSymbolCatalog(true);
	updateSymbolSearchMatches();
	ide_state.symbolSearchHoverIndex = -1;
	resetBlink();
}

export function openReferenceSearchPopup(): void {
	const context = getActiveCodeTabContext();
	if (ide_state.symbolSearchVisible || ide_state.symbolSearchActive) {
		closeSymbolSearch(false);
	}
	ide_state.renameController.cancel();
	const referenceContext = buildProjectReferenceContext(context);
	const result = resolveReferenceLookup({
		buffer: ide_state.buffer,
		textVersion: ide_state.textVersion,
		cursorRow: ide_state.cursorRow,
		cursorColumn: ide_state.cursorColumn,
		extractExpression: (row, column) => extractHoverExpression(row, column),
		path: referenceContext.path,
	});
	if (result.kind === 'error') {
		ide_state.showMessage(result.message, constants.COLOR_STATUS_WARNING, result.duration);
		return;
	}
	const { info, initialIndex } = result;
	ide_state.referenceState.apply(info, initialIndex);
	ide_state.referenceCatalog = buildReferenceCatalogForExpression(info, context);
	if (ide_state.referenceCatalog.length === 0) {
		ide_state.showMessage('No references found', constants.COLOR_STATUS_WARNING, 1.6);
		return;
	}
	ide_state.symbolSearchMode = 'references';
	ide_state.symbolSearchGlobal = true;
	ide_state.symbolSearchVisible = true;
	ide_state.symbolSearchActive = true;
	applySymbolSearchFieldText('', true);
	ide_state.symbolSearchQuery = '';
	updateReferenceSearchMatches();
	ide_state.symbolSearchHoverIndex = -1;
	ensureSymbolSearchSelectionVisible();
	resetBlink();
	showReferenceStatusMessage();
}

export function closeSymbolSearch(clearQuery: boolean): void {
	if (clearQuery) {
		applySymbolSearchFieldText('', true);
	}
	ide_state.symbolSearchActive = false;
	ide_state.symbolSearchVisible = false;
	ide_state.symbolSearchGlobal = false;
	ide_state.symbolSearchMode = 'symbols';
	ide_state.referenceCatalog = [];
	ide_state.symbolSearchMatches = [];
	ide_state.symbolSearchSelectionIndex = -1;
	ide_state.symbolSearchDisplayOffset = 0;
	ide_state.symbolSearchHoverIndex = -1;
	ide_state.symbolSearchField.selectionAnchor = null;
	ide_state.symbolSearchField.pointerSelecting = false;
	resetBlink();
}

export function focusEditorFromSymbolSearch(): void {
	if (!ide_state.symbolSearchActive && !ide_state.symbolSearchVisible) {
		return;
	}
	ide_state.symbolSearchActive = false;
	if (ide_state.symbolSearchQuery.length === 0) {
		ide_state.symbolSearchVisible = false;
		ide_state.symbolSearchMatches = [];
		ide_state.symbolSearchSelectionIndex = -1;
		ide_state.symbolSearchDisplayOffset = 0;
	}
	ide_state.symbolSearchField.selectionAnchor = null;
	ide_state.symbolSearchField.pointerSelecting = false;
	resetBlink();
}

export function updateSymbolSearchMatches(): void {
	if (ide_state.symbolSearchMode === 'references') {
		updateReferenceSearchMatches();
		return;
	}
	refreshSymbolCatalog(false);
	ide_state.symbolSearchMatches = [];
	ide_state.symbolSearchSelectionIndex = -1;
	ide_state.symbolSearchDisplayOffset = 0;
	ide_state.symbolSearchHoverIndex = -1;
	if (ide_state.symbolCatalog.length === 0) {
		return;
	}
	const query = ide_state.symbolSearchQuery.trim().toLowerCase();
	if (query.length === 0) {
		ide_state.symbolSearchMatches = ide_state.symbolCatalog.map(entry => ({ entry, matchIndex: 0 }));
		if (ide_state.symbolSearchMatches.length > 0) {
			ide_state.symbolSearchSelectionIndex = 0;
		}
		return;
	}
	const matches: SymbolSearchResult[] = [];
	for (const entry of ide_state.symbolCatalog) {
		const idx = entry.searchKey.indexOf(query);
		if (idx === -1) {
			continue;
		}
		matches.push({ entry, matchIndex: idx });
	}
	if (matches.length === 0) {
		ide_state.symbolSearchMatches = [];
		return;
	}
	matches.sort((a, b) => {
		if (a.matchIndex !== b.matchIndex) {
			return a.matchIndex - b.matchIndex;
		}
		const aPriority = symbolPriority(a.entry.symbol.kind);
		const bPriority = symbolPriority(b.entry.symbol.kind);
		if (aPriority !== bPriority) {
			return bPriority - aPriority;
		}
		if (a.entry.searchKey.length !== b.entry.searchKey.length) {
			return a.entry.searchKey.length - b.entry.searchKey.length;
		}
		if (a.entry.line !== b.entry.line) {
			return a.entry.line - b.entry.line;
		}
		return a.entry.displayName.localeCompare(b.entry.displayName);
	});
	ide_state.symbolSearchMatches = matches;
	ide_state.symbolSearchSelectionIndex = 0;
	ide_state.symbolSearchDisplayOffset = 0;
}

export function updateReferenceSearchMatches(): void {
	const { matches, selectionIndex, displayOffset } = filterReferenceCatalog({
		catalog: ide_state.referenceCatalog,
		query: ide_state.symbolSearchQuery,
		state: ide_state.referenceState,
		pageSize: symbolSearchPageSize(),
	});
	ide_state.symbolSearchMatches = matches;
	ide_state.symbolSearchSelectionIndex = selectionIndex;
	ide_state.symbolSearchDisplayOffset = displayOffset;
	ide_state.symbolSearchHoverIndex = -1;
}

export function getActiveSymbolSearchMatch(): SymbolSearchResult {
	if (!ide_state.symbolSearchVisible || ide_state.symbolSearchMatches.length === 0) {
		return null;
	}
	let index = ide_state.symbolSearchHoverIndex;
	if (index < 0 || index >= ide_state.symbolSearchMatches.length) {
		index = ide_state.symbolSearchSelectionIndex;
	}
	if (index < 0 || index >= ide_state.symbolSearchMatches.length) {
		return null;
	}
	return ide_state.symbolSearchMatches[index];
}

export function ensureSymbolSearchSelectionVisible(): void {
	if (ide_state.symbolSearchSelectionIndex < 0) {
		ide_state.symbolSearchDisplayOffset = 0;
		return;
	}
	const maxVisible = symbolSearchPageSize();
	if (ide_state.symbolSearchSelectionIndex < ide_state.symbolSearchDisplayOffset) {
		ide_state.symbolSearchDisplayOffset = ide_state.symbolSearchSelectionIndex;
	}
	if (ide_state.symbolSearchSelectionIndex >= ide_state.symbolSearchDisplayOffset + maxVisible) {
		ide_state.symbolSearchDisplayOffset = ide_state.symbolSearchSelectionIndex - maxVisible + 1;
	}
	if (ide_state.symbolSearchDisplayOffset < 0) {
		ide_state.symbolSearchDisplayOffset = 0;
	}
	const maxOffset = Math.max(0, ide_state.symbolSearchMatches.length - maxVisible);
	if (ide_state.symbolSearchDisplayOffset > maxOffset) {
		ide_state.symbolSearchDisplayOffset = maxOffset;
	}
}

export function moveSymbolSearchSelection(delta: number): void {
	if (ide_state.symbolSearchMatches.length === 0) {
		return;
	}
	let next = ide_state.symbolSearchSelectionIndex;
	if (next === -1) {
		next = delta > 0 ? 0 : ide_state.symbolSearchMatches.length - 1;
	} else {
		next = clamp(next + delta, 0, ide_state.symbolSearchMatches.length - 1);
	}
	if (next === ide_state.symbolSearchSelectionIndex) {
		return;
	}
	ide_state.symbolSearchSelectionIndex = next;
	ensureSymbolSearchSelectionVisible();
	resetBlink();
}

export function applySymbolSearchSelection(index: number): void {
	if (index < 0 || index >= ide_state.symbolSearchMatches.length) {
		ide_state.showMessage('Symbol not found', constants.COLOR_STATUS_WARNING, 1.5);
		return;
	}
	const match = ide_state.symbolSearchMatches[index];
	if (ide_state.symbolSearchMode === 'references') {
		const referenceEntry = match.entry as ReferenceCatalogEntry;
		const symbol = referenceEntry.symbol as ReferenceSymbolEntry;
		const entryIndex = ide_state.referenceCatalog.indexOf(referenceEntry);
		const expressionLabel = ide_state.referenceState.getExpression() ?? symbol.name;
		closeSymbolSearch(true);
		ide_state.referenceState.clear();
		navigateToLuaDefinition(symbol.location);
		const total = ide_state.referenceCatalog.length;
		if (entryIndex >= 0 && total > 0) {
			ide_state.showMessage(`Reference ${entryIndex + 1}/${total} for ${expressionLabel}`, constants.COLOR_STATUS_SUCCESS, 1.6);
		} else {
			ide_state.showMessage('Jumped to reference', constants.COLOR_STATUS_SUCCESS, 1.6);
		}
		return;
	}
	const location = match.entry.symbol.location;
	closeSymbolSearch(true);
	scheduleMicrotask(() => {
		navigateToLuaDefinition(location);
	});
}

export function buildReferenceCatalogForExpression(info: ReferenceMatchInfo, context: CodeTabContext): ReferenceCatalogEntry[] {
	const path = context.descriptor.path;
	const activeLines = splitText(getTextSnapshot(ide_state.buffer));
	const environment: ProjectReferenceEnvironment = {
		activeContext: getActiveCodeTabContext(),
		activeLines,
		codeTabContexts: Array.from(ide_state.codeTabContexts.values()),
	};
	return buildProjectReferenceCatalog({
		workspace: getOrCreateSemanticWorkspace(),
		info,
		lines: activeLines,
		path,
		environment,
	});
}

export function showReferenceStatusMessage(): void {
	const matches = ide_state.referenceState.getMatches();
	const activeIndex = ide_state.referenceState.getActiveIndex();
	if (matches.length === 0 || activeIndex < 0) {
		return;
	}
	const label = ide_state.referenceState.getExpression() ?? '';
	ide_state.showMessage(`Reference ${activeIndex + 1}/${matches.length} for ${label}`, constants.COLOR_STATUS_SUCCESS, 1.6);
}

export function buildProjectReferenceContext(context: CodeTabContext): { environment: ProjectReferenceEnvironment; path: string; } {
	const path = context.descriptor.path;
	const environment: ProjectReferenceEnvironment = {
		activeContext: context,
		activeLines: splitText(getTextSnapshot(ide_state.buffer)),
		codeTabContexts: Array.from(ide_state.codeTabContexts.values()),
	};
	return { environment, path, };
}

export function applySymbolSearchFieldText(value: string, moveCursorToEnd: boolean): void {
	ide_state.symbolSearchQuery = value;
	setFieldText(ide_state.symbolSearchField, value, moveCursorToEnd);
}

// ── Line jump ────────────────────────────────────────────────────

export function openLineJump(): void {
	clearReferenceHighlights();
	closeSymbolSearch(false);
	closeResourceSearch(false);
	closeSearch(false, true);
	ide_state.renameController.cancel();
	ide_state.lineJumpVisible = true;
	ide_state.lineJumpActive = true;
	applyLineJumpFieldText('', true);
	resetBlink();
}

export function closeLineJump(clearValue: boolean): void {
	ide_state.lineJumpActive = false;
	ide_state.lineJumpVisible = false;
	if (clearValue) {
		applyLineJumpFieldText('', true);
	}
	ide_state.lineJumpField.selectionAnchor = null;
	ide_state.lineJumpField.pointerSelecting = false;
	resetBlink();
}

export function focusEditorFromLineJump(): void {
	if (!ide_state.lineJumpActive && !ide_state.lineJumpVisible) {
		return;
	}
	ide_state.lineJumpActive = false;
	ide_state.lineJumpVisible = false;
	ide_state.lineJumpField.selectionAnchor = null;
	ide_state.lineJumpField.pointerSelecting = false;
	resetBlink();
}

export function applyLineJump(): void {
	if (ide_state.lineJumpValue.length === 0) {
		ide_state.showMessage('Enter a line number', constants.COLOR_STATUS_WARNING, 1.5);
		return;
	}
	const target = Number.parseInt(ide_state.lineJumpValue, 10);
	const lineCount = ide_state.buffer.getLineCount();
	if (!Number.isFinite(target) || target < 1 || target > lineCount) {
		ide_state.showMessage(`Line must be between 1 and ${lineCount}`, constants.COLOR_STATUS_WARNING, 1.8);
		return;
	}
	const navigationCheckpoint = beginNavigationCapture();
	setCursorPosition(target - 1, 0);
	TextEditing.clearSelection();
	breakUndoSequence();
	closeLineJump(true);
	ide_state.showMessage(`Jumped to line ${target}`, constants.COLOR_STATUS_SUCCESS, 1.5);
	completeNavigation(navigationCheckpoint);
}

export function applyLineJumpFieldText(value: string, moveCursorToEnd: boolean): void {
	ide_state.lineJumpValue = value;
	setFieldText(ide_state.lineJumpField, value, moveCursorToEnd);
}

// ── Rename ───────────────────────────────────────────────────────

export function openRenamePrompt(): void {
	if (!isEditableCodeTab()) {
		notifyReadOnlyEdit();
		return;
	}
	closeSearch(false, true);
	closeLineJump(false);
	closeResourceSearch(false);
	closeSymbolSearch(false);
	ide_state.createResourceActive = false;
	const context = getActiveCodeTabContext();
	const referenceContext = buildProjectReferenceContext(context);
	const started = ide_state.renameController.begin({
		buffer: ide_state.buffer,
		textVersion: ide_state.textVersion,
		cursorRow: ide_state.cursorRow,
		cursorColumn: ide_state.cursorColumn,
		extractExpression: (row, column) => extractHoverExpression(row, column),
		path: referenceContext.path,
	});
	if (started) {
		ide_state.cursorVisible = true;
		resetBlink();
	}
}

export function focusEditorFromRename(): void {
	ide_state.cursorRevealSuspended = false;
	resetBlink();
	revealCursor();
	ide_state.cursorVisible = true;
}

import { isEditableCodeTab } from './editor_tabs';
import { notifyReadOnlyEdit } from './editor_view';
import { revealCursor } from './caret';
import { markTextMutated } from './text_utils';
import { markDiagnosticsDirtyForChunk } from './diagnostics_controller';
import { prepareUndo, applyUndoableReplace, recordEditContext } from './undo_controller';
import { crossFileRenameManager, type RenameCommitPayload, type RenameCommitResult } from './rename_controller';
import type { LuaSourceRange } from '../../lua/syntax/lua_ast';

export function commitRename(payload: RenameCommitPayload): RenameCommitResult {
	const { matches, newName, activeIndex, info } = payload;
	const activeContext = getActiveCodeTabContext();
	const referenceContext = buildProjectReferenceContext(activeContext);
	const activePath = referenceContext.path;
	const workspace = getOrCreateSemanticWorkspace();
	const renameManager = crossFileRenameManager;
	const sortedMatches = matches.slice();
	sortedMatches.sort((a, b) => {
		if (a.row !== b.row) {
			return a.row - b.row;
		}
		return a.start - b.start;
	});
	let updatedTotal = 0;

	const snapshot = workspace.getSnapshot();
	const decl = info.definitionKey ? snapshot.getDecl(info.definitionKey) : null;
	const references = info.definitionKey ? snapshot.getReferences(info.definitionKey) : [];
	type RangeBucket = { path: string; ranges: LuaSourceRange[]; seen: Set<string> };
	const rangeMap = new Map<string, RangeBucket>();
	const addRange = (range: LuaSourceRange): void => {
		const path = range.path ?? activePath;
		let bucket = rangeMap.get(path);
		if (!bucket) {
			bucket = { path: path, ranges: [], seen: new Set<string>() };
			rangeMap.set(path, bucket);
		}
		const key = `${range.start.line}:${range.start.column}:${range.end.line}:${range.end.column}`;
		if (bucket.seen.has(key)) {
			return;
		}
		bucket.seen.add(key);
		bucket.ranges.push(range);
	};
	if (decl) {
		addRange(decl.range);
	}
	for (let index = 0; index < references.length; index += 1) {
		addRange(references[index].range);
	}
	rangeMap.delete(activePath);

	if (sortedMatches.length > 0) {
		prepareUndo('rename', false);
		recordEditContext('replace', newName);
		for (let index = sortedMatches.length - 1; index >= 0; index -= 1) {
			const match = sortedMatches[index];
			const startOffset = ide_state.buffer.offsetAt(match.row, match.start);
			const endOffset = ide_state.buffer.offsetAt(match.row, match.end);
			applyUndoableReplace(startOffset, endOffset - startOffset, newName);
			ide_state.layout.invalidateLine(match.row);
		}
		markTextMutated();

		const clampedIndex = clamp(activeIndex, 0, sortedMatches.length - 1);
		const focused = sortedMatches[clampedIndex];
		ide_state.cursorRow = focused.row;
		ide_state.cursorColumn = focused.start;
		ide_state.selectionAnchor = { row: focused.row, column: focused.start + newName.length };
		updateDesiredColumn();
		resetBlink();
		ide_state.cursorRevealSuspended = false;
		ensureCursorVisible();
		updatedTotal += sortedMatches.length;
	}

	for (const bucket of rangeMap.values()) {
		const replacements = renameManager.applyRenameToChunk(bucket.path, bucket.ranges, newName, activePath);
		updatedTotal += replacements;
		if (replacements > 0) {
			markDiagnosticsDirtyForChunk(bucket.path);
		}
	}
	return { updatedMatches: updatedTotal };
}
