import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import * as colors from '../../ide/common/constants';
import { EditorFont } from '../../ide/editor/ui/view/font';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { InputFocusService } from '../../ide/input/focus';
import { PointerCaptureService } from '../../ide/input/pointer/capture';
import { api } from '../../ide/runtime/overlay_api';
import { THEME_TOKEN_COMMENT_GREY, THEME_TOKEN_MID_GREY, THEME_TOKEN_MUTED_GREY, THEME_TOKEN_TERMINAL_LIGHT_RED, resolveThemeTokenColor } from '../../ide/theme/tokens';
import { renderWorkbenchActionBar } from '../../ide/workbench/render/action_bar';
import { drawWorkbenchWindow } from '../../ide/workbench/render/window';
import { ContextMenuController } from '../../ide/workbench/services/context_menu/controller';
import { CONTEXT_MENU_PADDING } from '../../ide/workbench/services/context_menu/model';
import { drawContextMenu } from '../../ide/workbench/services/context_menu/render';
import { createWorkbenchActionBar, layoutWorkbenchActionBar } from '../../ide/workbench/ui/action_bar';
import { WorkbenchWindowModel } from '../../ide/workbench/ui/window/model';
import { Host2DKind } from '../../machine/ts/render/host_overlay/commands';
import type { HostOverlayFrame } from '../../machine/ts/render/host_overlay/overlay_queue';
import type { GlyphRenderSubmission, RectRenderSubmission } from '../../machine/ts/render/shared/submissions';
import type { FontVariant } from '../../machine/ts/render/shared/bmsx_font';
import type { RectBounds } from '../../machine/ts/common/rect';
import { createHostOverlayFixture } from '../helpers/host_overlay';

function fixture(t: TestContext, theme: string, variant: FontVariant) {
	const previousTheme = colors.getActiveIdeThemeVariant();
	const previousView = { font: editorViewState.font, lineHeight: editorViewState.lineHeight,
		viewportWidth: editorViewState.viewportWidth, viewportHeight: editorViewState.viewportHeight };
	colors.setIdeThemeVariant(theme);
	const font = new EditorFont(variant), overlay = createHostOverlayFixture(384, 288);
	Object.assign(editorViewState, { font, lineHeight: font.lineHeight, viewportWidth: 384, viewportHeight: 288 });
	t.after(() => { colors.setIdeThemeVariant(previousTheme); Object.assign(editorViewState, previousView); });
	const draw = (paint: () => void) => {
		overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer);
		paint(); overlay.renderer.endFrame();
		return overlay.queue.consumeOverlayFrame();
	};
	return { font, draw };
}

function glyphs(frame: HostOverlayFrame): GlyphRenderSubmission[] {
	const result: GlyphRenderSubmission[] = [];
	for (let index = 0; index < frame.commandCount; index++)
		if (frame.commandKinds[index] === Host2DKind.Glyphs) result.push(frame.commandRefs[index] as GlyphRenderSubmission);
	return result;
}

function fillsWithin(frame: HostOverlayFrame, bounds: RectBounds): RectRenderSubmission[] {
	const result: RectRenderSubmission[] = [];
	for (let index = 0; index < frame.commandCount; index++) if (frame.commandKinds[index] === Host2DKind.Rect) {
		const rect = frame.commandRefs[index] as RectRenderSubmission, area = rect.area;
		if (area.left >= bounds.left && area.right <= bounds.right && area.top >= bounds.top && area.bottom <= bounds.bottom) result.push(rect);
	}
	return result;
}

for (const theme of ['dark', 'light']) {
	test(`${theme} disabled control roles remain neutral without changing syntax DIM or Problems locations`, t => {
		fixture(t, theme, 'tiny');
		assert.equal(colors.COLOR_HEADER_BUTTON_TEXT_DISABLED, THEME_TOKEN_MUTED_GREY);
		assert.equal(colors.COLOR_MENU_DISABLED_TEXT, THEME_TOKEN_MUTED_GREY);
		for (const role of [colors.COLOR_HEADER_BUTTON_TEXT, colors.COLOR_MENU_TEXT, colors.COLOR_MENU_SELECTION_TEXT,
			colors.COLOR_STATUS_ERROR, colors.COLOR_STATUS_WARNING])
			assert.notEqual(resolveThemeTokenColor(colors.COLOR_MENU_DISABLED_TEXT), resolveThemeTokenColor(role));
		const syntaxDim = theme === 'dark' ? THEME_TOKEN_TERMINAL_LIGHT_RED : THEME_TOKEN_COMMENT_GREY;
		assert.equal(colors.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_DIM, syntaxDim);
		assert.equal(colors.COLOR_PROBLEMS_PANEL_LOCATION, syntaxDim);
	});
	for (const variant of ['tiny', 'msx'] as const) {
		test(`${theme}/${variant} actual action labels stay neutral when disabled, checked and hovered`, t => {
			const f = fixture(t, theme, variant), state = createWorkbenchActionBar('sourceEditReview.title');
			for (const item of state.items) item.enabled = true;
			const disabled = state.items[0], enabled = state.items[1];
			disabled.enabled = false; disabled.checked = true; state.hoveredCommand = disabled.command;
			layoutWorkbenchActionBar(state, 360, 10, 10 + f.font.lineHeight + 6, text => f.font.measure(text), f.font.renderFont(), 4);
			const commands = glyphs(f.draw(() => renderWorkbenchActionBar(state, f.font.renderFont())));
			assert.equal(commands.find(command => command.items === disabled.label)!.color, resolveThemeTokenColor(THEME_TOKEN_MUTED_GREY));
			assert.equal(commands.find(command => command.items === enabled.label)!.color, resolveThemeTokenColor(colors.COLOR_HEADER_BUTTON_TEXT));
		});
		test(`${theme}/${variant} generic window chrome owns transparent and painted disabled icon colors`, t => {
			const f = fixture(t, theme, variant), model = new WorkbenchWindowModel({ left: 20, top: 30, right: 330, bottom: 200 }, 100, 60);
			model.font = f.font.renderFont(); model.title = 'Window'; model.displayTitle = model.title;
			model.arrange({ left: 0, top: 0, right: 384, bottom: 288 }, f.font.lineHeight + 8);
			const state = createWorkbenchActionBar('window.title'), disabled = state.items[0], enabled = state.items[1];
			disabled.enabled = false; enabled.enabled = true;
			layoutWorkbenchActionBar(state, model.header.right - 4, model.header.top + 2, model.header.bottom - 2,
				text => f.font.measure(text), f.font.renderFont(), model.header.left + 4);
			for (const active of [true, false]) for (const intent of ['idle', 'hovered', 'checked', 'focused']) {
				const painted = intent !== 'idle';
				disabled.checked = intent === 'checked'; state.hoveredCommand = intent === 'hovered' ? disabled.command : null;
				state.hasFocus = intent === 'focused'; state.focusedIndex = intent === 'focused' ? 0 : -1;
				const frame = f.draw(() => drawWorkbenchWindow(model, state, active));
				const disabledRects = fillsWithin(frame, disabled.bounds), enabledRects = fillsWithin(frame, enabled.bounds);
				assert.ok(disabledRects.length > 0 && enabledRects.length > 0, 'the actual icon patterns must be painted');
				const expected = resolveThemeTokenColor(!painted && active ? THEME_TOKEN_MID_GREY : THEME_TOKEN_MUTED_GREY);
				for (const rect of disabledRects) {
					const area = rect.area, fullBackground = area.left === disabled.bounds.left && area.right === disabled.bounds.right
						&& area.top === disabled.bounds.top && area.bottom === disabled.bounds.bottom;
					assert.equal(rect.color, fullBackground ? resolveThemeTokenColor(colors.COLOR_HEADER_BUTTON_DISABLED_BACKGROUND) : expected);
				}
				for (const rect of enabledRects) assert.equal(rect.color,
					resolveThemeTokenColor(active ? colors.COLOR_WINDOW_HEADER_ACTIVE_TEXT : colors.COLOR_WINDOW_HEADER_INACTIVE_TEXT));
			}
		});
		test(`${theme}/${variant} actual disabled menu label, shortcut and active mark cannot adopt selection colors`, t => {
			const f = fixture(t, theme, variant), focus = new InputFocusService(), capture = new PointerCaptureService();
			const origin = focus.createTarget(); origin.bindKeyboard(() => {}); origin.focus();
			const menu = new ContextMenuController(focus, capture); t.after(() => menu.dispose());
			let undoEnabled = true;
			menu.show(40, 40, [{ type: 'command', command: 'undo' }, { type: 'command', command: 'save' }], {
				isEnabled: command => command !== 'undo' || undoEnabled, isActive: command => command === 'undo', execute() {},
			}, { selectFirst: true });
			assert.equal(menu.model.selectedIndex, 0);
			undoEnabled = false; menu.update();
			assert.equal(menu.model.selectedIndex, 1, 'keyboard selection must leave the now-disabled action');
			const disabled = menu.model.rows[0], enabled = menu.model.rows[1], frame = f.draw(() => drawContextMenu(menu));
			assert.equal(disabled.active, true); assert.equal(disabled.enabled, false);
			assert.ok(disabled.keybinding !== undefined);
			const text = glyphs(frame);
			for (const label of [disabled.label, disabled.keybinding])
				assert.equal(text.find(command => command.items === label)!.color, resolveThemeTokenColor(THEME_TOKEN_MUTED_GREY));
			assert.equal(text.find(command => command.items === enabled.label)!.color, resolveThemeTokenColor(colors.COLOR_MENU_SELECTION_TEXT));
			const size = Math.max(f.font.lineHeight >> 1, 2), left = menu.model.viewport.bounds.left + CONTEXT_MENU_PADDING;
			const top = menu.model.viewport.offsetTop + disabled.top + ((menu.model.rowHeight - size) >> 1);
			const marks = fillsWithin(frame, { left, top, right: left + size, bottom: top + size });
			assert.equal(marks.length, 1); assert.equal(marks[0].color, resolveThemeTokenColor(THEME_TOKEN_MUTED_GREY));
		});
	}
}
