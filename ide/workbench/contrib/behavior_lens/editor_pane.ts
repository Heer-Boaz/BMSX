import { STATUS_PRIORITY_CONTENT, STATUS_PRIORITY_DETAIL, type WorkbenchStatusItem } from '../../common/status_bar';
import type { QuickInputController } from '../../services/quick_input/controller';
import type { KeyInputEvent } from '../../../../hosts/common/input/text';
import type { RectBounds } from '../../../../machine/ts/common/rect';
import { executeTextHistoryCommand } from '../../../editor/editing/history_commands';
import { pointerHover } from '../../../input/pointer/hover';
import type { ContextMenuController } from '../../services/context_menu/controller';
import { WORKBENCH_MENUS, type WorkbenchContextMenuId } from '../../ui/menu/registry';
import type { EditorTextSelection } from '../../../editor/navigation/text_selection';
import { BehaviorLensNavigationSelection } from './navigation_selection';
import { inputFocus, type FocusCommandInvocation, type InputFocusScope } from '../../../input/focus';
import { pointerCapture } from '../../../input/pointer/capture';
import { WorkbenchGraphControl, WorkbenchGraphPointerResult } from '../../ui/graph/control';
import { scrollWorkbenchList } from '../../ui/list_view';
import { acceptBehaviorGraphSelection } from './graph_navigation';
import { acceptStateGraphSelection } from './state_graph_navigation';
import type { PlayerInput } from '../../../../hosts/common/input/player';
import type { PointerInputSnapshot, WheelInputSnapshot } from '../../../common/models';
import { measureText, measureTextRange } from '../../../editor/common/text/layout';
import { editorViewState } from '../../../editor/ui/view/state';
import { editorRuntimeState } from '../../../editor/common/runtime_state';
import type { BehaviorLensInput } from './editor_input';
import { WorkbenchViewEditorPane } from '../../ui/editor_pane/workbench_view_pane';
import type { BehaviorLensController } from './controller';
import {
	handleBehaviorLensGamepadInput,
	handleBehaviorLensKeyboardInput,
} from './keyboard';
import type { EditorCommandRunner } from '../../../common/commands';
import { WorkbenchActionBarControl } from '../../ui/action_bar_control';
import { drawBehaviorLens } from './render';
import { prepareBehaviorLensLayout } from './layout';
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
import type { EditorGroupView } from '../../services/editor/editor_group';
import type { BehaviorSourceIndex } from './source_index';
import type { EditorSourceLocation, EditorSourceLocationRequest } from '../../../editor/navigation/source_location';

export class BehaviorLensEditorPane extends WorkbenchViewEditorPane<BehaviorLensInput> {
	public readonly statusItems: readonly WorkbenchStatusItem[] = [
		{ text: '', alignment: 'left', priority: STATUS_PRIORITY_CONTENT, overflow: 'ellipsis', tone: 'normal' },
		{ text: '', alignment: 'right', priority: STATUS_PRIORITY_DETAIL, overflow: 'ellipsis', tone: 'normal' },
	];
	public override getSourceLocation(): EditorSourceLocation | undefined {
		const input = this.input;
		return this.controller.getSourceLocation(input);
	}
	public override captureSourceLocation(): EditorSourceLocationRequest { return this.controller.captureSourceLocation(this.input); }

	public override getSelection(): BehaviorLensNavigationSelection {
		this.controller.updateView(this.input);
		this.layout(this.contentBounds);
		return new BehaviorLensNavigationSelection(this.input);
	}

	private readonly pointer = new BehaviorLensPointer(pointerHover);
	private presentedSource: BehaviorSourceIndex | undefined;
	private readonly properties = new WorkbenchPropertyTreePointer(inputFocus, pointerHover, this.focusTarget);
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
		private readonly commands: EditorCommandRunner,
		private readonly contextMenu: ContextMenuController,
		surfaces: WorkbenchSurfaceService, paneSurface: WorkbenchSurface, workArea: Readonly<RectBounds>,
		private readonly group: EditorGroupView,
		scope: InputFocusScope,
		private readonly quickInput: QuickInputController,
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
		this.inspector.focusTarget.registerCommand('pause', {
			isEnabled: () => this.input.runtimeInspection?.interaction.transport?.playbackEnabled === true,
			run: () => { const interaction = this.input.runtimeInspection!.interaction; interaction.running = interaction.transport!.togglePlayback(); },
		});
		for (const [command, direction] of [['stepFrameBack', -1], ['stepFrame', 1]] as const) this.inspector.focusTarget.registerCommand(command, {
			isEnabled: () => {
				const transport = this.input.runtimeInspection?.interaction.transport;
				return transport?.available === true && transport.navigation.canStep(direction);
			},
			run: () => { const interaction = this.input.runtimeInspection!.interaction; interaction.running = false; interaction.transport!.navigation.step(direction); },
		});
		this.focusTarget.registerCommand('behaviorLens.addProperty', {
			isEnabled: () => this.hasInput && !this.inspector.visible && editableActionEffect(this.input.view) !== undefined,
			capture: () => {
				const intent = this.captureSourceIntent('definition');
				if (intent === undefined) return;
				return { isEnabled: () => intent.isCurrent() && !this.inspector.visible && editableActionEffect(intent.input.view) !== undefined,
					run: () => addActionEffectProperty(intent.input.view, this.quickInput, () => {
						if (!intent.isCurrent()) return;
						this.controller.updateView(intent.input);
						return intent.isCurrent() ? editableActionEffect(intent.input.view) : undefined;
					}) };
			},
			run: () => inputFocus.executeCommand('behaviorLens.addProperty', this.focusTarget),
		});
		this.focusTarget.registerCommand('behaviorLens.removeProperty', {
			isEnabled: () => this.hasInput && !this.inspector.visible && editableActionEffect(this.input.view) !== undefined
				&& selectedActionEffectProperty(this.input.view) !== undefined,
			capture: () => this.captureSourceMutation(input => !this.inspector.visible && editableActionEffect(input.view) !== undefined
				&& selectedActionEffectProperty(input.view) !== undefined, input => removeActionEffectProperty(input.view)),
			run: () => inputFocus.executeCommand('behaviorLens.removeProperty', this.focusTarget),
		});
		this.focusTarget.registerCommand('behaviorLens.editProperty', {
			isEnabled: () => {
				if (!this.hasInput || this.inspector.visible) return false;
				const property = selectedActionEffectProperty(this.input.view);
				return property !== undefined && !this.input.view.source.models.get(property.file.file)!.readOnly;
			},
			capture: () => this.captureSourceMutation(input => {
				const property = selectedActionEffectProperty(input.view);
				return !this.inspector.visible && property !== undefined && !input.view.source.models.get(property.file.file)!.readOnly;
			}, () => this.editProperty()),
			run: () => inputFocus.executeCommand('behaviorLens.editProperty', this.focusTarget),
		});
		this.focusTarget.registerCommand('behaviorLens.testEffect', {
			isEnabled: () => this.hasInput && this.controller.canTestEffect(this.input),
			capture: () => {
				const intent = this.captureSourceIntent('definition');
				if (intent === undefined) return;
				return { isEnabled: () => intent.isCurrent() && this.controller.canTestEffect(intent.input),
					run: () => this.controller.testEffect(intent.input, this.group, this.quickInput, intent.isCurrent) };
			},
			run: () => inputFocus.executeCommand('behaviorLens.testEffect', this.focusTarget),
		});
		for (const target of [this.focusTarget, this.graph.focusTarget]) target.registerCommand('behaviorLens.details', {
			isEnabled: () => this.input.view.selectionState.selected !== null && !this.inspector.visible,
			run: () => this.openDetails(),
		});
		this.focusTarget.registerCommand('behaviorLens.inspectRuntimeEffect', {
			isEnabled: () => this.input.view.presentation.kind === 'properties',
			run: () => {
				const input = this.input;
				if (this.focusInput(input)) this.controller.inspectRuntimeEffect(this.group, this.quickInput, input, this.inspector);
			},
		});
		for (const target of [this.focusTarget, this.graph.focusTarget]) target.registerCommand('behaviorLens.inspectRuntimeStateMachine', {
			isEnabled: () => this.input.view.presentation.kind === 'state-graph',
			run: () => {
				const input = this.input;
				if (this.focusInput(input)) this.controller.inspectRuntimeStateMachine(this.group, this.quickInput, input, this.inspector);
			},
		});
		for (const target of [this.focusTarget, this.graph.focusTarget]) target.registerCommand('behaviorLens.inspectRuntimeTree', {
			isEnabled: () => this.input.view.presentation.kind === 'graph',
			run: () => {
				const input = this.input;
				if (this.focusInput(input)) this.controller.inspectRuntimeTree(this.group, this.quickInput, input, this.inspector);
			},
		});
		for (const target of [this.focusTarget, this.graph.focusTarget]) target.registerCommand('behaviorLens.inspectRegisteredDefinitions', {
			isEnabled: () => this.input.view.presentation.kind === 'state-graph' || this.input.view.presentation.kind === 'properties',
			run: () => {
				const input = this.input;
				if (this.focusInput(input)) this.controller.inspectRegisteredDefinitions(this.group, this.quickInput, input, this.inspector);
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
		for (const [command, direction] of [['behaviorLens.moveChildEarlier', -1], ['behaviorLens.moveChildLater', 1]] as const) this.graph.focusTarget.registerCommand(command, {
			isEnabled: () => this.controller.canMoveSelectedChild(this.input, direction),
			capture: () => this.captureSourceMutation(input => this.controller.canMoveSelectedChild(input, direction),
				input => this.controller.moveSelectedChild(input, direction)),
			run: () => inputFocus.executeCommand(command, this.graph.focusTarget),
		});
		this.graph.focusTarget.registerCommand('behaviorLens.duplicateChild', {
			isEnabled: () => this.controller.canEditSelectedChild(this.input),
			capture: () => this.captureSourceMutation(input => this.controller.canEditSelectedChild(input), input => this.controller.duplicateSelectedChild(input)),
			run: () => inputFocus.executeCommand('behaviorLens.duplicateChild', this.graph.focusTarget),
		});
		this.graph.focusTarget.registerCommand('behaviorLens.setInitialState', {
			isEnabled: () => this.controller.canSetSelectedInitialState(this.input),
			capture: () => this.captureSourceMutation(input => this.controller.canSetSelectedInitialState(input), input => this.controller.setSelectedInitialState(input)),
			run: () => inputFocus.executeCommand('behaviorLens.setInitialState', this.graph.focusTarget),
		});
		this.graph.focusTarget.registerCommand('behaviorLens.removeChild', {
			isEnabled: () => this.controller.canEditSelectedChild(this.input),
			capture: () => this.captureSourceMutation(input => this.controller.canEditSelectedChild(input), input => this.controller.removeSelectedChild(input)),
			run: () => inputFocus.executeCommand('behaviorLens.removeChild', this.graph.focusTarget),
		});
	}

	/** The input owns semantic intent; reparsing can replace its source nodes without replacing that intent. */
	private captureSourceIntent(subject: 'selected' | 'definition'): { readonly input: BehaviorLensInput; isCurrent(): boolean } | undefined {
		if (!this.hasInput) return;
		const input = this.input, scope = this.focusTarget.scope, generation = scope.contextGeneration;
		const owner = input.view.selectionState, definition = owner.definitionRevision, selection = owner.selectionRevision;
		if (!owner.available || owner.definitionRowKey === null) return;
		return { input, isCurrent: () => this.hasInput && this.input === input && scope.contextGeneration === generation
			&& owner.available && owner.definitionRevision === definition && (subject === 'definition' || owner.selectionRevision === selection) };
	}

	/** Native source mutations settle this attachment before resolving its corresponding semantic target. */
	private captureSourceMutation(enabled: (input: BehaviorLensInput) => boolean, run: (input: BehaviorLensInput) => void): FocusCommandInvocation | undefined {
		const intent = this.captureSourceIntent('selected');
		if (intent === undefined) return;
		return { editScope: this.focusTarget.scope, isEnabled: () => {
			if (!intent.isCurrent()) return false;
			this.controller.updateView(intent.input);
			return intent.isCurrent() && enabled(intent.input) && intent.isCurrent();
		}, run: () => {
			if (!intent.isCurrent() || !this.focusInput(intent.input) || !intent.isCurrent()) return;
			this.controller.updateView(intent.input);
			if (intent.isCurrent() && enabled(intent.input) && intent.isCurrent()) run(intent.input);
		} };
	}

	protected override activate(): void {
		this.presentedSource = this.input.view.source;
		const presentation = this.input.view.presentation;
		if (presentation.kind === 'graph') this.graph.setInput(presentation.viewport, this.graphDragSource);
		else if (presentation.kind === 'state-graph') this.graph.setInput(presentation.viewport, this.stateMachineDragSource);
		else if (presentation.kind === 'properties') this.properties.setInput(presentation.tree, this.input.view.selectionState.definitionRowKey);
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
		const presentation = this.input.view.presentation;
		if (presentation.kind === 'properties') this.properties.setInput(presentation.tree, this.input.view.selectionState.definitionRowKey);
		else this.properties.clear();
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
			const result = this.properties.handle(snapshot, justPressed, now);
			if (result === WorkbenchPropertyPointerResult.Rejected) return true;
			if (result === WorkbenchPropertyPointerResult.ContextMenu) {
				if (view.presentation.tree.selectionIndex >= 0) acceptEffectPropertySelection(view, view.presentation, false);
				else view.selectionState.select(null);
				finishBehaviorLensNavigation(view);
				this.openContextMenu(snapshot.viewportX, snapshot.viewportY);
				return true;
			}
			if (result === WorkbenchPropertyPointerResult.Selection || result === WorkbenchPropertyPointerResult.Collapse || result === WorkbenchPropertyPointerResult.Activate) {
				acceptEffectPropertySelection(view, view.presentation, result === WorkbenchPropertyPointerResult.Collapse);
				finishBehaviorLensNavigation(view);
			}
			if (result === WorkbenchPropertyPointerResult.Activate) this.commands.execute('editor.source', this.focusTarget);
			return result !== WorkbenchPropertyPointerResult.Outside;
		}
		if (view.presentation.kind !== 'outline') {
			const result = this.graph.handlePointer(snapshot, now, snapshot.spaceDown);
			if (result === WorkbenchGraphPointerResult.Selection || result === WorkbenchGraphPointerResult.Activate || result === WorkbenchGraphPointerResult.ContextMenu) {
				if (view.presentation.kind === 'graph') acceptBehaviorGraphSelection(view, view.presentation);
				else acceptStateGraphSelection(view, view.presentation);
			}
			if (result === WorkbenchGraphPointerResult.ContextMenu) this.openContextMenu(snapshot.viewportX, snapshot.viewportY);
			if (result === WorkbenchGraphPointerResult.Activate) this.commands.execute('editor.source', this.graph.focusTarget);
			return result !== WorkbenchGraphPointerResult.Outside;
		}
		if (justPressed) this.focus();
		const result = this.pointer.handle(view, view.presentation, snapshot, justPressed, now);
		if (result === BehaviorLensPointerResult.ContextMenu) this.openContextMenu(snapshot.viewportX, snapshot.viewportY);
		if (result === BehaviorLensPointerResult.Activate) this.commands.execute('editor.source', this.focusTarget);
		return result !== BehaviorLensPointerResult.Outside;
	}

	private openContextMenu(x: number, y: number, keyboard = false): void {
		const input = this.input;
		if (!this.focusInput(input)) return;
		const view = input.view;
		const presentation = view.presentation;
		let menu: WorkbenchContextMenuId;
		if (view.selectionState.selected === null) menu = 'behaviorLens.canvas.context';
		else if (view.selectionState.selected.kind === 'state-entry') menu = 'behaviorLens.edge.context';
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
		const input = this.input, target = this.commandTarget, generation = target.scope.contextGeneration;
		if (!this.focusInput(input)) return;
		const focusRevision = inputFocus.revision;
		this.controller.updateView(input);
		if (target.scope.contextGeneration !== generation || inputFocus.revision !== focusRevision || inputFocus.admittedTarget !== target) return;
		prepareBehaviorLensLayout(input.view, this.contentBounds);
		input.updatePresentation(editorViewState.font.renderFont());
		if (target.scope.contextGeneration !== generation || inputFocus.revision !== focusRevision || inputFocus.admittedTarget !== target
			|| input.view.selectionState.selected === null) return;
		const source = input.view.source, selected = source.nodesByRowKey.get(input.view.selectionState.selected.rowKey)!;
		const lifetime = this.inspector.show({ title: selected.label,
			items: buildBehaviorInspection(input.view),
			canOpenSource: item => item.source !== undefined,
			openSource: item => this.controller.openInspectionSource(this.group, input, item),
		}, false);
		lifetime.add({ dispose: source.onDidInvalidate(() => this.inspector.hide()) });
		this.inspector.focusTarget.focus();
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
					fieldRange: locations.range(property.field.span), expressionRange: range, expressionKind: property.field.value.kind, expressionOffset: 0, firstTokenOffset: 0 });
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

	public updateStatus(): void {
		const status = this.input.view.status;
		this.statusItems[0].text = this.inspector.visible ? '' : status.info;
		this.statusItems[1].text = this.inspector.visible ? '' : status.detail;
	}
}
