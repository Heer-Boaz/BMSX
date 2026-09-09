import { inputFocus } from '../../../input/focus';
import { pointerCapture } from '../../../input/pointer/capture';
import { WorkbenchGraphControl, WorkbenchGraphPointerResult } from '../../ui/graph/control';
import { scrollWorkbenchList } from '../../ui/list_view';
import { acceptBehaviorGraphSelection } from './graph_navigation';
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
import { prepareBehaviorLensLayout } from './layout';
import { BehaviorLensPointer, BehaviorLensPointerResult } from './pointer';

export class BehaviorLensEditorPane extends FullWidthWorkbenchEditorPane<BehaviorLensInput> {
	private readonly pointer = new BehaviorLensPointer();
	private readonly graph = new WorkbenchGraphControl(inputFocus, pointerCapture, input => this.handleKeyboard(input), this.focusTarget);

	public constructor(
		resourcePanel: ResourcePanelController,
		private readonly controller: BehaviorLensController,
		private readonly commands: IdeCommandController,
	) {
		super(resourcePanel);
		this.graph.focusTarget.registerCommand('behaviorLens.toggleBranch', {
			isEnabled: () => {
				const presentation = this.input.view.presentation;
				if (presentation.kind !== 'graph') return false;
				const item = presentation.viewport.selection;
				return item !== null && item.kind === 'node' && item.expandable;
			},
			run: () => this.controller.toggleBranch(),
		});
	}

	protected override activate(): void {
		super.activate();
		this.pointer.cancel();
		this.graph.clearInput();
		this.controller.updateView(this.input);
		prepareBehaviorLensLayout(this.input.view);
		if (this.input.view.presentation.kind === 'graph') this.graph.setInput(this.input.view.presentation.viewport);
	}

	public override focus(): void {
		if (this.input.view.presentation.kind === 'graph') this.graph.focusTarget.focus();
		else super.focus();
	}

	public override dispose(): void {
		this.graph.dispose();
		super.dispose();
	}

	public override update(): void {
		this.controller.updateView(this.input);
	}

	public override clearInput(): void {
		this.pointer.cancel();
		this.graph.clearInput();
		if (this.input.view.presentation.kind === 'outline') this.input.view.presentation.hoverIndex = -1;
		super.clearInput();
	}

	public draw(): void {
		const view = this.input.view;
		drawBehaviorLens(view, this.commands, this.graph.hover, this.graph.focusTarget.hasFocus);
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
		const command = updateWorkbenchActionBarPointer(this.input.view.presentation.actionBar, snapshot);
		if (command !== null) {
			if (justPressed && this.commands.isEnabled(command)) this.commands.execute(command);
			return true;
		}
		if (justPressed) this.focus();
		const view = this.input.view;
		prepareBehaviorLensLayout(view);
		if (view.presentation.kind === 'graph') {
			const result = this.graph.handlePointer(snapshot, justPressed, now);
			if (justPressed && result !== WorkbenchGraphPointerResult.Outside) acceptBehaviorGraphSelection(view, view.presentation);
			if (result === WorkbenchGraphPointerResult.Activate) this.controller.openSource();
			return result !== WorkbenchGraphPointerResult.Outside;
		}
		const result = this.pointer.handle(view, view.presentation, snapshot, justPressed, now);
		if (result === BehaviorLensPointerResult.Activate) this.controller.openSource();
		return result !== BehaviorLensPointerResult.Outside;
	}

	public handleWheel(
		direction: number,
		steps: number,
		activePointer: PointerSnapshot | null,
		playerInput: PlayerInput,
	): void {
		const view = this.input.view;
		prepareBehaviorLensLayout(view);
		if (view.presentation.kind === 'graph') {
			if (activePointer === null || !this.graph.handleWheel(activePointer, 0, direction * steps * 16)) return;
		} else scrollWorkbenchList(view.presentation, direction * steps * 3);
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
