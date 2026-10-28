import type { EditorSourceLocation } from '../../../editor/navigation/source_location';
import type { KeyInputEvent } from '../../../../hosts/common/input/text';
import { executeTextHistoryCommand } from '../../../editor/editing/history_commands';
import { pointerHover } from '../../../input/pointer/hover';
import type { EditorTextSelection } from '../../../editor/navigation/text_selection';
import { SceneEditorNavigationSelection } from './navigation_selection';
import { PointerButton } from '../../../../hosts/common/input/pointer_event';
import { point_in_rect, type RectBounds } from '../../../../machine/ts/common/rect';
import type { PointerInputSnapshot, WheelInputSnapshot } from '../../../common/models';
import type { IdeCommandController } from '../../../commands/controller';
import type { RuntimeSourceState } from '../../../runtime/sources';
import { consumeIdeKey, isKeyJustPressed, isKeyDown } from '../../../input/keyboard/key_input';
import { INTEGER_INPUT_FORMAT } from '../../../editor/ui/inline/integer_input';
import { ValueInput } from '../../../editor/ui/inline/value_input';
import { api } from '../../../runtime/overlay_api';
import { editorViewState } from '../../../editor/ui/view/state';
import { createLuaTableFieldNumberEdits } from '../../../language/lua/source_edits';
import { getTextFileRuntimeSourceStatus } from '../../services/working_copy/runtime_source_status';
import { WorkbenchViewEditorPane } from '../../ui/editor_pane/workbench_view_pane';
import { revealWorkbenchListSelection, scrollWorkbenchList, workbenchListContainsPosition, workbenchListRowIndexAtPosition } from '../../ui/list_view';
import { navigateWorkbenchTree, setWorkbenchTreeCollapsed, workbenchTreeTwistieContainsPosition, WorkbenchTreeNavigationResult } from '../../ui/tree_view';
import { WorkbenchActionBarControl } from '../../ui/action_bar_control';
import { WorkbenchScrollControl } from '../../ui/scroll_control';
import { inputFocus, type InputFocusScope, type InputFocusTarget } from '../../../input/focus';
import { pointerCapture } from '../../../input/pointer/capture';
import type { SceneEditorController } from './controller';
import { POSITION_AXES, type SceneEditorInput, type SceneEditorSection } from './editor_input';
import { drawSceneEditor } from './render';
import { layoutSceneEditor } from './layout';
import { projectSceneSelection, selectSceneOutlineRow } from './outline';
import { SceneOptionEditor, type SceneEditorSectionCommands } from './option_editor';
import type { SceneOptionProperty } from './option_properties';
import type { ContextMenuController } from '../../services/context_menu/controller';
import type { WorkbenchSurfaceService } from '../../services/windows/service';
import type { WorkbenchSurface } from '../../services/windows/model';
import { WorkbenchTooltip } from '../../ui/tooltip';
import { measureText, measureTextRange } from '../../../editor/common/text/layout';
import { SceneOutlineFeedback } from './feedback';

/** Concrete editable view: document history here, draft history in each field. */
export class SceneEditorPane extends WorkbenchViewEditorPane<SceneEditorInput> {
	public override getSourceLocation(): EditorSourceLocation | undefined {
		const input = this.input;
		return this.controller.getSourceLocation(input);
	}
	public override getSelection(): SceneEditorNavigationSelection {
		const input = this.input;
		this.controller.refresh(input);
		return new SceneEditorNavigationSelection(input);
	}

	public readonly controls: readonly ValueInput<number>[];
	public readonly options: SceneOptionEditor;
	private status = '';
	private boundVersion = 0;
	private readonly actionBar: WorkbenchActionBarControl;
	private readonly details: WorkbenchScrollControl;
	private readonly unbindFieldFocus: readonly (() => void)[];
	private readonly actionTooltip = new WorkbenchTooltip();
	private readonly identityFeedback: SceneOutlineFeedback;
	private sourceHovered = false;
	private unsubscribeReadOnlyChange!: () => void;
	private unsubscribeContentChange!: () => void;
	private unsubscribeSelectionChange!: () => void;

	public constructor(
		private readonly controller: SceneEditorController,
		private readonly commands: IdeCommandController,
		private readonly sources: RuntimeSourceState,
		private readonly contextMenu: ContextMenuController, surfaces: WorkbenchSurfaceService, paneSurface: WorkbenchSurface,
		private readonly workArea: Readonly<RectBounds>,
		scope: InputFocusScope,
	) {
		super(scope);
		this.identityFeedback = new SceneOutlineFeedback(surfaces, paneSurface, workArea, this.focusTarget);
		this.actionTooltip.attach(surfaces, paneSurface, workArea);
		this.actionBar = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, commands, this.focusTarget, () => this.focus(), contextMenu);
		this.actionBar.focusTarget.canFocus = () => this.hasInput && this.input.actionBar.bounds.left < this.input.actionBar.bounds.right
			&& this.input.actionBar.bounds.top < this.input.actionBar.bounds.bottom;
		this.actionBar.onDidOpenOverflow = lifetime => {
			this.actionTooltip.hide(); this.sourceHovered = false;
			this.identityFeedback.clear();
			const input = this.input;
			lifetime.add({ dispose: input.workingCopy.onDidChangeContent(() => contextMenu.hide()) });
			lifetime.add({ dispose: input.authoring.onDidChangeSelection(() => contextMenu.hide()) });
		};
		this.details = new WorkbenchScrollControl(inputFocus, pointerCapture, this.focusTarget, event => {
			if (!isKeyJustPressed('Escape', event)) return false;
			consumeIdeKey('Escape', event);
			this.showSection('outline');
			return true;
		});
		this.focusTarget.canFocus = () => this.hasInput && this.input.outline.layout.visibleRowCount > 0;
		this.details.focusTarget.canFocus = () => this.hasInput && this.input.layout.mode !== 'outline' && this.input.outline.selectionIndex >= 0
			&& this.input.details.bounds.left < this.input.details.bounds.right && this.input.details.bounds.top < this.input.details.bounds.bottom;
		this.details.focusTarget.commandContext = this.focusTarget;
		for (const origin of [this.focusTarget, this.details.focusTarget]) origin.registerCommand('contextMenu', {
			isEnabled: () => this.hasInput && this.input.outline.selectionIndex >= 0,
			run: () => {
				const input = this.input, tree = input.outline;
				if (origin === this.focusTarget) revealWorkbenchListSelection(tree);
				this.openContextMenu(origin === this.focusTarget ? tree.layout.contentLeft + 4 : input.details.bounds.left + 4,
					origin === this.focusTarget ? tree.layout.contentTop + (tree.selectionIndex - (tree.scroll | 0) + 1) * tree.layout.rowHeight : input.details.bounds.top + 4, origin, true);
			},
		});
		const sectionCommands: SceneEditorSectionCommands = { details: {
			isEnabled: () => this.hasInput && this.input.outline.selectionIndex >= 0,
			run: () => this.showSection('details'),
		}, outline: {
			isEnabled: () => this.hasInput,
			run: () => this.showSection('outline'),
		} };
		this.focusTarget.registerCommand('sceneEditor.details', sectionCommands.details);
		this.focusTarget.registerCommand('sceneEditor.outline', sectionCommands.outline);
		this.focusTarget.registerCommand('sceneEditor.removeMember', {
			isEnabled: () => this.hasInput && this.controller.canRemoveSelectedMember(this.input),
			run: () => this.controller.removeSelectedMember(this.input),
		});
		for (const [command, direction] of [['sceneEditor.moveMemberUp', -1], ['sceneEditor.moveMemberDown', 1]] as const) {
			this.focusTarget.registerCommand(command, {
				isEnabled: () => this.hasInput && this.controller.canMoveSelectedMember(this.input, direction),
				run: () => this.controller.moveSelectedMember(this.input, direction),
			});
		}
		this.controls = POSITION_AXES.map((_axis, index) => new ValueInput(this.details.focusTarget, INTEGER_INPUT_FORMAT, value => {
			const property = this.input.properties[index];
			this.input.workingCopy.pushEditOperations(createLuaTableFieldNumberEdits(this.input.workingCopy.buffer, this.input.authoring.document!.analysis.chunk.locations, property.field!, value)!);
		}, () => this.update()));
		for (const control of this.controls) {
			control.field.focusTarget.commandContext = this.focusTarget;
			control.field.focusTarget.canFocus = () => this.details.focusTarget.canFocus!() && !control.field.readOnly;
			control.field.focusTarget.registerCommand('sceneEditor.details', sectionCommands.details);
			control.field.focusTarget.registerCommand('sceneEditor.outline', sectionCommands.outline);
		}
		this.unbindFieldFocus = [
			this.focusTarget.onDidFocus(() => { this.input.section = 'outline'; }),
			this.details.focusTarget.onDidFocus(() => { this.input.section = 'details'; }),
			...this.controls.map((control, index) => control.field.focusTarget.onDidFocus(() => this.revealProperty(index))),
		];
		this.options = new SceneOptionEditor(this.details.focusTarget, () => this.update(), (property, index) => this.revealOption(property, index), sectionCommands);
		for (const direction of ['undo', 'redo'] as const) {
			const historyCommand = {
				isEnabled: () => !this.input.workingCopy.readOnly && (direction === 'undo' ? this.input.workingCopy.canUndo : this.input.workingCopy.canRedo),
				run: () => { executeTextHistoryCommand(this.input.workingCopy, direction); },
			};
			this.focusTarget.registerCommand(direction, historyCommand);
			this.details.focusTarget.registerCommand(direction, historyCommand);
		}
	}

	protected override activate(): void {
		this.actionBar.setInput(this.input.actionBar, this.focusTarget);
		this.details.setInput(this.input.details);
		this.boundVersion = -1;
		// Edit and Undo can return to the retained projection before the next update.
		// Field bindings must still consume the canonical value after publication.
		this.unsubscribeContentChange = this.input.workingCopy.onDidChangeContent(() => { this.boundVersion = -1; });
		this.unsubscribeSelectionChange = this.input.authoring.onDidChangeSelection(() => {
			this.boundVersion = -1;
			const input = this.input, scope = this.focusTarget.scope, context = scope.contextGeneration;
			if (input.authoring.selection !== undefined) return;
			projectSceneSelection(input);
			// The empty subject publishes Outline geometry before its Details controls retire.
			layoutSceneEditor(input, true, true, this.contentBounds);
			this.options.clear();
			if (scope.contextGeneration !== context) return;
			if (this.updateControlAdmission()) this.bindFocusOrder();
		});
		this.unsubscribeReadOnlyChange = this.input.workingCopy.onDidChangeReadOnly(() => {
			if (this.updateControlAdmission()) this.bindFocusOrder();
		});
	}
	public override setOptions(_selection?: EditorTextSelection, navigationSelection?: SceneEditorNavigationSelection): void {
		if (navigationSelection === undefined) return;
		const scope = this.focusTarget.scope, context = scope.contextGeneration;
		this.controller.refresh(this.input);
		if (scope.contextGeneration !== context) return;
		navigationSelection.restore(this.input);
		if (scope.contextGeneration !== context) return;
		this.update();
	}

	public override layout(bounds: Readonly<RectBounds>): void { super.layout(bounds); this.update(); }

	public override update(): void {
		const scope = this.focusTarget.scope, context = scope.contextGeneration;
		this.controller.refresh(this.input);
		if (scope.contextGeneration !== context) return;
		const changed = this.boundVersion !== this.input.authoring.revision;
		const layoutChanged = layoutSceneEditor(this.input, changed, false, this.contentBounds);
		if (changed) {
			this.bindProperties();
			if (scope.contextGeneration !== context) return;
		}
		if (changed || layoutChanged) {
			if (!this.updateControlAdmission()) return;
			this.bindFocusOrder();
		}
		if (layoutChanged) {
			this.details.lineStep = this.input.outline.layout.rowHeight;
		}
		if (layoutChanged && this.input.layout.mode !== 'outline') {
			for (let index = 0; index < this.controls.length; index += 1) {
				if (this.controls[index].field.focusTarget.hasFocus) this.revealProperty(index);
			}
			for (let index = 0; index < this.options.controls.length; index += 1) {
				if (this.options.controls[index].field.focusTarget.hasFocus) this.revealOption(this.input.optionProperties[index], index);
			}
		}
		this.actionBar.update();
		const hint = this.actionBar.tooltipItem;
		if (hint !== undefined) this.actionTooltip.show(hint.tooltip, hint.bounds, editorViewState.font.renderFont(), measureTextRange, measureText, this.workArea);
		else if (this.sourceHovered) this.actionTooltip.show(this.input.workingCopy.resource.path, this.input.layout.sourceBounds, editorViewState.font.renderFont(), measureTextRange, measureText, this.workArea);
		else this.actionTooltip.hide();
		this.identityFeedback.update(editorViewState.font.renderFont(), measureTextRange, measureText);
		for (let index = 0; index < this.controls.length; index++) {
			if (this.controls[index].field.readOnly) continue;
			const bounds = this.input.properties[index].bounds;
			if (bounds.bottom <= this.input.details.bounds.top || bounds.top >= this.input.details.bounds.bottom) continue;
			this.controls[index].layout(bounds, this.input.details.bounds);
		}
		for (let index = 0; index < this.options.controls.length; index++) {
			if (this.options.controls[index].field.readOnly) continue;
			const bounds = this.input.optionProperties[index].bounds;
			if (bounds.bottom <= this.input.details.bounds.top || bounds.top >= this.input.details.bounds.bottom) continue;
			this.options.controls[index].layout(bounds, this.input.details.bounds);
		}
		this.status = SOURCE_STATUS[getTextFileRuntimeSourceStatus(this.sources, this.input.workingCopy)];
	}

	public draw(): void { drawSceneEditor(this.input, this.controls, this.options.controls, this.focusTarget.hasFocus, this.details.focusTarget.hasFocus); }

	public override get commandTarget(): InputFocusTarget {
		if (this.input.section === 'details' && this.details.focusTarget.canFocus!()) return this.details.focusTarget;
		if (this.focusTarget.canFocus!()) return this.focusTarget;
		if (this.details.focusTarget.canFocus!()) return this.details.focusTarget;
		return this.actionBar.focusTarget;
	}

	private showSection(section: SceneEditorSection): void {
		const input = this.input, scope = this.focusTarget.scope, context = scope.contextGeneration;
		const revision = inputFocus.revision;
		if (inputFocus.target?.edit?.commit() === false || scope.contextGeneration !== context || inputFocus.revision !== revision) return;
		const target = section === 'details' ? this.details.focusTarget : this.focusTarget;
		inputFocus.setTarget(target, () => {
			if (scope.contextGeneration !== context) return;
			input.section = section;
			this.identityFeedback.clear();
			this.update();
		});
	}

	private revealProperty(index: number): void {
		this.input.section = 'details';
		const bounds = this.input.properties[index].contentBounds;
		this.input.details.scrollbar.reveal(bounds.top, bounds.bottom, 2);
		layoutSceneEditor(this.input, false, false, this.contentBounds);
		this.controls[index].layout(this.input.properties[index].bounds, this.input.details.bounds);
	}

	private revealOption(property: SceneOptionProperty, index: number): void {
		this.input.section = 'details';
		this.input.details.scrollbar.reveal(property.contentBounds.top, property.contentBounds.bottom, 2);
		layoutSceneEditor(this.input, false, false, this.contentBounds);
		this.options.controls[index].layout(property.bounds, this.input.details.bounds);
	}

	private bindProperties(): void {
		for (let index = 0; index < this.controls.length; index += 1) {
			const property = this.input.properties[index];
			const control = this.controls[index];
			if (property.value !== null) control.setValue(property.value);
		}
		this.boundVersion = this.input.authoring.revision;
		this.options.bind(this.input);
	}

	/** Source authority and the containing client can change without a new projection. */
	private updateControlAdmission(): boolean {
		const input = this.input, scope = this.focusTarget.scope, context = scope.contextGeneration;
		const focused = inputFocus.target;
		let retiring: InputFocusTarget | undefined;
		const available = this.details.focusTarget.canFocus!();
		const outlineAvailable = this.focusTarget.canFocus!();
		const actionsAvailable = this.actionBar.focusTarget.canFocus!();
		if (!actionsAvailable) {
			pointerCapture.cancelTarget(this.actionBar);
			pointerHover.release(this.actionBar);
			this.actionTooltip.hide(); this.sourceHovered = false;
		}
		if (!available) this.details.cancelPointer();
		if (!outlineAvailable) {
			input.outline.hoverIndex = -1;
			this.identityFeedback.clear();
			pointerHover.release(this);
		}
		for (let index = 0; index < this.controls.length; index += 1) {
			const control = this.controls[index];
			control.field.readOnly = input.workingCopy.readOnly || input.properties[index].value === null;
			if (control.field.readOnly || !available) {
				control.cancel();
				if (focused === control.field.focusTarget) retiring = focused;
			}
		}
		if (!available && focused === this.details.focusTarget || !outlineAvailable && focused === this.focusTarget
			|| !actionsAvailable && focused === this.actionBar.focusTarget) retiring = focused;
		this.options.updateControlAdmission(input);
		if (scope.contextGeneration !== context) return false;
		retiring?.release();
		return scope.contextGeneration === context;
	}

	/** Presentation changes rewire navigation, never rebind a source draft or its history. */
	private bindFocusOrder(): void {
		let previous = this.actionBar.focusTarget;
		this.focusTarget.next = this.focusTarget.previous = null;
		this.details.focusTarget.next = this.details.focusTarget.previous = null;
		if (this.focusTarget.canFocus!()) {
			previous.next = this.focusTarget;
			this.focusTarget.previous = previous;
			previous = this.focusTarget;
		}
		if (this.details.focusTarget.canFocus!()) {
			previous.next = this.details.focusTarget;
			this.details.focusTarget.previous = previous;
			previous = this.details.focusTarget;
		}
		for (let index = 0; index < this.controls.length + this.options.controls.length; index += 1) {
			const control = index < this.controls.length ? this.controls[index] : this.options.controls[index - this.controls.length];
			control.field.focusTarget.next = control.field.focusTarget.previous = null;
			if (!control.field.focusTarget.canFocus!()) continue;
			previous.next = control.field.focusTarget;
			control.field.focusTarget.previous = previous;
			previous = control.field.focusTarget;
		}
		previous.next = this.actionBar.focusTarget;
		this.actionBar.focusTarget.previous = previous;
	}

	private select(index: number, toggle: boolean): boolean {
		const input = this.input, incoming = input.outline.rows[index];
		const span = incoming.element.span, sceneSpan = (incoming.parent ?? incoming).element.span;
		const intent = input.authoring.selectionRevision;
		const scope = this.focusTarget.scope, context = scope.contextGeneration;
		if (!this.focusTarget.focus()) return false;
		const focused = inputFocus.admittedTarget;
		if (this.input !== input || scope.contextGeneration !== context || input.authoring.selectionRevision !== intent
			|| focused === null || !scope.contains(focused.scope)) return false;
		this.controller.refresh(input);
		if (this.input !== input || scope.contextGeneration !== context || input.authoring.selectionRevision !== intent
			|| span.start === span.end || sceneSpan.start === sceneSpan.end) return false;
		index = input.outline.rows.findIndex(row => row.element.kind === incoming.element.kind
			&& row.element.span.start === span.start && row.element.span.end === span.end
			&& (row.parent ?? row).element.span.start === sceneSpan.start && (row.parent ?? row).element.span.end === sceneSpan.end);
		if (index === -1) return false;
		const row = input.outline.rows[index], version = input.workingCopy.version;
		if (toggle) setWorkbenchTreeCollapsed(input.outline, index, !row.collapsed);
		if (!selectSceneOutlineRow(input, index)) return false;
		const selected = input.authoring.selection;
		const current = inputFocus.admittedTarget;
		if (current === null || !scope.contains(current.scope) || this.input !== input || scope.contextGeneration !== context || input.workingCopy.version !== version
			|| selected?.scene !== row.element.scene || selected.kind !== row.element.kind
			|| selected.kind === 'member' && row.element.kind === 'member' && selected.entry !== row.element.entry) return false;
		const contentChanged = this.boundVersion !== input.authoring.revision;
		this.bindProperties();
		if (scope.contextGeneration !== context) return false;
		revealWorkbenchListSelection(input.outline);
		layoutSceneEditor(input, contentChanged, true, this.contentBounds);
		if (!this.updateControlAdmission()) return false;
		this.bindFocusOrder();
		return true;
	}

	private openContextMenu(x: number, y: number, origin: InputFocusTarget, keyboard = false): void {
		const input = this.input, version = input.workingCopy.version, selected = input.outline.rows[input.outline.selectionIndex];
		this.identityFeedback.clear(); this.actionTooltip.hide(); this.sourceHovered = false;
		this.contextMenu.show(x, y, input.contextActions, this.commands, {
			selectFirst: keyboard, invocationOrigin: origin, returnFocus: origin, commandTarget: this.focusTarget,
			onWillShow: lifetime => {
				lifetime.add({ dispose: input.workingCopy.onDidChangeContent(() => this.contextMenu.hide()) });
				lifetime.add({ dispose: input.authoring.onDidChangeSelection(() => this.contextMenu.hide()) });
				if (this.input !== input || input.workingCopy.version !== version || input.outline.rows[input.outline.selectionIndex] !== selected) this.contextMenu.hide(false);
			},
		});
	}

	public handleKeyboard(input: KeyInputEvent): void {
		for (const [code, command] of TREE_NAVIGATION) {
			if (isKeyDown(code, input)) {
				consumeIdeKey(code, input);
				if (navigateWorkbenchTree(this.input.outline, command) !== WorkbenchTreeNavigationResult.None && !this.select(this.input.outline.selectionIndex, false)) return;
				this.identityFeedback.keyboardSelection(this.input);
				return;
			}
		}
		if (isKeyJustPressed('Enter', input)) {
			consumeIdeKey('Enter', input);
			if (this.input.outline.selectionIndex >= 0) this.showSection('details');
		}
	}

	public onPointerLeave(): void {
		this.input.outline.hoverIndex = -1;
		this.sourceHovered = false;
		this.identityFeedback.onPointerLeave();
	}

	protected override handleViewPointer(snapshot: PointerInputSnapshot, justPressed: boolean): boolean {
		if (!snapshot.valid || !snapshot.insideViewport || !point_in_rect(snapshot.viewportX, snapshot.viewportY, this.input.layout)) return false;
		const index = workbenchListRowIndexAtPosition(this.input.outline, snapshot.viewportX, snapshot.viewportY);
		this.input.outline.hoverIndex = index;
		this.identityFeedback.pointer(this.input, index, snapshot);
		this.sourceHovered = point_in_rect(snapshot.viewportX, snapshot.viewportY, this.input.layout.sourceBounds);
		if (this.sourceHovered) { pointerHover.visit(this); if (justPressed) this.focus(); return true; }
		if (this.actionBar.handlePointer(snapshot)) return true;
		if ((snapshot.justPressedButtons & PointerButton.Secondary) !== 0 && index >= 0) {
			if (this.select(index, false)) this.openContextMenu(snapshot.viewportX, snapshot.viewportY, this.focusTarget);
			return true;
		}
		for (let index = 0; index < this.controls.length; index += 1) {
			const control = this.controls[index];
			const bounds = this.input.properties[index].bounds;
			if (!control.field.readOnly && ((point_in_rect(snapshot.viewportX, snapshot.viewportY, this.input.details.bounds)
				&& point_in_rect(snapshot.viewportX, snapshot.viewportY, bounds)) || control.field.pointerSelecting)) {
				control.handlePointer(bounds.left + 3, snapshot.viewportX, justPressed, ((snapshot.pressedButtons & PointerButton.Primary) !== 0));
				return true;
			}
		}
		for (let index = 0; index < this.options.controls.length; index += 1) {
			const control = this.options.controls[index];
			const bounds = this.input.optionProperties[index].bounds;
			if (!control.field.readOnly && ((point_in_rect(snapshot.viewportX, snapshot.viewportY, this.input.details.bounds)
				&& point_in_rect(snapshot.viewportX, snapshot.viewportY, bounds)) || control.field.pointerSelecting)) {
				control.handlePointer(bounds.left + 3, snapshot.viewportX, justPressed, ((snapshot.pressedButtons & PointerButton.Primary) !== 0));
				return true;
			}
		}
		if ((snapshot.justPressedButtons & PointerButton.Secondary) !== 0 && point_in_rect(snapshot.viewportX, snapshot.viewportY, this.input.details.bounds)) {
			const input = this.input, selected = input.outline.rows[input.outline.selectionIndex], version = input.workingCopy.version;
			const scope = this.focusTarget.scope, context = scope.contextGeneration;
			this.details.focusTarget.focus();
			const focused = inputFocus.admittedTarget;
			if (selected !== undefined && this.input === input && scope.contextGeneration === context && input.workingCopy.version === version
				&& input.outline.rows[input.outline.selectionIndex] === selected && focused !== null && scope.contains(focused.scope))
				this.openContextMenu(snapshot.viewportX, snapshot.viewportY, this.details.focusTarget);
			return true;
		}
		if (this.details.handlePointer(snapshot)) return true;
		if (index >= 0) pointerHover.visit(this);
		else pointerHover.release(this);
		if (justPressed) {
			if (index >= 0) this.select(index, workbenchTreeTwistieContainsPosition(this.input.outline, index, snapshot.viewportX));
			else this.focus();
		}
		return index >= 0;
	}

	public handleWheel(event: WheelInputSnapshot): void {
		if (this.details.handleWheel(event, event.deltaY * this.details.lineStep * 3)) layoutSceneEditor(this.input, false, false, this.contentBounds);
		else if (workbenchListContainsPosition(this.input.outline, event.viewportX, event.viewportY)) scrollWorkbenchList(this.input.outline, event.deltaY * 3);
	}

	public drawStatusBar(bounds: Readonly<RectBounds>, color: number): void {
		api.blit_text_inline_with_font(this.status, bounds.left + 4, bounds.top + 2, 0, color, editorViewState.font.renderFont());
	}

	public override dispose(): void {
		pointerHover.release(this);
		this.actionBar.dispose();
		this.actionTooltip.detach();
		this.identityFeedback.dispose();
		this.options.clear();
		for (const unbind of this.unbindFieldFocus) unbind();
		for (const control of this.controls) control.dispose();
		this.details.dispose();
		super.dispose();
	}

	public override clearInput(): void {
		this.unsubscribeContentChange();
		this.unsubscribeSelectionChange();
		this.unsubscribeReadOnlyChange();
		pointerHover.release(this);
		this.actionBar.clearInput();
		this.actionTooltip.hide(); this.sourceHovered = false;
		this.identityFeedback.clear();
		for (const control of this.controls) { control.cancel(); control.field.focusTarget.release(); }
		this.options.clear();
		this.details.clearInput();
		super.clearInput();
	}
}

const TREE_NAVIGATION = [
	['ArrowUp', 'up'], ['ArrowDown', 'down'], ['ArrowLeft', 'left'], ['ArrowRight', 'right'],
	['PageUp', 'page-up'], ['PageDown', 'page-down'], ['Home', 'home'], ['End', 'end'],
] as const;
const SOURCE_STATUS = {
	applied: 'SOURCE APPLIED', pending: 'SOURCE NOT APPLIED', failed: 'SOURCE APPLY FAILED',
	untracked: 'SOURCE STATUS UNKNOWN', source_only: 'SOURCE ONLY',
};
