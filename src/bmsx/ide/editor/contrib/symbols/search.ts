import { scheduleMicrotask } from '../../../../platform/platform';
import * as constants from '../../../common/constants';
import { renameController } from '../rename/controller';
import { showEditorMessage } from '../../../workbench/common/feedback_state';
import { clearReferenceHighlights, navigateToLuaDefinition } from '../intellisense/engine';
import { closeSearch } from '../find/search';
import { getActiveCodeTabContext } from '../../../workbench/ui/code_tab/contexts';
import { resetBlink } from '../../render/caret';
import { refreshSymbolCatalog } from './catalog';
import { closeResourceSearch } from '../../../workbench/contrib/resources/search';
import { closeLineJump } from '../find/line_jump';
import { applyReferenceSearchSelection } from '../references/search';
import { updateSymbolSearchMatches } from './search_catalog';
import {
	applySymbolSearchFieldText,
	closeSymbolSearch,
} from './shared';
import { symbolSearchState } from './search_state';

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
