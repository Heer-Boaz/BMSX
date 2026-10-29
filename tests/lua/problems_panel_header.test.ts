import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { inputFocus } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { pointerHover } from '../../ide/input/pointer/hover';
import { createProblemsPanelFixture } from '../helpers/problems_panel';
import type { PointerInputSnapshot } from '../../ide/common/models';
import { PROBLEMS_PANEL_HEADER_PADDING_X } from '../../ide/common/constants';
import { api } from '../../ide/runtime/overlay_api';
import { createHostOverlayFixture } from '../helpers/host_overlay';

function fixture(t: TestContext, variant: 'tiny' | 'msx' = 'msx', width = 240) {
	const f = createProblemsPanelFixture(t, variant, { left: 8, top: 170, right: width, bottom: 270 }, { left: 0, top: 0, right: 384, bottom: 288 });
	const { controller, surfaces, bounds } = f;
	const overlay = createHostOverlayFixture(384, 288);
	const paint = () => {
		controller.layout(bounds); controller.update();
		overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer); surfaces.draw(api); overlay.renderer.endFrame();
	};
	const press = (code: string) => {
		inputFocus.handleKeyboard(new KeyInputEvent(code, KeyModifier.none, false, true));
		inputFocus.handleKeyboard(new KeyInputEvent(code, KeyModifier.none, false, false));
	};
	const pointer = (held = 0, down = 0, up = 0) => {
		const button = controller.header.actions.items[0].bounds;
		const event: PointerInputSnapshot = { modifiers: KeyModifier.none, spaceDown: false, valid: true, insideViewport: true, viewportX: button.left + 2, viewportY: button.top + 2,
			pressedButtons: held, justPressedButtons: down, justReleasedButtons: up };
		pointerHover.beginDispatch();
		if (!pointerCapture.dispatch(event, false, 100)) controller.handlePointer(event);
		pointerHover.endDispatch();
	};
	return { ...f, paint, press, pointer };
}

for (const variant of ['tiny', 'msx'] as const) test(`Problems header allocates measured title and summary separately from its native action in ${variant}`, t => {
	const f = fixture(t, variant, 140);
	f.controller.setDiagnostics([], { ready: 123, pending: 12, unsupported: 34, failed: 56 }); f.paint();
	const header = f.controller.header, font = editorViewState.font;
	// Text and action disjointness is the intrinsic header layout contract, not its wording.
	assert.ok(f.bounds.left + PROBLEMS_PANEL_HEADER_PADDING_X + font.measure(header.title) <= header.actions.bounds.left - PROBLEMS_PANEL_HEADER_PADDING_X);
	assert.ok(header.summaryLeft + font.measure(header.summary) <= header.actions.bounds.left - PROBLEMS_PANEL_HEADER_PADDING_X);
	assert.ok(header.summary.length === 0 || header.summaryLeft >= f.bounds.left + PROBLEMS_PANEL_HEADER_PADDING_X + font.measure(header.title) + PROBLEMS_PANEL_HEADER_PADDING_X);
	f.pointer(); f.paint();
	assert.equal(f.headerFeedback.visible, true, 'the allocated native action admits hover disclosure');
});

test('coverage is a real paired Info action, keyboard disclosure and exact read-only copy target', t => {
	const f = fixture(t); f.controller.focus();
	f.controller.setDiagnostics([], { ready: 3, pending: 1, unsupported: 2, failed: 4 }); f.paint();
	f.pointer(PointerButton.Primary, PointerButton.Primary);
	assert.equal(inputFocus.target, f.controller.focusTarget, 'press does not steal body focus');
	f.pointer(0, 0, PointerButton.Primary); f.paint();
	assert.ok(inputFocus.target === f.controller.header.controls.focusTarget);
	assert.equal(inputFocus.target.clipboard!.readOnly, true);
	const coverage = inputFocus.target!.clipboard!.copy();
	// Exact clipboard serialization is the contribution's data-export contract, not UI wording.
	assert.equal(coverage, 'Diagnostics coverage\nChecked: 3\nPending: 1\nUnsupported: 2\nFailed: 4\nUnopened resources are not checked.');
	assert.equal(f.headerFeedback.visible, true);
	f.press('Escape'); f.paint(); assert.equal(inputFocus.target, f.controller.focusTarget);
	assert.equal(f.headerFeedback.visible, false);
	assert.equal(inputFocus.moveFocus(false), true); f.paint();
	assert.equal(f.headerFeedback.visible, true, 'Tab admits the same disclosure without a pointer');
	f.press('Enter'); assert.ok(inputFocus.target === f.controller.header.controls.focusTarget);
});

test('coverage publication refreshes its read-only export without remeasuring stable feedback', t => {
	const f = fixture(t); f.controller.focus(); inputFocus.moveFocus(false); f.paint();
	const advance = editorViewState.font.advance.bind(editorViewState.font);
	let measures = 0;
	t.mock.method(editorViewState.font, 'advance', (...args: Parameters<typeof advance>) => { measures++; return advance(...args); });
	for (let frame = 0; frame < 1000; frame++) { f.controller.layout(f.bounds); f.controller.header.updateFeedback(); }
	assert.equal(measures, 0);
	f.controller.setDiagnostics([], { ready: 9, pending: 0, unsupported: 0, failed: 0 }); f.paint();
	assert.equal(f.headerFeedback.visible, true);
	// Publishing new coverage must also replace every counter in the exact exported observation.
	assert.equal(inputFocus.target!.clipboard!.copy(),
		'Diagnostics coverage\nChecked: 9\nPending: 0\nUnsupported: 0\nFailed: 0\nUnopened resources are not checked.');
});

test('coverage feedback is passive, respects modal admission and retires with panel/root presentation', t => {
	const f = fixture(t); f.controller.focus(); inputFocus.moveFocus(false); f.paint();
	assert.equal(f.headerFeedback.visible, true);
	const feedbackBounds = f.headerFeedback.getBounds();
	const hit = f.surfaces.hitTest((feedbackBounds.left + feedbackBounds.right) / 2, (feedbackBounds.top + feedbackBounds.bottom) / 2);
	assert.ok(hit !== null && hit !== f.headerFeedback, 'passive disclosure never takes its underlying native pointer route');
	const modal = f.surfaces.attach({ role: 'modal', blockedScope: null, presentationParent: null, captureScope: Symbol('modal'),
		getBounds: () => f.area, getClip: () => f.area, isVisible: () => true, draw() {} });
	f.paint(); assert.equal(f.headerFeedback.visible, false); modal.dispose();
	f.controller.detach(); f.paint(); assert.equal(f.headerFeedback.visible, false);
	assert.equal(f.controller.focusTarget.getCommand('problems.coverage')!.isEnabled(), false);
	f.controller.attach(f.bounds); f.paint(); f.controller.header.detach();
	assert.equal(f.controller.focusTarget.getCommand('problems.coverage')!.isEnabled(), false, 'open intent is not an attached command capability');
	f.controller.focus(); inputFocus.moveFocus(false);
	assert.ok(inputFocus.admittedTarget === f.controller.focusTarget, 'Tab cannot enter a detached header control');
	f.owner.dispose();
	assert.equal(f.headerFeedback.retired, true); assert.equal(f.headerFeedback.visible, false);
});
