import * as constants from '../../../common/constants';
import { renameController } from '../rename/controller';
import { showEditorMessage } from '../../../common/feedback_state';
import { extractHoverExpression, navigateToLuaDefinition } from '../intellisense/engine';
import { getActiveCodeTabContext } from '../../../workbench/ui/code_tab/contexts';
import { resetBlink } from '../../render/caret';
import { applySymbolSearchFieldText, closeSymbolSearch, ensureSymbolSearchSelectionVisible } from '../symbols/shared';
import { resolveReferenceLookup } from './lookup';
import { editorDocumentState } from '../../editing/document_state';
import { symbolSearchState } from '../symbols/search_state';
import { referenceState } from './state';
import {
	type ReferenceCatalogEntry,
	type ReferenceSymbolEntry,
} from './sources';
import { buildReferenceSearchCatalog, showReferenceSearchStatusMessage, updateReferenceSearchMatches } from './search_catalog';

export function openReferenceSearchPopup(): void {
	const context = getActiveCodeTabContext();
	if (context.mode !== 'lua') {
		return;
	}
	if (symbolSearchState.visible || symbolSearchState.active) {
		closeSymbolSearch(false);
	}
	renameController.cancel();
	const result = resolveReferenceLookup({
		buffer: editorDocumentState.buffer,
		textVersion: editorDocumentState.textVersion,
		cursorRow: editorDocumentState.cursorRow,
		cursorColumn: editorDocumentState.cursorColumn,
		extractExpression: (row, column) => extractHoverExpression(row, column),
		path: context.descriptor.path,
	});
	if (result.kind === 'error') {
		showEditorMessage(result.message, constants.COLOR_STATUS_WARNING, result.duration);
		return;
	}
	const { info, initialIndex } = result;
	referenceState.apply(info, initialIndex);
	symbolSearchState.referenceCatalog = buildReferenceSearchCatalog(info, context);
	if (symbolSearchState.referenceCatalog.length === 0) {
		showEditorMessage('No references found', constants.COLOR_STATUS_WARNING, 1.6);
		return;
	}
	symbolSearchState.mode = 'references';
	symbolSearchState.global = true;
	symbolSearchState.visible = true;
	symbolSearchState.active = true;
	applySymbolSearchFieldText('', true);
	symbolSearchState.query = '';
	updateReferenceSearchMatches();
	symbolSearchState.hoverIndex = -1;
	ensureSymbolSearchSelectionVisible();
	resetBlink();
	showReferenceSearchStatusMessage();
}

export function applyReferenceSearchSelection(index: number): void {
	if (index < 0 || index >= symbolSearchState.matches.length) {
		showEditorMessage('Symbol not found', constants.COLOR_STATUS_WARNING, 1.5);
		return;
	}
	const match = symbolSearchState.matches[index];
	const referenceEntry = match.entry as ReferenceCatalogEntry;
	const symbol = referenceEntry.symbol as ReferenceSymbolEntry;
	const entryIndex = symbolSearchState.referenceCatalog.indexOf(referenceEntry);
	const total = symbolSearchState.referenceCatalog.length;
	const expressionLabel = referenceState.getExpression() ?? symbol.name;
	closeSymbolSearch(true);
	referenceState.clear();
	navigateToLuaDefinition(symbol.location);
	if (entryIndex >= 0 && total > 0) {
		showEditorMessage(`Reference ${entryIndex + 1}/${total} for ${expressionLabel}`, constants.COLOR_STATUS_SUCCESS, 1.6);
		return;
	}
	showEditorMessage('Jumped to reference', constants.COLOR_STATUS_SUCCESS, 1.6);
}
