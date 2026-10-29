import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { KeyModifier } from '../../hosts/common/input/text';
import { editorFeedbackState, showEditorMessage, updateEditorMessage } from '../../ide/common/feedback_state';
import { inputFocus } from '../../ide/input/focus';
import { LuaEvaluation } from '../../ide/runtime/lua_evaluation';
import { STATUS_PRIORITY_HINT } from '../../ide/workbench/common/status_bar';
import { createActualSourcePanes } from '../helpers/source_panes';

// Exact text comparisons below verify producer-to-reader data integrity and
// retained observations; they do not freeze any particular UI wording.
function fixture(t: TestContext) {
	const f = createActualSourcePanes(t);
	// This actual native scope admits a synthetic status producer. The contract
	// must apply to any interacting source, not a window kind or its item rank.
	const source = {
		interactionActive: false,
		statusItems: [{ text: 'An ongoing native interaction', alignment: 'left' as const,
			priority: STATUS_PRIORITY_HINT, overflow: 'ellipsis' as const, tone: 'normal' as const }],
		updateStatus() {},
	};
	f.first.commandTarget.scope.statusSource = source;
	f.first.focus();
	t.after(() => updateEditorMessage(editorFeedbackState.message.timer));
	return { ...f, statusSource: source };
}

for (const kind of ['info', 'success'] as const)
	test(`ongoing interaction guidance outranks retained ${kind} feedback without expiring or replacing it`, t => {
		const f = fixture(t), status = f.editor.statusBar, source = f.statusSource;
		showEditorMessage('An ordinary retained observation', kind, 30); f.update();
		assert.equal(status.itemsLayout.items.peek(0).fullText, editorFeedbackState.message.text);
		assert.ok(status.itemsLayout.items.peek(0).item !== source.statusItems[0]);
		const feedback = { ...editorFeedbackState.message };
		source.interactionActive = true; f.update();
		assert.ok(status.itemsLayout.items.peek(0).item === source.statusItems[0]);
		assert.deepEqual(editorFeedbackState.message, feedback, 'presentation precedence does not consume ordinary feedback');
		source.interactionActive = false; f.update();
		assert.equal(status.itemsLayout.items.peek(0).fullText, feedback.text);
		assert.equal(status.itemsLayout.items.peek(0).item!.tone, kind);
		assert.deepEqual(editorFeedbackState.message, feedback);
	});

for (const kind of ['warning', 'error'] as const)
	test(`${kind} feedback retains its safety precedence over an ongoing interaction`, t => {
		const f = fixture(t), source = f.statusSource;
		source.interactionActive = true;
		showEditorMessage('A retained safety observation', kind, 30); f.update();
		const presented = f.editor.statusBar.itemsLayout.items.peek(0);
		assert.ok(presented.item !== source.statusItems[0]);
		assert.equal(presented.fullText, editorFeedbackState.message.text); assert.equal(presented.item!.tone, kind);
		assert.equal(source.interactionActive, true);
	});

test('key-chord and evaluation overrides remain explicit ahead of active interaction guidance', t => {
	const f = fixture(t), source = f.statusSource, status = f.editor.statusBar, evaluation = f.ide.luaEvaluation;
	source.interactionActive = true;
	showEditorMessage('An ordinary retained observation', 'info', 30); f.update();
	assert.ok(status.itemsLayout.items.peek(0).item === source.statusItems[0]);
	try {
		evaluation.active = new LuaEvaluation('return 1', 'session', 1, 0); f.update();
		const override = status.itemsLayout.items.peek(0).item!;
		assert.ok(override !== source.statusItems[0]);
		assert.equal(override.tone, 'normal', 'evaluation owns the shared override rather than the retained info notification');
		f.key('KeyK', KeyModifier.ctrl);
		assert.equal(f.editor.keybindings.inChordMode, true);
		assert.ok(status.itemsLayout.items.peek(0).item === override);
		assert.equal(status.itemsLayout.items.peek(0).fullText, f.editor.keybindings.pendingLabel,
			'the actual chord owner publishes its complete guidance through the shared override item');
		f.key('Escape');
		assert.equal(f.editor.keybindings.inChordMode, false);
		assert.ok(status.itemsLayout.items.peek(0).item === override);
		assert.equal(override.tone, 'normal');
		evaluation.active = undefined; f.update();
		assert.ok(status.itemsLayout.items.peek(0).item === source.statusItems[0]);
		assert.equal(source.interactionActive, true); assert.equal(editorFeedbackState.message.visible, true);
	} finally { evaluation.active = undefined; }
});

for (const variant of ['tiny', 'msx'] as const) for (const operation of ['move', 'resize'] as const)
	for (const finish of ['Enter', 'Escape'] as const)
		test(`${variant} native ${operation} guidance remains complete at 768 pixels over real wrap feedback until ${finish}`, t => {
			const f = createActualSourcePanes(t), editor = f.editor, window = f.firstPart.window!;
			editor.setFontVariant(variant); editor.updateViewport({ width: 768, height: 480 }); f.first.focus();
			f.key('KeyZ', KeyModifier.alt);
			assert.equal(editorFeedbackState.message.visible, true); assert.equal(editorFeedbackState.message.kind, 'info');
			const feedback = { ...editorFeedbackState.message }, model = f.firstInput.workingCopy, version = model.version;
			t.after(() => updateEditorMessage(editorFeedbackState.message.timer));
			editor.commands.execute(`window.${operation}`, f.first.commandTarget); editor.update(0);
			assert.equal(window.interactionActive, true); assert.ok(inputFocus.admittedTarget === window.focusTarget);
			const guidance = window.statusItems[0], presented = editor.statusBar.itemsLayout.items.peek(0);
			assert.ok(presented.item === guidance);
			// Full interaction instructions, including acceptance and cancellation,
			// must fit this requested reading surface rather than requiring disclosure.
			assert.equal(presented.visible, true); assert.equal(presented.truncated, false);
			assert.equal(presented.text, guidance.text);
			assert.deepEqual(editorFeedbackState.message, feedback);
			f.key(finish);
			assert.equal(window.interactionActive, false); assert.ok(inputFocus.admittedTarget === window.focusTarget);
			assert.equal(editor.statusBar.itemsLayout.items.peek(0).fullText, feedback.text);
			assert.deepEqual(editorFeedbackState.message, feedback);
			assert.equal(model.version, version); assert.equal(model.buffer.getText(), f.source); assert.equal(model.canUndo, false);
		});
