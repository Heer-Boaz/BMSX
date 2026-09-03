import type { PlayerInput } from '../../../../hosts/common/input/player';
import type { PointerSnapshot } from '../../../common/models';
import { drawEditorText } from '../../../editor/render/text_renderer';
import { editorViewState } from '../../../editor/ui/view/state';
import type { IdeCommandController } from '../../../commands/controller';
import type { ResourcePanelController } from '../resources/panel/controller';
import type { ScenarioLabTabDescriptor } from '../../ui/tab/model';
import { FullWidthWorkbenchEditorPane } from '../../ui/editor_pane/workbench_view_pane';
import type { ScenarioLabController } from './controller';
import {
	handleScenarioLabGamepadInput,
	handleScenarioLabKeyboardInput,
} from './keyboard';
import { drawScenarioLab } from './render';

export class ScenarioLabEditorPane extends FullWidthWorkbenchEditorPane<ScenarioLabTabDescriptor> {
	public constructor(
		resourcePanel: ResourcePanelController,
		private readonly controller: ScenarioLabController,
		private readonly commands: IdeCommandController,
	) {
		super(resourcePanel);
	}

	public override update(): void {
		const view = this.input.view;
		this.controller.updateView(view);
	}

	public draw(): void {
		const view = this.input.view;
		drawScenarioLab(view, this.commands);
	}

	public handleKeyboard(playerInput: PlayerInput): void {
		if (!handleScenarioLabKeyboardInput(this.input.view, playerInput, this.controller)) {
			handleScenarioLabGamepadInput(
				this.input.view,
				playerInput,
				this.controller,
				this.commands,
			);
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
		activePointer: PointerSnapshot | null,
		playerInput: PlayerInput,
	): void {
		this.controller.handleWheel(this.input.view, direction, steps, activePointer);
		playerInput.inputHandlers.pointer?.consumeButton('pointer_wheel');
	}

	public drawStatusBar(statusTop: number, textColor: number): void {
		drawEditorText(
			editorViewState.font,
			this.input.view.status.renderedInfo,
			4,
			statusTop + 2,
			0,
			textColor,
		);
	}
}
