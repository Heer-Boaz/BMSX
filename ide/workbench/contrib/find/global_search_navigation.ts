import type { GlobalSearchMatch } from '../../../common/models';
import { openLuaCodeTab } from '../../ui/code_tab/io';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { EditorGroupView } from '../../services/editor/editor_group';

export function openGlobalSearchMatch(
	editorGroup: EditorGroupView,
	sources: RuntimeSourceState,
	match: GlobalSearchMatch,
): void {
	openLuaCodeTab(editorGroup, sources, match.resource, {
		row: match.row,
		startColumn: match.start,
		endColumn: match.end,
	});
}
