import { inputFocus } from '../../../input/focus';
import { pointerCapture } from '../../../input/pointer/capture';
import { WorkbenchGraphControl, WorkbenchGraphPointerResult } from '../../ui/graph/control';
import { scrollWorkbenchList } from '../../ui/list_view';
import { acceptBehaviorGraphSelection } from './graph_navigation';
import { acceptStateGraphSelection } from './state_graph_navigation';
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
import { WorkbenchPropertyTreePointer, WorkbenchPropertyPointerResult } from '../../ui/property_tree_pointer';
import { acceptEffectPropertySelection } from './action_effect_properties';
import { finishBehaviorLensNavigation } from './navigation';
import { beginBehaviorTreeDrag } from './behavior_tree_drag';

export class BehaviorLensEditorPane extends FullWidthWorkbenchEditorPane<BehaviorLensInput> {
	private readonly pointer = new BehaviorLensPointer();
	private readonly properties = new WorkbenchPropertyTreePointer();
	private readonly graph = new WorkbenchGraphControl(inputFocus, pointerCapture, input => this.handleKeyboard(input), this.focusTarget);
	private readonly startGraphDrag = () => beginBehaviorTreeDrag(this.input.workingCopy, this.input.view);
	private readonly unbindPointerBlur = this.focusTarget.onDidBlur(() => {
		this.pointer.cancel();
		this.properties.cancel();
	});

	public constructor(
		resourcePanel: ResourcePanelController,
		private readonly controller: BehaviorLensController,
		private readonly commands: IdeCommandController,
	) {
		super(resourcePanel);
		for (const target of [this.focusTarget, this.graph.focusTarget]) {
			target.registerCommand('undo', {
				isEnabled: () => !this.input.workingCopy.readOnly && this.input.workingCopy.canUndo,
				run: () => { this.input.workingCopy.undo(); },
			});
			target.registerCommand('redo', {
				isEnabled: () => !this.input.workingCopy.readOnly && this.input.workingCopy.canRedo,
				run: () => { this.input.workingCopy.redo(); },
			});
		}
		this.graph.focusTarget.registerCommand('behaviorLens.toggleBranch', {
			isEnabled: () => {
				const presentation = this.input.view.presentation;
				if (presentation.kind !== 'graph') return false;
				const item = presentation.viewport.selection;
				return item !== null && item.kind === 'node' && item.expandable;
			},
			run: () => this.controller.toggleBranch(),
		});
		this.graph.focusTarget.registerCommand('behaviorLens.duplicateChild', {
			isEnabled: () => this.controller.canEditSelectedChild(),
			run: () => this.controller.duplicateSelectedChild(),
		});
		this.graph.focusTarget.registerCommand('behaviorLens.setInitialState', {
			isEnabled: () => this.controller.canSetSelectedInitialState(),
			run: () => this.controller.setSelectedInitialState(),
		});
		this.graph.focusTarget.registerCommand('behaviorLens.removeChild', {
			isEnabled: () => this.controller.canEditSelectedChild(),
			run: () => this.controller.removeSelectedChild(),
		});
	}

	protected override activate(): void {
		super.activate();
		this.pointer.cancel();
		this.properties.cancel();
		this.graph.clearInput();
		this.controller.updateView(this.input);
		const presentation = this.input.view.presentation;
		if (presentation.kind === 'graph') this.graph.setInput(presentation.viewport, this.startGraphDrag);
		else if (presentation.kind === 'state-graph') this.graph.setInput(presentation.viewport);
	}

	public override focus(): void {
		const kind = this.input.view.presentation.kind;
		if (kind === 'graph' || kind === 'state-graph') this.graph.focusTarget.focus();
		else super.focus();
	}

	public override dispose(): void {
		this.graph.dispose();
		this.unbindPointerBlur();
		super.dispose();
	}

	public override update(): void {
		this.controller.updateView(this.input);
		this.graph.update();
	}

	public override clearInput(): void {
		this.pointer.cancel();
		this.properties.cancel();
		this.graph.clearInput();
		if (this.input.view.presentation.kind === 'outline') this.input.view.presentation.hoverIndex = -1;
		else if (this.input.view.presentation.kind === 'properties') this.input.view.presentation.tree.hoverIndex = -1;
		super.clearInput();
	}

	public draw(): void {
		const view = this.input.view;
		drawBehaviorLens(view, this.commands, this.graph.hover, this.graph.focusTarget.hasFocus, this.graph.dragFeedback);
	}

	public handleKeyboard(playerInput: PlayerInput): void {
		if (handleBehaviorLensKeyboardInput(this.input.view, playerInput, this.controller)
			|| handleBehaviorLensGamepadInput(this.input.view, playerInput, this.controller)) {
			this.pointer.cancel();
			this.properties.cancel();
			this.graph.cancelPointer();
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
		if (view.presentation.kind === 'properties') {
			const result = this.properties.handle(view.presentation.tree, snapshot, justPressed, now);
			if (result === WorkbenchPropertyPointerResult.Selection || result === WorkbenchPropertyPointerResult.Collapse || result === WorkbenchPropertyPointerResult.Activate) {
				acceptEffectPropertySelection(view, view.presentation, result === WorkbenchPropertyPointerResult.Collapse);
				finishBehaviorLensNavigation(view);
			}
			if (result === WorkbenchPropertyPointerResult.Activate) this.controller.openSource();
			return result !== WorkbenchPropertyPointerResult.Outside;
		}
		if (view.presentation.kind !== 'outline') {
			const result = this.graph.handlePointer(snapshot, justPressed, now);
			if (justPressed && result !== WorkbenchGraphPointerResult.Outside) {
				if (view.presentation.kind === 'graph') acceptBehaviorGraphSelection(view, view.presentation);
				else acceptStateGraphSelection(view, view.presentation, this.input.workingCopy.buffer);
			}
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
		if (view.presentation.kind === 'properties') {
			this.properties.cancel();
			scrollWorkbenchList(view.presentation.tree, direction * steps * 3);
		}
		else if (view.presentation.kind !== 'outline') {
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
