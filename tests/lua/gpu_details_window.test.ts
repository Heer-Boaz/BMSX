import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
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
import { GpuDebugPresentation } from '../../ide/workbench/contrib/gpu_debugger/presentation';
import { WorkbenchSurfaceService } from '../../ide/workbench/services/windows/service';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { eventHistoryRuntime } from '../helpers/event_history';

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
	const presentation = new GpuDebugPresentation();
	let formats = 0;
	const details = new GpuDetailsWindow(input, {
		isEnabled: (command, target) => inputFocus.getCommand(command, target)?.isEnabled() === true,
		execute: (command, target) => inputFocus.executeCommand(command, target),
	}, surfaces, owner, origin, () => area, page => {
		formats++; presentation.update(input.selected, input.selectionRevision, input.view);
		return presentation.details(input.selected, page);
	});
	t.after(() => { details.dispose(); inputFocus.setTarget(null); pointerCapture.cancel(); pointerHover.clear(); surfaces.dispose(); input.dispose(); history.dispose(); });
	const press = (code: string) => {
		inputFocus.handleKeyboard(new KeyInputEvent(code, KeyModifier.none, false, true));
		inputFocus.handleKeyboard(new KeyInputEvent(code, KeyModifier.none, false, false));
	};
	return { runtime, input, history, emit, write, area, surfaces, owner, origin, details, formats: () => formats, press };
}

for (const variant of ['tiny', 'msx'] as const) test(`GPU ${variant} Details is an owned modeless client with icon chrome and no idle formatting or measurements`, t => {
	const f = fixture(t, variant), { input, details } = f;
	assert.equal(input.detailsWindow.open, false); details.update(); assert.equal(f.formats(), 0);
	details.show();
	assert.equal(input.detailsWindow.open, true); assert.equal(f.formats(), 1);
	assert.equal(details.window.surface!.role, 'window'); assert.equal(details.window.surface!.lifetimeOwner, f.owner);
	assert.equal(details.window.clientSurface!.presentationParent, details.window.surface);
	assert.equal(details.inspector.chrome, 'client'); assert.equal(details.inspector.actionBar.items.some(item => item.visible), false);
	assert.equal(input.detailsWindow.title, '#0 Rectangle');
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
	const word = input.selected.words[0], firstRow = details.inspector.model.rows[0], first = firstRow.element;
	f.emit(0x44); f.emit(0x55); input.update(); details.update();
	assert.equal(input.selected.sequence, 0); assert.equal(input.selected.words[0], word);
	assert.match(input.detailsWindow.title, /expired/);
	assert.equal(f.formats(), 1, 'ring retirement does not re-copy or format an owned pinned observation');
	assert.equal(details.inspector.model.rows[0].element, first);
	input.select(input.history.firstSequence); details.update();
	assert.equal(f.formats(), 2); assert.notEqual(input.selected.words[0], word);
	assert.equal(details.inspector.model.rows[0], firstRow, 'new observations reuse presentation rows without reusing their subject identity');
	assert.notEqual(details.inspector.model.rows[0].element, first); assert.doesNotMatch(input.detailsWindow.title, /expired/);
	input.clear(); input.update(); details.update();
	assert.equal(input.detailsWindow.open, true); assert.equal(input.selected.sequence, -1); assert.equal(input.selected.wordCount, 0);
	assert.equal(input.detailsWindow.title, 'GPU Details');
	assert.deepEqual(details.inspector.model.rows.map(row => row.element.label), ['No operation selected']);
	assert.equal(f.formats(), 2, 'an absent operation is its own document, not decoded stale packet words');
	inputFocus.executeCommand('window.hide', details.inspector.focusTarget);
	assert.equal(input.detailsWindow.open, false); assert.equal(details.inspector.visible, false);
});

test('GPU collapse and close retain view bookmarks, but a newer selected observation cannot inherit a stale client bookmark', t => {
	const f = fixture(t), { input, details } = f; details.show();
	const last = details.inspector.model.rows.length - 1;
	details.inspector.model.select(last);
	const scroll = details.inspector.model.viewport.scrollTop, requested = { ...input.detailsWindow.requestedBounds };
	details.window.setCollapsed(true);
	assert.equal(details.inspector.visible, false); assert.equal(input.detailsRow, last); assert.equal(input.detailsScroll, scroll);
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
	assert.equal(input.detailsRow, 0); assert.equal(input.detailsScroll, 0);
	details.window.setCollapsed(false); details.update();
	assert.equal(details.inspector.model.selectionIndex, 0); assert.equal(f.formats(), 2);
	assert.deepEqual(input.detailsWindow.requestedBounds, requested);
});

test('GPU Details raw-page changes use the owned upload words and retire the previous page bookmark', t => {
	const f = fixture(t), { input, details } = f; details.show(); details.window.setCollapsed(true);
	f.write([0xa0000000, 0, 0x0001008c, ...Array.from({ length: 70 }, (_, index) => 0x11110000 | index)]);
	input.update(); input.select(input.history.endSequence - 1); input.selectedWord = 65;
	assert.equal(input.selected.wordCount, 73);
	details.window.setCollapsed(false); details.update();
	assert.match(details.inspector.model.rows.find(row => row.element.label === 'Raw words')!.element.value, /Page 2\/2/);
	assert.equal(details.inspector.model.rows.find(row => row.element.label === 'Word[65]')!.element.value, '1111003Eh');
	details.inspector.model.select(details.inspector.model.rows.length - 1); details.window.setCollapsed(true);
	assert.ok(input.detailsRow > 0); assert.ok(input.detailsScroll > 0);
	input.selectedWord = 0; details.window.setCollapsed(false); details.update();
	assert.equal(details.inspector.model.selectionIndex, 0); assert.equal(details.inspector.model.viewport.scrollTop, 0);
	assert.equal(details.inspector.model.rows.some(row => row.element.label === 'Word[65]'), false);
	assert.match(details.inspector.model.rows.find(row => row.element.label === 'Raw words')!.element.value, /Page 1\/2/);
	assert.equal(input.selected.words[65], 0x1111003e); assert.equal(f.formats(), 3);
});
