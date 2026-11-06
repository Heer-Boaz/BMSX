import { create_rect_bounds, point_in_rect, write_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import { PointerButton } from '../../../../hosts/common/input/pointer_event';
import type { PointerInputSnapshot } from '../../../common/models';
import type { EditorCommandRunner } from '../../../common/commands';
import * as colors from '../../../common/constants';
import { ValueInput } from '../../../editor/ui/inline/value_input';
import { drawValueInput } from '../../../editor/ui/inline/value_input_render';
import type { EditorFont } from '../../../editor/ui/view/font';
import { editorViewState } from '../../../editor/ui/view/state';
import { inputFocus, type InputFocusTarget } from '../../../input/focus';
import { pointerCapture } from '../../../input/pointer/capture';
import { pointerHover } from '../../../input/pointer/hover';
import { api } from '../../../runtime/overlay_api';
import { measureText } from '../../../editor/common/text/layout';
import type { WorkbenchPreferences } from '../../services/preferences/preferences';
import type { QuickInputController } from '../../services/quick_input/controller';
import { TextQuickPickProvider } from '../../services/quick_input/text_provider';
import { createWorkbenchActionBar, layoutWorkbenchActionBar } from '../../ui/action_bar';
import { WorkbenchActionBarControl } from '../../ui/action_bar_control';
import { WorkbenchCheckboxControl } from '../../ui/checkbox_control';
import { drawWorkbenchCheckbox } from '../../render/checkbox';
import { renderWorkbenchActionBar } from '../../render/action_bar';
import type { Setting } from './model';

/** A setting binds existing native controls to its declared preference, never to a copied draft database. */
export class SettingControl {
	public readonly fieldBounds = create_rect_bounds();
	public readonly actions;
	public readonly context: InputFocusTarget;
	public readonly value: ValueInput<number> | undefined;
	public readonly checkbox: WorkbenchCheckboxControl | undefined;
	public readonly buttons: WorkbenchActionBarControl;
	public attached = false;
	private controlHeight = 0;
	private inlineReset = false;
	public readonly focusOrder: readonly InputFocusTarget[];
	private observed: string | number | boolean | undefined;
	private enabled = true;
	public constructor(public readonly setting: Setting, private readonly preferences: WorkbenchPreferences,
		parent: InputFocusTarget, commands: EditorCommandRunner, private readonly quickInput: QuickInputController) {
		this.context = inputFocus.createTarget(parent);
		this.context.canFocus = () => false;
		this.actions = createWorkbenchActionBar(setting.kind === 'choice' ? 'settings.choice' : 'settings.value');
		this.context.registerCommand('settings.reset', { isEnabled: () => this.attached && this.enabled && preferences.isConfigured(setting.id),
			run: () => {
				this.value?.cancel(); preferences.reset(setting.id);
			} });
		if (setting.kind === 'number') {
			this.value = new ValueInput(this.context, { options: { singleLine: true, allowSpace: false }, format: String,
				parse: setting.parse, invalidBlurMessage: 'Invalid font size cancelled; preference unchanged.' }, value => setting.write(preferences, value));
			this.value.field.focusTarget.canFocus = () => this.attached && this.enabled;
		} else if (setting.kind === 'boolean') {
			this.checkbox = new WorkbenchCheckboxControl(inputFocus, pointerCapture, this.context, (_input, value) => setting.write(preferences, value));
		} else {
			this.context.registerCommand('settings.choose', { isEnabled: () => this.attached && this.enabled, run: () => {
				const current = setting.read(preferences);
				this.quickInput.pick(setting.label, 'Choose a value', () => new TextQuickPickProvider(
					setting.choices.map(choice => ({ ...choice, description: choice.value === current ? 'Current' : '', detail: '' })),
					setting.choices.findIndex(choice => choice.value === current)), choice => setting.write(preferences, choice.value), undefined,
					{ invocationOrigin: this.buttons.focusTarget, commandTarget: this.context });
			} });
		}
		this.buttons = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, commands, this.context, () => parent.focus());
		this.focusOrder = this.value !== undefined ? [this.value.field.focusTarget, this.buttons.focusTarget]
			: this.checkbox !== undefined ? [this.checkbox.focusTarget, this.buttons.focusTarget] : [this.buttons.focusTarget];
	}
	public attach(): void {
		this.attached = true; this.observed = undefined;
		this.buttons.setInput(this.actions, this.context); this.refresh();
	}
	public detach(): void {
		this.attached = false;
		this.value?.cancel(); this.value?.field.focusTarget.release();
		this.checkbox?.clearInput(); this.buttons.clearInput();
	}
	public refresh(): void {
		const value = this.setting.read(this.preferences);
		const enabled = this.setting.enabled === undefined || this.setting.enabled(this.preferences);
		if (value === this.observed && enabled === this.enabled) return;
		this.observed = value; this.enabled = enabled;
		switch (this.setting.kind) {
			case 'number': this.value!.setValue(this.setting.read(this.preferences)); break;
			case 'boolean': this.checkbox!.setInput({ label: this.setting.label, checked: this.setting.read(this.preferences), enabled }); break;
			case 'choice': this.actions.items[0].label = this.setting.choices.find(choice => choice.value === value)!.label; break;
		}
	}
	public measure(width: number, font: EditorFont): number {
		this.controlHeight = Math.max(font.lineHeight + 6, 12);
		this.inlineReset = this.setting.kind === 'number' && width >= font.charAdvance * 16 + 22;
		return this.setting.kind === 'choice' || this.inlineReset ? this.controlHeight : this.controlHeight * 2 + 2;
	}
	public layout(left: number, top: number, right: number, clip: RectBounds): void {
		const { font } = editorViewState, height = this.controlHeight;
		const fieldRight = this.value === undefined ? right : Math.min(right, left + font.charAdvance * 10 + 6);
		write_rect_bounds(this.fieldBounds, left, top, fieldRight, top + height);
		this.value?.layout(this.fieldBounds, clip);
		this.checkbox?.layout(this.fieldBounds, clip, font);
		const actionTop = this.setting.kind === 'choice' || this.inlineReset ? top : top + height + 2;
		layoutWorkbenchActionBar(this.actions, right, actionTop, actionTop + height, measureText, font.renderFont(), this.inlineReset ? fieldRight + 4 : left, 'start');
		this.buttons.update();
	}
	public handlePointer(snapshot: PointerInputSnapshot): boolean {
		if (this.buttons.handlePointer(snapshot)) return true;
		if (this.checkbox?.handlePointer(snapshot)) return true;
		if (this.value !== undefined && point_in_rect(snapshot.viewportX, snapshot.viewportY, this.fieldBounds)) {
			this.value.handlePointer(this.fieldBounds.left + 3, snapshot.viewportX,
				(snapshot.justPressedButtons & PointerButton.Primary) !== 0, (snapshot.pressedButtons & PointerButton.Primary) !== 0);
			return true;
		}
		return false;
	}
	public draw(): void {
		const font = editorViewState.font;
		if (this.value !== undefined) drawValueInput(this.value, this.fieldBounds);
		if (this.checkbox !== undefined) drawWorkbenchCheckbox(this.checkbox);
		renderWorkbenchActionBar(this.actions, font.renderFont(), colors.COLOR_INPUT_TEXT, colors.COLOR_HEADER_BUTTON_TEXT_DISABLED);
		if (this.value !== undefined && this.value.error.length > 0)
			api.blit_text_inline_with_font(this.value.error, this.actions.bounds.right + 4, this.actions.bounds.top, 0, colors.COLOR_CONTENT_ERROR_TEXT, font.renderFont());
	}
	public dispose(): void { this.detach(); this.value?.dispose(); this.checkbox?.dispose(); this.buttons.dispose(); }
}
