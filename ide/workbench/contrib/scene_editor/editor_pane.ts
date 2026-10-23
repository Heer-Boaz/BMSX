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
import { FullWidthWorkbenchEditorPane } from '../../ui/editor_pane/workbench_view_pane';
import { revealWorkbenchListSelection, scrollWorkbenchList, workbenchListContainsPosition, workbenchListRowIndexAtPosition } from '../../ui/list_view';
import { navigateWorkbenchTree, setWorkbenchTreeCollapsed, workbenchTreeTwistieContainsPosition, WorkbenchTreeNavigationResult } from '../../ui/tree_view';
import { WorkbenchActionBarControl } from '../../ui/action_bar_control';
import { WorkbenchScrollControl } from '../../ui/scroll_control';
import { inputFocus } from '../../../input/focus';
import { pointerCapture } from '../../../input/pointer/capture';
import type { ResourcePanelController } from '../resources/panel/controller';
import type { SceneEditorController } from './controller';
import { POSITION_AXES, type SceneEditorInput } from './editor_input';
import { drawSceneEditor } from './render';
import { layoutSceneEditor } from './layout';
import { selectSceneOutlineRow } from './outline';
import { SceneOptionEditor } from './option_editor';
import type { SceneOptionProperty } from './option_properties';
import type { ContextMenuController } from '../../services/context_menu/controller';
import type { WorkbenchSurfaceService } from '../../services/windows/service';
import type { WorkbenchSurface } from '../../services/windows/model';
import { WorkbenchTooltip } from '../../ui/tooltip';
import { measureText, measureTextRange } from '../../../editor/common/text/layout';

/** Concrete editable view: document history here, draft history in each field. */
export class SceneEditorPane extends FullWidthWorkbenchEditorPane<SceneEditorInput> {
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
	private sourceHovered = false;

	public constructor(resourcePanel: ResourcePanelController,
		private readonly controller: SceneEditorController,
		commands: IdeCommandController,
		private readonly sources: RuntimeSourceState,
		contextMenu: ContextMenuController, surfaces: WorkbenchSurfaceService, paneSurface: WorkbenchSurface,
		private readonly getWorkArea: () => Readonly<RectBounds>,
	) {
		super(resourcePanel);
		this.actionTooltip.attach(surfaces, paneSurface, getWorkArea);
		this.actionBar = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, commands, this.focusTarget, () => this.focus(), contextMenu);
		this.actionBar.onDidOpenOverflow = lifetime => {
			this.actionTooltip.hide(); this.sourceHovered = false;
			lifetime.add({ dispose: this.input.workingCopy.onDidChangeContent(() => contextMenu.hide()) });
		};
		this.details = new WorkbenchScrollControl(inputFocus, pointerCapture, this.focusTarget);
		this.details.focusTarget.commandContext = this.focusTarget;
		this.controls = POSITION_AXES.map((_axis, index) => new ValueInput(this.focusTarget, INTEGER_INPUT_FORMAT, value => {
			const property = this.input.properties[index];
			this.input.workingCopy.pushEditOperations(createLuaTableFieldNumberEdits(this.input.workingCopy.buffer, this.input.document.analysis.chunk.locations, property.field!, value)!);
		}, () => this.update()));
		this.unbindFieldFocus = this.controls.map((control, index) => control.field.focusTarget.onDidFocus(() => this.revealProperty(index)));
		this.options = new SceneOptionEditor(this.focusTarget, () => this.update(), property => this.revealOption(property));
		this.focusTarget.registerCommand('undo', {
			isEnabled: () => !this.input.workingCopy.readOnly && this.input.workingCopy.canUndo,
			run: () => { executeTextHistoryCommand(this.input.workingCopy, 'undo'); },
		});
		this.focusTarget.registerCommand('redo', {
			isEnabled: () => !this.input.workingCopy.readOnly && this.input.workingCopy.canRedo,
			run: () => { executeTextHistoryCommand(this.input.workingCopy, 'redo'); },
		});
	}

	protected override activate(): void {
		super.activate();
		this.actionBar.setInput(this.input.actionBar, this.focusTarget);
		this.details.setInput(this.input.details);
		this.boundVersion = -1;
	}
	public override setOptions(_selection?: EditorTextSelection, navigationSelection?: SceneEditorNavigationSelection): void {
		if (navigationSelection === undefined) return;
		this.controller.refresh(this.input);
		navigationSelection.restore(this.input);
		this.update();
	}

	public override update(): void {
		this.controller.refresh(this.input);
		const changed = this.boundVersion !== this.input.version;
		if (changed) this.bindProperties();
		if (layoutSceneEditor(this.input, changed, false, this.contentBounds)) {
			this.details.lineStep = this.input.outline.layout.rowHeight;
			for (let index = 0; index < this.controls.length; index += 1) {
				if (this.controls[index].field.focusTarget.hasFocus) this.revealProperty(index);
			}
			for (let index = 0; index < this.options.controls.length; index += 1) {
				if (this.options.controls[index].field.focusTarget.hasFocus) this.revealOption(this.input.optionProperties[index]);
			}
		}
		this.actionBar.update();
		const hint = this.actionBar.tooltipItem;
		if (hint !== undefined) this.actionTooltip.show(hint.tooltip, hint.bounds, editorViewState.font.renderFont(), measureTextRange, measureText, this.getWorkArea());
		else if (this.sourceHovered) this.actionTooltip.show(this.input.workingCopy.resource.path, this.input.layout.sourceBounds, editorViewState.font.renderFont(), measureTextRange, measureText, this.getWorkArea());
		else this.actionTooltip.hide();
		for (let index = 0; index < this.controls.length; index++) {
			if (this.controls[index].field.readOnly) continue;
			const bounds = this.input.properties[index].bounds;
			if (bounds.bottom <= this.input.details.bounds.top || bounds.top >= this.input.details.bounds.bottom) continue;
			this.controls[index].layout(bounds.right - bounds.left);
		}
		for (let index = 0; index < this.options.controls.length; index++) {
			if (this.options.controls[index].field.readOnly) continue;
			const bounds = this.input.optionProperties[index].bounds;
			if (bounds.bottom <= this.input.details.bounds.top || bounds.top >= this.input.details.bounds.bottom) continue;
			this.options.controls[index].layout(bounds.right - bounds.left);
		}
		this.status = SOURCE_STATUS[getTextFileRuntimeSourceStatus(this.sources, this.input.workingCopy)];
	}

	public draw(): void { drawSceneEditor(this.input, this.controls, this.options.controls, this.details.focusTarget.hasFocus); }

	private revealProperty(index: number): void {
		const bounds = this.input.properties[index].contentBounds;
		this.input.details.scrollbar.reveal(bounds.top, bounds.bottom, 2);
		layoutSceneEditor(this.input, false, false, this.contentBounds);
	}

	private revealOption(property: SceneOptionProperty): void {
		this.input.details.scrollbar.reveal(property.contentBounds.top, property.contentBounds.bottom, 2);
		layoutSceneEditor(this.input, false, false, this.contentBounds);
	}

	private bindProperties(): void {
		let previous = this.focusTarget;
		// An empty scroll area is pointer-focusable but not a Tab stop. Its local
		// neighbours still belong to this input, never to the preceding member.
		this.details.focusTarget.previous = this.focusTarget;
		this.details.focusTarget.next = this.actionBar.focusTarget;
		if (this.input.outline.selectionIndex >= 0) {
			previous.next = this.details.focusTarget;
			previous = this.details.focusTarget;
		}
		this.focusTarget.previous = null;
		for (let index = 0; index < this.controls.length; index += 1) {
			const property = this.input.properties[index];
			const control = this.controls[index];
			control.field.readOnly = this.input.workingCopy.readOnly || property.value === null;
			if (control.field.readOnly) {
				// Revoked source targets cannot retain a draft that blur would publish.
				control.cancel();
				control.field.focusTarget.release();
				control.field.focusTarget.previous = null;
				control.field.focusTarget.next = null;
			} else {
				control.setValue(property.value!);
				previous.next = control.field.focusTarget;
				control.field.focusTarget.previous = previous;
				previous = control.field.focusTarget;
			}
		}
		this.options.bind(this.input);
		for (const control of this.options.controls) {
			if (control.field.readOnly) continue;
			previous.next = control.field.focusTarget;
			control.field.focusTarget.previous = previous;
			previous = control.field.focusTarget;
		}
		previous.next = this.actionBar.focusTarget;
		this.actionBar.focusTarget.previous = previous;
		this.actionBar.focusTarget.next = this.focusTarget;
		this.focusTarget.previous = this.actionBar.focusTarget;
		this.boundVersion = this.input.version;
	}

	private select(index: number, toggle: boolean): void {
		this.focus();
		this.controller.refresh(this.input);
		if (toggle) setWorkbenchTreeCollapsed(this.input.outline, index, !this.input.outline.rows[index].collapsed);
		selectSceneOutlineRow(this.input, index);
		const contentChanged = this.boundVersion !== this.input.version;
		this.bindProperties();
		revealWorkbenchListSelection(this.input.outline);
		layoutSceneEditor(this.input, contentChanged, true, this.contentBounds);
	}

	public handleKeyboard(input: KeyInputEvent): void {
		for (const [code, command] of TREE_NAVIGATION) {
			if (isKeyDown(code, input)) {
				consumeIdeKey(code, input);
				if (navigateWorkbenchTree(this.input.outline, command) !== WorkbenchTreeNavigationResult.None) this.select(this.input.outline.selectionIndex, false);
				return;
			}
		}
		if (isKeyJustPressed('Enter', input)) {
			consumeIdeKey('Enter', input);
			if (this.focusTarget.next !== null) this.focusTarget.next.focus();
		}
	}

	public onPointerLeave(): void {
		this.input.outline.hoverIndex = -1;
		this.sourceHovered = false;
	}

	protected override handleViewPointer(snapshot: PointerInputSnapshot, justPressed: boolean): boolean {
		if (!snapshot.valid || !snapshot.insideViewport || !point_in_rect(snapshot.viewportX, snapshot.viewportY, this.input.layout)) return false;
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
		const index = workbenchListRowIndexAtPosition(this.input.outline, snapshot.viewportX, snapshot.viewportY);
		if (index >= 0) pointerHover.visit(this);
		else pointerHover.release(this);
		this.input.outline.hoverIndex = index;
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
		this.details.dispose();
		this.options.clear();
		for (const unbind of this.unbindFieldFocus) unbind();
		for (const control of this.controls) control.dispose();
		super.dispose();
	}

	public override clearInput(): void {
		pointerHover.release(this);
		this.actionBar.clearInput();
		this.actionTooltip.hide(); this.sourceHovered = false;
		this.details.clearInput();
		this.options.clear();
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
