import { clearGotoHoverHighlight } from '../../editor/contrib/intellisense/engine';
import { clearHoverTooltip } from '../../editor/contrib/hover/controller';
import { ensureVisualLines } from '../../editor/common/text/layout';
import { bottomMargin } from '../../workbench/common/layout';
import type { PointerSnapshot, ScrollbarKind } from '../../common/models';
import { editorPointerState } from './state';
import { editorViewState } from '../../editor/ui/view/state';
import { activeCodeEditor } from '../../editor/ui/code_editor_state';
import { editorCaretState } from '../../editor/ui/view/caret/state';
import type { CartEditor } from '../../cart_editor';

export function handleEditorScrollbarPointer(snapshot: PointerSnapshot, kinds: readonly ScrollbarKind[]): boolean {
	if (!editorViewState.scrollbarController.begin(kinds, snapshot, bottomMargin())) {
		return false;
	}
	editorPointerState.pointerSelecting = false;
	clearHoverTooltip();
	clearGotoHoverHighlight();
	return true;
}

export function applyScrollbarScroll(editor: CartEditor, kind: ScrollbarKind, scroll: number): void {
	switch (kind) {
		case 'codeVertical': {
			ensureVisualLines();
			activeCodeEditor.view.scrollRow = editorViewState.layout.clampVisualScroll(scroll, editorViewState.layout.getVisualLineCount(), editorViewState.cachedVisibleRowCount);
			editorCaretState.cursorRevealSuspended = true;
			break;
		}
		case 'codeHorizontal': {
			if (editorViewState.wordWrapEnabled) {
				activeCodeEditor.view.scrollLeft = 0;
				break;
			}
			activeCodeEditor.view.scrollLeft = editorViewState.layout.clampHorizontalScroll(scroll, editorViewState.cachedMaxScrollLeft);
			editorCaretState.cursorRevealSuspended = true;
			break;
		}
		case 'resourceVertical': {
			editor.resourcePanel.setScroll(scroll);
			break;
		}
		case 'resourceHorizontal': {
			editor.resourcePanel.setHScroll(scroll);
			break;
		}
	}
}
