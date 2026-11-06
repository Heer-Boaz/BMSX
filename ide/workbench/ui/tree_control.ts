import { KeyModifier, type KeyInputEvent } from '../../../hosts/common/input/text';
import { PointerButton } from '../../../hosts/common/input/pointer_event';
import type { PointerInputSnapshot, WheelInputSnapshot } from '../../common/models';
import type { EditorFont } from '../../editor/ui/view/font';
import type { InputFocusService, InputFocusTarget } from '../../input/focus';
import { consumeIdeKey } from '../../input/keyboard/key_input';
import type { PointerCaptureService } from '../../input/pointer/capture';
import type { PointerHoverService } from '../../input/pointer/hover';
import { workbenchListRowIndexAtPosition } from './list_view';
import { ScrollbarPointerControl } from './scrollbar_pointer';
import type { ScrollableWorkbenchTree } from './scrollable_tree';
import { navigateWorkbenchTree, setWorkbenchTreeCollapsed, workbenchTreeTwistieContainsPosition, WorkbenchTreeNavigationResult, type WorkbenchTreeNavigation, type WorkbenchTreeNode } from './tree_view';
import type { RectBounds } from '../../../machine/ts/common/rect';
import { drawWorkbenchTree } from '../render/tree';
import { WORKBENCH_ICON_SIZE } from './icon';

const NAVIGATION: Readonly<Record<string, WorkbenchTreeNavigation>> = {
	ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
	PageUp: 'page-up', PageDown: 'page-down', Home: 'home', End: 'end',
};

/** A labelled navigation tree shares retained row, focus, hit-test and scroll owners. */
export class WorkbenchTreeControl<Element extends { readonly label: string }> {
	public readonly focusTarget: InputFocusTarget;
	private input: ScrollableWorkbenchTree<Element> | undefined;
	private font!: EditorFont;
	private indent = 0;
	private readonly scrollbar: ScrollbarPointerControl;
	private readonly unbindKeyboard: () => void;
	private readonly measureRow = (row: WorkbenchTreeNode<Element>) => this.font.measureTextRange(row.element.label, 0, row.element.label.length)
		+ row.depth * this.indent + (row.expandable ? this.indent : 0) + 8;

	public constructor(focus: InputFocusService, private readonly capture: PointerCaptureService, private readonly hover: PointerHoverService,
		parent: InputFocusTarget, private readonly select: (element: Element) => void) {
		this.scrollbar = new ScrollbarPointerControl(capture, parent.scope.surfaceScope, hover);
		this.focusTarget = focus.createTarget(parent);
		this.focusTarget.canFocus = () => this.input !== undefined && this.input.layout.visibleRowCount > 0;
		this.unbindKeyboard = this.focusTarget.bindKeyboard(event => this.handleKeyboard(event));
	}
	public setInput(input: ScrollableWorkbenchTree<Element>): void { this.clearInput(); this.input = input; }
	public clearInput(): void {
		if (this.input !== undefined) this.input.hoverIndex = -1;
		this.input = undefined; this.focusTarget.release();
		this.capture.cancelTarget(this.scrollbar); this.hover.release(this); this.hover.release(this.scrollbar);
	}
	public dispose(): void { this.clearInput(); this.unbindKeyboard(); }
	public layout(bounds: Readonly<RectBounds>, font: EditorFont): void {
		this.font = font;
		this.indent = Math.max(font.lineHeight, WORKBENCH_ICON_SIZE);
		const tree = this.input!;
		tree.measureContentWidth(this.measureRow, font);
		tree.updateLayout(bounds.left, bounds.top, bounds.right, bounds.bottom, Math.max(font.lineHeight, WORKBENCH_ICON_SIZE) + 6, this.indent);
	}
	private handleKeyboard(event: KeyInputEvent): void {
		if (event.modifiers !== KeyModifier.none) return;
		const command = NAVIGATION[event.code];
		if (command === undefined) return;
		consumeIdeKey(event.code, event);
		if (!event.down) return;
		const tree = this.input!;
		if (navigateWorkbenchTree(tree, command) === WorkbenchTreeNavigationResult.Selection) this.select(tree.rows[tree.selectionIndex].element);
	}
	public onPointerLeave(): void { if (this.input !== undefined) this.input.hoverIndex = -1; }
	public handlePointer(snapshot: PointerInputSnapshot): boolean {
		const tree = this.input!;
		if (!snapshot.valid || !snapshot.insideViewport) return false;
		if (this.scrollbar.handlePointer(snapshot, tree.scrollbar) || this.scrollbar.handlePointer(snapshot, tree.horizontalScrollbar)) return true;
		const index = workbenchListRowIndexAtPosition(tree, snapshot.viewportX, snapshot.viewportY);
		if (index < 0) return false;
		tree.hoverIndex = index; this.hover.visit(this);
		if ((snapshot.justPressedButtons & PointerButton.Primary) !== 0) {
			if (!this.focusTarget.focus() || this.input !== tree) return true;
			if (workbenchTreeTwistieContainsPosition(tree, index, snapshot.viewportX)) setWorkbenchTreeCollapsed(tree, index, !tree.rows[index].collapsed);
			else { tree.selectionIndex = index; this.select(tree.rows[index].element); }
		}
		return true;
	}
	// disable-next-line single_line_method_pattern -- Native input dispatch uses the currently attached tree's scroll owner.
	public handleWheel(event: WheelInputSnapshot): boolean { return this.input!.handleWheel(event); }
	// disable-next-line single_line_method_pattern -- The control supplies its attached tree, measured font and actual focus to the separate renderer.
	public draw(): void { drawWorkbenchTree(this.input!, this.font, this.focusTarget.hasFocus); }
}
