import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import type { PointerSnapshot } from '../../ide/common/models';
import { inputFocus } from '../../ide/input/focus';
import { pointerCapture, PointerCaptureService, WORKBENCH_POINTER_SCOPE } from '../../ide/input/pointer/capture';
import { InlineBarFieldPointer } from '../../ide/input/quick_input/pointer/field';
import { InlineBarFieldLayout } from '../../ide/workbench/contrib/code_editor/inline_bar/field';
import { TextField } from '../../ide/editor/ui/inline/text_field_model';
import { selectedText, setFieldText } from '../../ide/editor/ui/inline/text_field';
import { getCodeAreaBounds } from '../../ide/editor/ui/view/view';
import { EditorFont } from '../../ide/editor/ui/view/font';
import { handleCodeAreaSelectionPointer } from '../../ide/input/pointer/code/selection';
import { EditorSearchController } from '../../ide/workbench/contrib/code_editor/find/search';
import { CodeEditorLineJump } from '../../ide/workbench/contrib/code_editor/find/line_jump';
import { RenameController } from '../../ide/workbench/contrib/code_editor/rename/controller';
import { CrossFileRenameManager } from '../../ide/workbench/contrib/code_editor/rename/operations';
import { SourceInlineBars } from '../../ide/workbench/contrib/code_editor/inline_bar/source_inline_bars';
import type { RuntimeSourceState } from '../../ide/runtime/sources';
import { createTestCodeDocuments } from '../helpers/code_documents';
import { createTestCodeControl } from '../helpers/code_control';

const scope = WORKBENCH_POINTER_SCOPE;
function pointer(x: number, pressedButtons: number = PointerButton.Primary, justPressedButtons = 0, justReleasedButtons = 0): PointerSnapshot {
	return { valid: true, insideViewport: true, viewportX: x, viewportY: 42, pressedButtons, justPressedButtons, justReleasedButtons };
}

function codeFixture(t: TestContext, variant: 'tiny' | 'msx', source = '-- source') {
	const { models, documents, clock } = createTestCodeDocuments(t);
	const model = models.retain({ contextLabel: 'Fixture project', sourceFilePath: 'hold.lua', location: { kind: 'workspace', path: 'hold.lua' }, contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'hold.lua',
		source: { type: 'lua', resid: 'hold' } }, 'lua', source);
	const code = createTestCodeControl(t, model, documents, clock, undefined, new EditorFont(variant));
	t.after(() => {
		inputFocus.setTarget(null); pointerCapture.cancel();
		const released = pointer(0, 0, 0, PointerButton.Primary);
		pointerCapture.dispatch(released, false, 0, code.focusTarget.scope.surfaceScope); pointerCapture.endRoute(released);
	});
	return code;
}

function fieldFixture(t: TestContext, variant: 'tiny' | 'msx') {
	const code = codeFixture(t, variant);
	const field = new TextField(code.focusTarget, { singleLine: true, allowSpace: true });
	const layout = new InlineBarFieldLayout(code, field);
	const control = new InlineBarFieldPointer(code, field, layout);
	const bar = { left: 73, top: 40, right: 151, bottom: 60 };
	field.focusTarget.canFocus = () => layout.visible;
	setFieldText(field, 'abcdefghijklmnopqrstuvwxyz', true);
	layout.layout(bar, '', '', 2); field.focusTarget.focus();
	t.after(() => { layout.hide(); control.dispose(); });
	const down = (x: number) => {
		const sample = pointer(x, PointerButton.Primary, PointerButton.Primary);
		pointerCapture.beginRoute(code.focusTarget.scope.surfaceScope, sample); control.handlePointer(sample, true);
		assert.equal(pointerCapture.active, true);
	};
	return { code, field, layout, down, remove: () => layout.hide() };
}

for (const variant of ['tiny', 'msx'] as const) {
	test(`${variant} captured field uses its own scrolled glyph origin through physical release`, t => {
		const f = fieldFixture(t, variant), start = f.layout.viewport.start;
		assert.ok(start > 0);
		const left = f.layout.bounds.left + 3, advance = f.code.font.advance('a');
		f.down(left + 1); assert.equal(f.field.cursorColumn, start);
		const release = pointer(left + 2 * advance + 1, 0, 0, PointerButton.Primary);
		assert.equal(pointerCapture.dispatch(release, false, 1, f.code.focusTarget.scope.surfaceScope), true);
		assert.equal(f.field.cursorColumn, start + 2);
		assert.equal(selectedText(f.field), f.field.text.slice(start, start + 2));
		assert.equal(f.field.pointerSelecting, false); assert.equal(pointerCapture.active, false);
		assert.equal(f.field.text, 'abcdefghijklmnopqrstuvwxyz');
	});

	test(`${variant} removing a captured field drains the hold without changing its retained selection`, t => {
		const f = fieldFixture(t, variant);
		f.down(f.layout.bounds.left + 4);
		const cursor = f.field.cursorColumn, anchor = { ...f.field.selectionAnchor };
		f.remove();
		assert.equal(pointerCapture.active, false); assert.equal(pointerCapture.draining, true);
		assert.equal(pointerCapture.dispatch(pointer(200), false, 1, f.code.focusTarget.scope.surfaceScope), true);
		assert.equal(f.field.cursorColumn, cursor); assert.deepEqual(f.field.selectionAnchor, anchor);
		assert.equal(f.field.pointerSelecting, false); assert.equal(f.field.text, 'abcdefghijklmnopqrstuvwxyz');
	});

	test(`${variant} Source endpoint consumes admitted motion in a primary-release sample`, t => {
		const source = 'mmmmmm\nnnnnnn', code = codeFixture(t, variant, source), view = code.view;
		view.selectionAnchor = { row: 0, column: 1 }; view.cursorColumn = 1;
		code.pointer.pointerSelecting = true;
		const bounds = getCodeAreaBounds(code);
		const release = pointer(bounds.textLeft + 4 * code.font.advance('m') + 1, 0, 0, PointerButton.Primary);
		release.viewportY = bounds.codeTop + 1;
		handleCodeAreaSelectionPointer(code, release, bounds);
		assert.equal(view.cursorRow, 0); assert.equal(view.cursorColumn, 4);
		assert.deepEqual(view.selectionAnchor, { row: 0, column: 1 }); assert.equal(code.model.buffer.getText(), source);
	});
}

test('retiring a target preserves a sibling capture and consumes the interrupted physical hold', () => {
	const service = new PointerCaptureService(); let firstCancelled = 0, secondCancelled = 0;
	const first = { handleCapturedPointer() {}, releaseCapturedPointer() { assert.fail('cancellation is not release'); }, cancelPointer() { firstCancelled++; } };
	const second = { handleCapturedPointer() {}, releaseCapturedPointer() { assert.fail('cancellation is not release'); }, cancelPointer() { secondCancelled++; } };
	service.beginRoute(scope, pointer(10, PointerButton.Primary, PointerButton.Primary)); service.capture(second);
	service.cancelTarget(first);
	assert.equal(service.active, true); assert.equal(firstCancelled, 0); assert.equal(secondCancelled, 0);
	service.cancelTarget(second);
	assert.equal(secondCancelled, 1); assert.equal(service.active, false); assert.equal(service.draining, true);
	assert.equal(service.dispatch(pointer(100, PointerButton.Primary | PointerButton.Secondary, PointerButton.Secondary), false, 1, scope), true);
	assert.equal(service.routeScope, undefined);
	assert.equal(service.dispatch(pointer(100, 0, 0, PointerButton.Primary | PointerButton.Secondary), false, 2, scope), true);
	assert.equal(service.draining, false); assert.equal(secondCancelled, 1);
});

test('an empty Source budget retires its actual Find capture before the next held move', t => {
	const code = codeFixture(t, 'tiny'), sources = {} as RuntimeSourceState;
	const find = new EditorSearchController(code, sources.catalog), lineJump = new CodeEditorLineJump(code);
	const rename = new RenameController(code, sources.catalog, new CrossFileRenameManager(sources.catalog));
	const bars = new SourceInlineBars(code, find, rename, lineJump);
	t.after(() => { find.dispose(); rename.dispose(); lineJump.dispose(); });
	const client = { left: 0, top: 10, right: 384, bottom: 270 };
	find.state.visible = true; setFieldText(find.state.field, 'retained_query', true);
	bars.layout(client); find.focus();
	const down = pointer(find.fieldLayout.bounds.left + 4, PointerButton.Primary, PointerButton.Primary);
	down.viewportY = find.fieldLayout.bounds.top + 3;
	pointerCapture.beginRoute(code.focusTarget.scope.surfaceScope, down); find.fieldPointer.handlePointer(down, true);
	assert.equal(pointerCapture.active, true);
	client.bottom = client.top; bars.layout(client);
	assert.equal(pointerCapture.active, false); assert.equal(pointerCapture.draining, true);
	assert.equal(pointerCapture.dispatch(pointer(200), false, 1, code.focusTarget.scope.surfaceScope), true);
	assert.equal(find.state.field.text, 'retained_query'); assert.equal(code.model.buffer.getText(), '-- source');
});
