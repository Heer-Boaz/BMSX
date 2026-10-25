import * as constants from '../../../../common/constants';
import { getLineJumpBarBounds, getRenameBarBounds, getSearchBarBounds } from '../../../common/layout';
import { editorSearchState, lineJumpFieldLayout, searchFieldLayout } from '../find/widget_state';
import { renameController } from '../rename/controller';
import type { InlineBarFieldLayout } from './field';

let searchCount = -1, searchIndex = -1, searchWorking = false, searchDetail = '';

export function getSearchFieldLayout(): InlineBarFieldLayout {
	const count = editorSearchState.scope === 'global' ? editorSearchState.globalMatches.length : editorSearchState.matches.length;
	const index = editorSearchState.currentIndex;
	const working = editorSearchState.scope === 'global' ? editorSearchState.globalJob !== null : editorSearchState.job !== null;
	if (count !== searchCount || index !== searchIndex || working !== searchWorking) {
		searchCount = count; searchIndex = index; searchWorking = working;
		searchDetail = working ? 'SEARCHING…' : `${index >= 0 ? index + 1 : 0}/${count}`;
	}
	searchFieldLayout.layout(getSearchBarBounds()!, editorSearchState.scope === 'global' ? 'FIND ALL' : 'FIND',
		count > 0 || editorSearchState.query.length > 0 || working ? searchDetail : '', constants.SEARCH_BAR_MARGIN_Y);
	return searchFieldLayout;
}

export function getRenameFieldLayout(): InlineBarFieldLayout {
	renameController.layoutField(getRenameBarBounds()!);
	return renameController.fieldLayout;
}

export function getLineJumpFieldLayout(): InlineBarFieldLayout {
	lineJumpFieldLayout.layout(getLineJumpBarBounds()!, 'LINE', '', constants.LINE_JUMP_BAR_MARGIN_Y);
	return lineJumpFieldLayout;
}
