import type { GlobalSearchMatch } from '../../../common/models';
import { openLuaCodeTab } from '../../ui/code_tab/io';
import type { WorkspaceSourceCatalog } from '../../../workspace/source_catalog';
import type { EditorGroupView } from '../../services/editor/editor_group';

export function openGlobalSearchMatch(
	editorGroup: EditorGroupView,
	catalog: WorkspaceSourceCatalog,
	match: GlobalSearchMatch,
): void {
	openLuaCodeTab(editorGroup, catalog, match.resource, {
		row: match.row,
		startColumn: match.start,
		endColumn: match.end,
	});
}
