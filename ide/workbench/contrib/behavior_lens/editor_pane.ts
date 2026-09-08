import type { PlayerInput } from '../../../../hosts/common/input/player';
import type { PointerSnapshot } from '../../../common/models';
import { drawEditorText } from '../../../editor/render/text_renderer';
import { measureText } from '../../../editor/common/text/layout';
import { editorViewState } from '../../../editor/ui/view/state';
import type { ResourcePanelController } from '../resources/panel/controller';
import type { BehaviorLensInput } from '../../ui/tab/model';
import { FullWidthWorkbenchEditorPane } from '../../ui/editor_pane/workbench_view_pane';
import type { BehaviorLensController } from './controller';
import {
	handleBehaviorLensGamepadInput,
	handleBehaviorLensKeyboardInput,
} from './keyboard';
import type { IdeCommandController } from '../../../commands/controller';
import { updateWorkbenchActionBarPointer } from '../../input/pointer/action_bar';
import { drawBehaviorLens } from './render';

export class BehaviorLensEditorPane extends FullWidthWorkbenchEditorPane<BehaviorLensInput> {
	public constructor(
		resourcePanel: ResourcePanelController,
		private readonly controller: BehaviorLensController,
		private readonly commands: IdeCommandController,
	) {
		super(resourcePanel);
	}

	public override update(): void {
		this.controller.updateView(this.input);
	}

	public draw(): void {
		const view = this.input.view;
		drawBehaviorLens(view, this.commands);
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
		const command = updateWorkbenchActionBarPointer(this.input.view.actionBar, snapshot);
		if (command !== null) {
			if (justPressed && this.commands.isEnabled(command)) this.commands.execute(command);
			return true;
		}
		if (justPressed) this.focus();
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
