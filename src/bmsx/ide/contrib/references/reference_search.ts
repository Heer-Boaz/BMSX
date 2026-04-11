import * as constants from '../../core/constants';
import { ide_state } from '../../core/ide_state';
import { extractHoverExpression, navigateToLuaDefinition } from '../intellisense/intellisense';
import { getActiveCodeTabContext } from '../../ui/editor_tabs';
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
	if (ide_state.symbolSearch.visible || ide_state.symbolSearch.active) {
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
	ide_state.symbolSearch.referenceCatalog = buildReferenceSearchCatalog(info, context);
	if (ide_state.symbolSearch.referenceCatalog.length === 0) {
		ide_state.showMessage('No references found', constants.COLOR_STATUS_WARNING, 1.6);
		return;
	}
	ide_state.symbolSearch.mode = 'references';
	ide_state.symbolSearch.global = true;
	ide_state.symbolSearch.visible = true;
	ide_state.symbolSearch.active = true;
	applySymbolSearchFieldText('', true);
	ide_state.symbolSearch.query = '';
	updateReferenceSearchMatches();
	ide_state.symbolSearch.hoverIndex = -1;
	ensureSymbolSearchSelectionVisible();
	resetBlink();
	showReferenceSearchStatusMessage();
}

export function applyReferenceSearchSelection(index: number): void {
	if (index < 0 || index >= ide_state.symbolSearch.matches.length) {
		ide_state.showMessage('Symbol not found', constants.COLOR_STATUS_WARNING, 1.5);
		return;
	}
	const match = ide_state.symbolSearch.matches[index];
	const referenceEntry = match.entry as ReferenceCatalogEntry;
	const symbol = referenceEntry.symbol as ReferenceSymbolEntry;
	const entryIndex = ide_state.symbolSearch.referenceCatalog.indexOf(referenceEntry);
	const total = ide_state.symbolSearch.referenceCatalog.length;
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
