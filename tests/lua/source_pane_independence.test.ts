import { Host2DKind } from '../../machine/ts/render/host_overlay/commands';
import type { GlyphRenderSubmission } from '../../machine/ts/render/shared/submissions';
import { editorRuntimeState } from '../../ide/editor/common/runtime_state';
import assert from 'node:assert/strict';
import test from 'node:test';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import type { PointerInputSnapshot } from '../../ide/common/models';
import { inputFocus } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { getCodeAreaBounds, resolveTextPositionBounds } from '../../ide/editor/ui/view/view';
import { CodeEditorNavigationSelection } from '../../ide/workbench/contrib/code_editor/navigation_selection';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { createActualSourcePanes } from '../helpers/source_panes';

test('two actual Source panes retain native targets, focused editing, clipboard and history for different models', t => {
	const f = createActualSourcePanes(t), a = f.first.code, b = f.second.code;
	const firstNative = a.focusTarget.textInput!, secondNative = b.focusTarget.textInput!;
	assert.ok(a !== b, 'each pane owns its own Source control'); assert.ok(a.layout !== b.layout, 'each control owns its layout'); assert.ok(a.focusTarget.scope !== b.focusTarget.scope, 'Source scopes are control-local');
	assert.ok(a.focusTarget.scope.commandParent === f.firstGroup.focusScope, 'first Source commands retain their group ancestry'); assert.ok(b.focusTarget.scope.commandParent === f.secondGroup.focusScope, 'second Source commands retain their group ancestry');
	assert.ok(a.focusTarget.scope.surfaceScope === f.firstGroup.captureScope, 'first Source belongs to its physical group surface'); assert.ok(b.focusTarget.scope.surfaceScope === f.secondGroup.captureScope, 'second Source belongs to its physical group surface');
	firstNative.setSelection(6, 11); secondNative.setSelection(6, 10);
	a.focusTarget.focus(); assert.equal(f.editor.clipboardTarget!.copy!(), 'alpha');
	b.focusTarget.focus(); assert.equal(f.editor.clipboardTarget!.copy!(), 'beta');
	const bVersion = b.model.version;
	assert.equal(firstNative.replaceText(6, 11, 'renamed'), true);
	assert.equal(a.model.buffer.getText(), f.source.replace('alpha', 'renamed'));
	assert.equal(b.model.buffer.getText(), f.otherSource); assert.equal(b.model.version, bVersion);
	assert.ok(inputFocus.target === b.focusTarget, 'a retained native target does not resolve through current focus');
	f.editor.clipboardTarget!.paste!({ text: 'gamma', images: [] });
	assert.equal(b.model.buffer.getText(), f.otherSource.replace('beta', 'gamma'));
	f.key('KeyZ', KeyModifier.ctrl);
	assert.equal(b.model.buffer.getText(), f.otherSource); assert.equal(a.model.canUndo, true);
	a.focusTarget.focus(); f.key('KeyZ', KeyModifier.ctrl);
	assert.equal(a.model.buffer.getText(), f.source); assert.equal(a.model.canUndo, false);
	const frame = f.paint(), paintedText = new Set<GlyphRenderSubmission['items']>();
	for (let index = 0; index < frame.commandCount; index++) if (frame.commandKinds[index] === Host2DKind.Glyphs)
		paintedText.add((frame.commandRefs[index] as GlyphRenderSubmission).items);
	// Exact authored projection bytes, not labels or coordinates, prove both bodies reached the real renderer.
	for (const code of [a, b]) {
		const line = code.layout.getViewLine(0).hi;
		assert.ok(paintedText.has(editorRuntimeState.uppercaseDisplay ? line.upperText : line.text));
	}
});

test('two actual Source panes over one model map sibling selections but deliver Undo selection only to its invoker', t => {
	const f = createActualSourcePanes(t, true), a = f.first.code, b = f.second.code;
	assert.ok(a.model === b.model, 'both inputs use the canonical shared working copy'); assert.ok(a.layout.document === b.layout.document, 'canonical projection is shared across controls');
	assert.ok(a.view !== b.view, 'Source views have independent selection ownership'); assert.ok(a.view.editSource !== b.view.editSource, 'history receivers are view-local');
	a.focusTarget.textInput!.setSelection(6, 11);
	b.focusTarget.textInput!.setSelection(0, 0);
	a.focusTarget.focus(); a.focusTarget.textInput!.replaceText(6, 11, 'omega');
	a.focusTarget.textInput!.setSelection(0, 0);
	b.focusTarget.focus(); f.key('KeyZ', KeyModifier.ctrl);
	assert.equal(a.model.buffer.getText(), f.source);
	assert.equal(a.view.cursorColumn, 0); assert.equal(a.view.selectionAnchor, null);
	assert.equal(b.view.cursorColumn, 11); assert.deepEqual(b.view.selectionAnchor, { row: 0, column: 6 });
	f.key('KeyZ', KeyModifier.ctrl | KeyModifier.shift);
	assert.equal(a.model.buffer.getText(), f.source.replace('alpha', 'omega'));
	assert.equal(a.view.cursorColumn, 0); assert.equal(b.view.cursorColumn, 11); assert.equal(b.view.selectionAnchor, null);
	f.firstGroup.close(f.firstInput.id);
	assert.ok(f.secondGroup.panes.activePane === f.second, 'closing the first group does not replace the second pane'); assert.ok(inputFocus.target === b.focusTarget, 'retiring a sibling preserves the focused Source control');
	b.focusTarget.textInput!.replaceText(0, 0, '-- retained\n');
	assert.ok(a.model === null, 'the closed Source control releases its working copy'); assert.ok(b.model === f.secondInput.workingCopy, 'the surviving Source retains its working copy');
});

test('shared font publication and one-pane resize preserve independent Source layout and pre-paint native carets', t => {
	const f = createActualSourcePanes(t), a = f.first.code, b = f.second.code;
	const long = '\talpha_'.repeat(60);
	a.model.pushEditOperations([{ offset: 0, deleteLength: a.model.buffer.length, text: long }]);
	b.model.pushEditOperations([{ offset: 0, deleteLength: b.model.buffer.length, text: '\tbeta\nreturn 2' }]);
	a.focusTarget.textInput!.setSelection(long.length, long.length); b.focusTarget.textInput!.setSelection(1, 1);
	const oldFont = a.font, variant = oldFont.variant === 'msx' ? 'tiny' : 'msx';
	f.editor.setFontVariant(variant); f.arrange();
	assert.ok(a.font !== oldFont, 'actual font publication replaces the typography generation'); assert.ok(a.font === b.font, 'both controls consume the published shared font'); assert.equal(a.font.variant, variant); assert.ok(a.layout !== b.layout, 'each control owns its layout');
	const bCaret = { ...b.focusTarget.textInput!.caretRect() }, bLayout = b.layout;
	f.firstBounds.right = 230; f.arrange();
	assert.ok(b.layout === bLayout, 'resizing a sibling retains this control layout'); assert.deepEqual(b.focusTarget.textInput!.caretRect(), bCaret);
	const revision = a.model.version, expected = { left: 0, top: 0, right: 0, bottom: 0 };
	for (const blink of [false, true]) {
		a.caret.cursorVisible = blink;
		a.focusTarget.textInput!.setSelection(1, 1);
		resolveTextPositionBounds(a, 0, 1, expected);
		const caret = a.focusTarget.textInput!.caretRect();
		assert.equal(caret.x, expected.left); assert.equal(caret.y, expected.top);
		assert.equal(caret.width, expected.right - expected.left); assert.equal(caret.height, a.lineHeight);
	}
	assert.equal(a.model.version, revision); assert.deepEqual(b.focusTarget.textInput!.caretRect(), bCaret);
});

test('Find, Rename and Suggest belong to the real Source pane and clear only with their own input', t => {
	const f = createActualSourcePanes(t), a = f.first, b = f.second;
	a.code.focusTarget.focus(); a.openFind('local'); a.find.applySearchFieldText('alpha', true);
	b.code.focusTarget.focus(); b.openFind('local'); b.find.applySearchFieldText('beta', true);
	f.update();
	assert.notEqual(a.find.state.field, b.find.state.field); assert.equal(a.find.state.query, 'alpha'); assert.equal(b.find.state.query, 'beta');
	assert.equal(a.find.state.matches.length, 2); assert.equal(b.find.state.matches.length, 2);
	b.find.closeSearch(false); b.code.focusTarget.textInput!.setSelection(7, 7); b.code.focusTarget.focus(); b.openRename(false);
	assert.equal(b.rename.isVisible(), true); assert.equal(a.rename.isVisible(), false);
	b.rename.cancel(); assert.equal(a.find.state.visible, true); assert.equal(a.find.state.query, 'alpha');
	b.code.model.pushEditOperations([{ offset: 0, deleteLength: b.code.model.buffer.length, text: 'retu' }]);
	b.code.focusTarget.textInput!.setSelection(4, 4); b.code.focusTarget.focus(); b.code.focusTarget.textInput!.replaceText(4, 4, 'r');
	f.update(250);
	assert.equal(b.code.inlineEdit.active, true); assert.equal(b.code.inlineEdit.text, 'n'); assert.equal(a.code.inlineEdit.active, false);
	f.firstGroup.clear();
	assert.equal(a.find.state.visible, false); assert.equal(a.find.state.job, null);
	assert.equal(b.code.inlineEdit.active, true); assert.ok(b.completion.session !== null, 'the surviving pane retains its admitted completion session');
	f.secondGroup.clear();
	assert.equal(b.code.inlineEdit.active, false); assert.ok(b.completion.session === null, 'retiring the owner clears its completion session'); assert.ok(b.code.model === null, 'clearing the second group detaches its Source control');
});

test('retiring a sibling Source preserves a real selection capture and retiring its owner drains the release', t => {
	const f = createActualSourcePanes(t), b = f.second.code, bounds = getCodeAreaBounds(b);
	const down = { valid: true, insideViewport: true, viewportX: bounds.textLeft + 1, viewportY: bounds.codeTop + 1,
		pressedButtons: PointerButton.Primary, justPressedButtons: PointerButton.Primary, justReleasedButtons: 0, modifiers: KeyModifier.none, spaceDown: false };
	pointerCapture.beginRoute(f.secondGroup.captureScope, down);
	f.second.handlePointer(down, true, false, f.host.clock.now(), false);
	assert.equal(pointerCapture.active, true); assert.equal(b.pointer.pointerSelecting, true);
	f.firstGroup.clear();
	assert.equal(pointerCapture.active, true); assert.equal(b.pointer.pointerSelecting, true);
	f.secondGroup.clear();
	assert.equal(pointerCapture.active, false); assert.equal(pointerCapture.draining, true); assert.equal(b.pointer.pointerSelecting, false);
	const replacement = new CodeEditorInput(f.secondInput.workingCopy); f.secondGroup.openEditor(replacement);
	const view = replacement.context.view;
	pointerCapture.dispatch({ ...down, viewportX: down.viewportX + 40, pressedButtons: 0,
		justPressedButtons: 0, justReleasedButtons: PointerButton.Primary }, false, f.host.clock.now(), f.secondGroup.captureScope);
	assert.equal(view.cursorColumn, 0); assert.equal(view.selectionAnchor, null); assert.equal(pointerCapture.draining, false);
});

test('Source selection latches physical occurrences and autoscrolls only its own admitted capture', t => {
	const f = createActualSourcePanes(t), a = f.first.code, b = f.second.code;
	b.model.pushEditOperations([{ offset: 0, deleteLength: b.model.buffer.length, text: 'local row = 1\n'.repeat(100) }]);
	b.focusTarget.textInput!.setSelection(0, 0); f.update();
	const bounds = getCodeAreaBounds(b), sample: PointerInputSnapshot = { valid: true, insideViewport: true,
		viewportX: bounds.textLeft + 1, viewportY: bounds.codeTop + 1,
		pressedButtons: PointerButton.Primary, justPressedButtons: PointerButton.Primary, justReleasedButtons: 0,
		modifiers: KeyModifier.none, spaceDown: false };
	pointerCapture.beginRoute(f.secondGroup.captureScope, sample);
	f.second.handlePointer(sample, true, false, f.host.clock.now(), false);
	assert.equal(pointerCapture.active, true);
	// The frontend reuses this producer record; an undelivered mutation is not another occurrence for Source.
	sample.viewportY = bounds.codeBottom + 20; sample.justPressedButtons = 0;
	f.second.update(0);
	assert.equal(b.view.scrollRow, 0); assert.equal(b.view.cursorRow, 0);
	pointerCapture.dispatch(sample, false, f.host.clock.now(), f.secondGroup.captureScope);
	f.second.update(0);
	assert.ok(b.view.scrollRow > 0); assert.ok(b.view.cursorRow > 0);
	assert.equal(a.view.scrollRow, 0); assert.equal(a.view.cursorRow, 0);
	sample.pressedButtons = 0; sample.justReleasedButtons = PointerButton.Primary;
	pointerCapture.dispatch(sample, false, f.host.clock.now(), f.secondGroup.captureScope);
	assert.equal(pointerCapture.active, false); assert.equal(b.pointer.pointerSelecting, false);
});

test('stationary Source hover consumes modifier changes while a sibling retains keyboard focus', t => {
	const f = createActualSourcePanes(t), a = f.first.code, b = f.second.code;
	const target = { left: 0, top: 0, right: 0, bottom: 0 };
	resolveTextPositionBounds(b, 1, 8, target);
	f.editor.dispatchPointer({ x: target.left + 1, y: (target.top + target.bottom) / 2,
		buttons: 0, pressedButtons: 0, releasedButtons: 0, cancelledButtons: 0,
		modifiers: KeyModifier.none, spaceDown: false, timestamp: f.host.clock.now() });
	a.focusTarget.focus(); f.update();
	assert.ok(inputFocus.target === a.focusTarget, 'hover never transfers keyboard focus from its sibling'); assert.equal(b.gotoHoverHighlight, null);
	f.editor.dispatchKey(new KeyInputEvent('ControlLeft', KeyModifier.ctrl)); f.update();
	assert.notEqual(b.gotoHoverHighlight, null); assert.equal(b.gotoHoverHighlight.row, 1);
	assert.equal(a.gotoHoverHighlight, null); assert.ok(inputFocus.target === a.focusTarget, 'hover never transfers keyboard focus from its sibling');
	f.editor.dispatchKey(new KeyInputEvent('ControlLeft', KeyModifier.none, false, false)); f.update();
	assert.equal(b.gotoHoverHighlight, null); assert.equal(a.gotoHoverHighlight, null);
	f.editor.dispatchKey(new KeyInputEvent('AltLeft', KeyModifier.alt)); f.update();
	assert.notEqual(b.hoverTooltip, null); assert.equal(b.hoverTooltip.path, b.model.resource.path);
	assert.equal(a.hoverTooltip, null); assert.ok(inputFocus.target === a.focusTarget, 'hover never transfers keyboard focus from its sibling');
	f.editor.dispatchKey(new KeyInputEvent('AltLeft', KeyModifier.none, false, false)); f.update();
	assert.equal(b.hoverTooltip, null); assert.equal(a.hoverTooltip, null);
});

test('Source navigation restore and input retirement target one actual pane without changing its sibling', t => {
	const f = createActualSourcePanes(t), a = f.first.code, b = f.second.code;
	a.focusTarget.textInput!.setSelection(6, 11); b.focusTarget.textInput!.setSelection(6, 10);
	const selection = new CodeEditorNavigationSelection(f.firstInput);
	t.after(() => selection.dispose());
	a.focusTarget.textInput!.setSelection(0, 0);
	f.firstGroup.activate(f.firstInput.id, undefined, selection);
	assert.equal(a.view.cursorColumn, 11); assert.deepEqual(a.view.selectionAnchor, { row: 0, column: 6 });
	assert.equal(b.view.cursorColumn, 10); assert.deepEqual(b.view.selectionAnchor, { row: 0, column: 6 });
	const retiredView = f.firstInput.context.view;
	f.firstGroup.close(f.firstInput.id);
	f.firstInput.workingCopy.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- hidden\n' }]);
	assert.equal(retiredView.cursorRow, 0, 'closed input releases its own model-position subscription');
	assert.ok(b.model === f.secondInput.workingCopy, 'the surviving Source retains its working copy'); assert.equal(b.model.buffer.getText(), f.otherSource);
});

test('a Source popup follows its owning attachment rather than sibling retirement or retained input lifetime', t => {
	const f = createActualSourcePanes(t), b = f.second.code;
	b.focusTarget.focus();
	f.editor.commands.execute('symbolSearch', b.focusTarget);
	const picker = f.editor.quickInput;
	assert.equal(picker.visible, true);
	assert.ok(picker.invocationOrigin === b.focusTarget, 'the picker retains its actual Source invocation');
	const pickerFocus = inputFocus.target;
	f.firstGroup.panes.clearEditor();
	assert.equal(picker.visible, true);
	assert.ok(inputFocus.target === pickerFocus, 'retiring a sibling cannot dismiss or refocus the picker');
	f.secondGroup.panes.clearEditor();
	assert.equal(picker.visible, false);
	assert.equal(b.model, null);
	assert.ok(f.secondGroup.model.tabs.includes(f.secondInput), 'the input remains retained after its view detaches');
	assert.ok(inputFocus.target !== b.focusTarget, 'dismissal cannot refocus a detached native editor');
});
