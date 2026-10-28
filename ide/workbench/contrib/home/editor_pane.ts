import type { RectBounds } from '../../../../machine/ts/common/rect';
import { clear_rect_bounds, write_rect_bounds } from '../../../../machine/ts/common/rect';
import type { EditorCommandRunner } from '../../../common/commands';
import * as colors from '../../../common/constants';
import type { PointerInputSnapshot, WheelInputSnapshot } from '../../../common/models';
import { truncateTextToWidth } from '../../../editor/common/text/layout';
import { editorViewState } from '../../../editor/ui/view/state';
import { inputFocus, type InputFocusScope } from '../../../input/focus';
import { pointerCapture } from '../../../input/pointer/capture';
import { pointerHover } from '../../../input/pointer/hover';
import { api } from '../../../runtime/overlay_api';
import { updateFullWidthWorkbenchLayout } from '../../common/layout';
import { drawWorkbenchIcon } from '../../render/icon';
import { WorkbenchActionBarControl } from '../../ui/action_bar_control';
import { WorkbenchViewEditorPane } from '../../ui/editor_pane/workbench_view_pane';
import { WORKBENCH_ICON_SIZE } from '../../ui/icon';
import { WorkbenchScrollControl } from '../../ui/scroll_control';
import { HOME_SECTIONS, type HomeInput, type HomeSection } from './editor_input';

const PADDING = 8;
const CARD_PADDING = 4;
const GAP = 8;
const ICON_GAP = 5;

/** A retained action page: existing controls own command admission, focus and physical gestures. */
export class HomeEditorPane extends WorkbenchViewEditorPane<HomeInput> {
	private readonly scroll = new WorkbenchScrollControl(inputFocus, pointerCapture, this.focusTarget);
	private readonly actions: readonly WorkbenchActionBarControl[];
	private attachedInput: HomeInput | undefined;
	private actionHeight = 0;
	private sectionHeadingHeight = 0;
	private headingHeight = 0;
	private caption = '';
	private projectedScroll: number | undefined;
	private focusedSection = -1;
	private focusedAction = -1;

	public constructor(private readonly commands: EditorCommandRunner, scope: InputFocusScope) {
		super(scope);
		this.focusTarget.canFocus = () => this.hasInput && this.input.viewport.bounds.left < this.input.viewport.bounds.right
			&& this.input.viewport.bounds.top < this.input.viewport.bounds.bottom;
		this.scroll.focusTarget.canFocus = this.focusTarget.canFocus;
		this.actions = HOME_SECTIONS.map(() => new WorkbenchActionBarControl(
			inputFocus, pointerCapture, pointerHover, commands, this.focusTarget, () => this.scroll.focusTarget.focus(), undefined, 'vertical'));
		this.scroll.onWillScroll = () => {
			for (const actions of this.actions) { pointerCapture.cancelTarget(actions); actions.cancelPointer(); }
		};
		this.focusTarget.next = this.scroll.focusTarget;
		this.focusTarget.previous = this.scroll.focusTarget;
		this.scroll.focusTarget.next = () => this.focusSection(-1, 1);
		this.scroll.focusTarget.previous = () => this.focusSection(this.actions.length, -1);
		for (let index = 0; index < this.actions.length; index++) {
			const target = this.actions[index].focusTarget;
			target.canFocus = () => this.focusTarget.canFocus!() && this.input.sections[index].visibleCount > 0;
			target.next = () => this.focusSection(index, 1);
			target.previous = () => this.focusSection(index, -1);
		}
	}

	public override get commandTarget() {
		for (let index = 0; index < this.actions.length; index++)
			if (this.input.sections[index].visibleCount > 0) return this.actions[index].focusTarget;
		return this.scroll.focusTarget;
	}
	private focusSection(from: number, direction: number): void {
		for (let index = from + direction; index >= 0 && index < this.actions.length; index += direction) {
			if (this.input.sections[index].visibleCount === 0) continue;
			this.actions[index].focusTarget.focus();
			return;
		}
		this.scroll.focusTarget.focus();
	}

	protected override activate(): void {
		this.scroll.setInput(this.input.viewport);
		for (let index = 0; index < this.actions.length; index++) this.actions[index].setInput(this.input.sections[index].actions, this.focusTarget);
		this.focusedSection = -1; this.focusedAction = -1;
		this.update();
	}
	public override clearInput(): void {
		for (const actions of this.actions) actions.clearInput();
		this.scroll.clearInput(); this.attachedInput = undefined; this.projectedScroll = undefined;
		super.clearInput();
	}
	public override dispose(): void {
		for (const actions of this.actions) actions.dispose();
		this.scroll.dispose(); super.dispose();
	}
	public override layout(bounds: Readonly<RectBounds>): void {
		super.layout(bounds);
		const layout = this.input.layout;
		if (layout.left !== bounds.left || layout.top !== bounds.top || layout.right !== bounds.right || layout.bottom !== bounds.bottom
			|| layout.font !== editorViewState.font) this.update();
	}

	public override update(): void {
		const input = this.input, font = editorViewState.font;
		const fontChanged = input.layout.font !== font || this.attachedInput !== input;
		let changed = updateFullWidthWorkbenchLayout(input.layout, this.contentBounds) || this.attachedInput !== input;
		this.attachedInput = input;
		for (const section of input.sections) {
			let count = 0;
			for (const item of section.actions.items) {
				const visible = this.commands.isEnabled(item.command, this.focusTarget);
				if (visible && (fontChanged || !item.visible)) item.width = font.measure(item.label);
				changed ||= item.visible !== visible;
				item.visible = visible;
				if (visible) count++;
			}
			section.visibleCount = count;
		}
		if (changed) {
			this.layoutCards();
			this.focusedSection = -1; this.focusedAction = -1;
		}
		for (const actions of this.actions) if (!actions.focusTarget.canFocus!()) {
			pointerCapture.cancelTarget(actions); pointerHover.release(actions);
			actions.cancelPointer(); actions.focusTarget.release();
		}
		if (!this.focusTarget.canFocus!()) {
			this.scroll.cancelPointer(); this.scroll.focusTarget.release(); this.focusTarget.release();
		} else this.revealFocusedAction();
		if (changed || this.projectedScroll !== Math.round(input.viewport.scrollTop)) this.projectActions();
		for (const actions of this.actions) actions.update();
	}

	private layoutCards(): void {
		const { layout, sections, viewport } = this.input, font = layout.font!;
		this.actionHeight = Math.max(font.lineHeight, WORKBENCH_ICON_SIZE) + 6;
		this.sectionHeadingHeight = font.lineHeight + 8;
		this.headingHeight = PADDING + font.lineHeight + (this.input.workspaceContext === null ? 0 : font.lineHeight + 4) + GAP;
		const width = Math.max(0, layout.right - layout.left - colors.SCROLLBAR_WIDTH - PADDING * 2);
		let minimumCardWidth = 0;
		for (const section of sections) for (const item of section.actions.items)
			if (item.visible) minimumCardWidth = Math.max(minimumCardWidth, item.width + CARD_PADDING * 2 + WORKBENCH_ICON_SIZE + ICON_GAP + 4);
		const columns = width >= minimumCardWidth * 2 + GAP ? 2 : 1;
		const cardWidth = Math.trunc((width - (columns - 1) * GAP) / columns);
		this.caption = this.input.workspaceContext === null ? '' : truncateTextToWidth(this.input.workspaceContext.projectRoot, width);
		let column = 0, top = this.headingHeight, rowHeight = 0;
		for (const section of sections) {
			if (section.visibleCount === 0) { clear_rect_bounds(section.bounds); continue; }
			if (column === columns) { top += rowHeight + GAP; column = 0; rowHeight = 0; }
			const left = PADDING + column * (cardWidth + GAP);
			const height = this.sectionHeadingHeight + section.visibleCount * this.actionHeight + CARD_PADDING;
			write_rect_bounds(section.bounds, left, top, left + cardWidth, top + height);
			const textWidth = Math.max(0, cardWidth - CARD_PADDING * 2 - WORKBENCH_ICON_SIZE - ICON_GAP - 4);
			for (let index = 0; index < section.actions.items.length; index++) {
				const item = section.actions.items[index];
				if (item.visible) section.labels[index] = truncateTextToWidth(item.label, textWidth);
			}
			rowHeight = Math.max(rowHeight, height); column++;
		}
		viewport.layout(layout.left, layout.top, layout.right, layout.bottom, top + rowHeight + PADDING);
		this.scroll.lineStep = this.actionHeight;
	}

	private revealFocusedAction(): void {
		const { sections, viewport } = this.input;
		for (let index = 0; index < sections.length; index++) {
			const section = sections[index], state = section.actions;
			if (!state.hasFocus || state.focusedIndex < 0) continue;
			if (this.focusedSection === index && this.focusedAction === state.focusedIndex) return;
			this.focusedSection = index; this.focusedAction = state.focusedIndex;
			let row = 0;
			for (let action = 0; action < state.focusedIndex; action++) if (state.items[action].visible) row++;
			const top = section.bounds.top + this.sectionHeadingHeight + row * this.actionHeight;
			viewport.scrollbar.reveal(top, top + this.actionHeight, CARD_PADDING);
			return;
		}
		this.focusedSection = -1; this.focusedAction = -1;
	}

	private projectActions(): void {
		const { sections, viewport } = this.input, clip = viewport.bounds;
		for (const section of sections) {
			const state = section.actions;
			let top = viewport.offsetTop + section.bounds.top + this.sectionHeadingHeight;
			const left = clip.left + section.bounds.left + CARD_PADDING;
			const right = clip.left + section.bounds.right - CARD_PADDING;
			for (const item of state.items) {
				if (!item.visible) { clear_rect_bounds(item.bounds); continue; }
				const bottom = top + this.actionHeight;
				if (bottom <= clip.top || top >= clip.bottom || right <= left) clear_rect_bounds(item.bounds);
				else write_rect_bounds(item.bounds, Math.max(clip.left, left), Math.max(clip.top, top), Math.min(clip.right, right), Math.min(clip.bottom, bottom));
				top = bottom;
			}
			state.layoutRevision++;
		}
		this.projectedScroll = Math.round(viewport.scrollTop);
	}

	public draw(): void {
		const { layout, viewport, sections } = this.input, font = editorViewState.font.renderFont();
		api.fill_rect(layout.left, layout.top, layout.right, layout.bottom, 0, colors.COLOR_CODE_BACKGROUND);
		api.pushClipRect(viewport.bounds.left, viewport.bounds.top, viewport.bounds.right, viewport.bounds.bottom);
		api.blit_text_inline_with_font('BMSX STUDIO', viewport.bounds.left + PADDING, viewport.offsetTop + PADDING, 0, colors.COLOR_TEXT_STRONG, font);
		if (this.input.workspaceContext !== null) api.blit_text_inline_with_font(this.caption, viewport.bounds.left + PADDING,
			viewport.offsetTop + PADDING + editorViewState.lineHeight + 4, 0, colors.COLOR_DESCRIPTION_TEXT, font);
		for (const section of sections) if (section.visibleCount !== 0) this.drawSection(section);
		api.popClipRect();
		viewport.scrollbar.draw(colors.SCROLLBAR_TRACK_COLOR, colors.SCROLLBAR_THUMB_COLOR);
	}

	private drawSection(section: HomeSection): void {
		const viewport = this.input.viewport, state = section.actions, font = editorViewState.font.renderFont();
		const left = viewport.bounds.left + section.bounds.left, right = viewport.bounds.left + section.bounds.right;
		const top = viewport.offsetTop + section.bounds.top, bottom = viewport.offsetTop + section.bounds.bottom;
		if (bottom <= viewport.bounds.top || top >= viewport.bounds.bottom) return;
		api.fill_rect(left, top, right, bottom, 0, colors.COLOR_RESOURCE_VIEWER_BACKGROUND);
		api.blit_rect(left, top, right, bottom, 0, colors.COLOR_TAB_BORDER);
		api.blit_text_inline_with_font(section.title, left + CARD_PADDING + 2, top + CARD_PADDING, 0, colors.COLOR_TEXT_STRONG, font);
		let rowTop = top + this.sectionHeadingHeight;
		for (let index = 0; index < state.items.length; index++) {
			const item = state.items[index];
			if (!item.visible) continue;
			const rowBottom = rowTop + this.actionHeight;
			if (rowBottom > viewport.bounds.top && rowTop < viewport.bounds.bottom) {
				const focused = state.hasFocus && state.focusedIndex === index;
				const pressed = state.pressedCommand === item.command;
				const highlighted = focused || state.hoveredCommand === item.command;
				const ink = pressed ? colors.COLOR_HEADER_BUTTON_PRESSED_TEXT
					: highlighted ? colors.COLOR_HEADER_BUTTON_ACTIVE_TEXT : colors.COLOR_RESOURCE_VIEWER_TEXT;
				if (pressed || highlighted) api.fill_rect(left + CARD_PADDING, rowTop, right - CARD_PADDING, rowBottom, 0,
					pressed ? colors.COLOR_HEADER_BUTTON_PRESSED_BACKGROUND : colors.COLOR_HEADER_BUTTON_ACTIVE_BACKGROUND);
				if (item.icon !== undefined) drawWorkbenchIcon(item.icon, left + CARD_PADDING + 2,
					rowTop + ((this.actionHeight - WORKBENCH_ICON_SIZE) >> 1), ink);
				api.blit_text_inline_with_font(section.labels[index], left + CARD_PADDING + WORKBENCH_ICON_SIZE + ICON_GAP + 2,
					rowTop + ((this.actionHeight - editorViewState.lineHeight) >> 1), 0, ink, font);
				if (focused) api.blit_rect(left + CARD_PADDING, rowTop, right - CARD_PADDING, rowBottom, 0, colors.COLOR_FOCUS_BORDER);
			}
			rowTop = rowBottom;
		}
	}

	protected override handleViewPointer(snapshot: PointerInputSnapshot): boolean {
		for (const actions of this.actions) if (actions.handlePointer(snapshot)) return true;
		return this.scroll.handlePointer(snapshot);
	}
	public handleKeyboard(): void {}
	public handleWheel(event: WheelInputSnapshot): void {
		this.scroll.handleWheel(event, event.deltaY * this.actionHeight);
	}
	public drawStatusBar(bounds: Readonly<RectBounds>, color: number): void {
		api.pushClipRect(bounds.left, bounds.top, bounds.right, bounds.bottom);
		api.blit_text_inline_with_font('Tab: sections | Enter: open', bounds.left + 4, bounds.top + 2, 0, color, editorViewState.font.renderFont());
		api.popClipRect();
	}
}
