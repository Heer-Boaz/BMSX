import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyModifier } from '../../hosts/common/input/text';
import { Host2DKind } from '../../machine/ts/render/host_overlay/commands';
import type { HostOverlayClipRect } from '../../machine/ts/render/host_overlay/clip';
import type { GlyphRenderSubmission } from '../../machine/ts/render/shared/submissions';
import { inputFocus } from '../../ide/input/focus';
import { api } from '../../ide/runtime/overlay_api';
import { getWorkbenchConnectionBounds, getWorkbenchStatusLayout } from '../../ide/workbench/common/layout';
import { GameViewInput } from '../../ide/workbench/contrib/game_view/editor_input';
import { createActualSourcePanes } from '../helpers/source_panes';

type Fixture = ReturnType<typeof createActualSourcePanes>;

function createStatusFixture(t: TestContext): Fixture {
	const f = createActualSourcePanes(t), viewport = f.ide.overlayRenderer.viewportSize;
	// Source composition borrows a small machine presenter; status painting needs
	// its real target to include the complete configured workbench viewport.
	f.host.presenter.setFixedRenderTargetSize(viewport.width, viewport.height);
	return f;
}

/** The visible numeric count is the status producer's content contract and locates
 * its real pointer target without exposing a private control or freezing pixels. */
function statusButton(t: TestContext, f: Fixture) {
	const row = getWorkbenchConnectionBounds(), count = String(f.editor.editorParts.minimizedCount);
	const painted: { x: number; y: number }[] = [];
	const paint = api.blit_text_inline_span_with_font.bind(api);
	const observe = t.mock.method(api, 'blit_text_inline_span_with_font', (...args: Parameters<typeof paint>) => {
		const [text, from, to, x, y] = args;
		if (text.slice(from, to) === count && y >= row.top && y < row.bottom) painted.push({ x: x + 1, y: y + 1 });
		paint(...args);
	});
	try { f.paint(); } finally { observe.mock.restore(); }
	assert.equal(painted.length, 1, 'one global status control publishes the actual minimized count');
	const point = painted[0], surface = f.editor.surfaces.hitTest(point.x, point.y);
	assert.ok(surface !== null && surface.role === 'content');
	return { ...point, surface };
}

function pointer(f: Fixture, point: { x: number; y: number }, down: boolean, timestamp: number) {
	f.editor.dispatchPointer({ x: point.x, y: point.y, buttons: down ? PointerButton.Primary : 0,
		pressedButtons: down ? PointerButton.Primary : 0, releasedButtons: down ? 0 : PointerButton.Primary,
		cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp });
	f.update();
}

test('status restore opens only on release, lists only minimized owners and Cancel returns to its actual invoker', t => {
	const f = createStatusFixture(t), parts = f.editor.editorParts, picker = f.editor.quickInput;
	f.first.focus(); parts.minimize(f.secondPart); f.update();
	const active = parts.activePart, text = f.firstInput.workingCopy.buffer.getText(), version = f.firstInput.workingCopy.version;
	const cycles = f.host.runtime.machine.scheduler.nowCycles, button = statusButton(t, f);
	pointer(f, button, true, 0);
	const invoker = inputFocus.target;
	assert.equal(picker.visible, false); assert.equal(f.secondPart.window!.model.minimized, true);
	assert.ok(parts.activePart === active && active === f.firstPart);
	pointer(f, button, false, 1);
	assert.equal(picker.visible, true); assert.equal(picker.model.list.rows.length, 1);
	const option = picker.model.list.rows[0].item;
	assert.ok('part' in option && option.part === f.secondPart);
	assert.ok(parts.activePart === active);
	f.key('Escape');
	assert.equal(picker.visible, false); assert.equal(f.secondPart.window!.model.minimized, true);
	assert.ok(inputFocus.target === invoker); assert.ok(parts.activePart === active);
	assert.equal(f.firstInput.workingCopy.buffer.getText(), text); assert.equal(f.firstInput.workingCopy.version, version);
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
});

test('choosing a minimized closing document restores its actual retained input and local decision', async t => {
	const f = createStatusFixture(t), parts = f.editor.editorParts, model = f.firstInput.workingCopy;
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- retained dirty document\n' }]);
	f.first.focus();
	const closing = parts.close(f.firstPart);
	t.after(() => f.firstPart.actionPrompt.close('cancel', false));
	assert.equal(f.firstPart.closing, true); assert.equal(f.firstPart.actionPrompt.visible, true);
	parts.minimize(f.firstPart); f.update();
	const text = model.buffer.getText(), version = model.version, cycles = f.host.runtime.machine.scheduler.nowCycles;
	const button = statusButton(t, f);
	pointer(f, button, true, 0); pointer(f, button, false, 1);
	const picker = f.editor.quickInput;
	assert.equal(picker.visible, true); assert.equal(picker.model.list.rows.length, 1);
	const option = picker.model.list.rows[0].item;
	assert.ok('part' in option && option.part === f.firstPart);
	f.key('Enter');
	assert.equal(picker.visible, false); assert.equal(f.firstPart.window!.model.minimized, false);
	assert.ok(parts.activePart === f.firstPart); assert.ok(inputFocus.target === f.firstPart.actionPrompt.focusTarget);
	assert.ok(f.firstGroup.model.activeTab === f.firstInput && f.firstGroup.panes.activePane === f.first);
	assert.equal(f.firstPart.actionPrompt.visible, true); assert.equal(f.firstPart.closing, true);
	assert.equal(model.buffer.getText(), text); assert.equal(model.version, version);
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
	f.key('Escape');
	assert.equal(await closing, false); assert.equal(f.firstPart.retired, false); assert.equal(model.dirty, true);
});

test('status count tracks actual membership and the last minimized close removes its pointer admission', async t => {
	const f = createStatusFixture(t), parts = f.editor.editorParts;
	parts.minimize(f.firstPart); parts.minimize(f.secondPart); f.update();
	assert.equal(parts.minimizedCount, 2);
	const button = statusButton(t, f);
	assert.equal(await parts.close(f.firstPart), true); f.update();
	assert.equal(parts.minimizedCount, 1);
	assert.ok(statusButton(t, f).surface === button.surface, 'count changes retain the existing global control');
	assert.equal(await parts.close(f.secondPart), true); f.update();
	assert.equal(parts.minimizedCount, 0); assert.equal(button.surface.visible, false);
	assert.equal(f.editor.surfaces.isAdmitted(button.surface), false);
	assert.equal(f.editor.commands.isEnabled('window.restoreMinimized'), false);
	pointer(f, button, true, 10); pointer(f, button, false, 11);
	assert.equal(f.editor.quickInput.visible, false);
});

test('foreground status discovery does not replace the live guest attachment or execute a frame', t => {
	const f = createStatusFixture(t), parts = f.editor.editorParts, game = new GameViewInput();
	parts.main.group.openEditor(game); parts.minimize(f.firstPart); parts.minimize(f.secondPart); f.update();
	const frame = game.frameBounds, preview = { x: (frame.left + frame.right) / 2, y: (frame.top + frame.bottom) / 2 };
	pointer(f, preview, true, 0); pointer(f, preview, false, 1);
	const guest = inputFocus.target!, binding = guest.guestInput!, scope = guest.scope;
	assert.ok(binding !== undefined && binding.recipient === f.host.input);
	const active = parts.activePart, cycles = f.host.runtime.machine.scheduler.nowCycles, button = statusButton(t, f);
	pointer(f, button, true, 20); pointer(f, button, false, 21);
	assert.equal(f.editor.quickInput.visible, true); assert.equal(f.editor.quickInput.model.list.rows.length, 2);
	assert.ok(guest.scope === scope && guest.guestInput === binding);
	assert.ok(parts.activePart === active); assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
	f.key('Escape');
	assert.equal(f.editor.quickInput.visible, false); assert.equal(parts.minimizedCount, 2);
	assert.ok(guest.scope === scope && guest.guestInput === binding); assert.ok(parts.activePart === active);
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
});

for (const variant of ['tiny', 'msx'] as const) test(`${variant} restore allocation stays between host fault and context within a narrow status row`, t => {
	const f = createStatusFixture(t), parts = f.editor.editorParts;
	f.editor.setFontVariant(variant); parts.minimize(f.secondPart); f.update();
	assert.equal(f.first.code.font.variant, variant);
	const button = statusButton(t, f), bounds = button.surface.getBounds(), requestedWidth = bounds.right - bounds.left;
	assert.ok(requestedWidth > 0);
	for (const width of [800, 256, 118, 35]) {
		f.editor.updateViewport({ width, height: 320 });
		for (const guest of [false, true]) for (const failed of [false, true]) {
			const layout = getWorkbenchStatusLayout(guest, failed, requestedWidth);
			const restore = layout.windowRestore, fault = layout.hostFault, context = layout.context, hint = layout.guestHint;
			// These are the owning allocation algorithm's geometry contracts, not a
			// workflow's incidental position: each slot owns disjoint available width.
			assert.equal(restore.left, fault.right); assert.equal(restore.right, context.left);
			assert.equal(context.right, hint.left); assert.equal(hint.right, layout.bounds.right);
			assert.ok(layout.bounds.left <= restore.left && restore.left <= restore.right && restore.right <= layout.bounds.right);
			assert.ok(context.left <= context.right && hint.left <= hint.right);
			assert.equal(restore.right - restore.left, Math.min(requestedWidth, layout.bounds.right - fault.right));
			assert.equal(restore.top, layout.connection.top); assert.equal(restore.bottom, layout.connection.bottom);
			for (let repeat = 0; repeat < 20; repeat++) {
				const retained = getWorkbenchStatusLayout(guest, failed, requestedWidth);
				assert.ok(retained === layout && retained.windowRestore === restore && retained.hostFault === fault
					&& retained.context === context && retained.guestHint === hint);
			}
		}
	}
});

test('the real status control clips both paint and pointer admission to its truncated restore allocation', t => {
	const f = createStatusFixture(t), parts = f.editor.editorParts;
	f.editor.setFontVariant('msx'); f.first.focus(); parts.minimize(f.secondPart); f.update();
	assert.equal(f.first.code.font.variant, 'msx');
	const button = statusButton(t, f), requestedWidth = button.surface.getBounds().right - button.surface.getBounds().left;
	f.ide.fault.hostFrameFailure = 'fixture host diagnostic';
	const faultEnd = getWorkbenchStatusLayout(false, true, requestedWidth).hostFault.right;
	const truncatedWidth = faultEnd + Math.trunc(requestedWidth / 2);
	f.host.presenter.setFixedRenderTargetSize(truncatedWidth, 320);
	f.ide.overlayRenderer.setViewportSize({ width: truncatedWidth, height: 320 });
	f.editor.updateViewport({ width: truncatedWidth, height: 320 }); f.update();
	const clip = button.surface.getClip(), bounds = button.surface.getBounds();
	const allocation = { ...getWorkbenchStatusLayout(false, true, requestedWidth).windowRestore };
	assert.deepEqual(clip, allocation);
	assert.ok(clip.right > clip.left && clip.right - clip.left < bounds.right - bounds.left,
		'the actual host-fault allocation truncates the intrinsic icon-and-count cell');
	const y = (clip.top + clip.bottom) / 2;
	assert.ok(f.editor.surfaces.hitTest((bounds.left + clip.left) / 2, y) !== button.surface,
		'the intrinsic control cannot take input from the adjacent host-fault slot');
	assert.ok(f.editor.surfaces.hitTest((clip.left + clip.right) / 2, y) === button.surface);
	const frame = f.paint();
	let currentClip: HostOverlayClipRect | undefined, paintedCount = 0;
	for (let index = 0; index < frame.commandCount; index++) {
		if (frame.commandKinds[index] === Host2DKind.Clip) currentClip = frame.commandRefs[index] as HostOverlayClipRect;
		else if (frame.commandKinds[index] === Host2DKind.Glyphs) {
			const glyph = frame.commandRefs[index] as GlyphRenderSubmission;
			if (glyph.items === '1' && glyph.y >= allocation.top && glyph.y < allocation.bottom) {
				paintedCount++; assert.deepEqual(currentClip, allocation, 'the emitted count uses the same named allocation as hit testing');
			}
		}
	}
	assert.equal(paintedCount, 1);
	f.editor.updateViewport({ width: 35, height: 320 }); f.update();
	assert.ok(button.surface.getClip() === clip, 'viewport changes update the retained component clip in place');
	assert.equal(clip.left, clip.right, 'a host fault can consume the complete available restore slot');
	assert.ok(f.editor.surfaces.hitTest(clip.left - 1, y) !== button.surface);
});
