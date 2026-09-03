import type { MicrotaskQueue } from '../../../../../common/microtask_queue';
import * as constants from '../../../../../common/constants';
import { showEditorMessage } from '../../../../../common/feedback_state';
import { clearReferenceHighlights } from '../../../../../editor/contrib/intellisense/engine';
import { navigateToLuaDefinition } from '../../../../ui/code_tab/activation';
import { closeSearch } from '../../find/search';
import { getActiveCodeTabContext } from '../../../../ui/code_tab/contexts';
import { resetBlink } from '../../../../../editor/render/caret';
import { refreshSymbolCatalog } from '../catalog';
import { closeResourceSearch } from '../../../resources/search/index';
import { closeLineJump } from '../../find/line_jump';
import { applyReferenceSearchSelection } from '../../references/search/index';
import { applyDefinitionSearchSelection } from '../../definitions/search/index';
import { updateSymbolSearchMatches } from './catalog';
import {
	applySymbolSearchFieldText,
	closeSymbolSearch,
} from '../shared';
import { symbolSearchState } from './state';
import type { RuntimeLuaTooling } from '../../../../../runtime/lua_tooling';
import type { RenameController } from '../../rename/controller';
import type { CartEditor } from '../../../../../cart_editor';

export function openSymbolSearch(bridge: RuntimeLuaTooling, rename: RenameController, initialQuery: string = ''): void {
	switch (getActiveCodeTabContext().model.mode) {
		case 'lua':
			break;
		case 'aem':
			return;
	}
	clearReferenceHighlights();
	closeSearch(false, true);
	closeLineJump(false);
	closeResourceSearch(false);
	rename.cancel();
	symbolSearchState.mode = 'symbols';
	symbolSearchState.locationCatalog = [];
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
	switch (getActiveCodeTabContext().model.mode) {
		case 'lua':
			break;
		case 'aem':
			return;
	}
	clearReferenceHighlights();
	closeSearch(false, true);
	closeLineJump(false);
	closeResourceSearch(false);
	rename.cancel();
	symbolSearchState.mode = 'symbols';
	symbolSearchState.locationCatalog = [];
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
	microtasks: MicrotaskQueue,
	editor: CartEditor,
	index: number,
): void {
	if (index < 0 || index >= symbolSearchState.matches.length) {
		showEditorMessage('Symbol not found', constants.COLOR_STATUS_WARNING, 1.5);
		return;
	}
	switch (symbolSearchState.mode) {
		case 'references':
			applyReferenceSearchSelection(editor, index);
			return;
		case 'definitions':
			applyDefinitionSearchSelection(editor, index);
			return;
		case 'symbols':
			break;
	}
	const location = symbolSearchState.matches[index].entry.symbol.location;
	closeSymbolSearch(true);
	microtasks.queueMicrotask(() => {
		navigateToLuaDefinition(editor, location);
	});
}
