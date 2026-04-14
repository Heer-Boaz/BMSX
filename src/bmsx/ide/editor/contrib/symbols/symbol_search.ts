import { scheduleMicrotask } from '../../../../platform/platform';
import * as constants from '../../../common/constants';
import { renameController } from '../rename/rename_controller';
import { showEditorMessage } from '../../../workbench/common/feedback_state';
import { clearReferenceHighlights, navigateToLuaDefinition } from '../intellisense/intellisense';
import { closeSearch } from '../find/editor_search';
import { getActiveCodeTabContext } from '../../../workbench/ui/tabs';
import { resetBlink } from '../../render/render_caret';
import { refreshSymbolCatalog } from './symbol_catalog';
import { closeResourceSearch } from '../../../workbench/contrib/resources/resource_search';
import { closeLineJump } from '../find/line_jump';
import { applyReferenceSearchSelection } from '../references/reference_search';
import { updateSymbolSearchMatches } from './symbol_search_catalog';
import {
	applySymbolSearchFieldText,
	closeSymbolSearch,
} from './symbol_search_shared';
import { symbolSearchState } from './symbol_search_state';

export function openSymbolSearch(initialQuery: string = ''): void {
	if (getActiveCodeTabContext().mode !== 'lua') {
		return;
	}
	clearReferenceHighlights();
	closeSearch(false, true);
	closeLineJump(false);
	closeResourceSearch(false);
	renameController.cancel();
	symbolSearchState.mode = 'symbols';
	symbolSearchState.referenceCatalog = [];
	symbolSearchState.global = false;
	symbolSearchState.visible = true;
	symbolSearchState.active = true;
	applySymbolSearchFieldText(initialQuery, true);
	refreshSymbolCatalog(true);
	updateSymbolSearchMatches();
	symbolSearchState.hoverIndex = -1;
	resetBlink();
}

export function openGlobalSymbolSearch(initialQuery: string = ''): void {
	if (getActiveCodeTabContext().mode !== 'lua') {
		return;
	}
	clearReferenceHighlights();
	closeSearch(false, true);
	closeLineJump(false);
	closeResourceSearch(false);
	renameController.cancel();
	symbolSearchState.mode = 'symbols';
	symbolSearchState.referenceCatalog = [];
	symbolSearchState.global = true;
	symbolSearchState.visible = true;
	symbolSearchState.active = true;
	applySymbolSearchFieldText(initialQuery, true);
	refreshSymbolCatalog(true);
	updateSymbolSearchMatches();
	symbolSearchState.hoverIndex = -1;
	resetBlink();
}

export function applySymbolSearchSelection(index: number): void {
	if (index < 0 || index >= symbolSearchState.matches.length) {
		showEditorMessage('Symbol not found', constants.COLOR_STATUS_WARNING, 1.5);
		return;
	}
	if (symbolSearchState.mode === 'references') {
		applyReferenceSearchSelection(index);
		return;
	}
	const location = symbolSearchState.matches[index].entry.symbol.location;
	closeSymbolSearch(true);
	scheduleMicrotask(() => {
		navigateToLuaDefinition(location);
	});
}
