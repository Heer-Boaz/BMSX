import * as constants from '../../../../../common/constants';
import { showEditorMessage } from '../../../../../common/feedback_state';
import { navigateToLuaDefinition } from '../../../../ui/code_tab/activation';
import { getActiveCodeTabContext } from '../../../../ui/code_tab/contexts';
import { resetBlink } from '../../../../../editor/render/caret';
import { applySymbolSearchFieldText, closeSymbolSearch, ensureSymbolSearchSelectionVisible } from '../../symbols/shared';
import { resolveReferenceLookup } from '../../../../../editor/contrib/references/lookup';
import { editorDocumentState } from '../../../../../editor/editing/document_state';
import { symbolSearchState } from '../../symbols/search/state';
import { referenceState } from '../../../../../editor/contrib/references/state';
import { buildReferenceSearchCatalog, showReferenceSearchStatusMessage } from './catalog';
import { updateSymbolSearchMatches } from '../../symbols/search/catalog';
import type { RuntimeLuaTooling } from '../../../../../runtime/lua_tooling';
import type { RenameController } from '../../rename/controller';
import type { CartEditor } from '../../../../../cart_editor';

export function openReferenceSearchPopup(bridge: RuntimeLuaTooling, rename: RenameController): void {
	const context = getActiveCodeTabContext();
	switch (context.mode) {
		case 'lua':
			break;
		case 'aem':
			return;
	}
	if (symbolSearchState.visible || symbolSearchState.active) {
		closeSymbolSearch(false);
	}
	rename.cancel();
	const result = resolveReferenceLookup(bridge, {
		buffer: editorDocumentState.buffer,
		cursorRow: editorDocumentState.cursorRow,
		cursorColumn: editorDocumentState.cursorColumn,
		identity: context.resource,
	});
	if (result.kind === 'error') {
		showEditorMessage(result.message, constants.COLOR_STATUS_WARNING, result.duration);
		return;
	}
	const { info, initialIndex } = result;
	referenceState.apply(info, initialIndex);
	symbolSearchState.locationCatalog = buildReferenceSearchCatalog(info, context);
	if (symbolSearchState.locationCatalog.length === 0) {
		showEditorMessage('No references found', constants.COLOR_STATUS_WARNING, 1.6);
		return;
	}
	symbolSearchState.mode = 'references';
	symbolSearchState.global = true;
	symbolSearchState.visible = true;
	symbolSearchState.active = true;
	applySymbolSearchFieldText('', true);
	symbolSearchState.query = '';
	updateSymbolSearchMatches(bridge);
	symbolSearchState.hoverIndex = -1;
	ensureSymbolSearchSelectionVisible();
	resetBlink();
	showReferenceSearchStatusMessage();
}

export function applyReferenceSearchSelection(
	editor: CartEditor,
	index: number,
): void {
	if (index < 0 || index >= symbolSearchState.matches.length) {
		showEditorMessage('Symbol not found', constants.COLOR_STATUS_WARNING, 1.5);
		return;
	}
	const match = symbolSearchState.matches[index];
	const symbol = match.entry.symbol;
	const entryIndex = match.catalogIndex;
	const total = symbolSearchState.locationCatalog.length;
	const expressionLabel = referenceState.getExpression() ?? symbol.name;
	closeSymbolSearch(true);
	referenceState.clear();
	navigateToLuaDefinition(editor, symbol.location);
	showEditorMessage(`Reference ${entryIndex + 1}/${total} for ${expressionLabel}`, constants.COLOR_STATUS_SUCCESS, 1.6);
}
