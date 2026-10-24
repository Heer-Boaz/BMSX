import { KeyModifier, type KeyInputEvent } from '../../../../hosts/common/input/text';
import { PointerButton } from '../../../../hosts/common/input/pointer_event';
import { create_rect_bounds, point_in_rect, write_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import * as colors from '../../../common/constants';
import type { PointerInputSnapshot, PointerSnapshot, WheelInputSnapshot } from '../../../common/models';
import { drawSingleLineField } from '../../../editor/ui/inline/single_line_render';
import { SingleLineFieldViewport } from '../../../editor/ui/inline/single_line_viewport';
import { applyInlineFieldEditing, applyInlineFieldPointer, getCursorOffset, selectAll, setFieldText } from '../../../editor/ui/inline/text_field';
import { TextField } from '../../../editor/ui/inline/text_field_model';
import type { EditorFont } from '../../../editor/ui/view/font';
import { editorViewState } from '../../../editor/ui/view/state';
import { resetBlink } from '../../../editor/render/caret';
import { inputFocus, InputFocusTarget } from '../../../input/focus';
import { consumeIdeKey, isKeyDown, isKeyJustPressed } from '../../../input/keyboard/key_input';
import { pointerCapture, type PointerCaptureTarget } from '../../../input/pointer/capture';
import { pointerHover, type PointerHoverTarget } from '../../../input/pointer/hover';
import { api } from '../../../runtime/overlay_api';
import { drawWorkbenchTextView } from '../../render/text_view';
import { drawWorkbenchIcon } from '../../render/icon';
import { WORKBENCH_ICON_SIZE } from '../icon';
import { WorkbenchScrollControl } from '../scroll_control';
import type { WorkbenchTextViewModel, WorkbenchTextViewMove } from './model';

// Read build diagnostics as short source lines, not a stack of wrapped word fragments.
const DOCUMENT_READING_COLUMNS = 48;

/** Focus, selection gestures and a local query for a resource-independent read-only document. */
export class WorkbenchTextViewControl implements PointerCaptureTarget, PointerHoverTarget {
	public get minimumWidth(): number { return editorViewState.charAdvance * DOCUMENT_READING_COLUMNS + colors.SCROLLBAR_WIDTH + 8; }
	public readonly focusTarget: InputFocusTarget;
	public readonly findField: TextField;
	public readonly findBounds = create_rect_bounds();
	public readonly findCloseBounds = create_rect_bounds();
	public findVisible = false;
	private readonly bounds = create_rect_bounds();
	private readonly bodyBounds = create_rect_bounds();
	private readonly findBar = create_rect_bounds();
	private readonly findViewport = new SingleLineFieldViewport();
	private readonly scroll: WorkbenchScrollControl;
	private model: WorkbenchTextViewModel | undefined;
	private unbindBuffer: (() => void) | undefined;
	private font!: EditorFont;
	private lineHeight = 0;
	private findArranged = false;
	private gesture: 'document' | 'find' | 'close' | undefined;
	private anchor = 0;
	private pointerX = 0;
	private pointerY = 0;
	private closeHovered = false;
	private count = '';
	private countWidth = 0;
	private countMatches = -1;
	private countIndex = -2;
	private countFont: EditorFont | undefined;
	private readonly unbindFind: () => void;
	private readonly unbindChange: () => void;
	private readonly unbindDocumentCancel: () => void;
	private readonly unbindFieldCancel: () => void;
	private readonly fieldPointer = { metrics: editorViewState.inlineFieldMetricsRef, textLeft: 0, pointerX: 0,
		justPressed: false, pointerPressed: false, doubleClickInterval: colors.DOUBLE_CLICK_MAX_INTERVAL_MS };

	public constructor(parent: InputFocusTarget) {
		this.scroll = new WorkbenchScrollControl(inputFocus, pointerCapture, parent, event => this.handleDocumentKey(event));
		this.focusTarget = this.scroll.focusTarget;
		this.findField = new TextField(this.focusTarget, { allowSpace: true, singleLine: true });
		this.findField.focusTarget.canFocus = () => this.model !== undefined && this.findVisible && this.findArranged;
		this.focusTarget.clipboard = { readOnly: true, copy: () => this.model!.copy() };
		this.scroll.onWillScroll = edge => this.model!.noteUserScroll(edge);
		this.unbindDocumentCancel = this.focusTarget.onDidCancelInput(() => { if (this.gesture === 'document') this.cancelPointer(); });
		this.unbindFieldCancel = this.findField.focusTarget.onDidCancelInput(() => { if (this.gesture === 'find') this.cancelPointer(); });
		this.unbindFind = this.findField.focusTarget.bindKeyboard(event => {
			if (isKeyJustPressed('Escape', event)) { consumeIdeKey('Escape', event); this.closeFind(); }
			else if (isKeyJustPressed('Enter', event) || isKeyJustPressed('NumpadEnter', event)) {
				consumeIdeKey(event.code, event); this.model!.nextMatch((event.modifiers & KeyModifier.shift) !== 0 ? -1 : 1);
			} else if (applyInlineFieldEditing(event, this.findField)) resetBlink();
		});
		this.unbindChange = this.findField.onDidChangeText(() => { if (this.model !== undefined) this.model.setQuery(this.findField.text); });
		const find = { isEnabled: () => this.model !== undefined, run: () => this.openFind() };
		const next = { isEnabled: () => this.model !== undefined && this.model.matchCount !== 0, run: () => { this.model!.nextMatch(1); } };
		const previous = { isEnabled: () => this.model !== undefined && this.model.matchCount !== 0, run: () => { this.model!.nextMatch(-1); } };
		for (const target of [this.focusTarget, this.findField.focusTarget]) {
			target.registerCommand('text.find', find); target.registerCommand('text.findNext', next); target.registerCommand('text.findPrevious', previous);
		}
	}

	public setInput(model: WorkbenchTextViewModel): void {
		if (this.model === model) return;
		this.clearInput(); this.model = model; this.scroll.setInput(model.viewport);
		this.unbindBuffer = model.onWillChangeBuffer(() => { this.cancelPointer(); this.scroll.cancelPointer(); });
		setFieldText(this.findField, model.query, true);
	}
	public clearInput(): void {
		this.cancelPointer(); pointerHover.release(this); this.removeFind(); this.findField.focusTarget.release();
		this.unbindBuffer?.(); this.unbindBuffer = undefined;
		this.scroll.clearInput(); this.model = undefined;
		this.findField.nativeCaret.width = this.findField.nativeCaret.height = 0;
	}
	public dispose(): void {
		this.clearInput(); this.unbindFind(); this.unbindChange(); this.unbindDocumentCancel(); this.unbindFieldCancel(); this.scroll.dispose();
	}
	public openFind(): void {
		this.cancelPointer(); this.findVisible = true;
		this.update(this.bounds, this.font, this.lineHeight);
		this.findField.focusTarget.focus(); selectAll(this.findField); resetBlink();
	}
	public closeFind(): void {
		this.cancelPointer(); this.removeFind();
		this.update(this.bounds, this.font, this.lineHeight); this.focusTarget.focus();
	}
	private removeFind(): void {
		this.findVisible = false; this.arrangeFindFocus(false); pointerHover.release(this);
	}
	private arrangeFindFocus(arranged: boolean): void {
		if (this.findArranged === arranged) return;
		this.findArranged = arranged;
		const field = this.findField.focusTarget;
		if (arranged) {
			const next = this.focusTarget.next;
			field.previous = this.focusTarget; field.next = next; this.focusTarget.next = field;
			// Only concrete successors have a reverse edge; view-boundary callbacks do not.
			if (next instanceof InputFocusTarget) next.previous = field;
		} else {
			this.focusTarget.next = field.next;
			if (field.next instanceof InputFocusTarget) field.next.previous = this.focusTarget;
			field.next = field.previous = null; field.cancelInput(); field.release();
			this.findField.nativeCaret.width = this.findField.nativeCaret.height = 0;
		}
	}

	public update(bounds: Readonly<RectBounds>, font: EditorFont, lineHeight: number): void {
		const model = this.model!;
		if (this.bounds.left !== bounds.left || this.bounds.top !== bounds.top || this.bounds.right !== bounds.right
			|| this.bounds.bottom !== bounds.bottom || this.font !== font) { this.cancelPointer(); pointerHover.release(this); }
		write_rect_bounds(this.bounds, bounds.left, bounds.top, bounds.right, bounds.bottom);
		this.font = font; this.lineHeight = lineHeight; this.scroll.lineStep = lineHeight;
		if (this.countMatches !== model.matchCount || this.countIndex !== model.matchIndex || this.countFont !== font) {
			this.countMatches = model.matchCount; this.countIndex = model.matchIndex; this.countFont = font;
			this.count = `${model.matchIndex + 1}/${model.matchCount}`;
			this.countWidth = font.measure(this.count);
		}
		let top = bounds.top;
		if (this.findVisible) {
			const bottom = Math.min(bounds.bottom, top + lineHeight + 8);
			write_rect_bounds(this.findBar, bounds.left, top, bounds.right, bottom);
			const closeSize = Math.max(lineHeight + 4, WORKBENCH_ICON_SIZE + 6);
			const right = Math.max(bounds.left, bounds.right - 3);
			write_rect_bounds(this.findCloseBounds, Math.max(bounds.left, right - closeSize), top + 2, right, Math.max(top + 2, bottom - 2));
			const showCount = this.findCloseBounds.left - bounds.left >= this.countWidth + font.advance('M') * 8 + 16;
			write_rect_bounds(this.findBounds, bounds.left + 3, top + 2, Math.max(bounds.left + 3, this.findCloseBounds.left - (showCount ? this.countWidth + 8 : 3)), Math.max(top + 2, bottom - 2));
			this.arrangeFindFocus(bottom - top >= lineHeight + 8 && this.findBounds.right - this.findBounds.left > 6);
			if (this.findArranged) {
				this.findViewport.update(this.findField, this.findBounds.right - this.findBounds.left - 6, editorViewState.inlineFieldMetricsRef, font);
				const caret = this.findField.nativeCaret;
				caret.x = this.findBounds.left + 3 + this.findViewport.advances[getCursorOffset(this.findField)] - this.findViewport.offset;
				caret.y = this.findBounds.top + 2; caret.width = this.findViewport.caretWidth; caret.height = lineHeight;
			}
			top = bottom;
		}
		write_rect_bounds(this.bodyBounds, bounds.left, top, bounds.right, bounds.bottom);
		if (this.bodyBounds.bottom === this.bodyBounds.top || this.bodyBounds.right === this.bodyBounds.left) this.focusTarget.cancelInput();
		model.layout(this.bodyBounds, font, lineHeight);
		if (this.gesture === 'document') {
			const view = model.viewport;
			const distance = this.pointerY < view.bounds.top ? this.pointerY - view.bounds.top : this.pointerY >= view.bounds.bottom ? this.pointerY - view.bounds.bottom : 0;
			if (distance !== 0) { model.noteUserScroll(); view.scrollbar.setScroll(view.scrollTop + distance); this.updateSelection(); }
		}
	}

	public draw(): void {
		if (this.model === undefined) return;
		drawWorkbenchTextView(this.model, this.font, this.focusTarget.hasFocus);
		if (!this.findVisible || !this.findArranged) return;
		const bar = this.findBar, field = this.findBounds;
		api.pushClipRect(bar.left, bar.top, bar.right, bar.bottom);
		api.fill_rect(bar.left, bar.top, bar.right, bar.bottom, 0, colors.COLOR_RESOURCE_VIEWER_BACKGROUND);
		api.fill_rect(field.left, field.top, field.right, field.bottom, 0, colors.COLOR_INPUT_BACKGROUND);
		api.blit_rect(field.left, field.top, field.right, field.bottom, 0, this.findField.focusTarget.hasFocus ? colors.COLOR_FOCUS_BORDER : colors.COLOR_INPUT_OUTLINE);
		api.pushClipRect(field.left + 1, field.top + 1, field.right - 1, field.bottom - 1);
		drawSingleLineField(this.findField, this.findViewport, field, colors.COLOR_INPUT_TEXT); api.popClipRect();
		if (field.right + this.countWidth + 4 <= this.findCloseBounds.left) api.blit_text_inline_with_font(this.count, field.right + 4, field.top + 2, 0, colors.COLOR_DESCRIPTION_TEXT, this.font.renderFont());
		const close = this.findCloseBounds;
		const pressed = this.gesture === 'close' && this.closeHovered;
		if (this.closeHovered) api.fill_rect(close.left, close.top, close.right, close.bottom, 0,
			pressed ? colors.COLOR_HEADER_BUTTON_PRESSED_BACKGROUND : colors.COLOR_HEADER_BUTTON_ACTIVE_BACKGROUND);
		drawWorkbenchIcon('close', close.left + Math.trunc((close.right - close.left - WORKBENCH_ICON_SIZE) / 2),
			close.top + Math.trunc((close.bottom - close.top - WORKBENCH_ICON_SIZE) / 2), pressed ? colors.COLOR_HEADER_BUTTON_PRESSED_TEXT
				: this.closeHovered ? colors.COLOR_HEADER_BUTTON_ACTIVE_TEXT : colors.COLOR_RESOURCE_VIEWER_TEXT);
		api.popClipRect();
	}

	public handlePointer(snapshot: PointerInputSnapshot): boolean {
		const pressed = (snapshot.justPressedButtons & PointerButton.Primary) !== 0;
		this.closeHovered = this.findVisible && this.findArranged && snapshot.valid && snapshot.insideViewport
			&& point_in_rect(snapshot.viewportX, snapshot.viewportY, this.findCloseBounds);
		if (this.closeHovered) pointerHover.visit(this); else pointerHover.release(this);
		if (this.findVisible && this.findArranged && snapshot.valid && snapshot.insideViewport && point_in_rect(snapshot.viewportX, snapshot.viewportY, this.findBar)) {
			if (pressed && point_in_rect(snapshot.viewportX, snapshot.viewportY, this.findCloseBounds)) {
				this.gesture = 'close'; pointerCapture.capture(this);
			} else if (pressed && point_in_rect(snapshot.viewportX, snapshot.viewportY, this.findBounds)) {
				this.findField.focusTarget.focus(); this.gesture = 'find'; this.moveFind(snapshot, true);
				if (this.findField.pointerSelecting) pointerCapture.capture(this);
			}
			if (this.gesture !== undefined && (snapshot.justReleasedButtons & PointerButton.Primary) !== 0) this.releaseCapturedPointer(snapshot);
			return true;
		}
		const handled = this.scroll.handlePointer(snapshot);
		if (handled && pressed && point_in_rect(snapshot.viewportX, snapshot.viewportY, this.model!.viewport.bounds)) {
			const offset = this.model!.offsetAt(snapshot.viewportX, snapshot.viewportY);
			this.anchor = (snapshot.modifiers & KeyModifier.shift) !== 0 ? this.model!.selectionAnchor : offset;
			this.model!.select(this.anchor, offset); this.gesture = 'document'; this.pointerX = snapshot.viewportX; this.pointerY = snapshot.viewportY;
			pointerCapture.capture(this);
			if ((snapshot.justReleasedButtons & PointerButton.Primary) !== 0) this.releaseCapturedPointer(snapshot);
			return true;
		}
		return handled;
	}
	public handleCapturedPointer(snapshot: PointerSnapshot): void {
		if (this.gesture === 'close') {
			this.closeHovered = point_in_rect(snapshot.viewportX, snapshot.viewportY, this.findCloseBounds);
			if (this.closeHovered) pointerHover.visit(this); else pointerHover.release(this);
		}
		if (this.gesture === 'find') this.moveFind(snapshot, false);
		else if (this.gesture === 'document') { this.pointerX = snapshot.viewportX; this.pointerY = snapshot.viewportY; this.updateSelection(); }
	}
	public releaseCapturedPointer(snapshot: PointerSnapshot): void {
		const close = this.gesture === 'close' && point_in_rect(snapshot.viewportX, snapshot.viewportY, this.findCloseBounds);
		this.handleCapturedPointer(snapshot); pointerCapture.release(this); this.gesture = undefined; this.findField.pointerSelecting = false;
		if (close) this.closeFind();
	}
	public cancelPointer(): void { this.gesture = undefined; this.findField.pointerSelecting = false; pointerCapture.cancelTarget(this); }
	public onPointerLeave(): void { this.closeHovered = false; }
	private updateSelection(): void { this.model!.select(this.anchor, this.model!.offsetAt(this.pointerX, this.pointerY)); }
	private moveFind(snapshot: PointerSnapshot, pressed: boolean): void {
		const options = this.fieldPointer; options.metrics = editorViewState.inlineFieldMetricsRef;
		options.textLeft = this.findBounds.left + 3 - this.findViewport.offset; options.pointerX = snapshot.viewportX;
		options.justPressed = pressed; options.pointerPressed = true;
		if (applyInlineFieldPointer(this.findField, options).requestBlinkReset) resetBlink();
	}
	public handleWheel(snapshot: WheelInputSnapshot, delta = snapshot.deltaY * this.lineHeight): boolean { return this.scroll.handleWheel(snapshot, delta); }

	private handleDocumentKey(event: KeyInputEvent): boolean {
		if ((event.modifiers & KeyModifier.alt) !== 0) return false;
		const primary = (event.modifiers & (KeyModifier.ctrl | KeyModifier.meta)) !== 0, extend = (event.modifiers & KeyModifier.shift) !== 0;
		if (primary && !extend && isKeyJustPressed('KeyA', event)) { consumeIdeKey('KeyA', event); this.model!.selectAll(); return true; }
		if (this.findVisible && isKeyJustPressed('Escape', event)) { consumeIdeKey('Escape', event); this.closeFind(); return true; }
		for (const [key, kind] of MOVEMENT) if (isKeyDown(key, event)) {
			if (primary && key !== 'Home' && key !== 'End') return false;
			consumeIdeKey(key, event); this.cancelPointer(); this.model!.move(primary ? key === 'Home' ? 'documentStart' : 'documentEnd' : kind, extend); return true;
		}
		return false;
	}
}

const MOVEMENT: readonly (readonly [string, WorkbenchTextViewMove])[] = [
	['ArrowLeft', 'left'], ['ArrowRight', 'right'], ['ArrowUp', 'up'], ['ArrowDown', 'down'],
	['Home', 'home'], ['End', 'end'], ['PageUp', 'pageUp'], ['PageDown', 'pageDown'],
];
