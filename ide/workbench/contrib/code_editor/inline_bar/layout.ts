import * as constants from '../../../../common/constants';
import { getLineJumpBarBounds, getRenameBarBounds, getSearchBarBounds } from '../../../common/layout';
import { editorSearchState, lineJumpState } from '../find/widget_state';
import { renameController } from '../rename/controller';
import { InlineBarFieldLayout } from './field';

export const searchFieldLayout = new InlineBarFieldLayout(editorSearchState.field);
export const renameFieldLayout = new InlineBarFieldLayout(renameController.getField());
export const lineJumpFieldLayout = new InlineBarFieldLayout(lineJumpState.field);
let searchCount = -1, searchIndex = -1, searchWorking = false, searchDetail = '';
let renameCount = -1, renameExpression = '', renameDetail = '';

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
	const count = renameController.getMatchCount(), expression = renameController.getExpressionLabel();
	if (count !== renameCount || expression !== renameExpression) {
		renameCount = count; renameExpression = expression;
		const refs = count === 1 ? '1 REF' : `${count} REFS`;
		renameDetail = expression.length > 0 ? `${expression} · ${refs}` : refs;
	}
	renameFieldLayout.layout(getRenameBarBounds()!, 'RENAME', renameDetail, constants.SEARCH_BAR_MARGIN_Y);
	return renameFieldLayout;
}

export function getLineJumpFieldLayout(): InlineBarFieldLayout {
	lineJumpFieldLayout.layout(getLineJumpBarBounds()!, 'LINE', '', constants.LINE_JUMP_BAR_MARGIN_Y);
	return lineJumpFieldLayout;
}
