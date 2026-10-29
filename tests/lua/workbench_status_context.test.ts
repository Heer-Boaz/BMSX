import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { KeyModifier } from '../../hosts/common/input/text';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { editorFeedbackState, showEditorMessage, updateEditorMessage } from '../../ide/common/feedback_state';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { setFieldText } from '../../ide/editor/ui/inline/text_field';
import { inputFocus } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { LuaEvaluation } from '../../ide/runtime/lua_evaluation';
import type { WorkbenchStatusSource } from '../../ide/workbench/common/status_bar';
import { STATUS_BAR_CONNECTION_WIDTH } from '../../ide/workbench/common/layout';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { CodeEditorPane } from '../../ide/workbench/contrib/code_editor/editor_pane';
import type { ActionPromptRequest } from '../../ide/workbench/contrib/modal/action_prompt_view';
import { ScenePrimaryClient } from '../../ide/workbench/contrib/scene_editor/primary_client';
import { TextQuickPickProvider } from '../../ide/workbench/services/quick_input/text_provider';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { createActualSourcePanes } from '../helpers/source_panes';

const SCENE = `local scenes = require('cartlib/world/scene_library')
scenes.register('room', { objects = {
 { member_id = 'actor', definition_id = 'example', options = { pos = { x = 1, y = 2, z = 3 } } },
} })
return {}
`;
const REQUEST: ActionPromptRequest = { title: 'Pending source action', message: 'Continue with the captured source?',
	primary: 'Save and continue', secondary: 'Continue without saving', primaryEnabled: true, defaultChoice: 'primary' };

type Fixture = ReturnType<typeof createActualSourcePanes>;

/** Inspect the actual composition's producer admission, not a rendered caption. */
function assertStatusProjection(t: TestContext, f: Fixture, expected: WorkbenchStatusSource, excluded: readonly WorkbenchStatusSource[]) {
	const selected = t.mock.method(expected, 'updateStatus');
	const background = excluded.map(source => t.mock.method(source, 'updateStatus'));
	try {
		f.paint();
		assert.ok(selected.mock.callCount() > 0, 'the one shell presentation reads the actual admitted context');
		for (const source of background) assert.equal(source.mock.callCount(), 0, 'background presentations cannot replace the current status');
		const projection = f.editor.statusBar.itemsLayout.items;
		assert.equal(projection.length, expected.statusItems.length);
		for (let index = 0; index < projection.length; index++) assert.ok(projection.peek(index).item === expected.statusItems[index]);
	} finally { selected.mock.restore(); for (const source of background) source.mock.restore(); }
}

function fixture(t: TestContext, variant: 'tiny' | 'msx') {
	const f = createActualSourcePanes(t, false, [['scene.lua', SCENE], ['cartlib/world/scene_library.lua', 'return {}']]);
	f.editor.setFontVariant(variant); editorFeedbackState.message.visible = false;
	f.host.presenter.setFixedRenderTargetSize(800, 320);
	f.editor.resourcePanel.show();
	f.editor.mainWorkspace.setActivityVisible(true); f.update();
	f.editor.problems.setDiagnostics([{ model: f.firstInput.workingCopy, version: f.firstInput.workingCopy.version,
		row: 1, startColumn: 2, endColumn: 3, message: 'An exact observed diagnostic.', severity: 'error' }],
		{ ready: 1, pending: 0, unsupported: 0, failed: 0 });
	f.editor.problems.setSelectionIndex(0);
	return f;
}

for (const variant of ['tiny', 'msx'] as const) {
	test(`${variant} one shell status follows actual floating, Files and Activity controls without borrowing source selection`, t => {
		const f = fixture(t, variant), files = f.editor.resourcePanel, activity = f.editor.problems;
		const text = f.firstInput.workingCopy.buffer.getText(), version = f.firstInput.workingCopy.version;
		const view = f.first.code.view, marker = activity.selectedDiagnostic;
		f.first.focus(); assertStatusProjection(t, f, f.first, [f.second, files, activity]);
		f.second.focus(); assertStatusProjection(t, f, f.second, [f.first, files, activity]);
		files.setFocused(true); assertStatusProjection(t, f, files, [f.first, f.second, activity]);
		f.editor.mainWorkspace.focusActivity(); assertStatusProjection(t, f, activity, [f.first, f.second, files]);
		activity.header.controls.focusTarget.focus(); assertStatusProjection(t, f, activity, [f.first, f.second, files]);
		assert.ok(f.first.code.view === view && activity.selectedDiagnostic === marker);
		assert.equal(f.firstInput.workingCopy.buffer.getText(), text); assert.equal(f.firstInput.workingCopy.version, version);
	});

	test(`${variant} Main document and independent primary region controls publish their actual status owner`, async t => {
		const f = fixture(t, variant), main = f.editor.mainWorkspace, group = f.editor.editorParts.main.activeGroup;
		group.openEditor(new CodeEditorInput(f.secondInput.workingCopy)); f.update();
		const documentPane = group.panes.activePane; assert.ok(documentPane instanceof CodeEditorPane);
		const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!;
		const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource), document = f.ide.sceneSources.get(model);
		assert.equal(await f.editor.openSceneInMain(() => ({ model, subject: { document, sourceVersion: model.version, scene: document.scenes[0] } }), inputFocus.target!), true);
		const primary = main.primary; assert.ok(primary instanceof ScenePrimaryClient);
		main.focusPrimary('hierarchy'); f.update();
		assertStatusProjection(t, f, primary, [documentPane, f.first, f.second, f.editor.problems]);
		f.key('ArrowDown'); main.focusPrimary('details'); f.update();
		const field = primary.details.control.controls[0]; assert.equal(field.field.focusTarget.focus(), true);
		setFieldText(field.field, '31', true);
		const selection = primary.consumer.selection;
		assertStatusProjection(t, f, primary, [documentPane, f.first, f.second, f.editor.problems]);
		assert.equal(field.pending, true); assert.equal(field.field.text, '31'); assert.equal(model.buffer.getText(), SCENE);
		assert.ok(primary.consumer.selection === selection);
		field.cancel(); documentPane.focus();
		assertStatusProjection(t, f, documentPane, [primary, f.first, f.second, f.editor.problems]);
	});

	test(`${variant} global and part-local popup chains retain the real invoking status owner`, async t => {
		const f = fixture(t, variant), editor = f.editor;
		for (const part of [f.firstPart, f.secondPart]) {
			const pane = part.activeGroup.panes.activePane!; pane.focus();
			part.quickInput.pick('choices', '', () => new TextQuickPickProvider([{ label: 'choice', description: '', detail: '' }]), () => {});
			assert.ok(inputFocus.admittedTarget === part.quickInput.field.focusTarget);
			assertStatusProjection(t, f, pane, [editor.resourcePanel, editor.problems]);
			editor.contextMenu.show(part.quickInput.layout.bounds.left + 1, part.quickInput.layout.bounds.top + 1, [], editor.commands);
			assert.ok(editor.contextMenu.invocationOrigin === part.quickInput.field.focusTarget);
			assertStatusProjection(t, f, pane, [editor.resourcePanel, editor.problems]);
			editor.contextMenu.hide(); part.quickInput.hide(); pane.focus();
			const pending = part.actionPrompt.show(REQUEST);
			try {
				assert.ok(inputFocus.admittedTarget === part.actionPrompt.focusTarget);
				assertStatusProjection(t, f, pane, [editor.resourcePanel, editor.problems]);
				editor.contextMenu.show(part.actionPrompt.view.bounds.left + 1, part.actionPrompt.view.bounds.top + 1, [], editor.commands);
				assertStatusProjection(t, f, pane, [editor.resourcePanel, editor.problems]);
			} finally { editor.contextMenu.hide(); part.actionPrompt.close(); await pending; }
		}
		editor.mainWorkspace.focusActivity();
		editor.quickInput.pick('choices', '', () => new TextQuickPickProvider([{ label: 'choice', description: '', detail: '' }]), () => {});
		editor.contextMenu.show(editor.quickInput.layout.bounds.left + 1, editor.quickInput.layout.bounds.top + 1, [], editor.commands);
		assertStatusProjection(t, f, editor.problems, [f.first, f.second, editor.resourcePanel]);
		editor.contextMenu.hide(); editor.quickInput.hide();
		editor.resourcePanel.setFocused(true);
		editor.quickInput.pick('choices', '', () => new TextQuickPickProvider([{ label: 'choice', description: '', detail: '' }]), () => {});
		assertStatusProjection(t, f, editor.resourcePanel, [f.first, f.second, editor.problems]);
		editor.quickInput.hide();
	});

	test(`${variant} retiring an invoking attachment cannot keep its status alive behind a newer foreground`, async t => {
		const f = fixture(t, variant), editor = f.editor;
		f.first.focus(); f.firstPart.quickInput.pick('choices', '', () => new TextQuickPickProvider([{ label: 'choice', description: '', detail: '' }]), () => {});
		assert.equal(await editor.editorParts.close(f.firstPart), true); f.second.focus(); f.update();
		assert.equal(f.firstPart.quickInput.visible, false);
		assertStatusProjection(t, f, f.second, [f.first, editor.resourcePanel, editor.problems]);
		editor.resourcePanel.setFocused(true); editor.resourcePanel.hide(); f.second.focus();
		assertStatusProjection(t, f, f.second, [f.first, editor.resourcePanel, editor.problems]);
		editor.mainWorkspace.focusActivity(); editor.mainWorkspace.setActivityVisible(false); f.second.focus();
		assertStatusProjection(t, f, f.second, [f.first, editor.resourcePanel, editor.problems]);
	});

	test(`${variant} native status keyboard focus copies complete and withdrawn producer observations`, async t => {
		const f = fixture(t, variant), editor = f.editor;
		editor.updateViewport({ width: 118, height: 240 }); f.first.focus(); f.update();
		const source = f.first.statusItems[0], raw = source.text;
		assert.ok(editor.statusBar.itemsLayout.items.peek(0).item === source);
		editor.commands.execute('status.focus', inputFocus.admittedTarget);
		assert.ok(inputFocus.admittedTarget === editor.statusBar.focusTarget);
		f.key('KeyC', KeyModifier.ctrl);
		assert.equal(await editor.clipboard.readText(), raw, 'clipboard data remains the exact full producer value');
		assert.equal(editor.statusBar.itemsLayout.items.peek(1).visible, false);
		f.key('ArrowRight'); f.key('KeyC', KeyModifier.ctrl);
		assert.equal(await editor.clipboard.readText(), f.first.statusItems[1].text,
			'keyboard reading reaches lower-priority facts even when their native status slot is withdrawn');
		f.key('Escape'); assert.ok(inputFocus.admittedTarget === f.first.commandTarget);
		assert.equal(f.firstInput.workingCopy.buffer.getText(), f.source); assert.equal(f.firstInput.workingCopy.dirty, false);
	});

	test(`${variant} native status disclosure captures complete values while later facts in the same attachment change`, async t => {
		const f = fixture(t, variant), editor = f.editor;
		editor.updateViewport({ width: 118, height: 240 }); f.first.focus(); f.update();
		const raw = f.first.statusItems[0].text, origin = inputFocus.admittedTarget;
		editor.commands.execute('status.details', origin);
		const picker = editor.quickInput;
		assert.equal(picker.visible, true); assert.ok(picker.invocationOrigin === origin);
		const entry = picker.model.list.rows[0].item;
		assert.ok('text' in entry && entry.text === raw, 'disclosure captures the full observation, not a rendered label');
		f.firstInput.workingCopy.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- a later canonical observation\n' }]);
		f.update();
		assert.equal(picker.visible, true); assert.notEqual(f.first.statusItems[0].text, raw);
		assert.ok(picker.model.list.rows[0].item === entry);
		f.key('Enter');
		assert.equal(await editor.clipboard.readText(), raw); assert.equal(picker.visible, false);
		assert.ok(inputFocus.admittedTarget === origin);
	});

	test(`${variant} replacing the concrete Source attachment retires a disclosed status snapshot before it can copy`, async t => {
		const f = fixture(t, variant), editor = f.editor;
		editor.updateViewport({ width: 118, height: 240 }); f.first.focus(); f.update(); await editor.clipboard.writeText('unchanged clipboard');
		editor.commands.execute('status.details', inputFocus.admittedTarget);
		assert.equal(editor.quickInput.visible, true);
		f.firstGroup.openEditor(new CodeEditorInput(f.secondInput.workingCopy)); f.second.focus(); f.update();
		assert.equal(editor.quickInput.visible, false);
		assert.ok(inputFocus.admittedTarget === f.second.commandTarget);
		assert.equal(await editor.clipboard.readText(), 'unchanged clipboard');
		assertStatusProjection(t, f, f.second, [f.first, editor.resourcePanel, editor.problems]);
	});

	test(`${variant} native feedback disclosure copies complete multiline data without publishing or changing source`, async t => {
		const f = fixture(t, variant), editor = f.editor;
		f.first.focus();
		const raw = 'A producer-owned multiline observation\r\nwith exact source/path and\ta second native value.';
		showEditorMessage(raw, 'warning', 4); f.update();
		editor.commands.execute('status.details', inputFocus.admittedTarget);
		const picker = editor.quickInput;
		assert.equal(picker.visible, true);
		const item = picker.model.list.rows[0].item;
		assert.ok('text' in item && item.text === raw);
		f.key('Enter'); assert.equal(await editor.clipboard.readText(), raw);
		assert.equal(f.firstInput.workingCopy.buffer.getText(), f.source); assert.equal(f.firstInput.workingCopy.dirty, false);
	});

	test(`${variant} the real status owner admits chord then evaluation then complete feedback before ordinary source facts`, t => {
		const f = fixture(t, variant), status = f.editor.statusBar, evaluation = f.ide.luaEvaluation;
		f.first.focus(); f.update();
		const source = f.first.statusItems[0], read = t.mock.method(f.first, 'updateStatus');
		const feedback = 'A complete transient observation\nwith retained second-line data.';
		try {
			showEditorMessage(feedback, 'warning', 4); f.update();
			assert.equal(status.itemsLayout.items.peek(0).fullText, feedback); assert.equal(read.mock.callCount(), 0);
			evaluation.active = new LuaEvaluation('return 1', 'session', 1, 0); f.update();
			const running = status.itemsLayout.items.peek(0).fullText;
			assert.notEqual(running, feedback); assert.ok(status.itemsLayout.items.peek(0).item !== source);
			f.key('KeyK', KeyModifier.ctrl);
			assert.notEqual(status.itemsLayout.items.peek(0).fullText, running);
			assert.equal(read.mock.callCount(), 0);
			f.key('Escape'); assert.equal(status.itemsLayout.items.peek(0).fullText, running);
			evaluation.active = undefined; f.update();
			assert.equal(status.itemsLayout.items.peek(0).fullText, feedback);
			updateEditorMessage(4); f.update();
			assert.ok(status.itemsLayout.items.peek(0).item === source); assert.ok(read.mock.callCount() > 0);
			assert.equal(f.firstInput.workingCopy.buffer.getText(), f.source); assert.equal(f.firstInput.workingCopy.dirty, false);
		} finally { evaluation.active = undefined; }
	});

	test(`${variant} hiding the actual status origin revokes a held disclosure without trapping subsequent native keyboard input`, t => {
		const f = fixture(t, variant), editor = f.editor, files = editor.resourcePanel;
		editor.updateViewport({ width: 118, height: 240 }); files.setFocused(true); f.update();
		const bounds = editor.statusBar.itemsLayout.disclosureBounds;
		assert.ok(bounds.left < bounds.right);
		const x = (bounds.left + bounds.right) / 2, y = (bounds.top + bounds.bottom) / 2;
		editor.dispatchPointer({ x, y, buttons: PointerButton.Primary, pressedButtons: PointerButton.Primary,
			releasedButtons: 0, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 1 });
		assert.equal(pointerCapture.active, true);
		assert.ok(editor.statusBar.itemsLayout.items.peek(0).item === files.statusItems[0]);
		files.hide(); f.update();
		assert.equal(pointerCapture.active, false);
		assert.ok(inputFocus.target === null || inputFocus.admittedTarget === inputFocus.target,
			'the retired disclosure cannot leave a retained but inadmissible native target');
		f.key('KeyP', KeyModifier.ctrl | KeyModifier.shift);
		assert.equal(editor.quickInput.visible, true); assert.ok(inputFocus.admittedTarget === editor.quickInput.field.focusTarget);
		editor.dispatchPointer({ x, y, buttons: 0, pressedButtons: 0, releasedButtons: PointerButton.Primary,
			cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 2 });
		assert.equal(editor.quickInput.visible, true); assert.ok(inputFocus.admittedTarget === editor.quickInput.field.focusTarget);
	});

	for (const withdrawal of ['facts', 'geometry'] as const)
		test(`${variant} ${withdrawal} withdrawal hands native status focus back without trapping Escape or retiring its attached provider`, t => {
			const f = fixture(t, variant), editor = f.editor, activity = editor.problems;
			editor.mainWorkspace.focusActivity(); f.update();
			const generation = activity.scope.contextGeneration;
			editor.commands.execute('status.focus', inputFocus.admittedTarget);
			assert.ok(inputFocus.admittedTarget === editor.statusBar.focusTarget);
			if (withdrawal === 'facts') activity.setDiagnostics([], { ready: 1, pending: 0, unsupported: 0, failed: 0 });
			else editor.updateViewport({ width: STATUS_BAR_CONNECTION_WIDTH, height: 240 });
			f.update();
			assert.equal(editor.statusBar.canFocus, false);
			assert.ok(inputFocus.admittedTarget === activity.focusTarget);
			assert.equal(activity.scope.contextGeneration, generation);
			const keyboard = t.mock.method(activity.focusTarget, 'handleKeyboard');
			f.key('Escape'); assert.ok(keyboard.mock.callCount() > 0, 'the real keyboard route still reaches its admitted native owner');
			f.key('KeyP', KeyModifier.ctrl | KeyModifier.shift);
			assert.equal(editor.quickInput.visible, true); assert.ok(inputFocus.admittedTarget === editor.quickInput.field.focusTarget);
			assert.equal(f.firstInput.workingCopy.buffer.getText(), f.source);
		});

	test(`${variant} a disclosed Activity snapshot survives same-provider empty facts and copies its captured value`, async t => {
		const f = fixture(t, variant), editor = f.editor, activity = editor.problems;
		editor.mainWorkspace.focusActivity(); f.update();
		const generation = activity.scope.contextGeneration, raw = activity.statusItems[0].text;
		editor.commands.execute('status.details', inputFocus.admittedTarget);
		const picker = editor.quickInput;
		assert.equal(picker.visible, true); assert.ok(inputFocus.admittedTarget === picker.field.focusTarget);
		const item = picker.model.list.rows[0].item; assert.ok('text' in item && item.text === raw);
		activity.setDiagnostics([], { ready: 1, pending: 0, unsupported: 0, failed: 0 }); f.update();
		assert.equal(activity.statusItems[0].text, ''); assert.equal(activity.scope.contextGeneration, generation);
		assert.equal(picker.visible, true); assert.ok(picker.model.list.rows[0].item === item);
		assert.ok(inputFocus.admittedTarget === picker.field.focusTarget);
		f.key('Enter'); assert.equal(await editor.clipboard.readText(), raw);
		assert.equal(picker.visible, false); assert.ok(inputFocus.admittedTarget === activity.focusTarget);
	});
}
