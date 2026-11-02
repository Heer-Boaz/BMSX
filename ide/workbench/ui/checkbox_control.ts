import { PointerButton } from '../../../hosts/common/input/pointer_event';
import { KeyModifier, type KeyInputEvent } from '../../../hosts/common/input/text';
import { copy_rect_bounds, create_rect_bounds, point_in_rect, write_rect_bounds, type RectBounds } from '../../../machine/ts/common/rect';
import type { PointerInputSnapshot } from '../../common/models';
import { truncateMeasuredText } from '../../common/text';
import type { EditorFont } from '../../editor/ui/view/font';
import { InputFocusScope, type InputFocusService, type InputFocusTarget } from '../../input/focus';
import { consumeIdeKey, isKeyJustPressed } from '../../input/keyboard/key_input';
import type { PointerCaptureService, PointerCaptureTarget } from '../../input/pointer/capture';
import { WORKBENCH_ICON_SIZE } from './icon';
import type { WorkbenchTooltipTarget } from './tooltip';

export type WorkbenchCheckboxInput = { readonly checked: boolean; readonly label: string; readonly enabled: boolean };
type CheckboxPress<Input> = { readonly input: Input; readonly revision: number; readonly context: number; readonly key: string | undefined };

/** A controlled boolean intent. Only the binding owner publishes checked state. */
export class WorkbenchCheckboxControl<Input extends WorkbenchCheckboxInput = WorkbenchCheckboxInput> implements PointerCaptureTarget {
	public readonly focusTarget: InputFocusTarget;
	public readonly bounds = create_rect_bounds();
	public readonly clip = create_rect_bounds();
	public readonly box = create_rect_bounds();
	public label = '';
	public labelX = 0;
	public labelY = 0;
	public font: EditorFont | undefined;
	public hovered = false;
	private readonly disclosure = { tooltip: '', bounds: this.bounds };
	private clippedLabel = false;
	private inputValue: Input | undefined;
	private revision = 0;
	private press: CheckboxPress<Input> | undefined;
	private unbindContext: (() => void) | undefined;
	private readonly unbindKeyboard: () => void;
	private readonly unbindBlur: () => void;
	private readonly cancelInput = () => { this.capture.cancelTarget(this); this.cancelPointer(); };
	public get input(): Input | undefined { return this.inputValue; }
	public get pressed(): boolean { return this.press !== undefined && (this.press.key !== undefined || this.hovered); }
	public get tooltipItem(): WorkbenchTooltipTarget | undefined {
		return this.inputValue !== undefined && this.clippedLabel && (this.hovered || this.focusTarget.hasFocus) ? this.disclosure : undefined;
	}
	public constructor(private readonly focus: InputFocusService, private readonly capture: PointerCaptureService,
		parent: InputFocusTarget, private readonly onChange: (input: Input, checked: boolean) => void,
		private readonly onCancel?: () => void) {
		this.focusTarget = focus.createTarget(parent, new InputFocusScope(parent.scope.surfaceScope, parent.scope));
		this.focusTarget.commandContext = parent.commandContext;
		this.focusTarget.canFocus = () => this.inputValue !== undefined && this.inputValue.enabled;
		this.unbindKeyboard = this.focusTarget.bindKeyboard(event => this.handleKeyboard(event), this.cancelInput);
		this.unbindBlur = this.focusTarget.onDidBlur(this.cancelInput);
	}
	public setInput(input: Input): void {
		if (this.inputValue === input) return;
		this.inputValue = input; this.revision++;
		this.unbindContext?.();
		this.unbindContext = this.focusTarget.scope.onDidRetireContext(() => this.clearInput());
		this.cancelInput(); this.prepare();
		if (!input.enabled) this.focusTarget.release();
	}
	public clearInput(): void {
		this.inputValue = undefined; this.revision++;
		this.unbindContext?.(); this.unbindContext = undefined;
		this.cancelInput(); this.focusTarget.release();
	}
	public layout(bounds: Readonly<RectBounds>, clip: Readonly<RectBounds>, font: EditorFont): void {
		const left = Math.max(bounds.left, clip.left), top = Math.max(bounds.top, clip.top);
		const right = Math.min(bounds.right, clip.right), bottom = Math.min(bounds.bottom, clip.bottom);
		if (this.font === font && this.bounds.left === bounds.left && this.bounds.top === bounds.top && this.bounds.right === bounds.right
			&& this.bounds.bottom === bounds.bottom && this.clip.left === left && this.clip.top === top && this.clip.right === right && this.clip.bottom === bottom) return;
		this.revision++; this.cancelInput(); copy_rect_bounds(this.bounds, bounds); write_rect_bounds(this.clip, left, top, right, bottom);
		this.font = font; this.prepare();
	}
	private prepare(): void {
		const input = this.inputValue, font = this.font; if (input === undefined || font === undefined) return;
		const bounds = this.bounds, height = bounds.bottom - bounds.top;
		const size = Math.min(bounds.right - bounds.left, height, WORKBENCH_ICON_SIZE + 4);
		const top = bounds.top + Math.trunc((height - size) / 2);
		write_rect_bounds(this.box, bounds.left + 2, top, bounds.left + 2 + size, top + size);
		this.labelX = this.box.right + 4; this.labelY = bounds.top + Math.trunc((height - font.lineHeight) / 2);
		this.label = truncateMeasuredText(input.label, bounds.right - this.labelX - 2, font.measureTextRange);
		this.clippedLabel = this.label !== input.label; this.disclosure.tooltip = input.label;
	}
	private current(press: CheckboxPress<Input>): boolean {
		return this.inputValue === press.input && this.revision === press.revision && this.focusTarget.scope.contextGeneration === press.context
			&& press.input.enabled && this.focus.admittedTarget === this.focusTarget;
	}
	private contains(snapshot: PointerInputSnapshot): boolean {
		return snapshot.valid && snapshot.insideViewport && point_in_rect(snapshot.viewportX, snapshot.viewportY, this.clip);
	}
	public handlePointer(snapshot: PointerInputSnapshot): boolean {
		this.hovered = this.inputValue !== undefined && this.contains(snapshot);
		if (!this.hovered) return false;
		if ((snapshot.justPressedButtons & PointerButton.Secondary) !== 0) return false;
		if ((snapshot.justPressedButtons & PointerButton.Primary) === 0) return true;
		if (!this.inputValue!.enabled) return true;
		const input = this.inputValue!, revision = this.revision, context = this.focusTarget.scope.contextGeneration;
		this.cancelInput();
		if (!this.focusTarget.focus() || this.inputValue !== input || this.revision !== revision || this.focusTarget.scope.contextGeneration !== context) return true;
		const press = { input, revision, context, key: undefined };
		this.press = press; this.hovered = this.contains(snapshot);
		this.capture.capture(this, PointerButton.Primary, this.focusTarget.scope.surfaceScope);
		if (this.press !== press) { if (this.press === undefined) this.capture.cancelTarget(this); return true; }
		if (!this.current(press)) { this.cancelInput(); return true; }
		if ((snapshot.justReleasedButtons & PointerButton.Primary) !== 0) this.releaseCapturedPointer(snapshot);
		return true;
	}
	public handleCapturedPointer(snapshot: PointerInputSnapshot): void {
		this.hovered = this.contains(snapshot);
		const press = this.press;
		if (press !== undefined && !this.current(press)) this.cancelInput();
	}
	public releaseCapturedPointer(snapshot: PointerInputSnapshot): void {
		const press = this.press;
		const commit = press !== undefined && press.key === undefined && (snapshot.justReleasedButtons & PointerButton.Primary) !== 0
			&& this.contains(snapshot) && this.current(press);
		this.cancelPointer();
		if (commit) this.onChange(press.input, !press.input.checked);
	}
	public cancelPointer(): void { this.capture.release(this); this.press = undefined; this.hovered = false; }
	public onPointerLeave(): void { this.hovered = false; }
	private handleKeyboard(event: KeyInputEvent): void {
		if (isKeyJustPressed('Escape', event)) {
			consumeIdeKey('Escape', event); this.cancelInput();
			if (this.onCancel !== undefined) this.onCancel(); else this.focusTarget.release();
			return;
		}
		if (event.consumed || event.code !== 'Space' && event.code !== 'Enter' && event.code !== 'NumpadEnter') return;
		if (event.down) {
			if (event.modifiers !== KeyModifier.none) return;
			consumeIdeKey(event.code, event);
			if (event.repeat || this.press !== undefined || !this.focusTarget.canFocus!()) return;
			this.press = { input: this.inputValue!, revision: this.revision, context: this.focusTarget.scope.contextGeneration, key: event.code };
		} else {
			const press = this.press;
			if (press?.key !== event.code) return;
			consumeIdeKey(event.code, event);
			const commit = this.current(press); this.cancelPointer();
			if (commit) this.onChange(press.input, !press.input.checked);
		}
	}
	public dispose(): void { this.clearInput(); this.unbindKeyboard(); this.unbindBlur(); }
}
