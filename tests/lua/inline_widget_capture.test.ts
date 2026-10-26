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
import { configureFontVariant, getCodeAreaBounds } from '../../ide/editor/ui/view/view';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { editorPointerState } from '../../ide/input/pointer/state';
import { handleCodeAreaSelectionPointer } from '../../ide/input/pointer/code/selection';
import { activeCodeEditor, createCodeEditorViewState } from '../../ide/editor/ui/code_editor_state';
import { refreshWorkbenchLayout } from '../../ide/workbench/common/layout';
import { layoutInlineWidgets } from '../../ide/quick_input/inline_widget';
import { getSearchFieldLayout } from '../../ide/workbench/contrib/code_editor/inline_bar/layout';
import { editorSearchState } from '../../ide/workbench/contrib/code_editor/find/widget_state';
import { createTestCodeDocuments } from '../helpers/code_documents';

const scope = WORKBENCH_POINTER_SCOPE;
function pointer(x: number, pressedButtons: number = PointerButton.Primary, justPressedButtons = 0, justReleasedButtons = 0): PointerSnapshot {
	return { valid: true, insideViewport: true, viewportX: x, viewportY: 42, pressedButtons, justPressedButtons, justReleasedButtons };
}

function fieldFixture(t: TestContext, variant: 'tiny' | 'msx') {
	const field = new TextField(null, { singleLine: true, allowSpace: true });
	const layout = new InlineBarFieldLayout(field);
	const bar = { left: 73, top: 40, right: 151, bottom: 60 };
	let available = true, lookups = 0;
	// Construct before the font producer replaces its metrics reference.
	const control = new InlineBarFieldPointer(field, () => {
		assert.equal(available, true, 'a retired capture must not query an absent field rectangle');
		lookups++; layout.layout(bar, '', '', 2); return layout;
	});
	configureFontVariant(variant);
	setFieldText(field, 'abcdefghijklmnopqrstuvwxyz', true);
	layout.layout(bar, '', '', 2); field.focusTarget.focus();
	t.after(() => {
		inputFocus.setTarget(null); pointerCapture.cancel();
		const released = pointer(0, 0, 0, PointerButton.Primary);
		pointerCapture.dispatch(released, false, 0, scope); pointerCapture.endRoute(released);
	});
	const down = (x: number) => {
		const sample = pointer(x, PointerButton.Primary, PointerButton.Primary);
		pointerCapture.beginRoute(scope, sample); control.handlePointer(sample, true);
		assert.equal(pointerCapture.active, true);
	};
	return { field, layout, down, lookupCount: () => lookups, remove: () => { layout.hide(); available = false; } };
}

for (const variant of ['tiny', 'msx'] as const) {
	test(`${variant} captured field uses its real inset and scrolled glyph origin through physical release`, t => {
		const f = fieldFixture(t, variant), start = f.layout.viewport.start;
		assert.ok(start > 0);
		const left = f.layout.bounds.left + 3, advance = editorViewState.font.advance('a');
		f.down(left + 1); assert.equal(f.field.cursorColumn, start);
		const release = pointer(left + 2 * advance + 1, 0, 0, PointerButton.Primary);
		assert.equal(pointerCapture.dispatch(release, false, 1, scope), true);
		assert.equal(f.field.cursorColumn, start + 2);
		assert.equal(selectedText(f.field), f.field.text.slice(start, start + 2));
		assert.equal(f.field.pointerSelecting, false); assert.equal(pointerCapture.active, false);
		assert.equal(f.field.text, 'abcdefghijklmnopqrstuvwxyz');
	});

	test(`${variant} removing a captured field drains the hold before another geometry lookup`, t => {
		const f = fieldFixture(t, variant);
		f.down(f.layout.bounds.left + 4);
		const lookups = f.lookupCount(); f.remove();
		assert.equal(pointerCapture.active, false); assert.equal(pointerCapture.draining, true);
		assert.equal(pointerCapture.dispatch(pointer(200), false, 1, scope), true);
		assert.equal(f.lookupCount(), lookups); assert.equal(f.field.pointerSelecting, false);
		assert.equal(f.field.text, 'abcdefghijklmnopqrstuvwxyz');
	});

	test(`${variant} source endpoint consumes admitted motion in a primary-release sample`, t => {
		configureFontVariant(variant);
		const source = 'mmmmmm\nnnnnnn';
		const { models, documents } = createTestCodeDocuments(t);
		const model = models.retain({ location: { kind: 'workspace' as const, path: 'hold.lua' }, domain: 0, path: 'hold.lua', source: { type: 'lua', resid: 'hold' } }, 'lua', source);
		const view = createCodeEditorViewState(); activeCodeEditor.attach(model, view);
		editorViewState.layout.attach(documents.get(model));
		t.after(() => { editorPointerState.pointerSelecting = false; activeCodeEditor.detach(); editorViewState.layout.dispose(); });
		editorViewState.viewportWidth = 384; editorViewState.viewportHeight = 288; editorViewState.codeAreaLeft = 0;
		refreshWorkbenchLayout();
		view.selectionAnchor = { row: 0, column: 1 }; view.cursorColumn = 1;
		editorPointerState.pointerSelecting = true;
		const bounds = getCodeAreaBounds();
		const release = pointer(bounds.textLeft + 4 * editorViewState.font.advance('m') + 1, 0, 0, PointerButton.Primary);
		release.viewportY = bounds.codeTop + 1;
		handleCodeAreaSelectionPointer(release, bounds);
		assert.equal(view.cursorRow, 0); assert.equal(view.cursorColumn, 4);
		assert.deepEqual(view.selectionAnchor, { row: 0, column: 1 }); assert.equal(model.buffer.getText(), source);
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

test('an empty workbench budget retires the real Find field before its next captured move', t => {
	configureFontVariant('tiny');
	const { models, documents } = createTestCodeDocuments(t);
	const model = models.retain({ location: { kind: 'workspace' as const, path: 'budget.lua' }, domain: 0, path: 'budget.lua', source: { type: 'lua', resid: 'budget' } }, 'lua', '-- source');
	activeCodeEditor.attach(model, createCodeEditorViewState());
	editorViewState.layout.attach(documents.get(model));
	t.after(() => {
		inputFocus.setTarget(null); editorSearchState.visible = false; pointerCapture.cancel();
		const released = pointer(0, 0, 0, PointerButton.Primary);
		pointerCapture.dispatch(released, false, 0, scope); pointerCapture.endRoute(released);
		activeCodeEditor.detach(); editorViewState.layout.dispose();
	});
	editorViewState.viewportWidth = 384; editorViewState.viewportHeight = 288;
	editorSearchState.visible = true; setFieldText(editorSearchState.field, 'retained_query', true);
	refreshWorkbenchLayout(); layoutInlineWidgets(); editorSearchState.field.focusTarget.focus();
	const fieldLayout = getSearchFieldLayout(), control = new InlineBarFieldPointer(editorSearchState.field, getSearchFieldLayout);
	const down = pointer(fieldLayout.bounds.left + 4, PointerButton.Primary, PointerButton.Primary);
	pointerCapture.beginRoute(scope, down); control.handlePointer(down, true);
	assert.equal(pointerCapture.active, true);
	editorViewState.viewportHeight = 8; refreshWorkbenchLayout(); layoutInlineWidgets();
	assert.equal(pointerCapture.active, false); assert.equal(pointerCapture.draining, true);
	assert.equal(pointerCapture.dispatch(pointer(200), false, 1, scope), true);
	assert.equal(editorSearchState.field.text, 'retained_query'); assert.equal(model.buffer.getText(), '-- source');
});
