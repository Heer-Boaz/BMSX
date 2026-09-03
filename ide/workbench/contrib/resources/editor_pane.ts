import type { PlayerInput } from '../../../../hosts/common/input/player';
import type { PointerSnapshot } from '../../../common/models';
import { closeLineJump } from '../code_editor/find/line_jump';
import { closeSearch } from '../code_editor/find/search';
import { runtimeErrorState } from '../../../editor/contrib/runtime_error/state';
import { editorCaretState } from '../../../editor/ui/view/caret/state';
import { editorViewState } from '../../../editor/ui/view/state';
import { drawEditorText } from '../../../editor/render/text_renderer';
import { measureText } from '../../../editor/common/text/layout';
import { getCodeAreaBounds } from '../../../editor/ui/view/view';
import { drawResourceViewer } from '../../render/resource_panel';
import type { ResourceViewerTabDescriptor } from '../../ui/tab/model';
import { WorkbenchViewEditorPane } from '../../ui/editor_pane/workbench_view_pane';
import {
	handleResourceViewerInput,
	scrollResourceViewer,
} from '../../input/keyboard/resource_viewer_input';
import { clampResourceViewerScroll } from './viewer';

export class ResourceViewerEditorPane extends WorkbenchViewEditorPane<ResourceViewerTabDescriptor> {
	protected activate(): void {
		closeSearch(false, true);
		closeLineJump(false);
		editorCaretState.cursorRevealSuspended = false;
		runtimeErrorState.activeOverlay = null;
		runtimeErrorState.executionStopRow = null;
		clampResourceViewerScroll(
			this.input.resource,
			getCodeAreaBounds(),
			editorViewState.lineHeight,
		);
	}

	public draw(): void {
		const resource = this.input.resource;
		drawResourceViewer(resource);
	}

	public handleKeyboard(playerInput: PlayerInput): void {
		const resource = this.input.resource;
		handleResourceViewerInput(playerInput, resource);
	}

	public handleWheel(
		direction: number,
		steps: number,
		_activePointer: PointerSnapshot | null,
		playerInput: PlayerInput,
	): void {
		scrollResourceViewer(this.input.resource, direction * steps);
		playerInput.inputHandlers.pointer?.consumeButton('pointer_wheel');
	}

	public drawStatusBar(statusTop: number, textColor: number): void {
		const viewer = this.input.resource;
		const info = `${viewer.resource.source.type.toUpperCase()} ${viewer.resource.source.resid}`;
		const detail = viewer.resource.path;
		drawEditorText(editorViewState.font, info, 4, statusTop + 2, 0, textColor);
		if (detail.length > 0) {
			drawEditorText(
				editorViewState.font,
				detail,
				editorViewState.viewportWidth - measureText(detail) - 4,
				statusTop + 2,
				0,
				textColor,
			);
		}
	}
}
