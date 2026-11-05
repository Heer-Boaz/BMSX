import { PointerClickSequence } from '../../../input/pointer/click_sequence';
import { PointerButton } from '../../../../hosts/common/input/pointer_event';
import { KeyModifier, type KeyInputEvent } from '../../../../hosts/common/input/text';
import * as colors from '../../../common/constants';
import type { EditorCommandRunner } from '../../../common/commands';
import type { PointerInputSnapshot, WheelInputSnapshot } from '../../../common/models';
import { editorViewState } from '../../../editor/ui/view/state';
import { inputFocus, type InputFocusTarget } from '../../../input/focus';
import { consumeIdeKey, isKeyDown, isKeyJustPressed } from '../../../input/keyboard/key_input';
import { pointerCapture } from '../../../input/pointer/capture';
import { api } from '../../../runtime/overlay_api';
import { drawWorkbenchIcon } from '../../render/icon';
import { WORKBENCH_ICON_SIZE } from '../../ui/icon';
import { scrollWorkbenchList, workbenchListContainsPosition, workbenchListRowIndexAtPosition } from '../../ui/list_view';
import { ScrollbarPointerControl } from '../../ui/scrollbar_pointer';
import { navigateWorkbenchTree, setWorkbenchTreeCollapsed, workbenchTreeTwistieContainsPosition } from '../../ui/tree_view';
import type { ActorLabInput } from './editor_input';

/** World selection is passive; actor experiments and source edits retain their own execution owners. */
export class ActorOutlinerControl {
	public readonly focusTarget: InputFocusTarget;
	private input: ActorLabInput | undefined;
	private readonly scrollbar = new ScrollbarPointerControl(pointerCapture);
	private readonly unbindKeyboard: () => void;
	private readonly clicks = new PointerClickSequence<object>();
	public constructor(private readonly parent: InputFocusTarget, private readonly commands: EditorCommandRunner,
		private readonly changed: () => void, private readonly contextMenu: (x: number, y: number, keyboard: boolean) => void) {
		this.focusTarget = inputFocus.createTarget(parent);
		this.focusTarget.commandContext = parent;
		this.focusTarget.canFocus = () => this.input?.presentation === 'world';
		this.unbindKeyboard = this.focusTarget.bindKeyboard(event => this.handleKeyboard(event));
		this.focusTarget.registerCommand('contextMenu', { isEnabled: () => this.input !== undefined && this.input.worldOutliner.tree.selectionIndex !== -1,
			run: () => this.openContextMenu() });
	}
	public setInput(input: ActorLabInput): void { if (this.input !== input) this.clearInput(); this.input = input; }
	public clearInput(): void { this.scrollbar.cancelPointer(); this.input = undefined; this.clicks.clear(); }
	public dispose(): void { this.clearInput(); this.unbindKeyboard(); }
	public openContextMenu(): void {
		this.select();
		const tree = this.input!.worldOutliner.tree;
		this.contextMenu(tree.layout.contentLeft, tree.layout.contentTop + (tree.selectionIndex - (tree.scroll | 0) + 1) * tree.layout.rowHeight, true);
	}
	private select(): void {
		const input = this.input!, row = input.worldOutliner.tree.rows[input.worldOutliner.tree.selectionIndex];
		if (row === undefined) return;
		input.controller.inspectActor(input, input.domain, row.element.hashId); this.changed();
	}
	public handlePointer(snapshot: PointerInputSnapshot, now: number): boolean {
		const input = this.input!;
		if (input.presentation !== 'world') return false;
		const tree = input.worldOutliner.tree;
		if (this.scrollbar.handlePointer(snapshot, tree.scrollbar)) return true;
		if (!snapshot.valid || !snapshot.insideViewport) return false;
		const index = workbenchListRowIndexAtPosition(tree, snapshot.viewportX, snapshot.viewportY);
		if (!workbenchListContainsPosition(tree, snapshot.viewportX, snapshot.viewportY)) return false;
		const primary = (snapshot.justPressedButtons & PointerButton.Primary) !== 0;
		const secondary = (snapshot.justPressedButtons & PointerButton.Secondary) !== 0;
		if (!primary && !secondary) return true;
		if (index < 0) {
			this.clicks.clear();
			if (primary) {
				this.focusTarget.focus();
				if (this.input === input && this.focusTarget.hasFocus) {
					input.controller.inspectActor(input, input.domain, 0); this.changed();
				}
			}
			return true;
		}
		const row = tree.rows[index];
		this.focusTarget.focus();
		if (this.input !== input || !this.focusTarget.hasFocus || tree.rows[index] !== row) return true;
		if (primary && workbenchTreeTwistieContainsPosition(tree, index, snapshot.viewportX)) {
			setWorkbenchTreeCollapsed(tree, index, !row.collapsed);
			// Disclosure changes row focus, not the selected live actor. Its Details
			// and viewport highlight survive a collapsed ancestor, as in UE's Outliner.
			this.clicks.clear(); this.changed(); return true;
		}
		tree.selectionIndex = index; this.select();
		if (secondary) { this.clicks.clear(); this.contextMenu(snapshot.viewportX, snapshot.viewportY, false); }
		else {
			const twice = this.clicks.click(row, snapshot.viewportX, snapshot.viewportY, now);
			if (twice) this.commands.execute('sceneViewport.frameSelection', this.parent);
		}
		return true;
	}
	public handleWheel(event: WheelInputSnapshot): boolean {
		const tree = this.input!.worldOutliner.tree;
		if (!workbenchListContainsPosition(tree, event.viewportX, event.viewportY)) return false;
		scrollWorkbenchList(tree, event.deltaY * 3); return true;
	}
	public handleKeyboard(event: KeyInputEvent): void {
		if (event.consumed) return;
		if ((event.modifiers & (KeyModifier.ctrl | KeyModifier.meta | KeyModifier.alt)) !== 0) return;
		for (const [key, command] of NAVIGATION) if (isKeyDown(key, event)) {
			consumeIdeKey(key, event);
			const tree = this.input!.worldOutliner.tree, selected = tree.rows[tree.selectionIndex];
			navigateWorkbenchTree(tree, command);
			if (tree.rows[tree.selectionIndex] !== selected) this.select();
			this.changed(); return;
		}
		if (isKeyJustPressed('KeyF', event)) { consumeIdeKey('KeyF', event); this.commands.execute('sceneViewport.frameSelection', this.parent); }
		if (isKeyJustPressed('Enter', event)) { consumeIdeKey('Enter', event); this.commands.execute('actorLab.details', this.parent); }
	}
	public draw(): void {
		const input = this.input!, tree = input.worldOutliner.tree, layout = tree.layout;
		const font = editorViewState.font.renderFont(), color = colors.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_TEXT;
		api.pushClipRect(layout.contentLeft, layout.contentTop, layout.contentRight, layout.contentBottom);
		const first = tree.scroll | 0;
		for (let i = first; i < tree.rows.length && i < first + layout.visibleRowCount; i++) {
			const row = tree.rows[i], top = layout.contentTop + (i - first) * layout.rowHeight;
			const selected = row.element.hashId === input.actorHashId;
			if (selected) api.fill_rect(layout.contentLeft, top, layout.contentRight, top + layout.rowHeight, 0, colors.COLOR_RESOURCE_PANEL_HIGHLIGHT);
			const textColor = selected ? colors.COLOR_RESOURCE_PANEL_HIGHLIGHT_TEXT : row.element.containsSelection ? colors.COLOR_BODY_ACCENT : color;
			const left = layout.contentLeft + row.depth * layout.indentWidth;
			if (row.expandable) drawWorkbenchIcon(row.collapsed ? 'chevronRight' : 'chevronDown',
				left + ((layout.indentWidth - WORKBENCH_ICON_SIZE) >> 1), top + ((layout.rowHeight - WORKBENCH_ICON_SIZE) >> 1), textColor);
			api.blit_text_inline_with_font(row.element.label, left + layout.indentWidth, top + 2, 0, textColor, font);
		}
		if (tree.rows.length === 0) api.blit_text_inline_with_font('NO LIVE ACTORS', layout.contentLeft, layout.contentTop + 3, 0, color, font);
		api.popClipRect(); tree.scrollbar.draw(colors.SCROLLBAR_TRACK_COLOR, colors.SCROLLBAR_THUMB_COLOR);
	}
}

const NAVIGATION = [['ArrowUp', 'up'], ['ArrowDown', 'down'], ['ArrowLeft', 'left'], ['ArrowRight', 'right'],
	['PageUp', 'page-up'], ['PageDown', 'page-down'], ['Home', 'home'], ['End', 'end']] as const;
