import type { KeyInputEvent } from '../../../../hosts/common/input/text';
import type { RectBounds } from '../../../../machine/ts/common/rect';
import { executeTextHistoryCommand } from '../../../editor/editing/history_commands';
import { pointerHover } from '../../../input/pointer/hover';
import type { ContextMenuController } from '../../services/context_menu/controller';
import { WORKBENCH_MENUS, type WorkbenchContextMenuId } from '../../ui/menu/registry';
import type { EditorTextSelection } from '../../../editor/navigation/text_selection';
import { BehaviorLensNavigationSelection } from './navigation_selection';
import { inputFocus } from '../../../input/focus';
import { pointerCapture } from '../../../input/pointer/capture';
import { WorkbenchGraphControl, WorkbenchGraphPointerResult } from '../../ui/graph/control';
import { scrollWorkbenchList } from '../../ui/list_view';
import { acceptBehaviorGraphSelection } from './graph_navigation';
import { acceptStateGraphSelection } from './state_graph_navigation';
import type { PlayerInput } from '../../../../hosts/common/input/player';
import type { PointerInputSnapshot, WheelInputSnapshot } from '../../../common/models';
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
import { prepareBehaviorLensLayout, measureBehaviorLensMinimumWidth } from './layout';
import { BehaviorLensPointer, BehaviorLensPointerResult } from './pointer';
import { WorkbenchPropertyTreePointer, WorkbenchPropertyPointerResult } from '../../ui/property_tree_pointer';
import { acceptEffectPropertySelection } from './action_effect_properties';
import { finishBehaviorLensNavigation } from './navigation';
import type { BehaviorTreeTransferDrop } from './behavior_tree_drag';
import { behaviorTreeTransferImpacts } from './behavior_tree_review';
import { transferBehaviorTreeChild } from './behavior_tree_edit';
import { beginStateMachineDrag, stateMachineConnectionEnds, type StateMachineRetargetDrop } from './state_machine_drag';
import { retargetStateMachineTransition } from './state_machine_edit';
import { stateMachineRetargetImpacts } from './state_machine_review';
import { WorkbenchSourceEditReview } from '../../ui/source_edit_review/control';
import type { WorkbenchGraphDragSource } from '../../ui/graph/drag';
import { WorkbenchPropertyInspector } from '../../ui/property_inspector/control';
import { drawWorkbenchPropertyInspector } from '../../render/property_inspector';
import { buildBehaviorInspection } from './inspection';
import { runtimeInspectionPropertiesEqual, type RuntimeInspectionProperty } from './runtime_properties';
import { applyActionEffectPropertyEdit, selectedActionEffectProperty } from './action_effect_edit';
import { WorkbenchPropertyEdit } from '../../ui/property_edit';
import { parseLuaFieldValueEdit, type LuaFieldValueEdit } from '../../../language/lua/field_value_edit';
import { luaSourceRangeToTextRange, readLuaSourceRange } from '../../../language/lua/source_edits';
import type { WorkbenchSurfaceService } from '../../services/windows/service';
import type { WorkbenchSurface } from '../../services/windows/model';
import { addActionEffectProperty, editableActionEffect, removeActionEffectProperty } from './action_effect_authoring';
import type { RuntimeFrameNavigation } from '../../../runtime/frame_navigation';

export class BehaviorLensEditorPane extends FullWidthWorkbenchEditorPane<BehaviorLensInput> {
	public override get companionGameMinimumWidth(): number { return measureBehaviorLensMinimumWidth(this.input.view); }

	public override get suspendsRuntime(): boolean { return this.input.runtimeInspection?.running !== true; }
	public override get runtimeTransport() { return this.runtimeControlContext === undefined ? undefined : this.commands.transport; }
	public override get runtimeControlContext() { return this.input.runtimeInspection === undefined ? undefined : this.inspector.focusTarget; }
	public override setRuntimeCaptureRunning(running: boolean): void {
		const inspection = this.input.runtimeInspection;
		if (inspection !== undefined) inspection.running = running;
	}
	public override getSelection(): BehaviorLensNavigationSelection {
		this.controller.updateView(this.input);
		return new BehaviorLensNavigationSelection(this.input);
	}

	private readonly pointer = new BehaviorLensPointer(pointerHover);
	private readonly properties = new WorkbenchPropertyTreePointer(pointerHover);
	private readonly graph = new WorkbenchGraphControl(inputFocus, pointerCapture, pointerHover, input => this.handleKeyboard(input), this.focusTarget);
	private readonly unbindGraphGamepad = this.graph.focusTarget.bindGamepad(input => this.handleGamepad(input));
	public readonly sourceEditReview: WorkbenchSourceEditReview;
	public readonly inspector = new WorkbenchPropertyInspector<RuntimeInspectionProperty>(inputFocus, pointerCapture, pointerHover, this.focusTarget);
	private readonly actionBar: WorkbenchActionBarControl;
	public readonly propertyEdit: WorkbenchPropertyEdit<LuaFieldValueEdit>;
	private readonly stateMachineDrop: StateMachineRetargetDrop = (selection, target) => {
		const input = this.input;
		const model = input.view.source.models.get(target.file.file)!;
		if (target.uses.length === 1) retargetStateMachineTransition(model, input.view, selection, target);
		else {
			this.sourceEditReview.show({
				model, title: 'RETARGET FSM',
				summary: `${target.uses.length} RECOGNIZED USES: ${target.literal.value} -> ${target.text}`,
				items: stateMachineRetargetImpacts(input.view, target),
				apply: () => retargetStateMachineTransition(model, input.view, selection, target),
				openSource: index => this.controller.openStateMachineUseSource(input, target.uses[index].use),
				onWillShow: lifetime => lifetime.add({ dispose: input.view.source.onDidInvalidate(() => this.sourceEditReview.clear()) }),
			});
		}
	};
	private readonly stateMachineDragSource: WorkbenchGraphDragSource = {
		connectionEnds: edge => stateMachineConnectionEnds(this.input.view, edge),
		begin: start => beginStateMachineDrag(this.input.view, start, this.stateMachineDrop),
	};
	private readonly treeDrop: BehaviorTreeTransferDrop = (analysis, insertion, check) => {
		const input = this.input;
		const model = input.view.source.models.get(analysis.member.file.file)!;
		const items = behaviorTreeTransferImpacts(input.view, analysis, insertion, check);
		this.sourceEditReview.show({
			model, title: 'MOVE BT SOURCE', summary: `${analysis.member.branch.role} -> ${check.target.role} POSITION ${insertion + 1}`,
			items,
			apply: () => transferBehaviorTreeChild(model, input.view, analysis.member, check, insertion),
			openSource: index => this.controller.openWrittenSource(input, items[index].range),
			onWillShow: lifetime => lifetime.add({ dispose: input.view.source.onDidInvalidate(() => this.sourceEditReview.clear()) }),
		});
	};
	private readonly graphDragSource = { begin: () => this.controller.beginTreeDrag(this.input, this.treeDrop) };
	private readonly unbindPointerBlur = this.focusTarget.onDidBlur(() => {
		this.pointer.cancel();
		this.properties.cancel();
	});

	public constructor(
		resourcePanel: ResourcePanelController,
		private readonly controller: BehaviorLensController,
		private readonly commands: IdeCommandController,
		private readonly contextMenu: ContextMenuController,
		private readonly frameNavigation: RuntimeFrameNavigation,
		surfaces: WorkbenchSurfaceService, paneSurface: WorkbenchSurface, workArea: Readonly<RectBounds>,
	) {
		super(resourcePanel);
		this.sourceEditReview = new WorkbenchSourceEditReview(inputFocus, pointerCapture, pointerHover, this.graph.focusTarget,
			contextMenu, surfaces, paneSurface, workArea);
		this.actionBar = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, commands, this.focusTarget, () => this.focus(), contextMenu);
		this.actionBar.onDidOpenOverflow = lifetime => {
			lifetime.add({ dispose: this.input.view.source.onDidInvalidate(() => this.contextMenu.hide()) });
		};
		this.propertyEdit = new WorkbenchPropertyEdit(this.focusTarget, value => value.edit.text, surfaces, paneSurface, workArea);
		for (const target of [this.focusTarget, this.inspector.focusTarget]) {
			target.registerCommand('pause', { isEnabled: () => this.input.runtimeInspection !== undefined && this.commands.transport.playbackEnabled,
				run: () => { this.input.runtimeInspection!.running = this.commands.transport.togglePlayback(); } });
			for (const [command, direction] of [['stepFrameBack', -1], ['stepFrame', 1]] as const) target.registerCommand(command, {
				isEnabled: () => this.input.runtimeInspection !== undefined && this.frameNavigation.canStep(direction),
				run: () => { this.input.runtimeInspection!.running = false; this.frameNavigation.step(direction); },
			});
		}
		this.focusTarget.registerCommand('behaviorLens.addProperty', {
			isEnabled: () => !this.inspector.visible && editableActionEffect(this.input.view) !== undefined,
			run: () => addActionEffectProperty(this.input.view, this.controller.quickInput),
		});
		this.focusTarget.registerCommand('behaviorLens.removeProperty', {
			isEnabled: () => !this.inspector.visible && editableActionEffect(this.input.view) !== undefined
				&& selectedActionEffectProperty(this.input.view) !== undefined,
			run: () => removeActionEffectProperty(this.input.view),
		});
		this.focusTarget.registerCommand('behaviorLens.editProperty', {
			isEnabled: () => {
				if (this.sourceEditReview.visible || this.inspector.visible) return false;
				const property = selectedActionEffectProperty(this.input.view);
				return property !== undefined && !this.input.view.source.models.get(property.file.file)!.readOnly;
			},
			run: () => this.editProperty(),
		});
		for (const target of [this.focusTarget, this.graph.focusTarget]) target.registerCommand('behaviorLens.details', {
			isEnabled: () => this.input.view.selection !== null && !this.sourceEditReview.visible && !this.inspector.visible,
			run: () => this.openDetails(),
		});
		this.focusTarget.registerCommand('behaviorLens.inspectRuntimeEffect', {
			isEnabled: () => this.input.view.presentation.kind === 'properties' && !this.sourceEditReview.visible,
			run: () => { this.focus(); this.controller.inspectRuntimeEffect(this.input, this.inspector); },
		});
		for (const target of [this.focusTarget, this.graph.focusTarget]) target.registerCommand('behaviorLens.inspectRuntimeStateMachine', {
			isEnabled: () => this.input.view.presentation.kind === 'state-graph' && !this.sourceEditReview.visible,
			run: () => { this.focus(); this.controller.inspectRuntimeStateMachine(this.input, this.inspector); },
		});
		for (const target of [this.focusTarget, this.graph.focusTarget]) target.registerCommand('behaviorLens.inspectRuntimeTree', {
			isEnabled: () => this.input.view.presentation.kind === 'graph' && !this.sourceEditReview.visible,
			run: () => { this.focus(); this.controller.inspectRuntimeTree(this.input, this.inspector); },
		});
		for (const target of [this.focusTarget, this.graph.focusTarget]) target.registerCommand('behaviorLens.inspectRegisteredDefinitions', {
			isEnabled: () => (this.input.view.presentation.kind === 'state-graph' || this.input.view.presentation.kind === 'properties')
				&& !this.sourceEditReview.visible,
			run: () => { this.focus(); this.controller.inspectRegisteredDefinitions(this.input, this.inspector); },
		});
		for (const target of [this.focusTarget, this.graph.focusTarget]) target.registerCommand('contextMenu', {
			isEnabled: () => !this.sourceEditReview.visible && !this.inspector.visible,
			run: () => this.openKeyboardContextMenu(),
		});
		for (const target of [this.focusTarget, this.graph.focusTarget, this.sourceEditReview.focusTarget, this.inspector.focusTarget]) {
			for (const direction of ['undo', 'redo'] as const) target.registerCommand(direction, {
				isEnabled: () => {
					const model = this.input.workingCopy.history.findModel(this.input.getWorkingCopies(), direction);
					return model !== undefined && !model.readOnly;
				},
				run: () => {
					const model = this.input.workingCopy.history.findModel(this.input.getWorkingCopies(), direction)!;
					executeTextHistoryCommand(model, direction);
				},
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

	protected override activate(): void {
		super.activate();
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
	public override setOptions(_selection?: EditorTextSelection, navigationSelection?: BehaviorLensNavigationSelection): void {
		if (navigationSelection === undefined) return;
		this.propertyEdit.close();
		this.pointer.clear();
		this.properties.clear();
		this.sourceEditReview.clear();
		this.inspector.hide();
		this.controller.updateView(this.input, navigationSelection);
	}

	public override focus(): void {
		if (this.inspector.visible) { this.inspector.focusTarget.focus(); return; }
		if (this.sourceEditReview.visible) { this.sourceEditReview.focusTarget.focus(); return; }
		const kind = this.input.view.presentation.kind;
		if (kind === 'graph' || kind === 'state-graph') this.graph.focusTarget.focus();
		else super.focus();
	}

	public override dispose(): void {
		this.propertyEdit.dispose();
		this.pointer.clear();
		this.properties.clear();
		this.actionBar.dispose();
		this.sourceEditReview.dispose();
		this.inspector.dispose();
		this.graph.dispose(); this.unbindGraphGamepad();
		this.unbindPointerBlur();
		super.dispose();
	}

	public override update(): void {
		this.controller.updateView(this.input);
		const items = this.input.runtimeInspection?.refresh();
		if (items !== undefined) this.inspector.updateItems(items, runtimeInspectionPropertiesEqual);
		this.propertyEdit.update();
		this.inspector.update();
		this.graph.update();
		this.actionBar.update();
		const layout = this.input.view.layout;
		if (this.inspector.visible) this.inspector.layout(editorViewState.font.renderFont(), measureTextRange, measureText, layout);
		else if (this.sourceEditReview.visible) this.sourceEditReview.layout(editorViewState.font.renderFont(), measureTextRange, measureText, layout);
		this.sourceEditReview.update();
	}

	public override clearInput(): void {
		this.propertyEdit.close();
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
			drawWorkbenchPropertyInspector(this.inspector);
			return;
		}
		drawBehaviorLens(view, this.graph.hover, this.graph.focusTarget.hasFocus, this.graph.dragFeedback,
			this.graph.connectionHandles, this.sourceEditReview.visible ? this.sourceEditReview : undefined);
	}

	public handleKeyboard(event: KeyInputEvent): void {
		if (handleBehaviorLensKeyboardInput(this.input.view, event, this.controller)) {
			this.pointer.cancel();
			this.properties.cancel();
			this.graph.cancelPointer();
		}
	}

	public override handleGamepad(input: PlayerInput): void {
		if (handleBehaviorLensGamepadInput(this.input.view, input, this.controller)) {
			this.pointer.cancel();
			this.properties.cancel();
			this.graph.cancelPointer();
		}
	}

	protected override handleViewPointer(
		snapshot: PointerInputSnapshot,
		justPressed: boolean,
		now: number,
	): boolean {
		if (this.inspector.visible) return this.inspector.handlePointer(snapshot);
		if (this.sourceEditReview.visible) return this.sourceEditReview.handlePointer(snapshot, justPressed, now);
		if (this.actionBar.handlePointer(snapshot)) return true;
		const view = this.input.view;
		prepareBehaviorLensLayout(view, this.contentBounds);
		if (view.presentation.kind === 'properties') {
			if (justPressed) this.focus();
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
			const result = this.graph.handlePointer(snapshot, now, snapshot.spaceDown);
			if (result === WorkbenchGraphPointerResult.Selection || result === WorkbenchGraphPointerResult.Activate || result === WorkbenchGraphPointerResult.ContextMenu) {
				if (view.presentation.kind === 'graph') acceptBehaviorGraphSelection(view, view.presentation);
				else acceptStateGraphSelection(view, view.presentation);
			}
			if (result === WorkbenchGraphPointerResult.ContextMenu) this.openContextMenu(snapshot.viewportX, snapshot.viewportY);
			if (result === WorkbenchGraphPointerResult.Activate) this.controller.openSource();
			return result !== WorkbenchGraphPointerResult.Outside;
		}
		if (justPressed) this.focus();
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
		this.contextMenu.show(x, y, WORKBENCH_MENUS[menu], this.commands, { selectFirst: keyboard,
			commandTarget: presentation.kind === 'graph' || presentation.kind === 'state-graph' ? this.graph.focusTarget : this.focusTarget,
			onWillShow: lifetime => { lifetime.add({ dispose: view.source.onDidInvalidate(() => this.contextMenu.hide()) }); },
		});
	}

	private openDetails(): void {
		this.controller.updateView(this.input);
		this.focus();
		const input = this.input;
		const selected = input.view.source.nodesByRowKey.get(input.view.selection!.rowKey)!;
		const lifetime = this.inspector.show({ title: selected.label,
			items: buildBehaviorInspection(input.view),
			canOpenSource: item => item.source !== undefined,
			openSource: item => this.controller.openInspectionSource(input, item),
		});
		lifetime.add({ dispose: input.view.source.onDidInvalidate(() => this.inspector.hide()) });
	}

	private editProperty(): void {
		this.controller.updateView(this.input);
		const properties = this.input.view.presentation;
		if (properties.kind === 'properties') {
			const input = this.input, property = selectedActionEffectProperty(input.view)!;
			const range = property.file.chunk.locations.range(property.field.value.span);
			if (range.start.line !== range.end.line) {
				this.controller.openWrittenSource(this.input, range);
			} else {
				const model = input.view.source.models.get(property.file.file)!;
				const locations = property.file.chunk.locations;
				const span = luaSourceRangeToTextRange(model.buffer, range);
				const lifetime = this.propertyEdit.open({ model, tree: properties.tree, row: properties.tree.rows[properties.tree.selectionIndex],
					parse: text => parseLuaFieldValueEdit(model.buffer, locations, property.field, text),
					apply: value => { applyActionEffectPropertyEdit(input, property, value); this.controller.updateView(input); },
				}, { edit: { offset: span.start, deleteLength: span.end - span.start, text: readLuaSourceRange(model.buffer, range) },
					fieldRange: locations.range(property.field.span), expressionRange: range });
				lifetime.add({ dispose: input.view.source.onDidInvalidate(() => this.propertyEdit.close()) });
			}
		}
	}

	private openKeyboardContextMenu(): void {
		const view = this.input.view;
		prepareBehaviorLensLayout(view, this.contentBounds);
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
				+ (Math.max(0, list.selectionIndex - (list.scroll | 0)) + 1) * list.layout.rowHeight, true);
		}
	}

	public handleWheel(event: WheelInputSnapshot): void {
		const view = this.input.view;
		prepareBehaviorLensLayout(view, this.contentBounds);
		if (this.inspector.visible) {
			this.inspector.handleWheel(event, event.deltaY * editorViewState.font.lineHeight * 3);
		} else if (this.sourceEditReview.visible) this.sourceEditReview.handleWheel(event.deltaY * 3);
		else if (view.presentation.kind === 'properties') {
			if (this.propertyEdit.active) this.focus();
			this.properties.cancel();
			scrollWorkbenchList(view.presentation.tree, event.deltaY * 3);
		} else if (view.presentation.kind !== 'outline') this.graph.handleWheel(event);
		else scrollWorkbenchList(view.presentation, event.deltaY * 3);
	}

	public drawStatusBar(bounds: Readonly<RectBounds>, textColor: number): void {
		// These controls replace the source graph; its selection is not their source target.
		if (this.inspector.visible || this.sourceEditReview.visible) return;
		const status = this.input.view.status;
		drawEditorText(editorViewState.font, status.info, bounds.left + 4, bounds.top + 2, 0, textColor);
		if (status.detail.length > 0) {
			drawEditorText(
				editorViewState.font,
				status.detail,
				bounds.right - measureText(status.detail) - 4,
				bounds.top + 2,
				0,
				textColor,
			);
		}
	}
}
