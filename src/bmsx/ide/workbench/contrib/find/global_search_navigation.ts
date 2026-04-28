import type { GlobalSearchMatch } from '../../../common/models';
import { openLuaCodeTab } from '../../ui/code_tab/io';
import type { Runtime } from '../../../../machine/runtime/runtime';

export function openGlobalSearchMatch(runtime: Runtime, match: GlobalSearchMatch): void {
	openLuaCodeTab(runtime, match.descriptor, {
		row: match.row,
		startColumn: match.start,
		endColumn: match.end,
	});
}
