import { TextQuickPickProvider } from '../../ide/workbench/services/quick_input/text_provider';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { Input } from '../../hosts/common/input/manager';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { HeadlessInputHub } from '../../hosts/node/headless/input';
import type { PointerSnapshot } from '../../ide/common/models';
import { inputFocus } from '../../ide/input/focus';
import { pointerCapture, PointerCaptureService, WORKBENCH_POINTER_SCOPE } from '../../ide/input/pointer/capture';
import { PointerButton } from '../../ide/input/pointer/buttons';
import { configureFontVariant } from '../../ide/editor/ui/view/view';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { insertValue } from '../../ide/editor/ui/inline/text_field';
import { QuickInputController } from '../../ide/workbench/services/quick_input/controller';
import type { QuickPickMatch } from '../../ide/workbench/services/quick_input/provider';

const PRIMARY = PointerButton.Primary;

function fixture(t: TestContext) {
	const clock = new VirtualHeadlessClock(), input = new Input(clock, new HeadlessInputHub(), -1);
	configureFontVariant(clock, 'tiny', null);
	editorViewState.viewportWidth = 384; editorViewState.viewportHeight = 288;
	const picker = new QuickInputController({ text: '', isSupported: () => false, writeText: async () => {} });
	const items = Array.from({ length: 100 }, (_, id) => ({ id, label: `row_${id}`, description: 'independent catalog', detail: `${id}` }));
	let accepted: typeof items[number] | undefined, pressId = 0;
	const open = () => picker.pick('Choose', 'Filter', () => new TextQuickPickProvider(items), item => { accepted = item; });
	const pointer = (x: number, y: number, held = 0, down = 0, up = 0) => {
		const snapshot: PointerSnapshot = { valid: true, insideViewport: true, viewportX: x, viewportY: y,
			pressedButtons: held, justPressedButtons: down, justReleasedButtons: up };
		if (!pointerCapture.dispatch(snapshot, false, clock.now(), picker.pointerScope)) picker.handlePointer(snapshot, down !== 0);
	};
	const key = (code: string, down: boolean) => {
		input.inputButton('keyboard:0', code, down, down ? 1 : 0, clock.now() + 1, ++pressId);
		clock.advance(20); input.pollInput(); inputFocus.handleKeyboard(input.getPlayerInput(1));
	};
	const press = (code: string) => { key(code, true); key(code, false); };
	open();
	t.after(() => { picker.dispose(); pointerCapture.cancel(); inputFocus.setTarget(null); });
	return { picker, items, open, pointer, key, press, clock, accepted: () => accepted };
}

test('chooser rows accept only a release on the captured admitted row, never pointer down or another row', t => {
	const { picker, items, pointer, accepted } = fixture(t), model = picker.model;
	const x = model.viewport.bounds.left + 5, y = model.viewport.bounds.top + 4;
	pointer(x, y, PRIMARY, PRIMARY);
	assert.equal(picker.visible, true); assert.equal(accepted(), undefined);
	assert.equal(pointerCapture.active, true);
	pointer(x, y + model.rowHeight, 0, 0, PRIMARY);
	assert.equal(picker.visible, true); assert.equal(accepted(), undefined);
	pointer(x, y, PRIMARY, PRIMARY);
	pointer(x, y, 0, 0, PRIMARY);
	assert.equal(picker.visible, false); assert.equal(accepted(), items[0]);
	assert.equal(pointerCapture.active, false);
});

test('chooser query, geometry, outside release and session changes cancel pending row activation', t => {
	const { picker, open, pointer, accepted } = fixture(t), model = picker.model;
	for (const change of ['query', 'geometry', 'outside', 'session'] as const) {
		const x = model.viewport.bounds.left + 5, y = model.viewport.bounds.top + 4;
		pointer(x, y, PRIMARY, PRIMARY);
		if (change === 'query') { insertValue(picker.field, 'row_99'); picker.update(); }
		if (change === 'geometry') { editorViewState.viewportWidth = 256; picker.update(); }
		if (change === 'session') open();
		pointer(change === 'outside' ? model.viewport.bounds.right + 20 : x, y, 0, 0, PRIMARY);
		assert.equal(accepted(), undefined, change);
		assert.equal(picker.visible, true, change);
		open();
	}
});

test('chooser scrollbar and fractional hit geometry share one axis while preserving the query focus', t => {
	const { picker, pointer } = fixture(t), model = picker.model, view = model.viewport;
	for (const variant of ['msx', 'tiny'] as const) {
		configureFontVariant(new VirtualHeadlessClock(), variant, null); picker.update();
		const thumb = view.scrollbar.getThumb()!;
		const x = thumb.left + 1, y = (thumb.top + thumb.bottom) / 2;
		pointer(x, y, PRIMARY, PRIMARY);
		assert.equal(inputFocus.target, picker.field.focusTarget);
		pointer(x, view.bounds.bottom - 2, PRIMARY);
		assert.ok(view.scrollTop > 0);
		assert.equal(inputFocus.target, picker.field.focusTarget);
		pointer(x, view.bounds.bottom - 2, 0, 0, PRIMARY);
		model.viewport.scrollbar.setScroll(model.rowHeight * 7.25);
		for (let pixel = view.bounds.top; pixel < view.bounds.bottom; pixel += 1) {
			const row = model.rowIndexAtPosition(view.bounds.left + 2, pixel);
			assert.ok(model.rowTop(row) <= pixel && model.rowTop(row) + model.rowHeight > pixel);
		}
		const rows = model.list.rows, first = rows[0], revision = view.revision;
		for (let frame = 0; frame < 100; frame += 1) picker.update();
		assert.equal(model.list.rows, rows); assert.equal(rows[0], first);
		assert.equal(view.revision, revision);
	}
});

test('Ctrl+Home/End reaches every result while unmodified Home/End still edits the query caret', t => {
	const { picker, key, press } = fixture(t), model = picker.model;
	insertValue(picker.field, 'row_'); picker.update();
	press('Home'); assert.equal(picker.field.cursorColumn, 0);
	press('End'); assert.equal(picker.field.cursorColumn, 4);
	key('ControlLeft', true); press('End'); key('ControlLeft', false);
	assert.equal(model.list.selectionIndex, 99);
	assert.ok(model.viewport.scrollTop > 0);
	assert.equal(picker.field.cursorColumn, 4);
	assert.ok(model.rowTop(99) + model.rowHeight <= model.viewport.bounds.bottom);
	key('ControlLeft', true); press('Home'); key('ControlLeft', false);
	assert.equal(model.list.selectionIndex, 0); assert.equal(model.viewport.scrollTop, 0);
	assert.equal(picker.field.cursorColumn, 4);
});

test('picker prepares visible rows lazily across scrolling, query replacement and font/width generations', t => {
	const { picker, key, press, clock, open } = fixture(t), model = picker.model;
	const presented = new Set<number>(), getRow = model.getRenderRow.bind(model);
	t.mock.method(model, 'getRenderRow', (match: QuickPickMatch) => { presented.add(match.itemIndex); return getRow(match); });
	open();
	const first = picker.layout.renderRows[0];
	assert.equal(presented.size, model.endVisibleIndex);
	assert.equal(presented.has(50), false); assert.equal(presented.has(99), false);
	key('ControlLeft', true); press('End'); key('ControlLeft', false); picker.update();
	const last = picker.layout.renderRows[picker.layout.renderRows.length - 1];
	assert.equal(last.labelText, last.item.label);
	assert.equal(presented.has(99), true);
	assert.equal(presented.has(50), false, 'scrolling does not prepare the invisible catalog between endpoints');
	const oldRevision = first.textRevision;
	configureFontVariant(clock, 'msx', null); picker.update();
	assert.notEqual(last.textRevision, oldRevision);
	assert.equal(first.textRevision, oldRevision, 'font changes only prepare currently visible rows');
	key('ControlLeft', true); press('Home'); key('ControlLeft', false); picker.update();
	assert.equal(first.textRevision, last.textRevision, 'returning to a row consumes the new font generation');
	insertValue(picker.field, 'row_50'); picker.update();
	const hidden = picker.layout.renderRows[0];
	assert.equal(model.list.rows[0].itemIndex, 50);
	assert.equal(presented.has(50), true);
	assert.equal(hidden.labelText, hidden.item.label, 'a new query at the same scroll position prepares its actual result');
	const widthRevision = hidden.textRevision;
	editorViewState.viewportWidth = 256; picker.update();
	assert.notEqual(hidden.textRevision, widthRevision);
	const measure = t.mock.method(editorViewState.font, 'advance', () => assert.fail('idle text measurement'));
	for (let frame = 0; frame < 1000; frame += 1) picker.update();
	measure.mock.restore();
});

test('capture admission distinguishes an interactive popup from a background grab and a blocking surface', () => {
	const capture = new PointerCaptureService(), popup = Symbol('popup'), other = Symbol('other popup');
	let moves = 0, cancels = 0;
	const target = { handleCapturedPointer() { moves += 1; }, releaseCapturedPointer() { assert.fail('not a release'); }, cancelPointer() { cancels += 1; } };
	const held = { valid: true, insideViewport: true, pressedButtons: PRIMARY, justPressedButtons: 0, justReleasedButtons: 0, viewportX: 10, viewportY: 20 };
	capture.capture(target);
	assert.equal(capture.dispatch(held, false, 1, popup), false);
	assert.equal(cancels, 1, 'a background capture cannot run through a popup');
	capture.capture(target, PRIMARY, popup);
	assert.equal(capture.dispatch(held, false, 2, popup), true);
	assert.equal(moves, 1, 'the admitted popup keeps its own capture');
	assert.equal(capture.dispatch(held, false, 3, other), false);
	assert.equal(cancels, 2);
	capture.capture(target, PRIMARY, popup);
	assert.equal(capture.dispatch(held, true, 4, popup), false);
	assert.equal(cancels, 3, 'a blocking modal still cancels an interactive popup grab');
	capture.capture(target, PRIMARY, popup);
	assert.equal(capture.dispatch(held, false, 5, WORKBENCH_POINTER_SCOPE), false);
	assert.equal(cancels, 4, 'a closed popup cannot deliver its later release to the workbench');
});
