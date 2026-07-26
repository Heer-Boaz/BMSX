import type { GlobalSearchMatch } from '../../../common/models';
import { openLuaCodeTab } from '../../ui/code_tab/io';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { ResourcePanelController } from '../resources/panel/controller';

export function openGlobalSearchMatch(
	resourcePanel: ResourcePanelController,
	sources: RuntimeSourceState,
	match: GlobalSearchMatch,
): void {
	openLuaCodeTab(resourcePanel, sources, match.descriptor, {
		row: match.row,
		startColumn: match.start,
		endColumn: match.end,
	});
}
