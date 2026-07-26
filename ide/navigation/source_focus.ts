import { closeLineJump } from '../editor/contrib/find/line_jump';
import { closeSearch } from '../editor/contrib/find/search';
import { closeSymbolSearch } from '../editor/contrib/symbols/shared';
import { resetBlink } from '../editor/render/caret';
import type { ResourcePanelController } from '../workbench/contrib/resources/panel/controller';
import { closeResourceSearch } from '../workbench/contrib/resources/search/index';

export function releaseResourcePanelFocus(resourcePanel: ResourcePanelController): void {
	if (!resourcePanel.isFocused()) {
		return;
	}
	resourcePanel.setFocused(false);
	resetBlink();
}

export function prepareEditorForSourceFocus(): void {
	closeSymbolSearch(true);
	closeResourceSearch(true);
	closeLineJump(true);
	closeSearch(true);
}
