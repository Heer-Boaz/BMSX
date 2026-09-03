import type { GlobalSearchMatch } from '../../../common/models';
import { openLuaCodeTab } from '../../ui/code_tab/io';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { EditorPanes } from '../../services/editor/editor_panes';

export function openGlobalSearchMatch(
	editorPanes: EditorPanes,
	sources: RuntimeSourceState,
	match: GlobalSearchMatch,
): void {
	openLuaCodeTab(editorPanes, sources, match.resource, {
		row: match.row,
		startColumn: match.start,
		endColumn: match.end,
	});
}
