import { PointerButton } from '../../ide/input/pointer/buttons';
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { configureFontVariant } from '../../ide/editor/ui/view/view';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { TextField } from '../../ide/editor/ui/inline/text_field_model';
import { insertValue, selectAll, setCursorFromOffset, setFieldText } from '../../ide/editor/ui/inline/text_field';
import { SingleLineFieldViewport } from '../../ide/editor/ui/inline/single_line_viewport';
import { inputFocus } from '../../ide/input/focus';
import { QuickInputController } from '../../ide/workbench/services/quick_input/controller';
import { QuickPickModel } from '../../ide/workbench/services/quick_input/model';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { OverlayRenderer } from '../../ide/runtime/overlay_renderer';
import { api } from '../../ide/runtime/overlay_api';
import { HeadlessGPUBackend } from '../../machine/ts/render/headless/backend';
import { HeadlessVideoOutput } from '../../hosts/node/headless/video_output';
import { VideoPresenter } from '../../machine/ts/render/video_presenter';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { Host2DKind } from '../../machine/ts/render/host_overlay/commands';
import type { GlyphRenderSubmission } from '../../machine/ts/render/shared/submissions';
import * as constants from '../../ide/common/constants';
import { resolveThemeTokenColor } from '../../ide/theme/tokens';
import { EditorTextModel } from '../../ide/editor/model/text_model';

const items = [
	{ label: 'scenes/root.lua', description: 'LUA / SLOT 0', detail: 'root', resourceId: 10 },
	{ label: 'scenes/root.lua', description: 'LUA / SLOT 1', detail: 'root', resourceId: 20 },
	{ label: 'title_screen.lua', description: 'LUA / SLOT 0', detail: 'title_screen', resourceId: 30 },
];

function createPicker(t: TestContext): QuickInputController {
	configureFontVariant(new VirtualHeadlessClock(), 'tiny', null);
	editorViewState.viewportWidth = 384;
	editorViewState.viewportHeight = 288;
	const picker = new QuickInputController({ text: '', isSupported: () => false, writeText: async () => {} });
	t.after(() => { picker.dispose(); inputFocus.setTarget(null); });
	return picker;
}

test('source-bound quick input cancels its snapshot on content change and releases the subscription', t => {
	const picker = createPicker(t);
	const model = new EditorTextModel({ domain: 0, path: 'proof.lua', source: { resid: 'proof', type: 'lua' } }, 'lua', 'return 1');
	const origin = inputFocus.createTarget();
	origin.focus();
	let invalidations = 0;
	picker.pick('Source', 'Filter', (_focus, disposables) => {
		disposables.add({ dispose: model.onDidChangeContent(() => { invalidations += 1; picker.hide(); }) });
		return items;
	}, () => assert.fail('invalidated source accepted'));
	model.pushEditOperations([{ offset: 7, deleteLength: 1, text: '2' }]);
	assert.equal(picker.visible, false);
	assert.equal(inputFocus.target, origin);
	assert.equal(invalidations, 1);
	picker.pick('Files', 'Filter', () => items, () => {});
	model.undo();
	assert.equal(picker.visible, true, 'the expired source session cannot hide a newer unrelated picker');
	assert.equal(invalidations, 1);
});

test('quick input session resources end before accept, replacement, blur, cancellation and disposal', t => {
	const picker = createPicker(t);
	for (const route of ['accept', 'replacement', 'blur', 'cancel', 'dispose'] as const) {
		const origin = inputFocus.createTarget();
		origin.focus();
		let disposals = 0;
		picker.pick('Scoped', 'Filter', (_focus, disposables) => {
			disposables.add({ dispose: () => { disposals += 1; } });
			return items;
		}, () => { assert.equal(route, 'accept'); assert.equal(disposals, 1, 'cleanup precedes source navigation'); });
		if (route === 'accept') picker.accept();
		else if (route === 'replacement') {
			picker.pick('New', 'Filter', () => { assert.equal(disposals, 1); return items; }, () => {});
			picker.hide();
		} else if (route === 'blur') inputFocus.createTarget().focus();
		else if (route === 'cancel') picker.hide();
		else picker.dispose();
		assert.equal(disposals, 1, route);
	}
});

test('quick pick filtering retains caller items, rows and result storage across queries', () => {
	const model = new QuickPickModel();
	model.setItems(items);
	const retained = model.entries.slice();
	const rows = model.list.rows;
	model.filter('');
	assert.deepEqual(rows, retained);
	assert.equal(model.list.selectionIndex, 0);
	model.filter(' ROOT  slot 1 ');
	assert.equal(model.list.rows, rows);
	assert.equal(rows.length, 1);
	assert.equal(rows[0], retained[1]);
	assert.equal(rows[0].item, items[1]);
	assert.equal(rows[0].itemIndex, 1);
	model.filter('absent');
	assert.equal(rows.length, 0);
	assert.equal(model.list.selectionIndex, -1);
	model.filter('root');
	assert.deepEqual(rows, retained.slice(0, 2), 'same-named items remain distinct and stable');
	model.filter('');
	assert.deepEqual(rows, retained);
});

test('quick pick ranks query matches deterministically without excluding later catalog items', () => {
	const model = new QuickPickModel();
	const catalog = Array.from({ length: 600 }, (_, index) => ({ label: `module_${index}.lua`, description: 'LUA', detail: '' }));
	model.setItems(catalog);
	model.filter('module_599');
	assert.equal(model.list.rows[0].item, catalog[599]);
	model.filter('module_5');
	assert.equal(model.list.rows[0].item, catalog[5], 'shorter matching labels rank first');
	model.filter('');
	assert.equal(model.list.rows.length, 600, 'viewport capacity is not a query/catalog limit');
});

test('quick input owns root focus; cancellation returns to the actual invoking control', t => {
	const picker = createPicker(t);
	const pane = inputFocus.createTarget();
	const property = new TextField(pane);
	property.focusTarget.focus();
	picker.pick('Files', 'Filter', () => items, () => assert.fail('cancel accepted an item'));
	assert.equal(picker.field.focusTarget.parent, null);
	assert.equal(inputFocus.target, picker.field.focusTarget);
	picker.hide();
	assert.equal(inputFocus.target, property.focusTarget);
	assert.equal(picker.visible, false);
	assert.equal(picker.model.entries.length, 0);
});

test('quick input blur does not restore a departing pane over the new focus owner', t => {
	const picker = createPicker(t);
	const first = inputFocus.createTarget();
	const next = inputFocus.createTarget();
	first.focus();
	picker.pick('Files', 'Filter', () => items, () => assert.fail('blur accepted an item'));
	next.focus();
	assert.equal(picker.visible, false);
	assert.equal(inputFocus.target, next);
});

test('item providers observe the invoking control after blur, not the replaced query context', t => {
	const picker = createPicker(t);
	const origin = inputFocus.createTarget();
	let blurs = 0;
	let provisions = 0;
	origin.onDidBlur(() => { blurs += 1; });
	origin.focus();
	picker.pick('Old', 'Filter', () => items, () => assert.fail('old picker accepted'));
	insertValue(picker.field, 'old query');
	picker.pick('Commands', 'Filter', focus => {
		provisions += 1;
		assert.equal(focus, origin);
		assert.equal(blurs, 2, 'replace restores origin, then its new blur precedes admission');
		assert.equal(inputFocus.target, picker.field.focusTarget, 'provider receives context explicitly without focus swapping');
		return items;
	}, item => {
		assert.equal(item, items[0]);
		assert.equal(inputFocus.target, origin, 'execution happens in the restored invoking context');
	});
	picker.model.filter('root');
	picker.update();
	picker.update();
	assert.equal(provisions, 1, 'typing and draw frames do not rebuild the command catalog');
	assert.equal(picker.field.canUndo, false, 'replaced query history does not leak into the new session');
	picker.accept();
});

test('quick input replacement and acceptance hide before handing the exact typed item to navigation', t => {
	const picker = createPicker(t);
	const original = inputFocus.createTarget();
	const destination = inputFocus.createTarget();
	original.focus();
	picker.pick('Old', 'Filter', () => items, () => assert.fail('replaced picker accepted'));
	let accepted = 0;
	picker.pick('New', 'Filter', () => items, item => {
		assert.equal(item, items[1]);
		assert.equal(item.resourceId, 20);
		assert.equal(picker.visible, false);
		assert.equal(inputFocus.target, original);
		accepted += 1;
		destination.focus();
	});
	insertValue(picker.field, 'no results');
	picker.accept();
	assert.equal(accepted, 0);
	assert.equal(picker.visible, true);
	selectAll(picker.field);
	insertValue(picker.field, 'slot 1');
	picker.accept();
	assert.equal(accepted, 1);
	assert.equal(inputFocus.target, destination);
});

test('quick input Undo/Redo refilters only its field and never the invoking document', t => {
	const picker = createPicker(t);
	const document = inputFocus.createTarget();
	document.registerCommand('undo', { isEnabled: () => true, run: () => assert.fail('document Undo') });
	document.focus();
	picker.pick('Files', 'Filter', () => items, () => {});
	insertValue(picker.field, 'slot 1');
	assert.equal(picker.model.list.rows.length, 1);
	inputFocus.executeCommand('undo');
	assert.equal(picker.field.text, '');
	assert.equal(picker.model.list.rows.length, 3);
	inputFocus.executeCommand('undo');
	assert.equal(inputFocus.target, picker.field.focusTarget);
	inputFocus.executeCommand('redo');
	assert.equal(picker.model.list.rows[0].item, items[1]);
});

test('retained picker frames do not refilter, rebuild labels or measure the query again', t => {
	const picker = createPicker(t);
	picker.pick('Files', 'Filter', () => items, () => {});
	insertValue(picker.field, 'root');
	picker.update();
	const advances = picker.textViewport.advances;
	const row = picker.model.entries[0];
	t.mock.method(picker.model, 'filter', () => assert.fail('idle filter'));
	t.mock.method(editorViewState.font, 'advance', () => assert.fail('idle text measurement'));
	for (let index = 0; index < 1000; index += 1) picker.update();
	assert.equal(picker.textViewport.advances, advances);
	assert.equal(picker.model.list.rows[0], row);
});

test('single-line viewport reveals the caret using whole proportional glyphs and refills after shrinking', () => {
	const field = new TextField();
	const view = new SingleLineFieldViewport();
	const font = {};
	let measurements = 0;
	const metrics = { advanceChar: (char: string) => { measurements += 1; return char === 'W' ? 7 : 3; }, spaceAdvance: 3, tabSpaces: 4 };
	setFieldText(field, 'WiWiWiWiWiWiWiWi', true);
	view.update(field, 23, metrics, font);
	assert.ok(view.start > 0);
	assert.equal(view.end, field.text.length);
	assert.ok(view.advances[field.cursorColumn] + view.caretWidth - view.offset <= 23);
	const measured = measurements;
	view.update(field, 23, metrics, font);
	assert.equal(measurements, measured);
	setCursorFromOffset(field, 0);
	view.update(field, 23, metrics, font);
	assert.equal(view.start, 0);
	assert.equal(view.end, 4);
	setCursorFromOffset(field, field.text.length);
	view.update(field, 90, metrics, font);
	assert.equal(view.start, 0);
	setFieldText(field, 'Wi', true);
	view.update(field, 23, metrics, font);
	assert.equal(view.start, 0);
	assert.equal(view.end, 2);
});

test('query pointer hit testing uses the scrolled text origin, not an unrelated code column', t => {
	const picker = createPicker(t);
	picker.pick('Files', 'Filter', () => items, () => {});
	insertValue(picker.field, 'scenes/root.lua '.repeat(30));
	picker.update();
	const start = picker.textViewport.start;
	assert.ok(start > 0);
	picker.handlePointer({ viewportX: picker.layout.field.left + 3, viewportY: picker.layout.field.top + 3,
		valid: true, insideViewport: true, pressedButtons: PointerButton.Primary, justPressedButtons: 0, justReleasedButtons: 0 }, true);
	assert.equal(picker.field.cursorColumn, start);
	picker.handlePointer({ viewportX: picker.layout.field.left + 3, viewportY: picker.layout.field.top + 3,
		valid: true, insideViewport: true, pressedButtons: 0, justPressedButtons: 0, justReleasedButtons: 0 }, false);
	assert.equal(picker.field.pointerSelecting, false);
});

test('picker uses the actual tiny font and draws only a bounded span of an unbounded query', t => {
	const picker = createPicker(t);
	picker.pick('GO TO FILE', 'Type to filter files', () => items, () => {});
	insertValue(picker.field, 'very_long_query_'.repeat(50));
	picker.update();
	assert.equal(picker.field.text.length, 800);
	const presenter = new VideoPresenter(new HeadlessVideoOutput(384, 288),
		new HeadlessGPUBackend(384, 288, PSX_MACHINE_SPEC.gxGpuVramBytes), 384, 288);
	const queue = presenter.hostOverlayQueue;
	const renderer = new OverlayRenderer(queue);
	renderer.beginFrame(presenter);
	api.beginFrame(renderer);
	picker.draw();
	renderer.endFrame();
	const frame = queue.consumeOverlayFrame();
	let found = false;
	for (let index = 0; index < frame.commandCount; index += 1) {
		if (frame.commandKinds[index] !== Host2DKind.Glyphs) continue;
		const glyphs = frame.commandRefs[index] as GlyphRenderSubmission;
		assert.equal(glyphs.font, editorViewState.font.renderFont());
		if (glyphs.items === picker.field.text) {
			found = true;
			assert.equal(glyphs.item_start, picker.textViewport.start);
			assert.equal(glyphs.item_end, picker.textViewport.end);
			assert.ok(glyphs.x + editorViewState.font.measure(picker.field.text.slice(glyphs.item_start, glyphs.item_end)) <= picker.layout.field.right - 3);
		}
	}
	assert.ok(found, 'renderer consumes the original string, not a truncated query');
	const view = picker.textViewport;
	assert.ok(view.start > 0);
	assert.ok(view.advances[view.end] - view.offset <= picker.layout.field.right - picker.layout.field.left - 6);
	editorViewState.viewportWidth = 256;
	picker.update();
	assert.equal(picker.layout.bounds.right, 248);
	assert.ok(view.advances[picker.field.text.length] + view.caretWidth - view.offset <= 226);

	// The same retained surface must change both sides of the selection color pair.
	setFieldText(picker.field, '', true);
	picker.field.didChangeText();
	picker.update();
	t.after(() => constants.setIdeThemeVariant('light'));
	for (const theme of ['light', 'dark'] as const) {
		constants.setIdeThemeVariant(theme);
		renderer.beginFrame(presenter);
		api.beginFrame(renderer);
		picker.draw();
		renderer.endFrame();
		const frame = queue.consumeOverlayFrame();
		let selectedLabels = 0;
		for (let index = 0; index < frame.commandCount; index += 1) {
			if (frame.commandKinds[index] !== Host2DKind.Glyphs) continue;
			const glyphs = frame.commandRefs[index] as GlyphRenderSubmission;
			if (glyphs.y < picker.model.list.layout.contentTop || glyphs.y >= picker.model.list.layout.contentTop + picker.model.list.layout.rowHeight) continue;
			assert.equal(glyphs.color, resolveThemeTokenColor(constants.COLOR_QUICK_OPEN_SELECTION_TEXT));
			assert.notEqual(glyphs.color, resolveThemeTokenColor(constants.COLOR_QUICK_OPEN_SELECTION_BACKGROUND));
			selectedLabels += 1;
		}
		assert.equal(selectedLabels, 3, 'primary label, description and detail all use selected foreground');
	}
});
