import type { BFont } from '../../../../machine/ts/render/shared/bitmap_font';
import type { RectBounds } from '../../../../machine/ts/common/rect';
import { create_rect_bounds, point_in_rect, write_rect_bounds } from '../../../../machine/ts/common/rect';
import type { PlayerInput } from '../../../../hosts/common/input/player';
import type { EditorCommandId } from '../../../common/commands';
import type { PointerSnapshot } from '../../../common/models';
import { truncateMeasuredText, type TextRangeMeasure } from '../../../common/text';
import type { InputFocusService, InputFocusTarget } from '../../../input/focus';
import type { PointerCaptureService } from '../../../input/pointer/capture';
import { consumeIdeKey, isKeyJustPressed, shouldRepeatKeyFromPlayer } from '../../../input/keyboard/key_input';
import { createWorkbenchActionBar, layoutWorkbenchActionBar } from '../action_bar';
import { WorkbenchActionBarControl } from '../action_bar_control';
import { scrollWorkbenchList } from '../list_view';
import { createWorkbenchPropertyTree, layoutWorkbenchPropertyTree } from '../property_tree';
import { WorkbenchPropertyTreePointer, WorkbenchPropertyPointerResult } from '../property_tree_pointer';
import { appendWorkbenchTreeNode, navigateWorkbenchTree, rebuildWorkbenchTreeRows, type WorkbenchTreeNavigation } from '../tree_view';
import type { SourceEditReview, SourceEditReviewElement } from './model';

const ACTION_KEYS = ['Enter', 'NumpadEnter', 'Escape'] as const;
const NAVIGATION: readonly [string, WorkbenchTreeNavigation][] = [
	['ArrowUp', 'up'], ['ArrowDown', 'down'], ['ArrowLeft', 'left'], ['ArrowRight', 'right'],
	['PageUp', 'page-up'], ['PageDown', 'page-down'], ['Home', 'home'], ['End', 'end'],
];

/** Editor-local review, not a modal router, working copy or second history. */
export class WorkbenchSourceEditReview {
	public readonly focusTarget: InputFocusTarget;
	public readonly tree = createWorkbenchPropertyTree<SourceEditReviewElement>();
	public readonly actionBar = createWorkbenchActionBar('sourceEditReview.title');
	public readonly bounds = create_rect_bounds();
	public title = '';
	public summary = '';
	public font: BFont | undefined;
	private input: SourceEditReview | undefined;
	private readonly pointer = new WorkbenchPropertyTreePointer();
	private readonly unbindKeyboard: () => void;
	private readonly actionControl: WorkbenchActionBarControl;
	private unbindSource: (() => void) | undefined;
	private layoutDirty = true;

	public constructor(focus: InputFocusService, capture: PointerCaptureService, parent: InputFocusTarget) {
		this.focusTarget = focus.createTarget(parent);
		this.actionControl = new WorkbenchActionBarControl(focus, capture, this, this.focusTarget);
		this.focusTarget.next = this.actionControl.focusTarget;
		this.focusTarget.previous = this.actionControl.focusTarget;
		this.actionControl.focusTarget.next = this.focusTarget;
		this.actionControl.focusTarget.previous = this.focusTarget;
		this.unbindKeyboard = this.focusTarget.bindKeyboard(input => this.handleKeyboard(input));
		this.focusTarget.registerCommand('sourceEditReview.apply', { isEnabled: () => this.isEnabled('sourceEditReview.apply'), run: () => this.apply() });
		this.focusTarget.registerCommand('sourceEditReview.discard', { isEnabled: () => this.visible, run: () => this.clear() });
		this.focusTarget.registerCommand('sourceEditReview.source', { isEnabled: () => this.isEnabled('sourceEditReview.source'), run: () => this.openSource() });
	}

	public get visible(): boolean { return this.input !== undefined; }

	public show(input: SourceEditReview): void {
		this.clear();
		this.input = input;
		this.actionControl.setInput(this.actionBar, this.focusTarget);
		for (let index = 0; index < input.items.length; index += 1) {
			appendWorkbenchTreeNode(this.tree, null, { ...input.items[index], index, kind: 'property', warning: false, displayLabel: '', displayValue: '', displayValueLeft: 0 });
		}
		rebuildWorkbenchTreeRows(this.tree, this.tree.roots.length > 0 ? this.tree.roots[0] : null);
		this.tree.textDirty = true;
		this.layoutDirty = true;
		this.unbindSource = input.model.onDidChangeContent(() => this.clear());
		this.focusTarget.focus();
	}

	/** Detach before source edits/navigation; an unrelated control keeps its focus. */
	public clear(): void {
		this.actionControl.clearInput();
		this.input = undefined;
		this.unbindSource?.();
		this.unbindSource = undefined;
		this.tree.roots.length = 0;
		rebuildWorkbenchTreeRows(this.tree, null);
		this.tree.descriptionLines.length = 0;
		this.tree.descriptionElement = undefined;
		this.pointer.cancel();
		this.focusTarget.release();
	}

	public dispose(): void { this.clear(); this.actionControl.dispose(); this.unbindKeyboard(); }

	public update(): void {
		if (this.input !== undefined && this.input.model.readOnly) this.clear();
		if (this.visible) this.actionControl.update();
	}

	public execute(command: EditorCommandId): void {
		switch (command) {
			case 'sourceEditReview.apply': this.apply(); return;
			case 'sourceEditReview.discard': this.clear(); return;
			case 'sourceEditReview.source': this.openSource(); return;
		}
		throw new Error(`Not a source review action: ${command}`);
	}

	public isEnabled(command: EditorCommandId): boolean {
		if (this.input === undefined) return false;
		switch (command) {
			case 'sourceEditReview.apply': return !this.input.model.readOnly;
			case 'sourceEditReview.discard': return true;
			case 'sourceEditReview.source': return this.tree.selectionIndex >= 0;
			default: return false;
		}
	}

	public apply(): void {
		if (!this.isEnabled('sourceEditReview.apply')) return;
		const input = this.input!;
		this.clear();
		input.apply();
	}

	public openSource(): void {
		if (!this.isEnabled('sourceEditReview.source')) return;
		const input = this.input!;
		const index = this.tree.rows[this.tree.selectionIndex].element.index;
		this.clear();
		input.openSource(index);
	}

	public layout(font: BFont, measure: TextRangeMeasure, measureText: (text: string) => number, bounds: RectBounds): void {
		if (this.layoutDirty || this.font !== font || this.bounds.left !== bounds.left || this.bounds.top !== bounds.top
			|| this.bounds.right !== bounds.right || this.bounds.bottom !== bounds.bottom) {
			this.font = font;
			write_rect_bounds(this.bounds, bounds.left, bounds.top, bounds.right, bounds.bottom);
			layoutWorkbenchActionBar(this.actionBar, bounds.right - 4, bounds.top + 2, bounds.top + font.lineHeight + 4, measureText);
			this.title = truncateMeasuredText(this.input!.title, this.actionBar.items[0].bounds.left - bounds.left - 8, measure);
			this.summary = truncateMeasuredText(this.input!.summary, bounds.right - bounds.left - 8, measure);
			this.layoutDirty = false;
		}
		layoutWorkbenchPropertyTree(this.tree, font, measure, bounds.left, bounds.top + font.lineHeight * 2 + 10, bounds.right, bounds.bottom);
	}

	public handlePointer(snapshot: PointerSnapshot, justPressed: boolean, now: number): boolean {
		if (this.actionControl.handlePointer(snapshot)) return true;
		if (!snapshot.valid || !snapshot.insideViewport || !point_in_rect(snapshot.viewportX, snapshot.viewportY, this.bounds)) return false;
		if (justPressed) this.focusTarget.focus();
		if (this.pointer.handle(this.tree, snapshot, justPressed, now) === WorkbenchPropertyPointerResult.Activate) this.openSource();
		return true;
	}

	public handleWheel(rows: number): void { this.pointer.cancel(); scrollWorkbenchList(this.tree, rows); }

	private handleKeyboard(input: PlayerInput): void {
		for (const [key, command] of NAVIGATION) if (shouldRepeatKeyFromPlayer(key, input)) {
			consumeIdeKey(key, input);
			this.pointer.cancel();
			navigateWorkbenchTree(this.tree, command);
			return;
		}
		for (const key of ACTION_KEYS) if (isKeyJustPressed(key, input)) {
			consumeIdeKey(key, input);
			if (key === 'Escape') this.clear();
			else this.openSource();
			return;
		}
	}
}
