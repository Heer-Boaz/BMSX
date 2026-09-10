import type { PlayerInput } from '../../../../hosts/common/input/player';
import type { PointerSnapshot } from '../../../common/models';
import { drawEditorText } from '../../../editor/render/text_renderer';
import { editorViewState } from '../../../editor/ui/view/state';
import type { IdeCommandController } from '../../../commands/controller';
import type { ResourcePanelController } from '../resources/panel/controller';
import type { ScenarioLabInput } from '../../ui/tab/model';
import { FullWidthWorkbenchEditorPane } from '../../ui/editor_pane/workbench_view_pane';
import type { ScenarioLabController } from './controller';
import {
	handleScenarioLabGamepadInput,
	handleScenarioLabKeyboardInput,
} from './keyboard';
import { drawScenarioLab } from './render';
import { inputFocus } from '../../../input/focus';
import { pointerCapture } from '../../../input/pointer/capture';
import { WorkbenchActionBarControl } from '../../ui/action_bar_control';
import { handleScenarioLabPointerInput, ScenarioLabPointerResult } from './pointer';
import { updateScenarioLabStatus } from './navigation';

export class ScenarioLabEditorPane extends FullWidthWorkbenchEditorPane<ScenarioLabInput> {
	private readonly resultsFocus = inputFocus.createTarget(this.focusTarget);
	private readonly unbindResultsKeyboard = this.resultsFocus.bindKeyboard(input => this.handleKeyboard(input));
	private readonly unbindTestsFocus = this.focusTarget.onDidFocus(() => {
		this.input.view.focus = 'tests';
		updateScenarioLabStatus(this.input.view);
	});
	private readonly unbindResultsFocus = this.resultsFocus.onDidFocus(() => {
		this.input.view.focus = 'results';
		updateScenarioLabStatus(this.input.view);
	});
	private readonly actionBar: WorkbenchActionBarControl;

	public constructor(
		resourcePanel: ResourcePanelController,
		private readonly controller: ScenarioLabController,
		private readonly commands: IdeCommandController,
	) {
		super(resourcePanel);
		this.actionBar = new WorkbenchActionBarControl(inputFocus, pointerCapture, commands, this.focusTarget);
		this.focusTarget.next = this.resultsFocus;
		this.resultsFocus.previous = this.focusTarget;
		this.resultsFocus.next = this.actionBar.focusTarget;
		this.actionBar.focusTarget.previous = this.resultsFocus;
		this.actionBar.focusTarget.next = this.focusTarget;
		this.focusTarget.previous = this.actionBar.focusTarget;
	}

	protected override activate(): void {
		super.activate();
		this.controller.updateView(this.input.view);
		this.actionBar.setInput(this.input.view.actionBar, this.focusTarget);
	}

	public override focus(): void {
		if (this.input.view.focus === 'results') this.resultsFocus.focus();
		else super.focus();
	}

	public override clearInput(): void {
		this.actionBar.clearInput();
		super.clearInput();
	}

	public override dispose(): void {
		this.actionBar.dispose();
		this.unbindResultsKeyboard();
		this.unbindTestsFocus();
		this.unbindResultsFocus();
		super.dispose();
	}

	public override update(): void {
		const view = this.input.view;
		this.controller.updateView(view);
		this.actionBar.update();
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
		if (this.actionBar.handlePointer(snapshot)) {
			if (justPressed) { view.lastPointerClickTimeMs = 0; view.lastPointerClickRowId = null; }
			return true;
		}
		const result = handleScenarioLabPointerInput(view, snapshot, justPressed, now);
		if (result === ScenarioLabPointerResult.Outside) return false;
		if (justPressed) this.focus();
		if (result === ScenarioLabPointerResult.Activate) this.controller.executeNavigation(view, 'activate');
		return true;
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
