import type { GlobalSearchMatch } from '../../../common/models';
import { openLuaCodeTab } from '../../ui/code_tab/io';

export function openGlobalSearchMatch(match: GlobalSearchMatch): void {
	openLuaCodeTab(match.descriptor, {
		row: match.row,
		startColumn: match.start,
		endColumn: match.end,
	});
}
