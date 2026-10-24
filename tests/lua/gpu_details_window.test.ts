import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { IO_GX_GPU_GP0, IO_GX_GPU_GP1 } from '../../machine/ts/spec/bmsx/io';
import { configureFontVariant } from '../../ide/editor/ui/view/view';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { inputFocus } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { pointerHover } from '../../ide/input/pointer/hover';
import { RuntimeGpuHistory } from '../../ide/runtime/gpu_history';
import { updateFullWidthWorkbenchLayout } from '../../ide/workbench/common/layout';
import { GpuDetailsWindow } from '../../ide/workbench/contrib/gpu_debugger/details_window';
import { GpuDebuggerInput } from '../../ide/workbench/contrib/gpu_debugger/editor_input';
import { ContextMenuController } from '../../ide/workbench/services/context_menu/controller';
import { QuickInputController } from '../../ide/workbench/services/quick_input/controller';
import { WorkbenchSurfaceService } from '../../ide/workbench/services/windows/service';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { eventHistoryRuntime } from '../helpers/event_history';
import { createHostOverlayFixture } from '../helpers/host_overlay';
import { api } from '../../ide/runtime/overlay_api';
import { Host2DKind } from '../../machine/ts/render/host_overlay/commands';
import type { HostOverlayTransform } from '../../machine/ts/render/host_overlay/transform';
import type { GlyphRenderSubmission } from '../../machine/ts/render/shared/submissions';
import type { RectRenderSubmission } from '../../machine/ts/render/shared/submissions';

function fixture(t: TestContext, variant: 'tiny' | 'msx' = 'msx') {
	configureFontVariant(new VirtualHeadlessClock(), variant, null);
	const { runtime } = eventHistoryRuntime(createCartlibProgramHarness('return true').images);
	assert.equal(runtime.machine.scheduler.runCpuSlice(0, 10_000_000), RunResult.Halted);
	const history = new RuntimeGpuHistory(runtime, 2, 128), input = new GpuDebuggerInput(history);
	const write = (words: readonly number[]) => {
		for (const word of words) {
			runtime.machine.scheduler.advanceTo(runtime.machine.scheduler.currentNowCycles() + 1000);
			runtime.machine.memory.writeMappedWord(IO_GX_GPU_GP0, word);
		}
		runtime.machine.scheduler.advanceTo(runtime.machine.scheduler.currentNowCycles() + 1000);
		runtime.machine.memory.readMappedU32LE(IO_GX_GPU_GP1);
	};
	const emit = (color = 0x33) => write([0x60000000 | color, 0x00100010, 0x00040008]);
	emit(); input.update(); input.select(input.selected.sequence);
	const area = { left: 0, top: 24, right: 384, bottom: 274 };
	updateFullWidthWorkbenchLayout(input.layout, { ...area, bottom: 256 });
	const surfaces = new WorkbenchSurfaceService(), origin = inputFocus.createTarget();
	origin.bindKeyboard(() => {}); origin.focus();
	const owner = surfaces.attach({ role: 'content', captureScope: origin.scope.surfaceScope, isVisible: () => true,
		getBounds: () => area, getClip: () => area, draw() {} });
	const menu = new ContextMenuController(inputFocus, pointerCapture), picker = new QuickInputController(menu);
	let formats = 0;
	const createDetails = () => {
		const window = new GpuDetailsWindow(input, {
			isEnabled: (command, target) => inputFocus.getCommand(command, target)?.isEnabled() === true,
			execute: (command, target) => inputFocus.executeCommand(command, target),
		}, picker, menu, surfaces, owner, origin, area);
		const format = window.presentation.details.bind(window.presentation);
		t.mock.method(window.presentation, 'details', record => { formats++; return format(record); });
		return window;
	};
	const details = createDetails();
	t.after(() => { details.dispose(); picker.dispose(); menu.hide(); inputFocus.setTarget(null); pointerCapture.cancel(); pointerHover.clear(); surfaces.dispose(); input.dispose(); history.dispose(); });
	const press = (code: string) => {
		inputFocus.handleKeyboard(new KeyInputEvent(code, KeyModifier.none, false, true));
		inputFocus.handleKeyboard(new KeyInputEvent(code, KeyModifier.none, false, false));
	};
	const choose = (label: string) => {
		details.chooseView();
		picker.model.list.selectionIndex = picker.model.list.rows.findIndex(row => row.item.label === label);
		assert.ok(picker.model.list.selectionIndex >= 0); picker.accept(); details.update();
	};
	return { runtime, input, history, emit, write, area, surfaces, owner, origin, details, createDetails, picker, menu, choose, formats: () => formats, press };
}

for (const variant of ['tiny', 'msx'] as const) test(`GPU ${variant} Details is an owned modeless client with icon chrome and no idle formatting or measurements`, t => {
	const f = fixture(t, variant), { input, details } = f;
	assert.equal(input.detailsWindow.open, false); details.update(); assert.equal(f.formats(), 0);
	details.show();
	assert.equal(input.detailsWindow.open, true); assert.equal(f.formats(), 1);
	assert.equal(details.window.surface!.role, 'window'); assert.equal(details.window.surface!.lifetimeOwner, f.owner);
	assert.equal(details.window.clientSurface!.presentationParent, details.window.surface);
	assert.equal(details.inspector.chrome, 'client'); assert.equal(details.inspector.actionBar.items.some(item => item.visible), false);
	assert.equal(input.detailsWindow.title, 'Rectangle #0');
	assert.equal(input.detailsWindow.requestedBounds.bottom, input.layout.bottom - 4, 'initial placement preserves shared timeline controls');
	assert.equal(input.detailsActions.items.every(item => item.icon !== undefined), true);
	const rows = details.inspector.model.rows, first = rows[0].element;
	const advance = editorViewState.font.advance.bind(editorViewState.font);
	let measures = 0;
	t.mock.method(editorViewState.font, 'advance', (...args: Parameters<typeof advance>) => { measures++; return advance(...args); });
	for (let frame = 0; frame < 1000; frame++) details.update();
	assert.equal(f.formats(), 1); assert.equal(measures, 0); assert.equal(details.inspector.model.rows, rows); assert.equal(rows[0].element, first);
	f.press('Escape');
	assert.equal(inputFocus.target, f.origin); assert.equal(input.detailsWindow.open, true, 'Escape returns focus without closing modeless Details');
	assert.equal(details.inspector.visible, true);
});

test('GPU Details preserves one observation through expiry and shows explicit empty selection after Clear', t => {
	const f = fixture(t), { input, details } = f; details.show();
	const word = input.selected.words[0], rows = details.inspector.model.rows, first = rows[0].element;
	f.emit(0x44); f.emit(0x55); input.update(); details.update();
	assert.equal(input.selected.sequence, 0); assert.equal(input.selected.words[0], word);
	assert.match(input.detailsWindow.title, /expired/);
	assert.equal(f.formats(), 1, 'ring retirement does not re-copy or format an owned pinned observation');
	assert.equal(details.inspector.model.rows[0].element, first);
	input.select(input.history.firstSequence); details.update();
	assert.equal(f.formats(), 2); assert.notEqual(input.selected.words[0], word);
	assert.equal(details.inspector.model.rows, rows, 'client retirement preserves the model owner, not its obsolete row identity');
	assert.notEqual(details.inspector.model.rows[0].element, first); assert.doesNotMatch(input.detailsWindow.title, /expired/);
	input.clear(); input.update(); details.update();
	assert.equal(input.detailsWindow.open, true); assert.equal(input.selected.sequence, -1); assert.equal(input.selected.wordCount, 0);
	assert.equal(input.detailsWindow.title, 'GPU Inspector');
	assert.deepEqual(details.inspector.model.rows.map(row => row.element.label), ['No operation selected']);
	assert.equal(f.formats(), 2, 'an absent operation is its own document, not decoded stale packet words');
	inputFocus.executeCommand('window.hide', details.inspector.focusTarget);
	assert.equal(input.detailsWindow.open, false); assert.equal(details.inspector.visible, false);
});

test('GPU collapse and close retain view bookmarks, but a newer selected observation cannot inherit a stale client bookmark', t => {
	const f = fixture(t), { input, details } = f; details.show();
	const last = details.inspector.model.rows.length - 1;
	details.inspector.model.select(last);
	const anchor = details.inspector.model.rowAt(details.inspector.model.viewport.bounds.top), scroll = details.inspector.model.viewport.scrollTop, requested = { ...input.detailsWindow.requestedBounds };
	details.window.setCollapsed(true);
	assert.equal(details.inspector.visible, false); assert.equal(input.detailsView.selectionIndex, last); assert.equal(input.detailsView.anchorIndex, anchor);
	for (let frame = 0; frame < 1000; frame++) details.update();
	assert.equal(f.formats(), 1);
	details.window.setCollapsed(false);
	assert.equal(details.inspector.model.viewport.scrollTop, scroll, 'restoration finishes during the actual client reflow, not a later paint');
	assert.equal(details.inspector.model.selectionIndex, last);
	details.inspector.focusTarget.focus(); f.press('Home'); details.update();
	assert.equal(details.inspector.model.selectionIndex, 0);
	assert.equal(details.inspector.model.viewport.scrollTop, 0, 'later keyboard navigation is not overwritten by an old restore request');
	details.window.hide(); assert.equal(input.detailsWindow.open, false); assert.deepEqual(input.detailsWindow.requestedBounds, requested);
	details.show(); assert.equal(f.formats(), 1);
	details.inspector.model.select(last);
	f.emit(0x77); input.update(); input.select(input.history.endSequence - 1);
	details.window.setCollapsed(true); // A new input occurrence can precede its first paint.
	assert.equal(input.detailsView.selectionIndex, 0); assert.equal(input.detailsView.anchorIndex, 0);
	details.window.setCollapsed(false); details.update();
	assert.equal(details.inspector.model.selectionIndex, 0); assert.equal(f.formats(), 2);
	assert.deepEqual(input.detailsWindow.requestedBounds, requested);
});

test('GPU Words exposes the complete upload and keeps its selection independent of Properties bookmarks', t => {
	const f = fixture(t), { input, details } = f; details.show(); details.window.setCollapsed(true);
	f.write([0xa0000000, 0, 0x0001008c, ...Array.from({ length: 70 }, (_, index) => 0x11110000 | index)]);
	input.update(); input.select(input.history.endSequence - 1); input.selectedWord = 65;
	assert.equal(input.selected.wordCount, 73);
	details.window.setCollapsed(false); details.update();
	assert.equal(details.inspector.model.rows.find(row => row.element.label === 'Words')!.element.value, '73');
	assert.equal(details.inspector.model.rows.some(row => row.element.label.startsWith('Word[')), false);
	details.inspector.model.select(details.inspector.model.rows.length - 1);
	const selected = details.inspector.model.selectionIndex, scroll = details.inspector.model.viewport.scrollTop;
	f.choose('Words'); assert.equal(input.inspectorPage, 'words'); assert.equal(details.inspector.visible, false);
	f.press('End'); details.update(); assert.equal(input.selectedWord, 72);
	assert.equal(details.words.focusTarget.clipboard!.copy(), '11110045h');
	assert.equal(input.words.contentHeight, 73 * editorViewState.lineHeight);
	input.selectedWord = 65; f.choose('Properties');
	assert.equal(details.inspector.model.selectionIndex, selected); assert.equal(details.inspector.model.viewport.scrollTop, scroll);
	assert.equal(input.selected.words[65], 0x1111003e); assert.equal(f.formats(), 2);
});


test('GPU pane detachment restores the retained page document instead of mistaking a fresh control for a page change', t => {
	const f = fixture(t), { input, details } = f;
	details.show(); details.inspector.model.select(details.inspector.model.rows.length - 1);
	const selected = details.inspector.model.selectionIndex, scroll = details.inspector.model.viewport.scrollTop;
	details.dispose();
	const restored = f.createDetails(); t.after(() => restored.dispose()); restored.update();
	assert.equal(restored.inspector.model.selectionIndex, selected);
	assert.equal(restored.inspector.model.viewport.scrollTop, scroll);
	restored.window.setCollapsed(true); configureFontVariant(new VirtualHeadlessClock(), 'tiny', null); restored.update();
	restored.window.setCollapsed(false); restored.update();
	const row = restored.inspector.model.rows[selected], view = restored.inspector.model.viewport;
	assert.ok(view.offsetTop + row.top < view.bounds.bottom && view.offsetTop + row.bottom > view.bounds.top);
	assert.equal(input.detailsWindow.open, true);
});

test('GPU Words preserves its independently scrolled word/fraction through both fonts and controller recreation', t => {
	const f = fixture(t), { input, details } = f;
	f.write([0xa0000000, 0, 0x0001008c, ...Array.from({ length: 70 }, (_, index) => 0x11110000 | index)]);
	input.update(); input.select(input.history.endSequence - 1); input.inspectorPage = 'words'; details.show();
	const decode = t.mock.method(details.presentation, 'update');
	assert.equal(input.selected.wordCount, 73); assert.equal(f.formats(), 0, 'Words does not create a decoded Properties document');
	input.words.scrollbar.setScroll(17.5 * editorViewState.lineHeight);
	const selected = input.selectedWord;
	for (const variant of ['tiny', 'msx'] as const) {
		configureFontVariant(new VirtualHeadlessClock(), variant, null); details.update();
		assert.equal(input.words.scrollTop / editorViewState.lineHeight, 17.5, 'font reflow retains the first logical word and within-row fraction');
		assert.equal(input.selectedWord, selected, 'reading with the wheel does not retarget word selection');
	}
	assert.equal(decode.mock.callCount(), 0, 'Words and font reflow never decode fabricated geometry');
	details.dispose(); const restored = f.createDetails(); t.after(() => restored.dispose()); restored.update();
	assert.equal(input.words.scrollTop / editorViewState.lineHeight, 17.5, 'a fresh control cannot reveal a stale selectedWord over the retained reading anchor');
	assert.equal(input.selectedWord, selected);
});

test('GPU Diagram keeps the same source-text anchor through a wrapping font round trip without user scrolling', t => {
	const f = fixture(t), { input, details } = f;
	input.inspectorPage = 'diagram'; details.show();
	const requested = input.detailsWindow.requestedBounds;
	input.detailsWindow.setRequestedBounds({ left: requested.right - input.detailsWindow.minimumWidth, top: requested.bottom - input.detailsWindow.minimumHeight,
		right: requested.right, bottom: requested.bottom }); details.update();
	input.diagram.scrollbar.setScroll(editorViewState.lineHeight);
	details.canvas.saveViewState(input.diagram, input.diagramView);
	assert.equal(input.diagramView.section, 0); assert.ok(input.diagramView.textOffset > 0, 'the actual operation heading wrapped at this supported width');
	const before = input.diagram.scrollTop, offset = input.diagramView.textOffset;
	configureFontVariant(new VirtualHeadlessClock(), 'tiny', null); details.update();
	assert.equal(input.diagramView.textOffset, offset);
	configureFontVariant(new VirtualHeadlessClock(), 'msx', null); details.update();
	assert.equal(input.diagramView.textOffset, offset, 'reflow projection cannot replace the source-text anchor with the new line start');
	assert.equal(input.diagram.scrollTop, before, 'returning to the original font restores the same logical reading location');
	configureFontVariant(new VirtualHeadlessClock(), 'tiny', null); details.update(); details.dispose();
	const restored = f.createDetails(); t.after(() => restored.dispose()); restored.update();
	configureFontVariant(new VirtualHeadlessClock(), 'msx', null); restored.update();
	assert.equal(input.diagramView.textOffset, offset, 'retiring a reflowed client preserves the original character identity');
	assert.equal(input.diagram.scrollTop, before);
	restored.diagram.focusTarget.focus(); f.press('End');
	for (const variant of ['tiny', 'msx'] as const) {
		configureFontVariant(new VirtualHeadlessClock(), variant, null); restored.update();
		assert.equal(input.diagram.scrollTop, input.diagram.scrollbar.getMaximumScroll(), 'End keeps the last actual annotation in view across reflow');
	}
	f.press('Home'); assert.equal(input.diagram.scrollTop, 0);
	for (const variant of ['tiny', 'msx'] as const) {
		configureFontVariant(new VirtualHeadlessClock(), variant, null); restored.update();
		assert.equal(input.diagram.scrollTop, 0, 'Home is the logical origin, not the heading padding');
	}
	restored.dispose(); const origin = f.createDetails(); t.after(() => origin.dispose()); origin.update();
	assert.equal(input.diagram.scrollTop, 0, 'recreating a client at Home cannot introduce a synthetic pixel offset');
});

for (const variant of ['tiny', 'msx'] as const) test(`GPU ${variant} diagram keeps paint and point hit mapping aligned while scrolling and moving without idle layout work`, t => {
	const f = fixture(t, variant), { input, details } = f;
	input.inspectorPage = 'diagram'; details.show();
	const requested = input.detailsWindow.requestedBounds;
	input.detailsWindow.setRequestedBounds({ left: requested.right - input.detailsWindow.minimumWidth,
		top: requested.bottom - input.detailsWindow.minimumHeight, right: requested.right, bottom: requested.bottom }); details.update();
	assert.equal(details.inspector.visible, false); assert.equal(f.formats(), 0);
	const overlay = createHostOverlayFixture(384, 288);
	for (const point of details.canvas.points) {
		assert.ok(input.diagram.offsetTop + point.y >= input.diagram.bounds.top && input.diagram.offsetTop + point.y < input.diagram.bounds.bottom,
			'the minimum-height Home viewport shows the actual plot points instead of a clipped thumbnail');
	}
	const click = (index: number) => {
		const point = details.canvas.points[index], x = input.diagram.bounds.left + point.x, y = input.diagram.offsetTop + point.y;
		assert.equal(f.surfaces.hitTest(x, y), details.window.clientSurface);
		details.window.clientSurface!.handlePointer!({ valid: true, insideViewport: true, viewportX: x, viewportY: y,
			pressedButtons: PointerButton.Primary, justPressedButtons: PointerButton.Primary, justReleasedButtons: PointerButton.Primary,
			modifiers: KeyModifier.none, spaceDown: false }, 0);
		assert.equal(input.selectedPoint, index);
		overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer); f.surfaces.draw(api); overlay.renderer.endFrame();
		const frame = overlay.queue.consumeOverlayFrame(); let transformFound = false, labelFound = false;
		for (let command = 0; command < frame.commandCount; command++) {
			if (frame.commandKinds[command] === Host2DKind.Transform) {
				const transform = frame.commandRefs[command] as HostOverlayTransform;
				if (transform.scale === 1 && transform.offsetX === input.diagram.bounds.left && transform.offsetY === input.diagram.offsetTop) transformFound = true;
			} else if (frame.commandKinds[command] === Host2DKind.Glyphs) {
				const glyph = frame.commandRefs[command] as GlyphRenderSubmission;
				if (glyph.items === `V${index}` && glyph.x === point.x + 5 && glyph.y === point.y - editorViewState.lineHeight) labelFound = true;
			}
		}
		assert.equal(transformFound, true); assert.equal(labelFound, true, 'paint publishes the same local point and scroll transform used for hit testing');
	};
	click(0); input.diagram.scrollbar.setScroll(4); click(3);
	const layout = t.mock.method(details.canvas, 'layout'), advance = t.mock.method(editorViewState.font, 'advance');
	for (let frame = 0; frame < 1000; frame++) details.update();
	assert.equal(layout.mock.callCount(), 0); assert.equal(advance.mock.callCount(), 0);
	const bounds = input.detailsWindow.requestedBounds;
	input.detailsWindow.setRequestedBounds({ left: bounds.left - 2, top: bounds.top - 2, right: bounds.right - 2, bottom: bounds.bottom - 2 }); details.update();
	assert.equal(layout.mock.callCount(), 0, 'moving only changes the paint/input transform'); click(2);
	assert.equal(input.selected.sequence, 0);
});

test('GPU selection producer retires its owned chooser and active capture before replacing words, without hiding a newer picker', t => {
	const f = fixture(t), { input, details } = f; input.inspectorPage = 'diagram'; details.show();
	const bounds = input.detailsWindow.requestedBounds;
	input.detailsWindow.setRequestedBounds({ left: bounds.right - input.detailsWindow.minimumWidth,
		top: bounds.bottom - input.detailsWindow.minimumHeight, right: bounds.right, bottom: bounds.bottom }); details.update();
	const thumb = input.diagram.scrollbar.getThumb()!;
	assert.ok(thumb !== null, 'actual annotations exceed the minimum diagram viewport');
	details.window.clientSurface!.handlePointer!({ valid: true, insideViewport: true, viewportX: thumb.left + 1, viewportY: thumb.top + 1,
		pressedButtons: PointerButton.Primary, justPressedButtons: PointerButton.Primary, justReleasedButtons: 0, modifiers: KeyModifier.none, spaceDown: false }, 0);
	assert.equal(pointerCapture.active, true);
	const oldSequence = input.selected.sequence, oldWord = input.selected.words[0];
	f.emit(0x77); input.update();
	const unbind = input.onWillChangeSelection(() => {
		assert.equal(input.selected.sequence, oldSequence); assert.equal(input.selected.words[0], oldWord);
		assert.equal(pointerCapture.active, false, 'old capture retires before the owning snapshot words change');
	});
	input.select(input.history.endSequence - 1); unbind(); details.update();
	details.chooseView(); assert.equal(f.picker.visible, true);
	f.emit(0x88); input.update(); input.select(input.history.endSequence - 1);
	assert.equal(f.picker.visible, false, 'a physical range/view choice cannot outlive its observation'); details.update();
	details.chooseView();
	f.picker.input('Other owner', '', '', async value => value, () => {});
	f.emit(0x99); input.update(); input.select(input.history.endSequence - 1);
	assert.equal(f.picker.visible, true, 'the retired observation cannot close a replacement picker owned elsewhere'); f.picker.hide();
});

for (const variant of ['tiny', 'msx'] as const) test(`GPU ${variant} untextured Fill UV and cleared Diagram expose textual evidence without inventing a plot`, t => {
	const f = fixture(t, variant), { input, details } = f;
	f.write([0x02000080, 0x00100010, 0x00040008]); input.update(); input.select(input.history.endSequence - 1);
	input.inspectorPage = 'diagram'; input.view = 'uv'; details.show();
	const overlay = createHostOverlayFixture(384, 288);
	const paint = () => {
		overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer); f.surfaces.draw(api); overlay.renderer.endFrame();
		return overlay.queue.consumeOverlayFrame();
	};
	const check = (expected: string) => {
		const frame = paint(), glyphs: GlyphRenderSubmission[] = [], rects: RectRenderSubmission[] = [];
		for (let index = 0; index < frame.commandCount; index++) {
			if (frame.commandKinds[index] === Host2DKind.Glyphs) glyphs.push(frame.commandRefs[index] as GlyphRenderSubmission);
			else if (frame.commandKinds[index] === Host2DKind.Rect) rects.push(frame.commandRefs[index] as RectRenderSubmission);
		}
		assert.equal(input.inspectorPage, 'diagram'); assert.equal(input.view, 'uv'); assert.equal(details.canvas.points.length, 0);
		const bodyText = glyphs.filter(run => run.x === 4 && run.y >= 0 && run.y < input.diagram.height).map(run => run.items).join(' ');
		assert.ok(bodyText.includes(expected), 'the complete measured absent-operands explanation is visible at Home');
		assert.equal(rects.some(rect => rect.area.left === 4 && rect.area.right === input.diagram.bounds.right - input.diagram.bounds.left - 4
			&& rect.area.top >= 0 && rect.area.bottom > rect.area.top), false, 'no plot rectangle is published when no graphical operands exist');
		assert.ok(details.canvas.contentHeight <= input.diagram.height, 'absence text does not reserve an empty graphic-height spacer');
	};
	check('No texture coordinates in this operation.');
	input.clear(); input.update(); details.update(); check('No operation selected');
	assert.equal(input.selected.sequence, -1); assert.equal(input.detailsWindow.open, true);
});

test('GPU Clear keeps the Words page open with an explicit absent-observation message', t => {
	const f = fixture(t), { input, details } = f;
	f.write([0xa0000000, 0, 0x0001008c, ...Array.from({ length: 70 }, (_, index) => 0x11110000 | index)]);
	input.update(); input.select(input.history.endSequence - 1); input.inspectorPage = 'words'; details.show();
	f.press('End'); details.update(); assert.equal(input.selectedWord, 72);
	input.clear(); input.update(); details.update();
	const overlay = createHostOverlayFixture(384, 288);
	overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer); f.surfaces.draw(api); overlay.renderer.endFrame();
	const frame = overlay.queue.consumeOverlayFrame(), glyphs: GlyphRenderSubmission[] = [];
	for (let index = 0; index < frame.commandCount; index++) if (frame.commandKinds[index] === Host2DKind.Glyphs)
		glyphs.push(frame.commandRefs[index] as GlyphRenderSubmission);
	assert.equal(input.inspectorPage, 'words'); assert.equal(input.selected.sequence, -1); assert.equal(input.selected.wordCount, 0);
	assert.ok(glyphs.some(run => run.items === 'No operation selected'));
	assert.equal(glyphs.some(run => run.items === '000048h  11110045h'), false, 'Clear cannot paint the retired final payload word');
	assert.equal(details.words.focusTarget.clipboard!.copy(), null);
});
