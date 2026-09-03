import type { PlayerInput } from '../../../../hosts/common/input/player';
import type { PointerSnapshot } from '../../../common/models';
import { drawEditorText } from '../../../editor/render/text_renderer';
import { measureText } from '../../../editor/common/text/layout';
import { editorViewState } from '../../../editor/ui/view/state';
import type { ResourcePanelController } from '../resources/panel/controller';
import type { BehaviorLensTabDescriptor } from '../../ui/tab/model';
import { FullWidthWorkbenchEditorPane } from '../../ui/editor_pane/workbench_view_pane';
import type { BehaviorLensController } from './controller';
import {
	handleBehaviorLensGamepadInput,
	handleBehaviorLensKeyboardInput,
} from './keyboard';
import { drawBehaviorLens } from './render';

export class BehaviorLensEditorPane extends FullWidthWorkbenchEditorPane<BehaviorLensTabDescriptor> {
	public constructor(
		resourcePanel: ResourcePanelController,
		private readonly controller: BehaviorLensController,
	) {
		super(resourcePanel);
	}

	public override update(): void {
		const view = this.input.view;
		this.controller.updateView(view);
	}

	public draw(): void {
		const view = this.input.view;
		drawBehaviorLens(view);
	}

	public handleKeyboard(playerInput: PlayerInput): void {
		if (!handleBehaviorLensKeyboardInput(this.input.view, playerInput, this.controller)) {
			handleBehaviorLensGamepadInput(this.input.view, playerInput, this.controller);
		}
	}

	protected override handleViewPointer(
		snapshot: PointerSnapshot,
		justPressed: boolean,
		now: number,
	): boolean {
		const view = this.input.view;
		return this.controller.handlePointer(view, snapshot, justPressed, now);
	}

	public handleWheel(
		direction: number,
		steps: number,
		_activePointer: PointerSnapshot | null,
		playerInput: PlayerInput,
	): void {
		this.controller.handleWheel(this.input.view, direction, steps);
		playerInput.inputHandlers.pointer?.consumeButton('pointer_wheel');
	}

	public drawStatusBar(statusTop: number, textColor: number): void {
		const status = this.input.view.status;
		drawEditorText(editorViewState.font, status.info, 4, statusTop + 2, 0, textColor);
		if (status.detail.length > 0) {
			drawEditorText(
				editorViewState.font,
				status.detail,
				editorViewState.viewportWidth - measureText(status.detail) - 4,
				statusTop + 2,
				0,
				textColor,
			);
		}
	}
}
