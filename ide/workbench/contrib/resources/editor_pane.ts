import * as constants from '../../../common/constants';
import type { KeyInputEvent } from '../../../../hosts/common/input/text';
import type { RectBounds } from '../../../../machine/ts/common/rect';
import type { EditorTextSelection } from '../../../editor/navigation/text_selection';
import { ResourceViewerNavigationSelection } from './navigation_selection';
import { handleEditorScrollbarPointer } from '../../../input/pointer/scrollbar';
import type { PointerInputSnapshot, WheelInputSnapshot } from '../../../common/models';
import { editorViewState } from '../../../editor/ui/view/state';
import { drawEditorText } from '../../../editor/render/text_renderer';
import { measureText } from '../../../editor/common/text/layout';
import { drawResourceViewer } from '../../render/resource_panel';
import type { ResourceViewerInput } from '../../ui/tab/model';
import { WorkbenchViewEditorPane } from '../../ui/editor_pane/workbench_view_pane';
import {
	handleResourceViewerInput,
	scrollResourceViewer,
} from '../../input/keyboard/resource_viewer_input';
import { clampResourceViewerScroll } from './viewer';

const VIEWER_SCROLLBARS = ['viewerVertical'] as const;

// Metadata names and values need a reading column even when the image itself can shrink.
const RESOURCE_READING_COLUMNS = 32;

export class ResourceViewerEditorPane extends WorkbenchViewEditorPane<ResourceViewerInput> {
	public override get companionGameMinimumWidth(): number {
		return editorViewState.charAdvance * RESOURCE_READING_COLUMNS + constants.SCROLLBAR_WIDTH + 8;
	}

	public override getSelection(): ResourceViewerNavigationSelection {
		return new ResourceViewerNavigationSelection(this.input.view.scroll);
	}

	protected activate(): void {
		clampResourceViewerScroll(
			this.input.view,
			this.contentBounds,
			editorViewState.lineHeight,
		);
	}
	public override setOptions(_selection?: EditorTextSelection, navigationSelection?: ResourceViewerNavigationSelection): void {
		if (navigationSelection === undefined) return;
		navigationSelection.restore(this.input.view);
		clampResourceViewerScroll(this.input.view, this.contentBounds, editorViewState.lineHeight);
	}

	protected override handleViewPointer(snapshot: PointerInputSnapshot, justPressed: boolean): boolean {
		if (handleEditorScrollbarPointer(snapshot, VIEWER_SCROLLBARS)) return true;
		if (justPressed) this.focus();
		return false;
	}

	public draw(): void {
		const resource = this.input.view;
		drawResourceViewer(resource);
	}

	public handleKeyboard(playerInput: KeyInputEvent): void {
		const resource = this.input.view;
		handleResourceViewerInput(playerInput, resource);
	}

	public handleWheel(event: WheelInputSnapshot): void {
		scrollResourceViewer(this.input.view, event.deltaY);
	}

	public drawStatusBar(bounds: Readonly<RectBounds>, textColor: number): void {
		const viewer = this.input.view;
		const info = `${viewer.content.resource.source.type.toUpperCase()} ${viewer.content.resource.source.resid}`;
		const detail = viewer.content.resource.path;
		drawEditorText(editorViewState.font, info, bounds.left + 4, bounds.top + 2, 0, textColor);
		if (detail.length > 0) {
			drawEditorText(
				editorViewState.font,
				detail,
				bounds.right - measureText(detail) - 4,
				bounds.top + 2,
				0,
				textColor,
			);
		}
	}
}
