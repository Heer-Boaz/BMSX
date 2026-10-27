import type { KeyInputEvent } from '../../../../hosts/common/input/text';
import { create_rect_bounds, point_in_rect, write_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import type { PointerInputSnapshot, WheelInputSnapshot } from '../../../common/models';
import type { EditorCommandRunner } from '../../../common/commands';
import { showEditorMessage } from '../../../common/feedback_state';
import { executeTextHistoryCommand } from '../../../editor/editing/history_commands';
import type { EditorModelEdit } from '../../../editor/model/text_model';
import type { EditorTextSelection } from '../../../editor/navigation/text_selection';
import { INTEGER_INPUT_FORMAT, parseIntegerInput } from '../../../editor/ui/inline/integer_input';
import { ValueInput } from '../../../editor/ui/inline/value_input';
import { editorViewState } from '../../../editor/ui/view/state';
import { inputFocus, type InputFocusScope, type InputFocusTarget } from '../../../input/focus';
import { consumeIdeKey, isKeyJustPressed, isShiftDown, isKeyDown } from '../../../input/keyboard/key_input';
import { PointerButton } from '../../../../hosts/common/input/pointer_event';
import { pointerCapture } from '../../../input/pointer/capture';
import { pointerHover } from '../../../input/pointer/hover';
import { api } from '../../../runtime/overlay_api';
import type { RuntimeSourceState } from '../../../runtime/sources';
import { getTextFileRuntimeSourceStatus } from '../../services/working_copy/runtime_source_status';
import { WorkbenchActionBarControl } from '../../ui/action_bar_control';
import { WorkbenchViewEditorPane } from '../../ui/editor_pane/workbench_view_pane';
import { revealWorkbenchListSelection, scrollWorkbenchList, workbenchListContainsPosition, workbenchListRowIndexAtPosition } from '../../ui/list_view';
import { ScrollbarPointerControl } from '../../ui/scrollbar_pointer';
import { navigateWorkbenchTree, setWorkbenchTreeCollapsed, workbenchTreeTwistieContainsPosition, WorkbenchTreeNavigationResult } from '../../ui/tree_view';
import type { CartMapController } from './controller';
import type { CartMapInput, CartMapLayoutMode, CartMapSection } from './editor_input';
import { projectCartMap, selectCartMapRow, createCartMapMove } from './source_projection';
import { layoutCartMap, measureCartMapMinimumWidth } from './layout';
import { drawCartMap } from './render';
import { CartMapNavigationSelection, restoreCartMapView } from './view_snapshot';
import type { WorkbenchSurfaceService } from '../../services/windows/service';
import type { WorkbenchSurface } from '../../services/windows/model';
import { WorkbenchTooltip } from '../../ui/tooltip';
import { measureText, measureTextRange, truncateTextToWidth } from '../../../editor/common/text/layout';
import type { EditorFont } from '../../../editor/ui/view/font';
import type { EditorGroupView } from '../../services/editor/editor_group';

/** Display seeds carry coordinates; an accepted draft carries a versioned source proposal. */
export type CartMapCoordinateEdit = { readonly coordinate: number; readonly edit?: EditorModelEdit };

export class CartMapPane extends WorkbenchViewEditorPane<CartMapInput> {
	public override get companionGameMinimumWidth(): number { return measureCartMapMinimumWidth(this.input); }
	public readonly controls: readonly ValueInput<CartMapCoordinateEdit>[];
	private readonly actions: WorkbenchActionBarControl;
	private readonly scrollbar = new ScrollbarPointerControl(pointerCapture);
	private readonly gridFocus = inputFocus.createTarget(this.focusTarget);
	private readonly unbindGrid = this.gridFocus.bindKeyboard(input => this.handleGridKeyboard(input));
	private readonly unbindClientFocus: readonly (() => void)[];
	private boundRevision = -1;
	private readonly tooltip = new WorkbenchTooltip();
	private headerHovered: 'source' | 'selection' | undefined;
	private gridHovered = false;
	private gridPointerX = 0;
	private gridPointerY = 0;
	private statusText = '';
	private statusMapWidth: number | undefined;
	private statusMapHeight: number | undefined;
	private statusDiagnostic: string | null | undefined;
	private statusSource = '';
	private statusFont: EditorFont | undefined;
	private statusWidth = -1;
	private readonly statusRange = create_rect_bounds();
	private statusRangeVisible = false;
	private statusColumn: number | undefined;
	private statusRow: number | undefined;
	private readonly beforeModeChange = (mode: CartMapLayoutMode): void => {
		this.scrollbar.cancelPointer();
		if (mode === 'map') this.focusTarget.cancelInput();
		else if (mode === 'outline') this.gridFocus.cancelInput();
	};
	private readonly beforeFieldHide = (axis: number): void => { this.controls[axis].field.focusTarget.cancelInput(); };
	public constructor(controller: CartMapController, commands: EditorCommandRunner, private readonly sources: RuntimeSourceState,
		surfaces: WorkbenchSurfaceService, paneSurface: WorkbenchSurface, private readonly workArea: Readonly<RectBounds>,
		group: EditorGroupView, scope: InputFocusScope) {
		super(scope);
		this.tooltip.attach(surfaces, paneSurface, workArea);
		this.focusTarget.canFocus = () => this.hasInput && this.input.layout.mode !== 'map';
		this.gridFocus.canFocus = () => this.hasInput && this.input.layout.mode !== 'outline';
		this.gridFocus.commandContext = this.focusTarget;
		this.actions = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, commands, this.focusTarget, () => this.focus());
		const source = { isEnabled: () => this.hasInput, run: () => controller.openSource(group, this.input) };
		const map = { isEnabled: () => this.hasInput && this.input.grid.content !== undefined, run: () => this.showSection('map') };
		const outline = { isEnabled: () => this.hasInput, run: () => this.showSection('outline') };
		for (const target of [this.focusTarget, this.gridFocus]) {
			target.registerCommand('cartMap.source', source);
			target.registerCommand('cartMap.map', map);
			target.registerCommand('cartMap.outline', outline);
		}
		for (const direction of ['undo', 'redo'] as const) {
			const historyCommand = {
				isEnabled: () => !this.input.workingCopy.readOnly && (direction === 'undo' ? this.input.workingCopy.canUndo : this.input.workingCopy.canRedo),
				run: () => {
					if (!executeTextHistoryCommand(this.input.workingCopy, direction, this.input.editSource)) return;
					this.update();
					if (this.input.layout.mode !== 'map' && this.input.tree.selectionIndex >= 0) revealWorkbenchListSelection(this.input.tree);
					if (this.input.selected !== undefined) this.input.grid.reveal(this.input.selected);
				},
			};
			this.focusTarget.registerCommand(direction, historyCommand);
			this.gridFocus.registerCommand(direction, historyCommand);
		}
		this.controls = [0, 1].map(axis => new ValueInput<CartMapCoordinateEdit>(this.gridFocus, {
			options: INTEGER_INPUT_FORMAT.options, invalidBlurMessage: 'Map edit cancelled; source unchanged.',
			format: value => String(value.coordinate),
			parse: text => {
				const result = parseIntegerInput(text);
				if ('error' in result) return result;
				const item = this.input.selected!;
				const x = axis === 0 ? result.value : item.x, y = axis === 1 ? result.value : item.y;
				try { return { value: { coordinate: result.value, edit: createCartMapMove(item, x, y, this.input.editSource) } }; }
				catch (error) { return { error: String(error) }; }
			},
		}, value => this.applyMove(value.edit!), () => this.update()));
		for (let axis = 0; axis < this.controls.length; axis++) {
			const target = this.controls[axis].field.focusTarget;
			target.canFocus = () => this.hasInput && this.input.layout.mode !== 'outline' && !this.controls[axis].field.readOnly
				&& this.input.fieldBounds[axis].bottom > this.input.fieldBounds[axis].top && this.input.fieldBounds[axis].right > this.input.fieldBounds[axis].left;
			target.registerCommand('cartMap.source', source);
			target.registerCommand('cartMap.map', map);
			target.registerCommand('cartMap.outline', outline);
		}
		const focusMap = () => { this.input.section = 'map'; };
		this.unbindClientFocus = [this.focusTarget.onDidFocus(() => { this.input.section = 'outline'; }), this.gridFocus.onDidFocus(focusMap),
			...this.controls.map(control => control.field.focusTarget.onDidFocus(focusMap))];
	}
	public override getSelection(): CartMapNavigationSelection { return new CartMapNavigationSelection(this.input); }
	protected override activate(): void {
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
			for (let axis = 0; axis < this.controls.length; axis++) {
				const control = this.controls[axis];
				control.cancel();
				control.field.readOnly = item === undefined || this.input.workingCopy.readOnly;
				if (control.field.readOnly) {
					control.field.focusTarget.release();
				} else {
					control.setValue({ coordinate: axis === 0 ? item.x : item.y });
				}
			}
			this.boundRevision = this.input.viewRevision;
		}
		const measured = layoutCartMap(this.input, this.contentBounds, changed, this.beforeModeChange, this.beforeFieldHide);
		if (changed || measured) this.bindFocusOrder();
		if (this.input.layout.mode === 'map' && this.focusTarget.hasFocus) this.gridFocus.focus();
		else if (this.input.layout.mode === 'outline' && this.gridFocus.hasFocus) this.focusTarget.focus();
		this.actions.update();
		const hint = this.actions.tooltipItem, layout = this.input.layout;
		if (hint !== undefined) this.tooltip.show(hint.tooltip, hint.bounds, editorViewState.font.renderFont(), measureTextRange, measureText, this.workArea);
		else if (this.headerHovered !== undefined) this.tooltip.show(this.headerHovered === 'source' ? this.input.workingCopy.resource.path : layout.selectionLabel,
			this.headerHovered === 'source' ? layout.sourceBounds : layout.selectionBounds, editorViewState.font.renderFont(), measureTextRange, measureText, this.workArea);
		else this.tooltip.hide();
		if (this.input.layout.mode !== 'outline' && this.input.selected !== undefined) for (let axis = 0; axis < this.controls.length; axis++) {
			const bounds = this.input.fieldBounds[axis];
				this.controls[axis].layout(bounds, this.contentBounds);
		}
	}
	public override get commandTarget(): InputFocusTarget { return this.input.layout.mode === 'map' ? this.gridFocus : this.focusTarget; }
	public override focus(): void { this.update(); super.focus(); }
	private showSection(section: CartMapSection): void {
		if (inputFocus.target?.edit?.commit() === false) return;
		this.input.section = section;
		this.tooltip.hide(); this.headerHovered = undefined;
		this.update();
		if (section === 'map') {
			if (this.input.selected !== undefined) this.input.grid.reveal(this.input.selected);
			this.gridFocus.focus();
		}
		else {
			revealWorkbenchListSelection(this.input.tree);
			this.focusTarget.focus();
		}
	}
	/** Reflow changes navigation membership, never the source value or local draft history. */
	private bindFocusOrder(): void {
		let previous = this.actions.focusTarget;
		this.focusTarget.next = this.focusTarget.previous = null;
		this.gridFocus.next = this.gridFocus.previous = null;
		if (this.input.layout.mode !== 'map') {
			previous.next = this.focusTarget; this.focusTarget.previous = previous; previous = this.focusTarget;
		}
		if (this.input.layout.mode !== 'outline') {
			previous.next = this.gridFocus; this.gridFocus.previous = previous; previous = this.gridFocus;
		}
		for (const control of this.controls) {
			const target = control.field.focusTarget;
			target.next = target.previous = null;
			if (this.input.layout.mode === 'outline' || control.field.readOnly) continue;
			previous.next = target; target.previous = previous; previous = target;
		}
		previous.next = this.actions.focusTarget; this.actions.focusTarget.previous = previous;
	}
	private applyMove(edit: EditorModelEdit): void {
		const input = this.input;
		input.workingCopy.history.applyEdits(new Map([[input.workingCopy, edit]]));
		this.update();
		if (input.layout.mode !== 'map') revealWorkbenchListSelection(input.tree);
		if (input.selected !== undefined) input.grid.reveal(input.selected);
	}
	private select(index: number, grid = false): void {
		(grid ? this.gridFocus : this.focusTarget).focus();
		projectCartMap(this.input);
		selectCartMapRow(this.input, index);
		this.update();
		if (index >= 0 && this.input.layout.mode !== 'map') revealWorkbenchListSelection(this.input.tree);
		if (this.input.selected !== undefined) this.input.grid.reveal(this.input.selected);
	}
	public handleKeyboard(input: KeyInputEvent): void {
		for (const [code, command] of NAVIGATION) if (isKeyDown(code, input)) {
			consumeIdeKey(code, input);
			if (navigateWorkbenchTree(this.input.tree, command) !== WorkbenchTreeNavigationResult.None) this.select(this.input.tree.selectionIndex);
			return;
		}
		if (isKeyJustPressed('Enter', input)) {
			consumeIdeKey('Enter', input);
			if (this.input.grid.content !== undefined) this.showSection('map');
		}
	}
	private handleGridKeyboard(input: KeyInputEvent): void {
		if (isKeyJustPressed('Escape', input)) { consumeIdeKey('Escape', input); this.showSection('outline'); return; }
		for (const [code, dx, dy] of MOVES) if (isKeyDown(code, input)) {
			consumeIdeKey(code, input); projectCartMap(this.input);
			const item = this.input.selected;
			if (item !== undefined && !this.input.workingCopy.readOnly) {
				try { this.applyMove(createCartMapMove(item, item.x + dx, item.y + dy, this.input.editSource)); }
				catch (error) { showEditorMessage(String(error), 'warning', 4); }
			} else {
				this.input.grid.scrollBy(dx, dy);
			}
			return;
		}
	}
	protected override handleViewPointer(snapshot: PointerInputSnapshot, justPressed: boolean): boolean {
		const layout = this.input.layout;
		this.gridHovered = false;
		this.headerHovered = !snapshot.valid || !snapshot.insideViewport ? undefined
			: point_in_rect(snapshot.viewportX, snapshot.viewportY, layout.sourceBounds) ? 'source'
			: layout.selectionLabel !== '' && point_in_rect(snapshot.viewportX, snapshot.viewportY, layout.selectionBounds) ? 'selection' : undefined;
		if (this.headerHovered !== undefined) { pointerHover.visit(this); if (justPressed) this.focus(); return true; }
		if (this.actions.handlePointer(snapshot)) return true;
		if (layout.mode !== 'outline') for (let axis = 0; axis < this.controls.length; axis++) {
			const control = this.controls[axis], bounds = this.input.fieldBounds[axis];
			if (!control.field.readOnly && ((snapshot.valid && snapshot.insideViewport
				&& point_in_rect(snapshot.viewportX, snapshot.viewportY, bounds)) || control.field.pointerSelecting)) {
				control.handlePointer(bounds.left + 3, snapshot.viewportX, justPressed, (snapshot.pressedButtons & PointerButton.Primary) !== 0); return true;
			}
		}
		const grid = this.input.grid;
		if (layout.mode !== 'map' && this.scrollbar.handlePointer(snapshot, this.input.tree.scrollbar)) return true;
		if (layout.mode !== 'outline' && (this.scrollbar.handlePointer(snapshot, grid.horizontal) || this.scrollbar.handlePointer(snapshot, grid.vertical))) return true;
		if (!snapshot.valid || !snapshot.insideViewport) return false;
		if (layout.mode !== 'outline' && point_in_rect(snapshot.viewportX, snapshot.viewportY, grid.bounds)) {
			this.gridHovered = true; this.gridPointerX = snapshot.viewportX; this.gridPointerY = snapshot.viewportY;
			pointerHover.visit(this);
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
		if (layout.mode === 'map') return false;
		if (justPressed && workbenchListContainsPosition(this.input.tree, snapshot.viewportX, snapshot.viewportY)) { this.focusTarget.focus(); this.update(); }
		const index = workbenchListRowIndexAtPosition(this.input.tree, snapshot.viewportX, snapshot.viewportY);
		if (justPressed && index >= 0) {
			this.focusTarget.focus(); projectCartMap(this.input);
			if (workbenchTreeTwistieContainsPosition(this.input.tree, index, snapshot.viewportX)) setWorkbenchTreeCollapsed(this.input.tree, index, !this.input.tree.rows[index].collapsed);
			this.select(index);
		}
		return index >= 0;
	}
	public handleWheel(event: WheelInputSnapshot): void {
		if (this.input.layout.mode !== 'map' && workbenchListContainsPosition(this.input.tree, event.viewportX, event.viewportY)) scrollWorkbenchList(this.input.tree, event.deltaY * 3);
		else if (this.input.layout.mode !== 'outline' && point_in_rect(event.viewportX, event.viewportY, this.input.grid.bounds)) {
			const horizontal = isShiftDown(event) && event.deltaX === 0;
			this.input.grid.scrollBy((event.deltaX + (horizontal ? event.deltaY : 0)) * 3, horizontal ? 0 : event.deltaY * 3);
		}
	}
	public draw(): void { drawCartMap(this.input, this.controls, this.gridFocus.hasFocus, this.focusTarget.hasFocus); }
	public drawStatusBar(bounds: Readonly<RectBounds>, color: number): void {
		const input = this.input, grid = input.grid, selected = input.tree.rows[input.tree.selectionIndex]?.element;
		const diagnostic = input.diagnostic ?? selected?.diagnostic;
		const source = ASSET_STATUS[getTextFileRuntimeSourceStatus(this.sources, input.workingCopy)];
		const content = grid.content, font = editorViewState.font, width = bounds.right - bounds.left - 8;
		const mapWidth = content?.width, mapHeight = content?.rows.length;
		const visible = input.layout.mode !== 'outline' && grid.bounds.right > grid.bounds.left && grid.bounds.bottom > grid.bounds.top;
		const range = grid.visibleRange;
		const hover = visible && this.gridHovered && pointerHover.has(this) && point_in_rect(this.gridPointerX, this.gridPointerY, grid.bounds);
		const column = hover ? grid.columnAt(this.gridPointerX) : undefined, row = hover ? grid.rowAt(this.gridPointerY) : undefined;
		if (mapWidth !== this.statusMapWidth || mapHeight !== this.statusMapHeight || diagnostic !== this.statusDiagnostic || source !== this.statusSource
			|| font !== this.statusFont || width !== this.statusWidth || visible !== this.statusRangeVisible
			|| range.left !== this.statusRange.left || range.top !== this.statusRange.top || range.right !== this.statusRange.right || range.bottom !== this.statusRange.bottom
			|| column !== this.statusColumn || row !== this.statusRow) {
			this.statusMapWidth = mapWidth; this.statusMapHeight = mapHeight; this.statusDiagnostic = diagnostic; this.statusSource = source;
			this.statusFont = font; this.statusWidth = width; this.statusRangeVisible = visible;
			write_rect_bounds(this.statusRange, range.left, range.top, range.right, range.bottom);
			this.statusColumn = column; this.statusRow = row;
			let text = source;
			if (content !== undefined) {
				text = `MAP ${content.width}x${content.rows.length}`;
				if (visible) text = `X${range.left}-${range.right - 1} Y${range.top}-${range.bottom - 1} | ${text}`;
				if (column !== undefined) text += ` @${column},${row}`;
				text += ` | ${source}`;
			}
			this.statusText = truncateTextToWidth(diagnostic ?? text, width);
		}
		api.pushClipRect(bounds.left, bounds.top, bounds.right, bounds.bottom);
		api.blit_text_inline_with_font(this.statusText, bounds.left + 4, bounds.top + 2, 0, color, font.renderFont());
		api.popClipRect();
	}
	public override clearInput(): void {
		pointerHover.release(this);
		this.tooltip.hide(); this.headerHovered = undefined;
		this.scrollbar.cancelPointer(); this.actions.clearInput();
		for (const control of this.controls) { control.cancel(); control.field.focusTarget.release(); }
		super.clearInput();
	}
	public onPointerLeave(): void { this.headerHovered = undefined; this.gridHovered = false; }
	public override dispose(): void {
		pointerHover.release(this);
		this.tooltip.detach();
		this.scrollbar.cancelPointer(); this.actions.dispose(); this.unbindGrid();
		for (const unbind of this.unbindClientFocus) unbind();
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
