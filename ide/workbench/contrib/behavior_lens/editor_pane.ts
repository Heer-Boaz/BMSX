import { pointerHover } from '../../../input/pointer/hover';
import type { ContextMenuController } from '../../services/context_menu/controller';
import { WORKBENCH_MENUS, type WorkbenchContextMenuId } from '../../ui/menu/registry';
import type { EditorTextSelection } from '../../../editor/navigation/text_selection';
import { BehaviorLensNavigationSelection } from './navigation_selection';
import { isCtrlDown, isShiftDown } from '../../../input/keyboard/key_input';
import { inputFocus } from '../../../input/focus';
import { pointerCapture } from '../../../input/pointer/capture';
import { WorkbenchGraphControl, WorkbenchGraphPointerResult } from '../../ui/graph/control';
import { scrollWorkbenchList } from '../../ui/list_view';
import { acceptBehaviorGraphSelection } from './graph_navigation';
import { acceptStateGraphSelection } from './state_graph_navigation';
import type { PlayerInput } from '../../../../hosts/common/input/player';
import type { PointerSnapshot } from '../../../common/models';
import { drawEditorText } from '../../../editor/render/text_renderer';
import { measureText, measureTextRange } from '../../../editor/common/text/layout';
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
import { WorkbenchActionBarControl } from '../../ui/action_bar_control';
import { drawBehaviorLens } from './render';
import { prepareBehaviorLensLayout } from './layout';
import { BehaviorLensPointer, BehaviorLensPointerResult } from './pointer';
import { WorkbenchPropertyTreePointer, WorkbenchPropertyPointerResult } from '../../ui/property_tree_pointer';
import { acceptEffectPropertySelection } from './action_effect_properties';
import { finishBehaviorLensNavigation } from './navigation';
import { beginBehaviorTreeDrag } from './behavior_tree_drag';
import { beginStateMachineDrag, stateMachineConnectionEnds, type StateMachineRetargetDrop } from './state_machine_drag';
import { retargetStateMachineTransition } from './state_machine_edit';
import { stateMachineRetargetImpacts } from './state_machine_review';
import { WorkbenchSourceEditReview } from '../../ui/source_edit_review/control';
import type { WorkbenchGraphDragSource } from '../../ui/graph/drag';
import { WorkbenchPropertyInspector } from '../../ui/property_inspector/control';
import { drawWorkbenchPropertyInspector } from '../../render/property_inspector';
import { buildBehaviorInspection, type BehaviorInspectionProperty } from './inspection';

export class BehaviorLensEditorPane extends FullWidthWorkbenchEditorPane<BehaviorLensInput> {
	public override getSelection(): BehaviorLensNavigationSelection {
		this.controller.updateView(this.input);
		return new BehaviorLensNavigationSelection(this.input);
	}

	private readonly pointer = new BehaviorLensPointer(pointerHover);
	private readonly properties = new WorkbenchPropertyTreePointer(pointerHover);
	private readonly graph = new WorkbenchGraphControl(inputFocus, pointerCapture, pointerHover, input => this.handleKeyboard(input), this.focusTarget);
	public readonly sourceEditReview = new WorkbenchSourceEditReview(inputFocus, pointerCapture, pointerHover, this.graph.focusTarget);
	public readonly inspector = new WorkbenchPropertyInspector<BehaviorInspectionProperty>(inputFocus, pointerCapture, pointerHover, this.focusTarget);
	private readonly actionBar: WorkbenchActionBarControl;
	private readonly stateMachineDrop: StateMachineRetargetDrop = (selection, target) => {
		const input = this.input;
		if (target.uses.length === 1) retargetStateMachineTransition(input.workingCopy, input.view, selection, target);
		else {
			const lifetime = this.sourceEditReview.show({
				model: input.workingCopy, title: 'RETARGET FSM',
				summary: `${target.uses.length} RECOGNIZED USES: ${target.literal.value} -> ${target.text}`,
				items: stateMachineRetargetImpacts(input.view, target),
				apply: () => retargetStateMachineTransition(input.workingCopy, input.view, selection, target),
				openSource: index => this.controller.openStateMachineUseSource(input, target.uses[index].use),
			});
			lifetime.add({ dispose: input.view.source.onDidInvalidate(() => this.sourceEditReview.clear()) });
		}
	};
	private readonly stateMachineDragSource: WorkbenchGraphDragSource = {
		connectionEnds: edge => stateMachineConnectionEnds(this.input.workingCopy, this.input.view, edge),
		begin: start => beginStateMachineDrag(this.input.workingCopy, this.input.view, start, this.stateMachineDrop),
	};
	private readonly graphDragSource = { begin: () => beginBehaviorTreeDrag(this.input.workingCopy, this.input.view) };
	private readonly unbindPointerBlur = this.focusTarget.onDidBlur(() => {
		this.pointer.cancel();
		this.properties.cancel();
	});

	public constructor(
		resourcePanel: ResourcePanelController,
		private readonly controller: BehaviorLensController,
		private readonly commands: IdeCommandController,
		private readonly contextMenu: ContextMenuController,
	) {
		super(resourcePanel);
		this.actionBar = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, commands, this.focusTarget);
		for (const target of [this.focusTarget, this.graph.focusTarget]) target.registerCommand('behaviorLens.details', {
			isEnabled: () => this.input.view.selection !== null && !this.sourceEditReview.visible && !this.inspector.visible,
			run: () => this.openDetails(),
		});
		for (const target of [this.focusTarget, this.graph.focusTarget]) target.registerCommand('contextMenu', {
			isEnabled: () => !this.sourceEditReview.visible && !this.inspector.visible,
			run: () => this.openKeyboardContextMenu(),
		});
		for (const target of [this.focusTarget, this.graph.focusTarget, this.sourceEditReview.focusTarget, this.inspector.focusTarget]) {
			target.registerCommand('undo', {
				isEnabled: () => !this.input.workingCopy.readOnly && this.input.workingCopy.canUndo,
				run: () => { this.input.workingCopy.undo(); },
			});
			target.registerCommand('redo', {
				isEnabled: () => !this.input.workingCopy.readOnly && this.input.workingCopy.canRedo,
				run: () => { this.input.workingCopy.redo(); },
			});
		}
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

	protected override activate(_selection?: EditorTextSelection, navigationSelection?: BehaviorLensNavigationSelection): void {
		super.activate();
		this.pointer.clear();
		this.properties.clear();
		this.sourceEditReview.clear();
		this.inspector.hide();
		this.graph.clearInput();
		this.controller.updateView(this.input, navigationSelection);
		const presentation = this.input.view.presentation;
		if (presentation.kind === 'graph') this.graph.setInput(presentation.viewport, this.graphDragSource);
		else if (presentation.kind === 'state-graph') this.graph.setInput(presentation.viewport, this.stateMachineDragSource);
		const content = presentation.kind === 'graph' || presentation.kind === 'state-graph' ? this.graph.focusTarget : this.focusTarget;
		this.actionBar.setInput(presentation.actionBar, content);
		content.next = this.actionBar.focusTarget;
		content.previous = this.actionBar.focusTarget;
		this.actionBar.focusTarget.next = content;
		this.actionBar.focusTarget.previous = content;
	}

	public override focus(): void {
		if (this.inspector.visible) { this.inspector.focusTarget.focus(); return; }
		if (this.sourceEditReview.visible) { this.sourceEditReview.focusTarget.focus(); return; }
		const kind = this.input.view.presentation.kind;
		if (kind === 'graph' || kind === 'state-graph') this.graph.focusTarget.focus();
		else super.focus();
	}

	public override dispose(): void {
		this.pointer.clear();
		this.properties.clear();
		this.actionBar.dispose();
		this.sourceEditReview.dispose();
		this.inspector.dispose();
		this.graph.dispose();
		this.unbindPointerBlur();
		super.dispose();
	}

	public override update(): void {
		this.controller.updateView(this.input);
		this.sourceEditReview.update();
		this.inspector.update();
		this.graph.update();
		this.actionBar.update();
	}

	public override clearInput(): void {
		this.inspector.hide();
		this.actionBar.clearInput();
		this.sourceEditReview.clear();
		this.pointer.clear();
		this.properties.clear();
		this.graph.clearInput();
		super.clearInput();
	}

	public draw(): void {
		const view = this.input.view;
		if (this.inspector.visible) {
			this.inspector.layout(editorViewState.font.renderFont(), measureTextRange, measureText, prepareBehaviorLensLayout(view));
			drawWorkbenchPropertyInspector(this.inspector);
			return;
		}
		if (this.sourceEditReview.visible) this.sourceEditReview.layout(editorViewState.font.renderFont(), measureTextRange, measureText, prepareBehaviorLensLayout(view));
		drawBehaviorLens(view, this.commands, this.graph.hover, this.graph.focusTarget.hasFocus, this.graph.dragFeedback,
			this.graph.connectionHandles, this.sourceEditReview.visible ? this.sourceEditReview : undefined);
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
		playerInput: PlayerInput,
	): boolean {
		if (this.inspector.visible) return this.inspector.handlePointer(snapshot);
		if (this.sourceEditReview.visible) {
			this.sourceEditReview.layout(editorViewState.font.renderFont(), measureTextRange, measureText, prepareBehaviorLensLayout(this.input.view));
			return this.sourceEditReview.handlePointer(snapshot, justPressed, now);
		}
		if (this.actionBar.handlePointer(snapshot)) return true;
		if (justPressed) this.focus();
		const view = this.input.view;
		prepareBehaviorLensLayout(view);
		if (view.presentation.kind === 'properties') {
			const result = this.properties.handle(view.presentation.tree, snapshot, justPressed, now);
			if (result === WorkbenchPropertyPointerResult.ContextMenu) {
				if (view.presentation.tree.selectionIndex >= 0) acceptEffectPropertySelection(view, view.presentation, false);
				else view.selection = null;
				finishBehaviorLensNavigation(view);
				this.openContextMenu(snapshot.viewportX, snapshot.viewportY);
				return true;
			}
			if (result === WorkbenchPropertyPointerResult.Selection || result === WorkbenchPropertyPointerResult.Collapse || result === WorkbenchPropertyPointerResult.Activate) {
				acceptEffectPropertySelection(view, view.presentation, result === WorkbenchPropertyPointerResult.Collapse);
				finishBehaviorLensNavigation(view);
			}
			if (result === WorkbenchPropertyPointerResult.Activate) this.controller.openSource();
			return result !== WorkbenchPropertyPointerResult.Outside;
		}
		if (view.presentation.kind !== 'outline') {
			const result = this.graph.handlePointer(snapshot, now, playerInput.getRawButtonState('Space', 'keyboard').pressed);
			if (result === WorkbenchGraphPointerResult.Selection || result === WorkbenchGraphPointerResult.Activate || result === WorkbenchGraphPointerResult.ContextMenu) {
				if (view.presentation.kind === 'graph') acceptBehaviorGraphSelection(view, view.presentation);
				else acceptStateGraphSelection(view, view.presentation);
			}
			if (result === WorkbenchGraphPointerResult.ContextMenu) this.openContextMenu(snapshot.viewportX, snapshot.viewportY);
			if (result === WorkbenchGraphPointerResult.Activate) this.controller.openSource();
			return result !== WorkbenchGraphPointerResult.Outside;
		}
		const result = this.pointer.handle(view, view.presentation, snapshot, justPressed, now);
		if (result === BehaviorLensPointerResult.ContextMenu) this.openContextMenu(snapshot.viewportX, snapshot.viewportY);
		if (result === BehaviorLensPointerResult.Activate) this.controller.openSource();
		return result !== BehaviorLensPointerResult.Outside;
	}

	private openContextMenu(x: number, y: number, keyboard = false): void {
		this.focus();
		const view = this.input.view;
		const presentation = view.presentation;
		let menu: WorkbenchContextMenuId;
		if (view.selection === null) menu = 'behaviorLens.canvas.context';
		else if (view.selection.kind === 'state-entry') menu = 'behaviorLens.edge.context';
		else if (presentation.kind === 'graph' || presentation.kind === 'state-graph') {
			menu = presentation.viewport.selection?.kind === 'edge' ? 'behaviorLens.edge.context'
				: presentation.kind === 'graph' ? 'behaviorLens.node.context' : 'behaviorLens.state.context';
		} else menu = 'behaviorLens.property.context';
		const lifetime = this.contextMenu.show(x, y, WORKBENCH_MENUS[menu], this.commands, keyboard);
		lifetime.add({ dispose: view.source.onDidInvalidate(() => this.contextMenu.hide()) });
	}

	private openDetails(): void {
		this.controller.updateView(this.input);
		this.focus();
		const input = this.input;
		const selected = input.view.source.nodesByRowKey.get(input.view.selection!.rowKey)!;
		const lifetime = this.inspector.show({ title: selected.label,
			items: buildBehaviorInspection(input.view),
			canOpenSource: item => item.range !== undefined,
			openSource: item => this.controller.openInspectionSource(input, item),
		});
		lifetime.add({ dispose: input.view.source.onDidInvalidate(() => this.inspector.hide()) });
	}

	private openKeyboardContextMenu(): void {
		const view = this.input.view;
		prepareBehaviorLensLayout(view);
		const presentation = view.presentation;
		if (presentation.kind === 'graph' || presentation.kind === 'state-graph') {
			const viewport = presentation.viewport;
			const selected = viewport.selection;
			if (selected !== null) {
				viewport.reveal(selected);
				this.openContextMenu(viewport.graphToViewportX(selected.bounds.left),
					viewport.graphToViewportY(selected.kind === 'node' ? selected.bounds.top + selected.headerHeight : selected.bounds.bottom), true);
			} else this.openContextMenu(viewport.bounds.left + 8, viewport.bounds.top + 8, true);
		} else {
			const list = presentation.kind === 'properties' ? presentation.tree : presentation;
			this.openContextMenu(list.layout.contentLeft + 8, list.layout.contentTop
				+ (Math.max(0, list.selectionIndex - list.scroll) + 1) * list.layout.rowHeight, true);
		}
	}

	public handleWheel(
		direction: number,
		steps: number,
		activePointer: PointerSnapshot | null,
		playerInput: PlayerInput,
	): void {
		const view = this.input.view;
		prepareBehaviorLensLayout(view);
		if (this.inspector.visible) {
			if (activePointer === null || !this.inspector.handleWheel(activePointer, direction * steps * editorViewState.font.lineHeight * 3)) return;
		} else if (this.sourceEditReview.visible) this.sourceEditReview.handleWheel(direction * steps * 3);
		else if (view.presentation.kind === 'properties') {
			this.properties.cancel();
			scrollWorkbenchList(view.presentation.tree, direction * steps * 3);
		}
		else if (view.presentation.kind !== 'outline') {
			const distance = direction * steps * 16;
			const horizontal = isShiftDown(playerInput);
			if (activePointer === null || !this.graph.handleWheel(activePointer, horizontal ? distance : 0, horizontal ? 0 : distance,
				isCtrlDown(playerInput) ? -direction * steps : 0)) return;
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
