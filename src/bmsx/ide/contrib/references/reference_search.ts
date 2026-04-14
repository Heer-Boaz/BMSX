import * as constants from '../../core/constants';
import { renameController } from '../rename/rename_controller';
import { showEditorMessage } from '../../core/editor_feedback_state';
import { extractHoverExpression, navigateToLuaDefinition } from '../intellisense/intellisense';
import { getActiveCodeTabContext } from '../../ui/editor_tabs';
import { resetBlink } from '../../render/render_caret';
import { applySymbolSearchFieldText, closeSymbolSearch, ensureSymbolSearchSelectionVisible } from '../symbols/symbol_search_shared';
import { resolveReferenceLookup } from './reference_lookup';
import { editorDocumentState } from '../../editing/editor_document_state';
import { editorFeatureState } from '../../core/editor_feature_state';
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
	if (editorFeatureState.symbolSearch.visible || editorFeatureState.symbolSearch.active) {
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
	editorFeatureState.referenceState.apply(info, initialIndex);
	editorFeatureState.symbolSearch.referenceCatalog = buildReferenceSearchCatalog(info, context);
	if (editorFeatureState.symbolSearch.referenceCatalog.length === 0) {
		showEditorMessage('No references found', constants.COLOR_STATUS_WARNING, 1.6);
		return;
	}
	editorFeatureState.symbolSearch.mode = 'references';
	editorFeatureState.symbolSearch.global = true;
	editorFeatureState.symbolSearch.visible = true;
	editorFeatureState.symbolSearch.active = true;
	applySymbolSearchFieldText('', true);
	editorFeatureState.symbolSearch.query = '';
	updateReferenceSearchMatches();
	editorFeatureState.symbolSearch.hoverIndex = -1;
	ensureSymbolSearchSelectionVisible();
	resetBlink();
	showReferenceSearchStatusMessage();
}

export function applyReferenceSearchSelection(index: number): void {
	if (index < 0 || index >= editorFeatureState.symbolSearch.matches.length) {
		showEditorMessage('Symbol not found', constants.COLOR_STATUS_WARNING, 1.5);
		return;
	}
	const match = editorFeatureState.symbolSearch.matches[index];
	const referenceEntry = match.entry as ReferenceCatalogEntry;
	const symbol = referenceEntry.symbol as ReferenceSymbolEntry;
	const entryIndex = editorFeatureState.symbolSearch.referenceCatalog.indexOf(referenceEntry);
	const total = editorFeatureState.symbolSearch.referenceCatalog.length;
	const expressionLabel = editorFeatureState.referenceState.getExpression() ?? symbol.name;
	closeSymbolSearch(true);
	editorFeatureState.referenceState.clear();
	navigateToLuaDefinition(symbol.location);
	if (entryIndex >= 0 && total > 0) {
		showEditorMessage(`Reference ${entryIndex + 1}/${total} for ${expressionLabel}`, constants.COLOR_STATUS_SUCCESS, 1.6);
		return;
	}
	showEditorMessage('Jumped to reference', constants.COLOR_STATUS_SUCCESS, 1.6);
}
