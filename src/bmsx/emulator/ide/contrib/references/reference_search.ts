import * as constants from '../../constants';
import { ide_state } from '../../ide_state';
import { extractHoverExpression, navigateToLuaDefinition } from '../../intellisense';
import { getActiveCodeTabContext } from '../../browser/editor_tabs';
import { resetBlink } from '../../render/render_caret';
import { applySymbolSearchFieldText, closeSymbolSearch, ensureSymbolSearchSelectionVisible } from '../symbols/symbol_search_shared';
import { resolveReferenceLookup } from './reference_lookup';
import {
	type ReferenceCatalogEntry,
	type ReferenceSymbolEntry,
} from './reference_sources';
import { buildReferenceSearchCatalog, showReferenceSearchStatusMessage, updateReferenceSearchMatches } from './reference_search_catalog';

export function openReferenceSearchPopup(): void {
	const context = getActiveCodeTabContext();
	if (context.mode !== 'lua') {
		return;
	}
	if (ide_state.symbolSearchVisible || ide_state.symbolSearchActive) {
		closeSymbolSearch(false);
	}
	ide_state.renameController.cancel();
	const result = resolveReferenceLookup({
		buffer: ide_state.buffer,
		textVersion: ide_state.textVersion,
		cursorRow: ide_state.cursorRow,
		cursorColumn: ide_state.cursorColumn,
		extractExpression: (row, column) => extractHoverExpression(row, column),
		path: context.descriptor.path,
	});
	if (result.kind === 'error') {
		ide_state.showMessage(result.message, constants.COLOR_STATUS_WARNING, result.duration);
		return;
	}
	const { info, initialIndex } = result;
	ide_state.referenceState.apply(info, initialIndex);
	ide_state.referenceCatalog = buildReferenceSearchCatalog(info, context);
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
	showReferenceSearchStatusMessage();
}

export function applyReferenceSearchSelection(index: number): void {
	if (index < 0 || index >= ide_state.symbolSearchMatches.length) {
		ide_state.showMessage('Symbol not found', constants.COLOR_STATUS_WARNING, 1.5);
		return;
	}
	const match = ide_state.symbolSearchMatches[index];
	const referenceEntry = match.entry as ReferenceCatalogEntry;
	const symbol = referenceEntry.symbol as ReferenceSymbolEntry;
	const entryIndex = ide_state.referenceCatalog.indexOf(referenceEntry);
	const total = ide_state.referenceCatalog.length;
	const expressionLabel = ide_state.referenceState.getExpression() ?? symbol.name;
	closeSymbolSearch(true);
	ide_state.referenceState.clear();
	navigateToLuaDefinition(symbol.location);
	if (entryIndex >= 0 && total > 0) {
		ide_state.showMessage(`Reference ${entryIndex + 1}/${total} for ${expressionLabel}`, constants.COLOR_STATUS_SUCCESS, 1.6);
		return;
	}
	ide_state.showMessage('Jumped to reference', constants.COLOR_STATUS_SUCCESS, 1.6);
}
