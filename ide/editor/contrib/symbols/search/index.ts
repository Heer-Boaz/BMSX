import { scheduleMicrotask } from '../../../../../machine/ts/platform/platform';
import * as constants from '../../../../common/constants';
import { showEditorMessage } from '../../../../common/feedback_state';
import { clearReferenceHighlights } from '../../intellisense/engine';
import { navigateToLuaDefinition } from '../../../../workbench/ui/code_tab/activation';
import { closeSearch } from '../../find/search';
import { getActiveCodeTabContext } from '../../../../workbench/ui/code_tab/contexts';
import { resetBlink } from '../../../render/caret';
import { refreshSymbolCatalog } from '../catalog';
import { closeResourceSearch } from '../../../../workbench/contrib/resources/search/index';
import { closeLineJump } from '../../find/line_jump';
import { applyReferenceSearchSelection } from '../../references/search/index';
import { updateSymbolSearchMatches } from './catalog';
import {
	applySymbolSearchFieldText,
	closeSymbolSearch,
} from '../shared';
import { symbolSearchState } from './state';
import type { RuntimeLuaTooling } from '../../../../runtime/lua_tooling';
import type { RuntimeSourceState } from '../../../../runtime/sources';
import type { RenameController } from '../../rename/controller';
import type { CartEditor } from '../../../../cart_editor';

export function openSymbolSearch(bridge: RuntimeLuaTooling, rename: RenameController, initialQuery: string = ''): void {
	if (getActiveCodeTabContext().mode !== 'lua') {
		return;
	}
	clearReferenceHighlights();
	closeSearch(false, true);
	closeLineJump(false);
	closeResourceSearch(false);
	rename.cancel();
	symbolSearchState.mode = 'symbols';
	symbolSearchState.referenceCatalog = [];
	symbolSearchState.global = false;
	symbolSearchState.visible = true;
	symbolSearchState.active = true;
	applySymbolSearchFieldText(initialQuery, true);
	refreshSymbolCatalog(bridge, true);
	updateSymbolSearchMatches(bridge);
	symbolSearchState.hoverIndex = -1;
	resetBlink();
}

export function openGlobalSymbolSearch(bridge: RuntimeLuaTooling, rename: RenameController, initialQuery: string = ''): void {
	if (getActiveCodeTabContext().mode !== 'lua') {
		return;
	}
	clearReferenceHighlights();
	closeSearch(false, true);
	closeLineJump(false);
	closeResourceSearch(false);
	rename.cancel();
	symbolSearchState.mode = 'symbols';
	symbolSearchState.referenceCatalog = [];
	symbolSearchState.global = true;
	symbolSearchState.visible = true;
	symbolSearchState.active = true;
	applySymbolSearchFieldText(initialQuery, true);
	refreshSymbolCatalog(bridge, true);
	updateSymbolSearchMatches(bridge);
	symbolSearchState.hoverIndex = -1;
	resetBlink();
}

export function applySymbolSearchSelection(
	editor: CartEditor,
	sources: RuntimeSourceState,
	index: number,
): void {
	if (index < 0 || index >= symbolSearchState.matches.length) {
		showEditorMessage('Symbol not found', constants.COLOR_STATUS_WARNING, 1.5);
		return;
	}
	if (symbolSearchState.mode === 'references') {
		applyReferenceSearchSelection(editor, sources, index);
		return;
	}
	const location = symbolSearchState.matches[index].entry.symbol.location;
	closeSymbolSearch(true);
	scheduleMicrotask(() => {
		navigateToLuaDefinition(editor, sources, location);
	});
}
