import { create_rect_bounds, point_in_rect, write_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import type { KeyInputEvent } from '../../../../hosts/common/input/text';
import { PointerButton } from '../../../../hosts/common/input/pointer_event';
import type { EditorCommandRunner } from '../../../common/commands';
import { DOUBLE_CLICK_MAX_INTERVAL_MS } from '../../../common/constants';
import { showEditorMessage } from '../../../common/feedback_state';
import type { PointerInputSnapshot, WheelInputSnapshot } from '../../../common/models';
import { measureText, measureTextRange } from '../../../editor/common/text/layout';
import { editorTextModelService } from '../../../editor/model/model_service';
import type { EditorSourceLocation } from '../../../editor/navigation/source_location';
import type { EditorTextSelection } from '../../../editor/navigation/text_selection';
import { resetInlineBlink } from '../../../editor/render/caret';
import { getTextSnapshot } from '../../../editor/text/source_text';
import { applyInlineFieldEditing, applyInlineFieldPointer, selectAll, setFieldText } from '../../../editor/ui/inline/text_field';
import { TextField } from '../../../editor/ui/inline/text_field_model';
import { SingleLineFieldViewport } from '../../../editor/ui/inline/single_line_viewport';
import { editorViewState } from '../../../editor/ui/view/state';
import { inputFocus } from '../../../input/focus';
import { consumeIdeKey, isKeyJustPressed } from '../../../input/keyboard/key_input';
import { pointerCapture } from '../../../input/pointer/capture';
import { pointerHover } from '../../../input/pointer/hover';
import type { WorkspaceSourceCatalog } from '../../../workspace/source_catalog';
import type { ContextMenuController } from '../../services/context_menu/controller';
import type { EditorGroupView } from '../../services/editor/editor_group';
import type { EditorPaneConstraints } from '../../services/editor/editor_pane';
import type { EditorFont } from '../../../editor/ui/view/font';
import type { WorkbenchSurfaceService } from '../../services/windows/service';
import { resolveTextFileModel } from '../../services/working_copy/text_file_model';
import { layoutWorkbenchActionBar } from '../../ui/action_bar';
import { WorkbenchActionBarControl } from '../../ui/action_bar_control';
import { WorkbenchViewEditorPane } from '../../ui/editor_pane/workbench_view_pane';
import { WORKBENCH_ICON_SIZE } from '../../ui/icon';
import { revealWorkbenchListSelection, scrollWorkbenchList, workbenchListContainsPosition, workbenchListRowIndexAtPosition } from '../../ui/list_view';
import { ScrollbarPointerControl } from '../../ui/scrollbar_pointer';
import { workbenchTreeTwistieContainsPosition } from '../../ui/tree_view';
import { WorkbenchTooltip } from '../../ui/tooltip';
import type { WorkspaceSearchInput } from './editor_input';
import { WorkspaceSearchPresentation, drawWorkspaceSearch } from './render';
import { WorkspaceSearchNavigationSelection } from './view_snapshot';

const TREE_KEYS = [['ArrowUp', 'up'], ['ArrowDown', 'down'], ['ArrowLeft', 'left'], ['ArrowRight', 'right'],
	['PageUp', 'page-up'], ['PageDown', 'page-down'], ['Home', 'home'], ['End', 'end']] as const;

export function measureWorkspaceSearchInput(_input: WorkspaceSearchInput, font: EditorFont, _companion: boolean, target: EditorPaneConstraints): void {
	target.minimumWidth = font.advance('M') * 14 + 16;
	target.minimumHeight = (Math.max(font.lineHeight, WORKBENCH_ICON_SIZE) + 4) * 4 + 12;
	target.companionWidth = undefined;
}

/** Query editing and result gestures are attached controls, not the lifetime of the search. */
export class WorkspaceSearchPane extends WorkbenchViewEditorPane<WorkspaceSearchInput> {
	private readonly actions: WorkbenchActionBarControl;
	private readonly scrollbar = new ScrollbarPointerControl(pointerCapture);
	private readonly tooltip = new WorkbenchTooltip();
	private readonly presentation = new WorkspaceSearchPresentation();
	private readonly field = new TextField(this.focusTarget, { allowSpace: true, singleLine: true });
	private readonly fieldViewport = new SingleLineFieldViewport();
	private readonly fieldBounds = create_rect_bounds();
	private readonly hoverBounds = create_rect_bounds();
	private readonly fieldPointer = { metrics: editorViewState.inlineFieldMetricsRef, textLeft: 0, pointerX: 0,
		justPressed: false, pointerPressed: false, doubleClickInterval: DOUBLE_CLICK_MAX_INTERVAL_MS };
	private readonly unbindFieldKeyboard: () => void;
	private readonly unbindFieldCancel: () => void;
	private unbindQuery: (() => void) | undefined;
	private unbindInput: (() => void) | undefined;
	private lastClick: object | undefined;
	private lastClickTime = 0;
	public onPointerLeave(): void { if (this.hasInput) this.input.tree.hoverIndex = -1; this.tooltip.hide(); }

	public constructor(group: EditorGroupView, private readonly commands: EditorCommandRunner,
		private readonly catalog: WorkspaceSourceCatalog,
		private readonly contextMenu: ContextMenuController, surfaces: WorkbenchSurfaceService,
		private readonly workArea: Readonly<RectBounds>) {
		super(group.focusScope);
		this.field.focusTarget.canFocus = () => this.hasInput && this.fieldBounds.right > this.fieldBounds.left && this.fieldBounds.bottom > this.fieldBounds.top;
		this.field.focusTarget.commandContext = this.focusTarget;
		this.unbindFieldKeyboard = this.field.focusTarget.bindKeyboard(event => this.handleQueryKeyboard(event));
		this.unbindFieldCancel = this.field.focusTarget.onDidCancelInput(() => this.cancelPointer());
		this.tooltip.attach(surfaces, group.paneSurface, workArea);
		this.actions = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, commands, this.focusTarget, () => this.focus(), contextMenu);
		this.actions.onDidOpenOverflow = lifetime => {
			this.tooltip.hide(); lifetime.add({ dispose: this.input.onDidChangeIntent(() => this.contextMenu.hide()) });
		};
		this.focusTarget.registerCommand('findGlobal', { isEnabled: () => this.hasInput, run: () => this.focusQuery() });
		this.focusTarget.registerCommand('workspaceSearch.run', { isEnabled: () => this.hasInput && this.input.query !== '', run: () => this.input.run() });
		this.focusTarget.registerCommand('workspaceSearch.cancel', { isEnabled: () => this.hasInput && this.input.running, run: () => this.input.cancel() });
		this.focusTarget.registerCommand('workspaceSearch.matchCase', { isEnabled: () => this.hasInput,
			isChecked: () => this.hasInput && this.input.matchCase, run: () => this.input.toggleMatchCase() });
		this.focusTarget.registerCommand('workspaceSearch.includeShared', { isEnabled: () => this.hasInput,
			isChecked: () => this.hasInput && this.input.includeShared, run: () => this.input.toggleIncludeShared() });
		this.focusTarget.registerCommand('contextMenu', { isEnabled: () => this.hasInput,
			run: () => this.openContextMenu(this.input.tree.layout.contentLeft, this.input.tree.layout.contentTop, true) });
		this.field.focusTarget.next = this.focusTarget; this.field.focusTarget.previous = this.actions.focusTarget;
		this.focusTarget.next = this.actions.focusTarget; this.focusTarget.previous = this.field.focusTarget;
		this.actions.focusTarget.next = this.field.focusTarget; this.actions.focusTarget.previous = this.focusTarget;
	}
	public focusQuery(): void {
		const input = this.input, scope = this.field.focusTarget.scope, generation = scope.contextGeneration;
		if (this.field.focusTarget.focus() && this.hasInput && this.input === input && scope.contextGeneration === generation
			&& inputFocus.admittedTarget === this.field.focusTarget) selectAll(this.field);
	}
	private selectedMatch() {
		const input = this.input, selected = input.tree.rows[input.tree.selectionIndex]?.element;
		return !input.pending && input.search.query === input.query && selected?.match !== undefined ? selected : undefined;
	}
	public override get canOpenSource(): boolean { return this.hasInput && this.selectedMatch() !== undefined; }
	public override async getSourceLocation(): Promise<EditorSourceLocation | undefined> {
		const input = this.input, selected = this.selectedMatch(), revision = input.intentRevision;
		if (selected === undefined) return undefined;
		const resource = this.catalog.resolveResource(selected.file.resource);
		if (resource === undefined) { showEditorMessage('This search source is no longer available.', 'warning', 2); return undefined; }
		const current = () => this.hasInput && this.input === input && input.intentRevision === revision;
		try {
			const model = await resolveTextFileModel(editorTextModelService, this.catalog, resource);
			if (!current()) return undefined;
			if (getTextSnapshot(model.buffer) !== selected.file.snapshot.source) {
				showEditorMessage('Source changed since this search. Search again to refresh the results.', 'warning', 2); return undefined;
			}
			const match = selected.match!;
			return { model, modelVersion: model.version, selection: { row: match.row, startColumn: match.start, endColumn: match.end } };
		} catch (error) {
			if (current()) showEditorMessage(`Cannot open search source: ${error instanceof Error ? error.message : String(error)}`, 'error', 3);
			return undefined;
		}
	}
	public override getSelection(): WorkspaceSearchNavigationSelection { return new WorkspaceSearchNavigationSelection(this.input); }
	public override setOptions(_selection?: EditorTextSelection, selection?: WorkspaceSearchNavigationSelection): void { selection?.restore(this.input); this.update(); }
	protected override activate(): void {
		const input = this.input;
		setFieldText(this.field, input.query, true); this.field.cursorColumn = input.queryCursor;
		this.field.selectionAnchor = input.queryAnchor === undefined ? null : { row: 0, column: input.queryAnchor };
		this.unbindQuery = this.field.onDidChangeText(() => input.setQuery(this.field.text));
		this.unbindInput = input.onDidChangeIntent(() => {
			if (this.field.text !== input.query) setFieldText(this.field, input.query, true);
			this.lastClick = undefined; this.actions.cancelPointer(); this.tooltip.hide();
		});
		this.actions.setInput(input.actions, this.focusTarget); this.presentation.reset(); this.update();
	}
	public override clearInput(): void {
		this.input.queryCursor = this.field.cursorColumn; this.input.queryAnchor = this.field.selectionAnchor?.column;
		this.unbindQuery?.(); this.unbindQuery = undefined; this.unbindInput?.(); this.unbindInput = undefined;
		this.field.focusTarget.cancelInput(); this.field.focusTarget.release(); this.cancelPointer();
		this.input.tree.hoverIndex = -1; this.lastClick = undefined;
		pointerHover.release(this); this.tooltip.hide(); this.actions.clearInput(); this.scrollbar.cancelPointer();
		super.clearInput();
	}
	public override dispose(): void {
		this.unbindFieldKeyboard(); this.unbindFieldCancel(); this.tooltip.detach(); this.actions.dispose();
		this.cancelPointer(); this.scrollbar.cancelPointer(); super.dispose();
	}
	public override update(): void {
		const input = this.input, bounds = this.contentBounds, font = editorViewState.font;
		const rowHeight = Math.max(font.lineHeight, WORKBENCH_ICON_SIZE) + 4;
		layoutWorkbenchActionBar(input.actions, bounds.right - 4, bounds.top + 2, bounds.top + rowHeight + 2, measureText, font.renderFont(), bounds.left + font.advance('M') * 10 + 12);
		const top = Math.min(bounds.bottom, bounds.top + 2);
		write_rect_bounds(this.fieldBounds, bounds.left + 4, top, Math.max(bounds.left + 4, input.actions.bounds.left - 4), Math.min(bounds.bottom, top + rowHeight));
		this.fieldViewport.layout(this.field, this.fieldBounds, editorViewState.inlineFieldMetricsRef, font);
		input.tree.updateLayout(bounds.left + 4, Math.min(bounds.bottom, this.fieldBounds.bottom + rowHeight + 6), bounds.right, bounds.bottom,
			rowHeight, Math.max(font.advance(' ') * 2, WORKBENCH_ICON_SIZE + 4));
		this.presentation.update(input, font); this.actions.update();
		const hint = this.actions.tooltipItem;
		const hovered = input.tree.rows[input.tree.hoverIndex];
		if (hint !== undefined) this.tooltip.show(hint.tooltip, hint.bounds, font.renderFont(), measureTextRange, measureText, this.workArea);
		else if (hovered !== undefined) {
			const element = hovered.element, match = element.match, tree = input.tree;
			const y = tree.layout.contentTop + (tree.hoverIndex - (tree.scroll | 0)) * rowHeight;
			write_rect_bounds(this.hoverBounds, tree.layout.contentLeft, y, tree.layout.contentRight, y + rowHeight);
			this.tooltip.show(match === undefined ? element.file.label : `${element.file.label}:${match.row + 1}:${match.start + 1}`,
				this.hoverBounds, font.renderFont(), measureTextRange, measureText, this.workArea);
		} else this.tooltip.hide();
	}
	private handleQueryKeyboard(event: KeyInputEvent): void {
		if (isKeyJustPressed('Enter', event) || isKeyJustPressed('NumpadEnter', event)) {
			consumeIdeKey('Enter', event); consumeIdeKey('NumpadEnter', event); this.input.run(); return;
		}
		if (isKeyJustPressed('Escape', event)) {
			consumeIdeKey('Escape', event); this.input.cancel(); this.focus(); return;
		}
		if (isKeyJustPressed('ArrowDown', event)) {
			consumeIdeKey('ArrowDown', event); if (this.focusInput(this.input)) this.input.tree.navigate('down'); return;
		}
		applyInlineFieldEditing(event, this.field);
	}
	public handleKeyboard(event: KeyInputEvent): void {
		for (const [key, command] of TREE_KEYS) if (isKeyJustPressed(key, event)) {
			consumeIdeKey(key, event); this.input.tree.navigate(command); this.update(); return;
		}
		if (isKeyJustPressed('Enter', event)) {
			consumeIdeKey('Enter', event);
			const tree = this.input.tree, selected = tree.rows[tree.selectionIndex];
			if (selected?.expandable) tree.setCollapsed(tree.selectionIndex, !selected.collapsed);
			else this.commands.execute('editor.source', this.focusTarget);
		}
		if (isKeyJustPressed('Escape', event)) { consumeIdeKey('Escape', event); this.focusQuery(); }
	}
	protected override handleViewPointer(snapshot: PointerInputSnapshot, justPressed: boolean, now: number): boolean {
		if (this.actions.handlePointer(snapshot) || this.scrollbar.handlePointer(snapshot, this.input.tree.scrollbar)) return true;
		if (snapshot.valid && snapshot.insideViewport && point_in_rect(snapshot.viewportX, snapshot.viewportY, this.fieldBounds)) {
			const input = this.input, scope = this.field.focusTarget.scope, generation = scope.contextGeneration;
			if (justPressed && (!this.field.focusTarget.focus() || !this.hasInput || this.input !== input
				|| scope.contextGeneration !== generation || inputFocus.admittedTarget !== this.field.focusTarget)) return true;
			this.moveField(snapshot, justPressed);
			if (justPressed && this.field.pointerSelecting) pointerCapture.capture(this, PointerButton.Primary, this.focusTarget.scope.surfaceScope);
			return true;
		}
		const input = this.input, tree = input.tree, index = snapshot.valid && snapshot.insideViewport
			? workbenchListRowIndexAtPosition(tree, snapshot.viewportX, snapshot.viewportY) : -1;
		tree.hoverIndex = index; if (index >= 0) pointerHover.visit(this);
		if (index < 0 || !justPressed || !this.focusInput(input)) return index >= 0;
		const row = tree.rows[index], doubleClick = this.lastClick === row && now - this.lastClickTime <= DOUBLE_CLICK_MAX_INTERVAL_MS;
		tree.select(index); this.lastClick = doubleClick ? undefined : row; this.lastClickTime = now;
		if (workbenchTreeTwistieContainsPosition(tree, index, snapshot.viewportX) || doubleClick && row.expandable) tree.setCollapsed(index, !row.collapsed);
		else if (doubleClick) this.commands.execute('editor.source', this.focusTarget);
		revealWorkbenchListSelection(tree); this.update(); return true;
	}
	private moveField(snapshot: PointerInputSnapshot, pressed: boolean): void {
		this.fieldPointer.textLeft = this.fieldBounds.left + 3 - this.fieldViewport.offset;
		this.fieldPointer.metrics = editorViewState.inlineFieldMetricsRef;
		this.fieldPointer.pointerX = snapshot.viewportX; this.fieldPointer.justPressed = pressed;
		this.fieldPointer.pointerPressed = (snapshot.pressedButtons & PointerButton.Primary) !== 0;
		if (applyInlineFieldPointer(this.field, this.fieldPointer).requestBlinkReset) resetInlineBlink();
	}
	public handleCapturedPointer(snapshot: PointerInputSnapshot): void { this.moveField(snapshot, false); }
	public releaseCapturedPointer(snapshot: PointerInputSnapshot): void { this.moveField(snapshot, false); this.cancelPointer(); }
	public cancelPointer(): void { pointerCapture.cancelTarget(this); this.field.pointerSelecting = false; }
	public override handlePointer(snapshot: PointerInputSnapshot, justPressed: boolean, secondary: boolean, now: number, goto: boolean): void {
		const input = this.input; super.handlePointer(snapshot, justPressed, secondary, now, goto);
		if (!secondary || !this.hasInput || this.input !== input) return;
		const index = workbenchListRowIndexAtPosition(input.tree, snapshot.viewportX, snapshot.viewportY);
		if (index >= 0) { input.tree.select(index); this.openContextMenu(snapshot.viewportX, snapshot.viewportY, false); }
	}
	private openContextMenu(x: number, y: number, keyboard: boolean): void {
		this.tooltip.hide();
		this.contextMenu.show(x, y, this.input.contextMenu, this.commands, {
			invocationOrigin: this.focusTarget, returnFocus: this.focusTarget, commandTarget: this.focusTarget, selectFirst: keyboard,
			onWillShow: lifetime => lifetime.add({ dispose: this.input.onDidChangeIntent(() => this.contextMenu.hide()) }),
		});
	}
	public handleWheel(event: WheelInputSnapshot): void {
		const tree = this.input.tree;
		if (workbenchListContainsPosition(tree, event.viewportX, event.viewportY)) { scrollWorkbenchList(tree, event.deltaY * 3); this.tooltip.hide(); }
	}
	public draw(): void { drawWorkspaceSearch(this.input, this.presentation, this.contentBounds, this.field, this.fieldViewport, this.fieldBounds, this.focusTarget.hasFocus); }
	public drawStatusBar(): void {}
}
