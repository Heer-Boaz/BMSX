import type { KeyInputEvent } from '../../../../hosts/common/input/text';
import { point_in_rect, type RectBounds } from '../../../../machine/ts/common/rect';
import type { PointerInputSnapshot, WheelInputSnapshot } from '../../../common/models';
import type { EditorCommandRunner } from '../../../common/commands';
import { COLOR_STATUS_WARNING } from '../../../common/constants';
import { showEditorMessage } from '../../../common/feedback_state';
import { executeTextHistoryCommand } from '../../../editor/editing/history_commands';
import type { EditorModelEdit } from '../../../editor/model/text_model';
import type { EditorTextSelection } from '../../../editor/navigation/text_selection';
import { INTEGER_INPUT_FORMAT, parseIntegerInput } from '../../../editor/ui/inline/integer_input';
import { ValueInput } from '../../../editor/ui/inline/value_input';
import { editorViewState } from '../../../editor/ui/view/state';
import { inputFocus } from '../../../input/focus';
import { consumeIdeKey, isKeyJustPressed, isShiftDown, isKeyDown } from '../../../input/keyboard/key_input';
import { PointerButton } from '../../../../hosts/common/input/pointer_event';
import { pointerCapture } from '../../../input/pointer/capture';
import { pointerHover } from '../../../input/pointer/hover';
import { api } from '../../../runtime/overlay_api';
import type { RuntimeSourceState } from '../../../runtime/sources';
import { getTextFileRuntimeSourceStatus } from '../../services/working_copy/runtime_source_status';
import { WorkbenchActionBarControl } from '../../ui/action_bar_control';
import { FullWidthWorkbenchEditorPane } from '../../ui/editor_pane/workbench_view_pane';
import { revealWorkbenchListSelection, scrollWorkbenchList, workbenchListContainsPosition, workbenchListRowIndexAtPosition } from '../../ui/list_view';
import { ScrollbarPointerControl } from '../../ui/scrollbar_pointer';
import { navigateWorkbenchTree, setWorkbenchTreeCollapsed, workbenchTreeTwistieContainsPosition, WorkbenchTreeNavigationResult } from '../../ui/tree_view';
import type { ResourcePanelController } from '../resources/panel/controller';
import type { CartMapController } from './controller';
import type { CartMapInput } from './editor_input';
import { projectCartMap, selectCartMapRow, createCartMapMove } from './source_projection';
import { layoutCartMap } from './layout';
import { drawCartMap } from './render';
import { CartMapNavigationSelection, restoreCartMapView } from './view_snapshot';

/** Display seeds carry coordinates; an accepted draft carries a versioned source proposal. */
export type CartMapCoordinateEdit = { readonly coordinate: number; readonly edit?: EditorModelEdit };

export class CartMapPane extends FullWidthWorkbenchEditorPane<CartMapInput> {
	public readonly controls: readonly ValueInput<CartMapCoordinateEdit>[];
	private readonly actions: WorkbenchActionBarControl;
	private readonly scrollbar = new ScrollbarPointerControl(pointerCapture);
	private readonly gridFocus = inputFocus.createTarget(this.focusTarget);
	private readonly unbindGrid = this.gridFocus.bindKeyboard(input => this.handleGridKeyboard(input));
	private boundRevision = -1;
	public constructor(resources: ResourcePanelController, controller: CartMapController, commands: EditorCommandRunner, private readonly sources: RuntimeSourceState) {
		super(resources);
		this.gridFocus.commandContext = this.focusTarget;
		this.actions = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, commands, this.focusTarget);
		this.focusTarget.registerCommand('cartMap.source', { isEnabled: () => true, run: () => controller.openSource(this.input) });
		for (const direction of ['undo', 'redo'] as const) this.focusTarget.registerCommand(direction, {
			isEnabled: () => !this.input.workingCopy.readOnly && (direction === 'undo' ? this.input.workingCopy.canUndo : this.input.workingCopy.canRedo),
			run: () => {
				if (!executeTextHistoryCommand(this.input.workingCopy, direction)) return;
				this.update();
				if (this.input.tree.selectionIndex >= 0) revealWorkbenchListSelection(this.input.tree);
				if (this.input.selected !== undefined) this.input.grid.reveal(this.input.selected);
			},
		});
		this.controls = [0, 1].map(axis => new ValueInput<CartMapCoordinateEdit>(this.focusTarget, {
			options: INTEGER_INPUT_FORMAT.options, invalidBlurMessage: 'Map edit cancelled; source unchanged.',
			format: value => String(value.coordinate),
			parse: text => {
				const result = parseIntegerInput(text);
				if ('error' in result) return result;
				const item = this.input.selected!;
				const x = axis === 0 ? result.value : item.x, y = axis === 1 ? result.value : item.y;
				try { return { value: { coordinate: result.value, edit: createCartMapMove(item, x, y) } }; }
				catch (error) { return { error: String(error) }; }
			},
		}, value => this.applyMove(value.edit!), () => this.update()));
	}
	public override getSelection(): CartMapNavigationSelection { return new CartMapNavigationSelection(this.input); }
	protected override activate(): void {
		super.activate();
		this.boundRevision = -1;
		this.actions.setInput(this.input.actionBar, this.focusTarget);
	}
	public override setOptions(_selection?: EditorTextSelection, navigation?: CartMapNavigationSelection): void {
		if (navigation === undefined) return;
		restoreCartMapView(this.input, navigation.view);
		this.update();
	}
	public override update(): void {
		projectCartMap(this.input);
		const changed = this.boundRevision !== this.input.viewRevision;
		if (changed) {
			const item = this.input.selected;
			let previous = this.gridFocus;
			this.focusTarget.next = this.gridFocus; this.gridFocus.previous = this.focusTarget;
			for (let axis = 0; axis < this.controls.length; axis++) {
				const control = this.controls[axis];
				control.cancel();
				control.field.readOnly = item === undefined || this.input.workingCopy.readOnly;
				if (control.field.readOnly) {
					control.field.focusTarget.release(); control.field.focusTarget.previous = null; control.field.focusTarget.next = null;
				} else {
					control.setValue({ coordinate: axis === 0 ? item.x : item.y });
					previous.next = control.field.focusTarget; control.field.focusTarget.previous = previous;
					previous = control.field.focusTarget;
				}
			}
			previous.next = this.actions.focusTarget; this.actions.focusTarget.previous = previous;
			this.actions.focusTarget.next = this.focusTarget; this.focusTarget.previous = this.actions.focusTarget;
			this.boundRevision = this.input.viewRevision;
		}
		this.actions.update();
		layoutCartMap(this.input, this.contentBounds, changed);
		if (this.input.selected !== undefined) for (let axis = 0; axis < this.controls.length; axis++) {
			const bounds = this.input.fieldBounds[axis];
			this.controls[axis].layout(bounds.right - bounds.left);
		}
	}
	private applyMove(edit: EditorModelEdit): void {
		const input = this.input;
		input.workingCopy.history.applyEdits(new Map([[input.workingCopy, edit]]));
		this.update();
		revealWorkbenchListSelection(input.tree);
		if (input.selected !== undefined) input.grid.reveal(input.selected);
	}
	private select(index: number, grid = false): void {
		(grid ? this.gridFocus : this.focusTarget).focus();
		projectCartMap(this.input);
		selectCartMapRow(this.input, index);
		this.update();
		if (index >= 0) revealWorkbenchListSelection(this.input.tree);
		if (this.input.selected !== undefined) this.input.grid.reveal(this.input.selected);
	}
	public handleKeyboard(input: KeyInputEvent): void {
		for (const [code, command] of NAVIGATION) if (isKeyDown(code, input)) {
			consumeIdeKey(code, input);
			if (navigateWorkbenchTree(this.input.tree, command) !== WorkbenchTreeNavigationResult.None) this.select(this.input.tree.selectionIndex);
			return;
		}
		if (isKeyJustPressed('Enter', input)) { consumeIdeKey('Enter', input); this.gridFocus.focus(); }
	}
	private handleGridKeyboard(input: KeyInputEvent): void {
		if (isKeyJustPressed('Escape', input)) { consumeIdeKey('Escape', input); this.select(-1, true); return; }
		for (const [code, dx, dy] of MOVES) if (isKeyDown(code, input)) {
			consumeIdeKey(code, input); projectCartMap(this.input);
			const item = this.input.selected;
			if (item !== undefined && !this.input.workingCopy.readOnly) {
				try { this.applyMove(createCartMapMove(item, item.x + dx, item.y + dy)); }
				catch (error) { showEditorMessage(String(error), COLOR_STATUS_WARNING, 4); }
			} else {
				this.input.grid.horizontal.setScroll(this.input.grid.horizontal.getScroll() + dx * this.input.grid.cellSize);
				this.input.grid.vertical.setScroll(this.input.grid.vertical.getScroll() + dy * this.input.grid.cellSize);
			}
			return;
		}
	}
	protected override handleViewPointer(snapshot: PointerInputSnapshot, justPressed: boolean): boolean {
		if (this.actions.handlePointer(snapshot)) return true;
		for (let axis = 0; axis < this.controls.length; axis++) {
			const control = this.controls[axis], bounds = this.input.fieldBounds[axis];
			if (!control.field.readOnly && ((snapshot.valid && snapshot.insideViewport
				&& point_in_rect(snapshot.viewportX, snapshot.viewportY, bounds)) || control.field.pointerSelecting)) {
				control.handlePointer(bounds.left + 3, snapshot.viewportX, justPressed, (snapshot.pressedButtons & PointerButton.Primary) !== 0); return true;
			}
		}
		const grid = this.input.grid;
		if (this.scrollbar.handlePointer(snapshot, this.input.tree.scrollbar)) return true;
		if (this.scrollbar.handlePointer(snapshot, grid.horizontal) || this.scrollbar.handlePointer(snapshot, grid.vertical)) return true;
		if (!snapshot.valid || !snapshot.insideViewport) return false;
		if (point_in_rect(snapshot.viewportX, snapshot.viewportY, grid.bounds)) {
			if (justPressed) {
				this.gridFocus.focus(); this.update();
				const x = grid.columnAt(snapshot.viewportX), y = grid.rowAt(snapshot.viewportY);
				const tree = this.input.tree;
				const node = tree.roots.find(root => root.element.sheet === grid.content)?.children.find(child => child.element.item?.x === x && child.element.item.y === y);
				if (node !== undefined) setWorkbenchTreeCollapsed(tree, tree.rows.indexOf(node.parent!), false);
				this.select(node === undefined ? -1 : tree.rows.indexOf(node), true);
			}
			return true;
		}
		if (justPressed && workbenchListContainsPosition(this.input.tree, snapshot.viewportX, snapshot.viewportY)) { this.focus(); this.update(); }
		const index = workbenchListRowIndexAtPosition(this.input.tree, snapshot.viewportX, snapshot.viewportY);
		if (justPressed && index >= 0) {
			this.focus(); projectCartMap(this.input);
			if (workbenchTreeTwistieContainsPosition(this.input.tree, index, snapshot.viewportX)) setWorkbenchTreeCollapsed(this.input.tree, index, !this.input.tree.rows[index].collapsed);
			this.select(index);
		}
		return index >= 0;
	}
	public handleWheel(event: WheelInputSnapshot): void {
		if (workbenchListContainsPosition(this.input.tree, event.viewportX, event.viewportY)) scrollWorkbenchList(this.input.tree, event.deltaY * 3);
		else if (point_in_rect(event.viewportX, event.viewportY, this.input.grid.bounds)) {
			const grid = this.input.grid, horizontal = isShiftDown(event) && event.deltaX === 0, step = grid.cellSize * 3;
			grid.horizontal.setScroll(grid.horizontal.getScroll() + (event.deltaX + (horizontal ? event.deltaY : 0)) * step);
			if (!horizontal) grid.vertical.setScroll(grid.vertical.getScroll() + event.deltaY * step);
		}
	}
	public draw(): void { drawCartMap(this.input, this.controls, this.gridFocus.hasFocus); }
	public drawStatusBar(bounds: Readonly<RectBounds>, color: number): void {
		const input = this.input, selected = input.tree.rows[input.tree.selectionIndex]?.element;
		const text = input.diagnostic ?? selected?.diagnostic ?? ASSET_STATUS[getTextFileRuntimeSourceStatus(this.sources, input.workingCopy)];
		api.pushClipRect(bounds.left, bounds.top, bounds.right, bounds.bottom);
		api.blit_text_inline_with_font(text, bounds.left + 4, bounds.top + 2, 0, color, editorViewState.font.renderFont());
		api.popClipRect();
	}
	public override clearInput(): void {
		this.scrollbar.cancelPointer(); this.actions.clearInput();
		for (const control of this.controls) { control.cancel(); control.field.focusTarget.release(); }
		super.clearInput();
	}
	public override dispose(): void {
		this.scrollbar.cancelPointer(); this.actions.dispose(); this.unbindGrid();
		for (const control of this.controls) control.dispose();
		super.dispose();
	}
}
const NAVIGATION = [['ArrowUp', 'up'], ['ArrowDown', 'down'], ['ArrowLeft', 'left'], ['ArrowRight', 'right'], ['PageUp', 'page-up'], ['PageDown', 'page-down'], ['Home', 'home'], ['End', 'end']] as const;
const MOVES = [['ArrowLeft', -1, 0], ['ArrowRight', 1, 0], ['ArrowUp', 0, -1], ['ArrowDown', 0, 1]] as const;
const ASSET_STATUS = {
	applied: 'ASSET SOURCE CURRENT', pending: 'REBUILD NEEDED', failed: 'APPLY FAILED',
	untracked: 'ASSET SOURCE UNKNOWN', source_only: 'SOURCE ONLY',
};
