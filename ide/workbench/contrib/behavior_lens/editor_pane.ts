import type { KeyInputEvent } from '../../../../hosts/common/input/text';
import type { RectBounds } from '../../../../machine/ts/common/rect';
import { executeTextHistoryCommand } from '../../../editor/editing/history_commands';
import { pointerHover } from '../../../input/pointer/hover';
import type { ContextMenuController } from '../../services/context_menu/controller';
import { WORKBENCH_MENUS, type WorkbenchContextMenuId } from '../../ui/menu/registry';
import type { EditorTextSelection } from '../../../editor/navigation/text_selection';
import { BehaviorLensNavigationSelection } from './navigation_selection';
import { inputFocus, type InputFocusScope } from '../../../input/focus';
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
import { editorRuntimeState } from '../../../editor/common/runtime_state';
import type { BehaviorLensInput } from '../../ui/tab/model';
import { WorkbenchViewEditorPane } from '../../ui/editor_pane/workbench_view_pane';
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
import { beginStateMachineDrag, stateMachineConnectionEnds, type StateMachineRetargetDrop } from './state_machine_drag';
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
import type { EditorGroupView } from '../../services/editor/editor_group';
import type { BehaviorSourceIndex } from './source_index';

export class BehaviorLensEditorPane extends WorkbenchViewEditorPane<BehaviorLensInput> {
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
		this.layout(this.contentBounds);
		return new BehaviorLensNavigationSelection(this.input);
	}

	private readonly pointer = new BehaviorLensPointer(pointerHover);
	private presentedSource: BehaviorSourceIndex | undefined;
	private readonly properties = new WorkbenchPropertyTreePointer(pointerHover);
	private readonly graph = new WorkbenchGraphControl(inputFocus, pointerCapture, pointerHover, input => this.handleKeyboard(input), this.focusTarget);
	private readonly unbindGraphGamepad = this.graph.focusTarget.bindGamepad(input => this.handleGamepad(input));
	public readonly inspector = new WorkbenchPropertyInspector<RuntimeInspectionProperty>(inputFocus, pointerCapture, pointerHover, this.focusTarget);
	private readonly actionBar: WorkbenchActionBarControl;
	public readonly propertyEdit: WorkbenchPropertyEdit<LuaFieldValueEdit>;
	private readonly stateMachineDrop: StateMachineRetargetDrop = (selection, target) =>
		this.controller.retargetStateMachineTransition(this.group, this.input, selection, target);
	private readonly stateMachineDragSource: WorkbenchGraphDragSource = {
		connectionEnds: edge => stateMachineConnectionEnds(this.input.view, edge),
		begin: start => beginStateMachineDrag(this.input.view, start, this.stateMachineDrop),
	};
	private readonly treeDrop: BehaviorTreeTransferDrop = (analysis, insertion, check) =>
		this.controller.reviewTreeTransfer(this.group, this.input, analysis, insertion, check);
	private readonly graphDragSource = { begin: () => this.controller.beginTreeDrag(this.input, this.treeDrop) };
	private readonly unbindPointerBlur = this.focusTarget.onDidBlur(() => {
		this.pointer.cancel();
		this.properties.cancel();
	});

	public constructor(
		private readonly controller: BehaviorLensController,
		private readonly commands: IdeCommandController,
		private readonly contextMenu: ContextMenuController,
		private readonly frameNavigation: RuntimeFrameNavigation,
		surfaces: WorkbenchSurfaceService, paneSurface: WorkbenchSurface, workArea: Readonly<RectBounds>,
		private readonly group: EditorGroupView,
		scope: InputFocusScope,
	) {
		super(scope);
		this.actionBar = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, commands, this.focusTarget, () => this.focus(), contextMenu);
		this.actionBar.onDidOpenOverflow = lifetime => {
			lifetime.add({ dispose: this.input.view.source.onDidInvalidate(() => this.contextMenu.hide()) });
		};
		this.propertyEdit = new WorkbenchPropertyEdit(this.focusTarget, value => value.edit.text, surfaces, paneSurface, workArea);
		this.graph.focusTarget.commandContext = this.focusTarget;
		this.inspector.focusTarget.commandContext = this.focusTarget;
		this.propertyEdit.control.field.focusTarget.commandContext = this.focusTarget;
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
				if (this.inspector.visible) return false;
				const property = selectedActionEffectProperty(this.input.view);
				return property !== undefined && !this.input.view.source.models.get(property.file.file)!.readOnly;
			},
			run: () => this.editProperty(),
		});
		for (const target of [this.focusTarget, this.graph.focusTarget]) target.registerCommand('behaviorLens.details', {
			isEnabled: () => this.input.view.selection !== null && !this.inspector.visible,
			run: () => this.openDetails(),
		});
		this.focusTarget.registerCommand('behaviorLens.inspectRuntimeEffect', {
			isEnabled: () => this.input.view.presentation.kind === 'properties',
			run: () => {
				const input = this.input;
				if (this.focusInput(input)) this.controller.inspectRuntimeEffect(this.group, input, this.inspector);
			},
		});
		for (const target of [this.focusTarget, this.graph.focusTarget]) target.registerCommand('behaviorLens.inspectRuntimeStateMachine', {
			isEnabled: () => this.input.view.presentation.kind === 'state-graph',
			run: () => {
				const input = this.input;
				if (this.focusInput(input)) this.controller.inspectRuntimeStateMachine(this.group, input, this.inspector);
			},
		});
		for (const target of [this.focusTarget, this.graph.focusTarget]) target.registerCommand('behaviorLens.inspectRuntimeTree', {
			isEnabled: () => this.input.view.presentation.kind === 'graph',
			run: () => {
				const input = this.input;
				if (this.focusInput(input)) this.controller.inspectRuntimeTree(this.group, input, this.inspector);
			},
		});
		for (const target of [this.focusTarget, this.graph.focusTarget]) target.registerCommand('behaviorLens.inspectRegisteredDefinitions', {
			isEnabled: () => this.input.view.presentation.kind === 'state-graph' || this.input.view.presentation.kind === 'properties',
			run: () => {
				const input = this.input;
				if (this.focusInput(input)) this.controller.inspectRegisteredDefinitions(this.group, input, this.inspector);
			},
		});
		for (const target of [this.focusTarget, this.graph.focusTarget]) target.registerCommand('contextMenu', {
			isEnabled: () => !this.inspector.visible,
			run: () => this.openKeyboardContextMenu(),
		});
		for (const target of [this.focusTarget, this.graph.focusTarget, this.inspector.focusTarget]) {
			for (const direction of ['undo', 'redo'] as const) target.registerCommand(direction, {
				isEnabled: () => {
					const model = this.input.workingCopy.history.findModel(this.input.getWorkingCopies(), direction);
					return model !== undefined && !model.readOnly;
				},
				run: () => {
					const model = this.input.workingCopy.history.findModel(this.input.getWorkingCopies(), direction)!;
					executeTextHistoryCommand(model, direction, this.input.view.editSource);
				},
			});
		}
		for (const target of [this.focusTarget, this.graph.focusTarget]) target.registerCommand('behaviorLens.source', {
			isEnabled: () => true,
			run: () => this.controller.openSource(this.group, this.input),
		});
		for (const [command, direction] of [['behaviorLens.moveChildEarlier', -1], ['behaviorLens.moveChildLater', 1]] as const) this.graph.focusTarget.registerCommand(command, {
			isEnabled: () => this.controller.canMoveSelectedChild(this.input, direction),
			run: () => {
				const input = this.input;
				if (this.focusInput(input)) this.controller.moveSelectedChild(input, direction);
			},
		});
		this.graph.focusTarget.registerCommand('behaviorLens.duplicateChild', {
			isEnabled: () => this.controller.canEditSelectedChild(this.input),
			run: () => {
				const input = this.input;
				if (this.focusInput(input)) this.controller.duplicateSelectedChild(input);
			},
		});
		this.graph.focusTarget.registerCommand('behaviorLens.setInitialState', {
			isEnabled: () => this.controller.canSetSelectedInitialState(this.input),
			run: () => {
				const input = this.input;
				if (this.focusInput(input)) this.controller.setSelectedInitialState(input);
			},
		});
		this.graph.focusTarget.registerCommand('behaviorLens.removeChild', {
			isEnabled: () => this.controller.canEditSelectedChild(this.input),
			run: () => {
				const input = this.input;
				if (this.focusInput(input)) this.controller.removeSelectedChild(input);
			},
		});
	}

	protected override activate(): void {
		this.presentedSource = this.input.view.source;
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
		this.inspector.hide();
		this.controller.updateView(this.input, navigationSelection);
		this.presentedSource = this.input.view.source;
		this.layout(this.contentBounds);
	}

	public override layout(bounds: Readonly<RectBounds>): void {
		super.layout(bounds);
		if (!this.hasInput) return;
		prepareBehaviorLensLayout(this.input.view, bounds);
		this.input.updatePresentation(editorViewState.font.renderFont());
		if (this.presentedSource !== this.input.view.source) {
			this.presentedSource = this.input.view.source;
			finishBehaviorLensNavigation(this.input.view);
		}
	}

	public override get commandTarget() {
		if (this.inspector.visible) return this.inspector.focusTarget;
		const kind = this.input.view.presentation.kind;
		return kind === 'graph' || kind === 'state-graph' ? this.graph.focusTarget : this.focusTarget;
	}

	public override dispose(): void {
		this.propertyEdit.dispose();
		this.pointer.clear();
		this.properties.clear();
		this.actionBar.dispose();
		this.inspector.dispose();
		this.graph.dispose(); this.unbindGraphGamepad();
		this.unbindPointerBlur();
		super.dispose();
	}

	public override update(): void {
		this.controller.updateView(this.input);
		this.layout(this.contentBounds);
		const items = this.input.runtimeInspection?.refresh();
		if (items !== undefined) this.inspector.updateItems(items, runtimeInspectionPropertiesEqual);
		this.propertyEdit.update();
		this.inspector.update();
		this.graph.advanceDrag(editorRuntimeState.currentTimeMs);
		this.actionBar.update();
		const layout = this.input.view.layout;
		if (this.inspector.visible) this.inspector.layout(editorViewState.font.renderFont(), measureTextRange, measureText, layout);
	}

	public override clearInput(): void {
		this.presentedSource = undefined;
		this.propertyEdit.close();
		this.inspector.hide();
		this.actionBar.clearInput();
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
			this.graph.connectionHandles);
	}

	public handleKeyboard(event: KeyInputEvent): void {
		this.layout(this.contentBounds);
		if (handleBehaviorLensKeyboardInput(this.group, this.input, event, this.controller)) {
			this.pointer.cancel();
			this.properties.cancel();
			this.graph.cancelPointer();
		}
	}

	public override handleGamepad(input: PlayerInput): void {
		this.layout(this.contentBounds);
		if (handleBehaviorLensGamepadInput(this.group, this.input, input, this.controller)) {
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
		if (this.actionBar.handlePointer(snapshot)) return true;
		const view = this.input.view;
		this.layout(this.contentBounds);
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
			if (result === WorkbenchPropertyPointerResult.Activate) this.controller.openSource(this.group, this.input);
			return result !== WorkbenchPropertyPointerResult.Outside;
		}
		if (view.presentation.kind !== 'outline') {
			const result = this.graph.handlePointer(snapshot, now, snapshot.spaceDown);
			if (result === WorkbenchGraphPointerResult.Selection || result === WorkbenchGraphPointerResult.Activate || result === WorkbenchGraphPointerResult.ContextMenu) {
				if (view.presentation.kind === 'graph') acceptBehaviorGraphSelection(view, view.presentation);
				else acceptStateGraphSelection(view, view.presentation);
			}
			if (result === WorkbenchGraphPointerResult.ContextMenu) this.openContextMenu(snapshot.viewportX, snapshot.viewportY);
			if (result === WorkbenchGraphPointerResult.Activate) this.controller.openSource(this.group, this.input);
			return result !== WorkbenchGraphPointerResult.Outside;
		}
		if (justPressed) this.focus();
		const result = this.pointer.handle(view, view.presentation, snapshot, justPressed, now);
		if (result === BehaviorLensPointerResult.ContextMenu) this.openContextMenu(snapshot.viewportX, snapshot.viewportY);
		if (result === BehaviorLensPointerResult.Activate) this.controller.openSource(this.group, this.input);
		return result !== BehaviorLensPointerResult.Outside;
	}

	private openContextMenu(x: number, y: number, keyboard = false): void {
		const input = this.input;
		if (!this.focusInput(input)) return;
		const view = input.view;
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
		const input = this.input;
		this.controller.updateView(input);
		if (!this.focusInput(input)) return;
		const selected = input.view.source.nodesByRowKey.get(input.view.selection!.rowKey)!;
		const lifetime = this.inspector.show({ title: selected.label,
			items: buildBehaviorInspection(input.view),
			canOpenSource: item => item.source !== undefined,
			openSource: item => this.controller.openInspectionSource(this.group, input, item),
		});
		lifetime.add({ dispose: input.view.source.onDidInvalidate(() => this.inspector.hide()) });
	}

	private editProperty(): void {
		this.controller.updateView(this.input);
		this.layout(this.contentBounds);
		const properties = this.input.view.presentation;
		if (properties.kind === 'properties') {
			const input = this.input, property = selectedActionEffectProperty(input.view)!;
			const range = property.file.chunk.locations.range(property.field.value.span);
			if (range.start.line !== range.end.line) {
				this.controller.openWrittenSource(this.group, this.input, range);
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
		} else if (view.presentation.kind === 'properties') {
			if (this.propertyEdit.active) this.focus();
			this.properties.cancel();
			scrollWorkbenchList(view.presentation.tree, event.deltaY * 3);
		} else if (view.presentation.kind !== 'outline') this.graph.handleWheel(event);
		else scrollWorkbenchList(view.presentation, event.deltaY * 3);
	}

	public drawStatusBar(bounds: Readonly<RectBounds>, textColor: number): void {
		// Runtime inspection replaces the source graph; its selection is not the inspection source target.
		if (this.inspector.visible) return;
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
