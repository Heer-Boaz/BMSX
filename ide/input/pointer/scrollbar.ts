import { PointerButton } from './buttons';
import { clearGotoHoverHighlight } from '../../editor/contrib/intellisense/engine';
import { clearHoverTooltip } from '../../editor/contrib/hover/controller';
import { ensureVisualLines } from '../../editor/common/text/layout';
import { bottomMargin } from '../../workbench/common/layout';
import type { PointerSnapshot, ScrollbarKind } from '../../common/models';
import { editorPointerState } from './state';
import { editorViewState } from '../../editor/ui/view/state';
import { activeCodeEditor } from '../../editor/ui/code_editor_state';
import { editorCaretState } from '../../editor/ui/view/caret/state';
import { getCodeAreaBounds } from '../../editor/ui/view/view';
import { setResourceViewerScroll } from '../../workbench/contrib/resources/viewer';
import { getActiveResourceViewer } from '../../workbench/contrib/resources/view_tabs';
import type { ResourcePanelController } from '../../workbench/contrib/resources/panel/controller';

export function handleEditorScrollbarPointer(snapshot: PointerSnapshot, justPressed: boolean, kinds: readonly ScrollbarKind[]): boolean {
	if (!justPressed) {
		return false;
	}
	if (!editorViewState.scrollbarController.begin(kinds, snapshot.viewportX, snapshot.viewportY, ((snapshot.pressedButtons & PointerButton.Primary) !== 0), bottomMargin())) {
		return false;
	}
	editorPointerState.pointerSelecting = false;
	clearHoverTooltip();
	clearGotoHoverHighlight();
	return true;
}

export function applyScrollbarScroll(resourcePanel: ResourcePanelController, kind: ScrollbarKind, scroll: number): void {
	switch (kind) {
		case 'codeVertical': {
			ensureVisualLines();
			activeCodeEditor.view.scrollRow = editorViewState.layout.clampVisualScroll(Math.round(scroll), editorViewState.layout.getVisualLineCount(), editorViewState.cachedVisibleRowCount);
			editorCaretState.cursorRevealSuspended = true;
			break;
		}
		case 'codeHorizontal': {
			if (editorViewState.wordWrapEnabled) {
				activeCodeEditor.view.scrollColumn = 0;
				break;
			}
			activeCodeEditor.view.scrollColumn = editorViewState.layout.clampHorizontalScroll(Math.round(scroll), editorViewState.cachedMaxScrollColumn);
			editorCaretState.cursorRevealSuspended = true;
			break;
		}
		case 'resourceVertical': {
			resourcePanel.setScroll(scroll);
			resourcePanel.setFocused(true);
			break;
		}
		case 'resourceHorizontal': {
			resourcePanel.setHScroll(scroll);
			resourcePanel.setFocused(true);
			break;
		}
		case 'viewerVertical': {
			const viewer = getActiveResourceViewer();
			if (!viewer) {
				break;
			}
			setResourceViewerScroll(viewer, getCodeAreaBounds(), editorViewState.lineHeight, scroll);
			break;
		}
	}
}
