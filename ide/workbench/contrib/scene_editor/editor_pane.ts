import type { EditorParts } from '../../services/editor/editor_parts';
import { WORKBENCH_TEXT_EDITOR_ID } from '../code_editor/editor_input';
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
import { layoutSceneEditor, measureSceneEditorMinimumWidth } from './layout';
import { selectSceneOutlineRow } from './outline';
import { SceneOptionEditor, type SceneEditorSectionCommands } from './option_editor';
import type { SceneOptionProperty } from './option_properties';
import type { ContextMenuController } from '../../services/context_menu/controller';
import type { WorkbenchSurfaceService } from '../../services/windows/service';
import type { WorkbenchSurface } from '../../services/windows/model';
import { WorkbenchTooltip } from '../../ui/tooltip';
import { measureText, measureTextRange } from '../../../editor/common/text/layout';
import { SceneOutlineFeedback } from './feedback';
import type { EditorGroupView } from '../../services/editor/editor_group';

/** Concrete editable view: document history here, draft history in each field. */
export class SceneEditorPane extends WorkbenchViewEditorPane<SceneEditorInput> {
	public override get companionGameMinimumWidth(): number { return measureSceneEditorMinimumWidth(); }
	public override getSelection(): SceneEditorNavigationSelection {
		this.controller.refresh(this.input);
		return new SceneEditorNavigationSelection(this.input);
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

	public constructor(
		private readonly controller: SceneEditorController,
		commands: IdeCommandController,
		private readonly sources: RuntimeSourceState,
		contextMenu: ContextMenuController, surfaces: WorkbenchSurfaceService, paneSurface: WorkbenchSurface,
		private readonly workArea: Readonly<RectBounds>,
		private readonly group: EditorGroupView,
		parts: EditorParts,
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
			lifetime.add({ dispose: this.input.workingCopy.onDidChangeContent(() => contextMenu.hide()) });
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
		const sectionCommands: SceneEditorSectionCommands = { details: {
			isEnabled: () => this.hasInput && this.input.outline.selectionIndex >= 0,
			run: () => this.showSection('details'),
		}, outline: {
			isEnabled: () => this.hasInput,
			run: () => this.showSection('outline'),
		} };
		this.focusTarget.registerCommand('sceneEditor.details', sectionCommands.details);
		this.focusTarget.registerCommand('sceneEditor.outline', sectionCommands.outline);
		this.focusTarget.registerCommand('sceneEditor.source', {
			isEnabled: () => this.hasInput,
			run: () => this.controller.openSource(parts.documentDestination(this.group, { resource: this.input.workingCopy.resource, editorId: WORKBENCH_TEXT_EDITOR_ID }), this.input),
		});
		this.focusTarget.registerCommand('sceneEditor.removeMember', {
			isEnabled: () => this.hasInput && this.controller.canRemoveSelectedMember(this.input),
			run: () => { const input = this.input; if (this.focusInput(input)) this.controller.removeSelectedMember(input); },
		});
		for (const [command, direction] of [['sceneEditor.moveMemberUp', -1], ['sceneEditor.moveMemberDown', 1]] as const) {
			this.focusTarget.registerCommand(command, {
				isEnabled: () => this.hasInput && this.controller.canMoveSelectedMember(this.input, direction),
				run: () => { const input = this.input; if (this.focusInput(input)) this.controller.moveSelectedMember(input, direction); },
			});
		}
		this.controls = POSITION_AXES.map((_axis, index) => new ValueInput(this.details.focusTarget, INTEGER_INPUT_FORMAT, value => {
			const property = this.input.properties[index];
			this.input.workingCopy.pushEditOperations(createLuaTableFieldNumberEdits(this.input.workingCopy.buffer, this.input.document.analysis.chunk.locations, property.field!, value)!);
		}, () => this.update()));
		for (const control of this.controls) {
			control.field.focusTarget.commandContext = this.focusTarget;
			control.field.focusTarget.canFocus = () => this.details.focusTarget.canFocus!() && !control.field.readOnly;
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
		this.unsubscribeReadOnlyChange = this.input.workingCopy.onDidChangeReadOnly(() => {
			this.updateControlAdmission();
			this.bindFocusOrder();
		});
	}
	public override setOptions(_selection?: EditorTextSelection, navigationSelection?: SceneEditorNavigationSelection): void {
		if (navigationSelection === undefined) return;
		this.controller.refresh(this.input);
		navigationSelection.restore(this.input);
		this.update();
	}

	public override layout(bounds: Readonly<RectBounds>): void { super.layout(bounds); this.update(); }

	public override update(): void {
		this.controller.refresh(this.input);
		const changed = this.boundVersion !== this.input.version;
		const layoutChanged = layoutSceneEditor(this.input, changed, false, this.contentBounds);
		if (changed) this.bindProperties();
		if (changed || layoutChanged) {
			this.updateControlAdmission();
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
		if (inputFocus.target?.edit?.commit() === false) return;
		this.input.section = section;
		this.identityFeedback.clear();
		this.update();
		if (section === 'details' && this.details.focusTarget.canFocus!()) this.details.focusTarget.focus();
		else this.focus();
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
		this.options.bind(this.input);
		this.boundVersion = this.input.version;
	}

	/** Source authority and the containing client can change without a new projection. */
	private updateControlAdmission(): void {
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
			this.input.outline.hoverIndex = -1;
			this.identityFeedback.clear();
			pointerHover.release(this);
		}
		for (let index = 0; index < this.controls.length; index += 1) {
			const control = this.controls[index];
			control.field.readOnly = this.input.workingCopy.readOnly || this.input.properties[index].value === null;
			if (control.field.readOnly || !available) {
				control.cancel();
				control.field.focusTarget.release();
			}
		}
		this.options.updateControlAdmission(this.input);
		if (!available) this.details.focusTarget.release();
		if (!outlineAvailable) this.focusTarget.release();
		if (!actionsAvailable) this.actionBar.focusTarget.release();
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

	private select(index: number, toggle: boolean): void {
		this.focusTarget.focus();
		this.controller.refresh(this.input);
		if (toggle) setWorkbenchTreeCollapsed(this.input.outline, index, !this.input.outline.rows[index].collapsed);
		selectSceneOutlineRow(this.input, index);
		const contentChanged = this.boundVersion !== this.input.version;
		this.bindProperties();
		revealWorkbenchListSelection(this.input.outline);
		layoutSceneEditor(this.input, contentChanged, true, this.contentBounds);
		this.updateControlAdmission();
		this.bindFocusOrder();
	}

	public handleKeyboard(input: KeyInputEvent): void {
		for (const [code, command] of TREE_NAVIGATION) {
			if (isKeyDown(code, input)) {
				consumeIdeKey(code, input);
				if (navigateWorkbenchTree(this.input.outline, command) !== WorkbenchTreeNavigationResult.None) this.select(this.input.outline.selectionIndex, false);
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
