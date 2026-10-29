import { STATUS_PRIORITY_CONTENT, type WorkbenchStatusItem } from '../../common/status_bar';
import { create_rect_bounds, write_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import type { KeyInputEvent } from '../../../../hosts/common/input/text';
import type { EditorCommandRunner } from '../../../common/commands';
import type { PointerInputSnapshot, WheelInputSnapshot } from '../../../common/models';
import { showEditorMessage } from '../../../common/feedback_state';
import { CallHierarchyDirection } from '../../../editor/contrib/call_hierarchy/model';
import { measureText, measureTextRange, truncateTextToWidth } from '../../../editor/common/text/layout';
import { editorTextModelService } from '../../../editor/model/model_service';
import type { EditorSourceLocation } from '../../../editor/navigation/source_location';
import type { EditorTextSelection } from '../../../editor/navigation/text_selection';
import { editorViewState } from '../../../editor/ui/view/state';
import { inputFocus } from '../../../input/focus';
import { consumeIdeKey, isKeyJustPressed } from '../../../input/keyboard/key_input';
import { pointerCapture } from '../../../input/pointer/capture';
import { pointerHover } from '../../../input/pointer/hover';
import type { WorkspaceSourceCatalog } from '../../../workspace/source_catalog';
import type { ContextMenuController } from '../../services/context_menu/controller';
import type { EditorGroupView } from '../../services/editor/editor_group';
import type { WorkbenchSurfaceService } from '../../services/windows/service';
import { resolveLuaTextFileModel } from '../../services/working_copy/text_file_model';
import { layoutWorkbenchActionBar } from '../../ui/action_bar';
import { WorkbenchActionBarControl } from '../../ui/action_bar_control';
import { WorkbenchViewEditorPane } from '../../ui/editor_pane/workbench_view_pane';
import { WORKBENCH_ICON_SIZE } from '../../ui/icon';
import { revealWorkbenchListSelection, scrollWorkbenchList, workbenchListContainsPosition, workbenchListRowIndexAtPosition } from '../../ui/list_view';
import { ScrollbarPointerControl } from '../../ui/scrollbar_pointer';
import { workbenchTreeTwistieContainsPosition } from '../../ui/tree_view';
import { WorkbenchTooltip } from '../../ui/tooltip';
import type { CallHierarchyInput } from './editor_input';
import { drawCallHierarchy } from './render';
import { CallHierarchyNavigationSelection } from './view_snapshot';

const TREE_KEYS = [['ArrowUp', 'up'], ['ArrowDown', 'down'], ['ArrowLeft', 'left'], ['ArrowRight', 'right'],
	['PageUp', 'page-up'], ['PageDown', 'page-down'], ['Home', 'home'], ['End', 'end']] as const;

/** A concrete result attachment; source admission remains with the shared editor navigation owner. */
export class CallHierarchyPane extends WorkbenchViewEditorPane<CallHierarchyInput> {
	public readonly statusItems: readonly WorkbenchStatusItem[] = [
		{ text: '', alignment: 'left', priority: STATUS_PRIORITY_CONTENT, overflow: 'ellipsis', tone: 'normal' },
	];
	private readonly actions: WorkbenchActionBarControl;
	private readonly scrollbar = new ScrollbarPointerControl(pointerCapture);
	private readonly tooltip = new WorkbenchTooltip();
	private readonly hoverBounds = create_rect_bounds();
	private renderedTree: CallHierarchyInput['tree'] | undefined;
	private renderedRevision = -1;
	private renderedWidth = -1;
	private renderedFont: object | undefined;
	private unbindInput: (() => void) | undefined;
	public onPointerLeave(): void { if (this.hasInput) this.input.tree.hoverIndex = -1; this.tooltip.hide(); }

	public constructor(group: EditorGroupView, private readonly commands: EditorCommandRunner,
		private readonly catalog: WorkspaceSourceCatalog, private readonly contextMenu: ContextMenuController,
		surfaces: WorkbenchSurfaceService, private readonly workArea: Readonly<RectBounds>) {
		super(group.focusScope);
		this.tooltip.attach(surfaces, group.paneSurface, workArea);
		this.actions = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, commands, this.focusTarget, () => this.focus(), contextMenu);
		this.actions.onDidOpenOverflow = lifetime => {
			this.tooltip.hide();
			lifetime.add({ dispose: this.input.onDidChange(() => this.contextMenu.hide()) });
		};
		for (const [command, direction] of [['callHierarchy.incoming', CallHierarchyDirection.CallsTo], ['callHierarchy.outgoing', CallHierarchyDirection.CallsFrom]] as const) {
			this.focusTarget.registerCommand(command, { isEnabled: () => this.hasInput, isChecked: () => this.hasInput && this.input.direction === direction,
				run: () => { this.scrollbar.cancelPointer(); this.input.setDirection(direction); this.update(); this.focus(); } });
		}
		this.focusTarget.registerCommand('contextMenu', { isEnabled: () => this.hasInput,
			run: () => this.openContextMenu(this.input.tree.layout.contentLeft, this.input.tree.layout.contentTop, true) });
		this.focusTarget.next = this.actions.focusTarget; this.focusTarget.previous = this.actions.focusTarget;
		this.actions.focusTarget.next = this.focusTarget; this.actions.focusTarget.previous = this.focusTarget;
	}

	public override get canOpenSource(): boolean {
		return this.hasInput && this.input.tree.rows[this.input.tree.selectionIndex] !== undefined;
	}
	public override getSourceLocation(): EditorSourceLocation | undefined {
		const input = this.input, revision = input.revision, selected = input.tree.rows[input.tree.selectionIndex]?.element;
		if (selected === undefined) return undefined;
		const resource = this.catalog.resolveResource(selected.resource);
		if (resource === undefined) { showEditorMessage('This query source is no longer available.', 'warning', 2); return undefined; }
		const model = resolveLuaTextFileModel(editorTextModelService, this.catalog, resource);
		if (!this.hasInput || this.input !== input || input.revision !== revision) return undefined;
		const location = input.model.getSourceLocation(model, selected.range);
		if (!this.hasInput || this.input !== input || input.revision !== revision) return undefined;
		if (location === undefined) showEditorMessage('Source changed since this query. Run Call Hierarchy again.', 'warning', 2);
		return location;
	}
	public override getSelection(): CallHierarchyNavigationSelection { return new CallHierarchyNavigationSelection(this.input); }
	public override setOptions(_selection?: EditorTextSelection, navigation?: CallHierarchyNavigationSelection): void {
		navigation?.restore(this.input); this.update();
	}
	protected override activate(): void {
		this.renderedTree = undefined; this.actions.setInput(this.input.actions, this.focusTarget);
		this.unbindInput = this.input.onDidChange(() => { this.actions.cancelPointer(); this.tooltip.hide(); });
		this.update();
	}
	public override clearInput(): void {
		this.unbindInput?.(); this.unbindInput = undefined;
		this.input.tree.hoverIndex = -1;
		pointerHover.release(this); this.tooltip.hide(); this.actions.clearInput(); this.scrollbar.cancelPointer(); this.renderedTree = undefined;
		super.clearInput();
	}
	public override dispose(): void { this.tooltip.detach(); this.actions.dispose(); this.scrollbar.cancelPointer(); super.dispose(); }

	public override update(): void {
		const input = this.input, tree = input.tree, bounds = this.contentBounds, font = editorViewState.font;
		const rowHeight = Math.max(font.lineHeight, WORKBENCH_ICON_SIZE) + 4;
		for (const item of input.actions.items) item.checked = item.command === 'callHierarchy.incoming' ? input.direction === CallHierarchyDirection.CallsTo
			: item.command === 'callHierarchy.outgoing' && input.direction === CallHierarchyDirection.CallsFrom;
		layoutWorkbenchActionBar(input.actions, bounds.right - 4, bounds.top + 2, bounds.top + rowHeight + 2, measureText, font.renderFont(), bounds.left + 4);
		tree.updateLayout(bounds.left + 4, Math.min(bounds.bottom, bounds.top + rowHeight + 6), bounds.right, bounds.bottom,
			rowHeight, Math.max(font.advance(' ') * 2, WORKBENCH_ICON_SIZE + 4));
		const width = tree.layout.contentRight - tree.layout.contentLeft;
		if (this.renderedTree !== tree || this.renderedRevision !== tree.revision || this.renderedWidth !== width || this.renderedFont !== font) {
			this.renderedTree = tree; this.renderedRevision = tree.revision; this.renderedWidth = width; this.renderedFont = font;
			for (const node of tree.rows) {
				const available = width - (node.depth + 1) * tree.layout.indentWidth, element = node.element;
				element.displayText = measureText(element.text) <= available ? element.text : truncateTextToWidth(element.label, available);
			}
		}
		this.actions.update();
		const hint = this.actions.tooltipItem, hovered = tree.rows[tree.hoverIndex];
		if (hint !== undefined) this.tooltip.show(hint.tooltip, hint.bounds, font.renderFont(), measureTextRange, measureText, this.workArea);
		else if (hovered !== undefined) {
			const top = tree.layout.contentTop + (tree.hoverIndex - (tree.scroll | 0)) * rowHeight;
			write_rect_bounds(this.hoverBounds, tree.layout.contentLeft, top, tree.layout.contentRight, top + rowHeight);
			this.tooltip.show(hovered.element.tooltip, this.hoverBounds, font.renderFont(), measureTextRange, measureText, this.workArea);
		} else this.tooltip.hide();
	}
	public handleKeyboard(event: KeyInputEvent): void {
		for (const [key, command] of TREE_KEYS) if (isKeyJustPressed(key, event)) {
			consumeIdeKey(key, event); this.input.tree.navigate(command); this.update(); return;
		}
		if (isKeyJustPressed('Enter', event)) { consumeIdeKey('Enter', event); this.commands.execute('editor.source', this.focusTarget); }
	}
	protected override handleViewPointer(snapshot: PointerInputSnapshot, justPressed: boolean): boolean {
		if (this.actions.handlePointer(snapshot) || this.scrollbar.handlePointer(snapshot, this.input.tree.scrollbar)) { this.input.tree.hoverIndex = -1; return true; }
		const input = this.input, tree = input.tree, index = snapshot.valid && snapshot.insideViewport
			? workbenchListRowIndexAtPosition(tree, snapshot.viewportX, snapshot.viewportY) : -1;
		tree.hoverIndex = index;
		if (index >= 0) pointerHover.visit(this);
		if (index < 0 || !justPressed) return index >= 0;
		if (!this.focusInput(input)) return true;
		tree.select(index);
		if (workbenchTreeTwistieContainsPosition(tree, index, snapshot.viewportX)) tree.setCollapsed(index, !tree.rows[index].collapsed);
		revealWorkbenchListSelection(tree); this.update(); return true;
	}
	public override handlePointer(snapshot: PointerInputSnapshot, justPressed: boolean, secondary: boolean, now: number, goto: boolean): void {
		const input = this.input;
		super.handlePointer(snapshot, justPressed, secondary, now, goto);
		if (!secondary || !this.hasInput || this.input !== input) return;
		const index = workbenchListRowIndexAtPosition(this.input.tree, snapshot.viewportX, snapshot.viewportY);
		if (index >= 0) { this.input.tree.select(index); this.openContextMenu(snapshot.viewportX, snapshot.viewportY, false); }
	}
	private openContextMenu(x: number, y: number, keyboard: boolean): void {
		this.tooltip.hide();
		this.contextMenu.show(x, y, this.input.contextActions, this.commands, {
			invocationOrigin: this.focusTarget, returnFocus: this.focusTarget, commandTarget: this.focusTarget, selectFirst: keyboard,
			onWillShow: lifetime => lifetime.add({ dispose: this.input.onDidChange(() => this.contextMenu.hide()) }),
		});
	}
	public handleWheel(event: WheelInputSnapshot): void {
		const tree = this.input.tree;
		if (workbenchListContainsPosition(tree, event.viewportX, event.viewportY)) { scrollWorkbenchList(tree, event.deltaY * 3); this.tooltip.hide(); }
	}
	public draw(): void { drawCallHierarchy(this.input, this.contentBounds, this.focusTarget.hasFocus); }
	public updateStatus(): void {
		this.statusItems[0].text = this.input.tree.rows[this.input.tree.selectionIndex]?.element.status ?? '';
	}
}
