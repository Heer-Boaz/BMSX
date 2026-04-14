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
import { editorFeatureState } from '../../common/editor_feature_state';
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
	renameController.cancel();
	editorFeatureState.symbolSearch.mode = 'symbols';
	editorFeatureState.symbolSearch.referenceCatalog = [];
	editorFeatureState.symbolSearch.global = false;
	editorFeatureState.symbolSearch.visible = true;
	editorFeatureState.symbolSearch.active = true;
	applySymbolSearchFieldText(initialQuery, true);
	refreshSymbolCatalog(true);
	updateSymbolSearchMatches();
	editorFeatureState.symbolSearch.hoverIndex = -1;
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
	editorFeatureState.symbolSearch.mode = 'symbols';
	editorFeatureState.symbolSearch.referenceCatalog = [];
	editorFeatureState.symbolSearch.global = true;
	editorFeatureState.symbolSearch.visible = true;
	editorFeatureState.symbolSearch.active = true;
	applySymbolSearchFieldText(initialQuery, true);
	refreshSymbolCatalog(true);
	updateSymbolSearchMatches();
	editorFeatureState.symbolSearch.hoverIndex = -1;
	resetBlink();
}

export function applySymbolSearchSelection(index: number): void {
	if (index < 0 || index >= editorFeatureState.symbolSearch.matches.length) {
		showEditorMessage('Symbol not found', constants.COLOR_STATUS_WARNING, 1.5);
		return;
	}
	if (editorFeatureState.symbolSearch.mode === 'references') {
		applyReferenceSearchSelection(index);
		return;
	}
	const location = editorFeatureState.symbolSearch.matches[index].entry.symbol.location;
	closeSymbolSearch(true);
	scheduleMicrotask(() => {
		navigateToLuaDefinition(location);
	});
}
