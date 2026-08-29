import * as constants from '../../../../../common/constants';
import { showEditorMessage } from '../../../../../common/feedback_state';
import { queryDefinitionsAt } from '../../../../../editor/contrib/definitions/query';
import { resetBlink } from '../../../../../editor/render/caret';
import { referenceState } from '../../../../../editor/contrib/references/state';
import { navigateToLuaDefinition } from '../../../../ui/code_tab/activation';
import { getActiveCodeTabContext } from '../../../../ui/code_tab/contexts';
import { closeSymbolSearch, ensureSymbolSearchSelectionVisible, applySymbolSearchFieldText } from '../../symbols/shared';
import { updateSymbolSearchMatches } from '../../symbols/search/catalog';
import { symbolSearchState } from '../../symbols/search/state';
import { buildDefinitionSearchCatalog } from './catalog';
import type { RuntimeLuaTooling } from '../../../../../runtime/lua_tooling';
import type { RenameController } from '../../rename/controller';
import type { CartEditor } from '../../../../../cart_editor';

export function openDefinitionSearch(
	bridge: RuntimeLuaTooling,
	rename: RenameController,
	editor: CartEditor,
	row: number,
	column: number,
): boolean {
	const context = getActiveCodeTabContext();
	const query = queryDefinitionsAt(
		bridge,
		context,
		row,
		column,
	);
	if (!query) {
		showEditorMessage('Definition not found', constants.COLOR_STATUS_WARNING, 1.6);
		return false;
	}
	const definitions = query.definitions;
	if (definitions.length === 1) {
		navigateToLuaDefinition(editor, definitions[0].location);
		return true;
	}
	referenceState.clear();
	if (symbolSearchState.visible || symbolSearchState.active) {
		closeSymbolSearch(false);
	}
	rename.cancel();
	symbolSearchState.locationCatalog = buildDefinitionSearchCatalog(definitions);
	symbolSearchState.mode = 'definitions';
	symbolSearchState.global = true;
	symbolSearchState.visible = true;
	symbolSearchState.active = true;
	applySymbolSearchFieldText('', true);
	updateSymbolSearchMatches(bridge);
	ensureSymbolSearchSelectionVisible();
	resetBlink();
	return true;
}

export function applyDefinitionSearchSelection(
	editor: CartEditor,
	index: number,
): void {
	if (index < 0 || index >= symbolSearchState.matches.length) {
		showEditorMessage('Definition not found', constants.COLOR_STATUS_WARNING, 1.5);
		return;
	}
	const match = symbolSearchState.matches[index];
	closeSymbolSearch(true);
	navigateToLuaDefinition(editor, match.entry.symbol.location);
}
