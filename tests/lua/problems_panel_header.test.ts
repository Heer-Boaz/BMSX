import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { inputFocus } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { pointerHover } from '../../ide/input/pointer/hover';
import { ProblemsPanelController } from '../../ide/workbench/contrib/problems/panel/controller';
import { WORKBENCH_ICON_SIZE } from '../../ide/workbench/ui/icon';
import { WorkbenchSurfaceService } from '../../ide/workbench/services/windows/service';
import type { EditorCommandRunner } from '../../ide/common/commands';
import type { PointerSnapshot } from '../../ide/common/models';
import { PROBLEMS_PANEL_HEADER_PADDING_X } from '../../ide/common/constants';
import { api } from '../../ide/runtime/overlay_api';
import { createHostOverlayFixture } from '../helpers/host_overlay';
import { createTestEditorGroup } from '../helpers/editor_panes';

function fixture(t: TestContext, variant: 'tiny' | 'msx' = 'msx', width = 240) {
	configureFontVariant(variant);
	const controller = new ProblemsPanelController(), surfaces = new WorkbenchSurfaceService();
	const bounds = { left: 8, top: 170, right: width, bottom: 270 }, area = { left: 0, top: 0, right: 384, bottom: 288 };
	const owner = surfaces.attach({ role: 'content', captureScope: Symbol('Problems'), getBounds: () => bounds,
		getClip: () => area, isVisible: () => controller.isVisible, draw: () => controller.draw(bounds) });
	const commands: EditorCommandRunner = {
		isEnabled: (command, target) => target!.commandContext.getCommand(command)!.isEnabled(),
		execute: (command, target) => target!.getCommand(command)!.run(),
	};
	controller.header.attach(surfaces, owner, area, commands);
	controller.show(); controller.prepareLayout(bounds);
	const group = createTestEditorGroup();
	const unbindKeyboard = controller.focusTarget.bindKeyboard(event => controller.handleKeyboard(event, group));
	const overlay = createHostOverlayFixture(384, 288), texts: string[] = [];
	t.mock.method(api, 'blit_text_inline_with_font', text => { texts.push(text); });
	const paint = () => {
		controller.prepareLayout(bounds); controller.header.updateFeedback(); texts.length = 0;
		overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer); surfaces.draw(api); overlay.renderer.endFrame();
	};
	const press = (code: string) => {
		inputFocus.handleKeyboard(new KeyInputEvent(code, KeyModifier.none, false, true));
		inputFocus.handleKeyboard(new KeyInputEvent(code, KeyModifier.none, false, false));
	};
	const pointer = (held = 0, down = 0, up = 0) => {
		const button = controller.header.actions.items[0].bounds;
		const event: PointerSnapshot = { valid: true, insideViewport: true, viewportX: button.left + 2, viewportY: button.top + 2,
			pressedButtons: held, justPressedButtons: down, justReleasedButtons: up };
		pointerHover.beginDispatch();
		if (!pointerCapture.dispatch(event, false, 100)) controller.handlePointer(group, event, down !== 0, up !== 0, bounds);
		pointerHover.endDispatch();
	};
	t.after(() => { controller.hide(); controller.header.detach(); unbindKeyboard(); pointerHover.clear(); pointerCapture.cancel(); surfaces.dispose(); group.dispose(); });
	return { controller, surfaces, owner, bounds, area, texts, paint, press, pointer };
}

for (const variant of ['tiny', 'msx'] as const) test(`Problems header budgets its count, coverage state and Info action in ${variant}`, t => {
	const f = fixture(t, variant, 140);
	f.controller.setDiagnostics([], { ready: 123, pending: 12, unsupported: 34, failed: 56 }); f.paint();
	const header = f.controller.header, font = editorViewState.font;
	assert.equal(header.title, 'PROBLEMS (0)');
	assert.ok(f.bounds.left + PROBLEMS_PANEL_HEADER_PADDING_X + font.measure(header.title) <= header.actions.bounds.left - PROBLEMS_PANEL_HEADER_PADDING_X);
	assert.ok(header.summaryLeft + font.measure(header.summary) <= header.actions.bounds.left - PROBLEMS_PANEL_HEADER_PADDING_X);
	assert.ok(header.summary.length === 0 || header.summaryLeft >= f.bounds.left + PROBLEMS_PANEL_HEADER_PADDING_X + font.measure(header.title) + PROBLEMS_PANEL_HEADER_PADDING_X);
	assert.equal(header.actions.items[0].icon, 'info');
	const button = header.actions.items[0].bounds, height = button.bottom - button.top;
	assert.ok(button.top + ((height - WORKBENCH_ICON_SIZE) >> 1) + WORKBENCH_ICON_SIZE <= button.bottom - 2,
		'the native Info icon and focus indicator have separate pixel rows');
	f.pointer(); f.paint();
	for (const line of ['Checked: 123', 'Pending: 12', 'Unsupported: 34', 'Failed: 56', 'Unopened resources are not checked.'])
		assert.ok(f.texts.join('\n').includes(line), line);
});

test('coverage summary distinguishes failed, pending, unsupported, checked and unrequested resources', t => {
	const f = fixture(t);
	for (const [coverage, summary] of [
		[{ ready: 0, pending: 0, unsupported: 0, failed: 0 }, 'Not checked'],
		[{ ready: 3, pending: 0, unsupported: 0, failed: 0 }, '3 checked'],
		[{ ready: 3, pending: 0, unsupported: 2, failed: 0 }, '2 unsupported'],
		[{ ready: 3, pending: 1, unsupported: 2, failed: 0 }, '1 pending'],
		[{ ready: 3, pending: 1, unsupported: 2, failed: 4 }, '4 failed'],
	] as const) {
		f.controller.setDiagnostics([], coverage); f.paint(); assert.equal(f.controller.header.summary, summary);
	}
});

test('coverage is a real paired Info action, keyboard disclosure and exact read-only copy target', t => {
	const f = fixture(t); f.controller.setFocused(true);
	f.controller.setDiagnostics([], { ready: 3, pending: 1, unsupported: 2, failed: 4 }); f.paint();
	f.pointer(PointerButton.Primary, PointerButton.Primary);
	assert.equal(inputFocus.target, f.controller.focusTarget, 'press does not steal body focus');
	f.pointer(0, 0, PointerButton.Primary); f.paint();
	assert.equal(inputFocus.target, f.controller.focusTarget.next);
	const coverage = inputFocus.target!.clipboard!.copy();
	assert.equal(coverage, 'Diagnostics coverage\nChecked: 3\nPending: 1\nUnsupported: 2\nFailed: 4\nUnopened resources are not checked.');
	assert.ok(f.texts.includes('Diagnostics coverage'));
	f.press('Escape'); f.paint(); assert.equal(inputFocus.target, f.controller.focusTarget);
	assert.equal(f.texts.includes('Diagnostics coverage'), false);
	assert.equal(inputFocus.moveFocus(false), true); f.paint();
	assert.ok(f.texts.includes('Diagnostics coverage'), 'Tab reaches complete coverage without a pointer');
	f.press('Enter'); assert.equal(inputFocus.target, f.controller.focusTarget.next);
});

test('coverage publication updates the open disclosure without retaining old status or remeasuring clean frames', t => {
	const f = fixture(t); f.controller.setFocused(true); inputFocus.moveFocus(false); f.paint();
	const advance = editorViewState.font.advance.bind(editorViewState.font);
	let measures = 0;
	t.mock.method(editorViewState.font, 'advance', (...args: Parameters<typeof advance>) => { measures++; return advance(...args); });
	for (let frame = 0; frame < 1000; frame++) { f.controller.prepareLayout(f.bounds); f.controller.header.updateFeedback(); }
	assert.equal(measures, 0);
	f.controller.setDiagnostics([], { ready: 9, pending: 0, unsupported: 0, failed: 0 }); f.paint();
	assert.ok(f.texts.includes('Checked: 9')); assert.equal(f.texts.includes('Checked: 0'), false);
	assert.ok(inputFocus.target!.clipboard!.copy()!.includes('Checked: 9'));
});

test('coverage feedback is passive, respects modal admission and retires with panel/root presentation', t => {
	const f = fixture(t); f.controller.setFocused(true); inputFocus.moveFocus(false); f.paint();
	assert.ok(f.texts.includes('Diagnostics coverage'));
	assert.equal(f.surfaces.hitTest(f.bounds.right - 20, f.bounds.top + 2), f.owner);
	const modal = f.surfaces.attach({ role: 'modal', blockedScope: null, captureScope: Symbol('modal'),
		getBounds: () => f.area, getClip: () => f.area, isVisible: () => true, draw() {} });
	f.paint(); assert.equal(f.texts.includes('Diagnostics coverage'), false); modal.dispose();
	f.controller.hide(); f.paint(); assert.equal(f.texts.includes('Diagnostics coverage'), false);
	assert.equal(f.controller.focusTarget.getCommand('problems.coverage')!.isEnabled(), false);
	f.controller.show(); f.paint(); f.controller.header.detach();
	assert.equal(f.controller.focusTarget.getCommand('problems.coverage')!.isEnabled(), false, 'open intent is not an attached command capability');
	assert.equal(f.controller.focusTarget.next, null);
});
