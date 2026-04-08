import { scheduleMicrotask } from '../../../platform/platform';
import * as constants from '../../core/constants';
import { ide_state } from '../../core/ide_state';
import { clearReferenceHighlights, navigateToLuaDefinition } from '../intellisense/intellisense';
import { closeSearch } from '../find/editor_search';
import { getActiveCodeTabContext } from '../../browser/editor_tabs';
import { resetBlink } from '../../render/render_caret';
import { refreshSymbolCatalog } from './symbol_catalog';
import { closeResourceSearch } from '../resources/resource_search';
import { closeLineJump } from '../find/line_jump';
import { applyReferenceSearchSelection } from '../references/reference_search';
import { updateSymbolSearchMatches } from './symbol_search_catalog';
import {
	applySymbolSearchFieldText,
	closeSymbolSearch,
} from './symbol_search_shared';

export function openSymbolSearch(initialQuery: string = ''): void {
	if (getActiveCodeTabContext().mode !== 'lua') {
		return;
	}
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
	if (getActiveCodeTabContext().mode !== 'lua') {
		return;
	}
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

export function applySymbolSearchSelection(index: number): void {
	if (index < 0 || index >= ide_state.symbolSearchMatches.length) {
		ide_state.showMessage('Symbol not found', constants.COLOR_STATUS_WARNING, 1.5);
		return;
	}
	if (ide_state.symbolSearchMode === 'references') {
		applyReferenceSearchSelection(index);
		return;
	}
	const location = ide_state.symbolSearchMatches[index].entry.symbol.location;
	closeSymbolSearch(true);
	scheduleMicrotask(() => {
		navigateToLuaDefinition(location);
	});
}
