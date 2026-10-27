import { KeyModifier } from '../../hosts/common/input/text';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Font } from '../../machine/ts/render/shared/bmsx_font';
import { createWorkbenchActionBar } from '../../ide/workbench/ui/action_bar';
import { RuntimeTimelineLayout } from '../../ide/workbench/ui/runtime_timeline';
import { WorkbenchSlider } from '../../ide/workbench/ui/slider';
import { WorkbenchSliderControl } from '../../ide/workbench/ui/slider_control';
import { InputFocusService } from '../../ide/input/focus';
import { PointerCaptureService } from '../../ide/input/pointer/capture';
import type { PointerInputSnapshot } from '../../ide/common/models';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { createHostOverlayFixture } from '../helpers/host_overlay';
import { api } from '../../ide/runtime/overlay_api';
import { drawRuntimeTimeline } from '../../ide/workbench/render/runtime_timeline';
import { Host2DKind } from '../../machine/ts/render/host_overlay/commands';
import type { GlyphRenderSubmission } from '../../machine/ts/render/shared/submissions';

for (const variant of ['tiny', 'msx'] as const) test(`${variant} runtime transport shares one compact row without title or pseudo-icon labels`, t => {
	const font = new Font({ variant }), actions = createWorkbenchActionBar('runtime.title');
	const layout = new RuntimeTimelineLayout(), range = new WorkbenchSlider();
	assert.deepEqual(actions.items.map(item => item.command), ['stepFrameBack', 'runtime.playback', 'stepFrame', 'runtime.resume', 'runtime.present']);
	assert.ok(actions.items.every(item => item.icon !== undefined), 'transport actions use actual icons; visibility belongs to the view context menu');
	for (const width of [192, 320, 384]) {
		layout.update(actions, range, font, 0, 240, width, 0, 150);
		assert.equal(layout.bounds.bottom - layout.bounds.top, RuntimeTimelineLayout.height(font));
		assert.ok(RuntimeTimelineLayout.height(font) < font.lineHeight + 22, 'transport no longer reserves a second label row');
		assert.equal(layout.positionLabel, '', 'live endpoint needs neither NOW nor a repeated playback header');
		assert.ok(actions.items[2].bounds.right < range.bounds.left);
		assert.ok(range.bounds.left + 6 < range.bounds.right, 'history remains draggable at compact viewport widths');
		assert.ok(range.bounds.right < actions.items[3].bounds.left);
		for (const item of actions.items) {
			assert.ok(item.bounds.left >= layout.bounds.left && item.bounds.right <= layout.bounds.right);
			assert.ok(item.bounds.top >= layout.bounds.top && item.bounds.bottom <= layout.bounds.bottom);
			assert.ok(item.tooltip.length > 0, 'icon actions retain their complete semantic names');
		}
		const track = { ...range.bounds }, revision = range.revision;
		const buttons = actions.items.map(item => ({ ...item.bounds }));
		layout.update(actions, range, font, 0, 240, width, 37, 150);
		assert.equal(layout.positionLabel, '-3.7 s');
		assert.deepEqual(range.bounds, track, 'entering history review cannot move the captured track');
		assert.deepEqual(actions.items.map(item => item.bounds), buttons);
		assert.equal(range.revision, revision);
	}
	const measure = t.mock.method(font, 'measure');
	for (let frame = 0; frame < 1000; frame++) layout.update(actions, range, font, 0, 240, 384, 37, 150);
	assert.equal(measure.mock.callCount(), 0, 'clean frames reuse measured transport text and geometry');
	const overlay = createHostOverlayFixture(384, 288);
	overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer);
	drawRuntimeTimeline(layout, actions, range, false, font); overlay.renderer.endFrame();
	const frame = overlay.queue.consumeOverlayFrame(), text: string[] = [];
	for (let index = 0; index < frame.commandCount; index++) if (frame.commandKinds[index] === Host2DKind.Glyphs) {
		const run = frame.commandRefs[index] as GlyphRenderSubmission;
		text.push((run.items as string).slice(run.item_start, run.item_end));
	}
	assert.deepEqual(text, ['-3.7 s'], 'transport buttons render actual icon geometry, not font-dependent pseudo icons');
});

test('history readback and changing offset text preserve a captured inline timeline drag', t => {
	const font = new Font({ variant: 'tiny' }), actions = createWorkbenchActionBar('runtime.title');
	const layout = new RuntimeTimelineLayout(), range = new WorkbenchSlider();
	layout.update(actions, range, font, 0, 240, 384, 0, 200);
	range.enabled = true; range.setRange(0, 2000, 1);
	const focus = new InputFocusService(), capture = new PointerCaptureService(), parent = focus.createTarget();
	parent.bindKeyboard(() => {}); parent.focus();
	const values: number[] = []; let cancelled = 0;
	const slider = new WorkbenchSliderControl(focus, capture, parent, value => values.push(value), () => cancelled++);
	slider.setInput(range); t.after(() => slider.dispose());
	const pointer = (x: number, held = 0, down = 0, up = 0): PointerInputSnapshot => ({ modifiers: KeyModifier.none, spaceDown: false,
		viewportX: x, viewportY: range.bounds.top + 4, valid: true, insideViewport: true,
		pressedButtons: held, justPressedButtons: down, justReleasedButtons: up,
	});
	slider.handlePointer(pointer(range.bounds.left + 3, PointerButton.Primary, PointerButton.Primary));
	const revision = range.revision;
	for (const offset of [1, 9, 10, 90, 100, 200]) {
		layout.update(actions, range, font, 0, 240, 384, offset, 200);
		slider.update();
		assert.equal(range.revision, revision);
		assert.equal(capture.active, true);
		capture.dispatch(pointer(range.bounds.right - 3, PointerButton.Primary), false, offset);
	}
	capture.dispatch(pointer(range.bounds.right - 3, 0, 0, PointerButton.Primary), false, 250);
	assert.equal(capture.active, false); assert.equal(cancelled, 0);
	assert.equal(values[0], 0); assert.equal(values.at(-1), 2000);
});
