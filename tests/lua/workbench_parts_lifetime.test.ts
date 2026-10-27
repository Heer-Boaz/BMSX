import { toLuaModulePath } from '../../toolchain/ts/lua/module_path';
import type { SourceStackTraceFrame } from '../../ide/runtime/stack_trace';
import { TEST_CARTRIDGE_CONTEXT_IDS, TEST_SYSTEM_CONTEXT_ID } from '../helpers/runtime_sources';
import { EditorLuaSemanticProject } from '../../ide/editor/contrib/intellisense/semantic/workspace/project';
import { SceneEditorInput } from '../../ide/workbench/contrib/scene_editor/editor_input';
import { CodeEditorPane } from '../../ide/workbench/contrib/code_editor/editor_pane';
import { openGpuDebugger } from '../../ide/workbench/contrib/gpu_debugger/editor_input';
import { openHome } from '../../ide/workbench/contrib/home/editor_input';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import type { ClipboardContents } from '../../hosts/common/clipboard';
import { HeadlessClipboard } from '../../hosts/node/headless/clipboard';
import { IdeMicrotaskQueue } from '../../ide/common/microtask_queue';
import { resourceIdentityKey, resourceIdentityKeyFromParts } from '../../ide/common/resource';
import { CallHierarchyModel } from '../../ide/editor/contrib/call_hierarchy/model';
import { editorTextModelService, EditorTextModelService } from '../../ide/editor/model/model_service';
import { editorRuntimeState } from '../../ide/editor/common/runtime_state';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { getCodeAreaBounds } from '../../ide/editor/ui/view/view';
import { focusRuntimeErrorOverlay } from '../../ide/runtime_error/navigation';
import { PROBLEMS_PANEL_DIVIDER_DRAG_MARGIN } from '../../ide/common/constants';
import { inputFocus } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { api } from '../../ide/runtime/overlay_api';
import { captureInstalledLuaSources, registerLuaSourceRecord, type LuaSourceRegistry } from '../../ide/runtime/source_registry';
import { createBlua32SystemSourceImage } from '../../ide/runtime/sources';
import { AemEditorInput } from '../../ide/workbench/contrib/aem/editor_input';
import { getProblemsPanelBounds } from '../../ide/workbench/contrib/problems/panel/layout';
import { problemsPanel } from '../../ide/workbench/contrib/problems/panel/controller';
import { RuntimeIdeState } from '../../ide/workbench/state';
import { getWorkbenchEditorBounds } from '../../ide/workbench/common/layout';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { resolveLuaCodeEditorInput } from '../../ide/workbench/ui/code_tab/io';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { CodeEditorInputSerializer } from '../../ide/workbench/contrib/code_editor/editor_serializer';
import { getSingleCursorSelectionRange } from '../../ide/editor/editing/cursor/state';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { buildLuaSemanticFrontendFromSnapshot } from '../../toolchain/ts/lua/semantic/frontend';
import { linkTestSystemBlua32 } from '../helpers/blua32';
import { createHostFrameFixture } from '../helpers/host_frame';
import { createTestRuntime, createTestSystemImageRuntimeSourceState } from '../helpers/runtime_sources';
import { parseLuaChunk } from './cpu_test_harness';
import { RuntimeDebuggerResumeMode, RuntimeDebuggerStopReason } from '../../ide/runtime/source_debugger';
import { presentRuntimeDebuggerStop } from '../../ide/workbench/contrib/debugger/controller';
import { updateSelectedScenarioNode } from '../../ide/workbench/contrib/scenario_lab/projection';
import { INSTRUCTION_BYTES } from '../../machine/ts/spec/blua32/instruction_format';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from '../helpers/scenario_sources';

function fixture(t: TestContext, source = 'local value = 42\nreturn value') {
	const image = linkTestSystemBlua32(compileLuaChunkToProgram(parseLuaChunk(source, 'parts.lua'), [],
		{ entrySource: source, programDomain: 'system', optLevel: 0 }));
	const host = createHostFrameFixture(createTestRuntime(image.romBytes)); host.runtime.boot();
	const registry: LuaSourceRegistry = { records: [], path2lua: {}, module2lua: {}, entrySourcePath: 'parts.lua',
		projectRootPath: '', can_boot_from_source: true, revision: 0 };
	for (let index = -1; index < 60; index++) {
		const path = index === -1 ? 'parts.lua' : `directory_${index}/child.lua`;
		const text = index < 0 || index >= 20 ? source : '9return 1';
		registerLuaSourceRecord(registry, { resid: path, type: 'lua', src: text, base_src: text,
			source_path: path, normalized_source_path: path, module_path: toLuaModulePath(path),
			update_timestamp: 0, base_update_timestamp: 0, generated: false, sourceKind: 'project', program_module: true });
	}
	const sources = createTestSystemImageRuntimeSourceState(image.romBytes, registry);
	sources.currentBlua32Media = { system: createBlua32SystemSourceImage(image.image, image.symbols, image.biosImports,
		captureInstalledLuaSources(registry, image.symbols!.metadata.compiledModulePaths), TEST_SYSTEM_CONTEXT_ID), cartridgeSlots: [null, null] };
	const unused = (): never => { throw new Error('Part lifetime does not request external domain work.'); };
	const clipboard = new HeadlessClipboard();
	const ide = new RuntimeIdeState(host.runtime, host.presenter, { capture: unused }, unused,
		{ measureDisplay: () => ({ left: 0, top: 0, width: editorViewState.viewportWidth, height: editorViewState.viewportHeight }) },
		host.input, host.audio, host.tasks, host.execution, host.rewind, host.clock, clipboard,
		new IdeMicrotaskQueue(), { log() {} }, 0.3, { width: 384, height: 288 }, sources, new Map(), unused, unused, unused);
	const editor = ide.editor;
	editor.editorParts.main.activeGroup.openEditor(resolveLuaCodeEditorInput(sources.catalog, sources.catalog.resolveResource({ contextId: TEST_SYSTEM_CONTEXT_ID, path: registry.entrySourcePath })!));
	t.after(async () => {
		problemsPanel.hide(); problemsPanel.setFixedHeightPx(0); inputFocus.setTarget(null);
		await editor.shutdown(); host.audio.dispose(); host.input.dispose();
	});
	editorRuntimeState.active = true; host.input.setPointerAdmissionMode('routed'); editor.update(0);
	const input = editor.editorParts.main.activeGroup.model.activeTab!;
	assert.ok(input.kind === 'code_editor');
	const pane = editor.editorParts.main.activeGroup.panes.getPane('code_editor') as CodeEditorPane;
	const model = pane.code.model!, view = pane.code.view!;
	const key = (code: string, modifiers = KeyModifier.none) => {
		editor.dispatchKey(new KeyInputEvent(code, modifiers)); editor.dispatchKey(new KeyInputEvent(code, modifiers, false, false)); editor.update(0);
	};
	assert.equal(editor.textTarget!.replaceText(0, 0, ' '), true);
	const edited = model.buffer.getText(), version = model.version, cycles = host.runtime.machine.scheduler.nowCycles;
	assert.equal(model.canUndo, true);
	const resource = (index: number) => sources.catalog.resourceByIdentity.get(resourceIdentityKeyFromParts(TEST_SYSTEM_CONTEXT_ID, `directory_${index}/child.lua`))!;
	return { pane, ide, editor, host, sources, input, model, view, source, edited, version, cycles, key, resource, clipboard };
}

function openAemFixture(f: ReturnType<typeof fixture>, source = 'events:\n  story:\n    channel: music\n    rules: []\n', path = 'events.aem.yaml') {
	f.sources.catalog.registerTextSources(TEST_SYSTEM_CONTEXT_ID, [{ type: 'aem', resid: 'events', source_path: path }]);
	const resource = f.sources.catalog.resourceByIdentity.get(resourceIdentityKeyFromParts(TEST_SYSTEM_CONTEXT_ID, path))!;
	const model = editorTextModelService.retain(resource, 'aem', source), input = new AemEditorInput(model);
	f.editor.editorParts.main.activeGroup.openEditor(input); f.editor.update(0);
	input.tree.selectionIndex = input.tree.rows.findIndex(row => row.element.key === '["events","story","channel"]');
	return { input, model, source };
}

test('ordinary Source close and reopen restores a plain reading memento in a fresh live view', t => {
	const source = Array.from({ length: 100 }, (_, row) => `-- row ${row} with readable source`).join('\n') + '\nreturn 1';
	const f = fixture(t, source), closedView = f.input.context.view;
	// Another retained source-backed view keeps this dirty document alive through Source close.
	f.editor.editorParts.main.activeGroup.model.add(new SceneEditorInput(f.model));
	closedView.cursorRow = 50; closedView.cursorColumn = 8;
	closedView.selectionAnchor = { row: 49, column: 3 };
	closedView.scrollRow = 35.5;
	const duplicate = resolveLuaCodeEditorInput(f.sources.catalog, f.model.resource);
	duplicate.context.view.cursorRow = 2;
	f.editor.editorParts.main.activeGroup.openEditor(duplicate);
	assert.equal(f.editor.editorParts.main.activeGroup.model.activeTab, f.input, 'an offered duplicate cannot replace the admitted view');
	f.editor.editorParts.main.activeGroup.close(f.input.id);
	const reopened = resolveLuaCodeEditorInput(f.sources.catalog, f.model.resource);
	f.editor.editorParts.main.activeGroup.openEditor(reopened);
	assert.equal(f.editor.editorParts.main.activeGroup.model.activeTab, reopened); assert.notEqual(reopened, f.input);
	assert.notEqual(reopened.context.view.editSource, closedView.editSource);
	assert.equal(reopened.workingCopy, f.model); assert.equal(f.model.dirty, true);
	assert.equal(reopened.context.view.cursorRow, 50); assert.equal(reopened.context.view.cursorColumn, 8);
	assert.deepEqual(reopened.context.view.selectionAnchor, { row: 49, column: 3 });
	// Reading coordinates are the memento's actual data contract, not a pixel layout assertion.
	assert.equal(reopened.context.view.scrollRow, 35.5);
	f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- prefix\n' }]);
	assert.equal(reopened.context.view.cursorRow, 51);
	assert.equal(closedView.cursorRow, 50, 'remembering reading position cannot keep the closed view subscribed');
});

test('explicit Source opening and serialized view state take precedence over the group reading memento', async t => {
	const source = Array.from({ length: 100 }, (_, row) => `-- row ${row} with readable source`).join('\n') + '\nreturn 1';
	const f = fixture(t, source);
	f.view.cursorRow = 50; f.view.cursorColumn = 8; f.view.scrollRow = 35.5;
	f.editor.editorParts.main.activeGroup.model.add(new SceneEditorInput(f.model));
	f.editor.editorParts.main.activeGroup.close(f.input.id);
	const selected = resolveLuaCodeEditorInput(f.sources.catalog, f.model.resource);
	f.editor.editorParts.main.activeGroup.openEditor(selected, { selection: { row: 5, startColumn: 7, endColumn: 9 } });
	assert.equal(selected.context.view.cursorRow, 5); assert.equal(selected.context.view.cursorColumn, 7);
	f.editor.editorParts.main.activeGroup.close(selected.id);
	const persisted = new CodeEditorInput(f.model);
	persisted.context.view.cursorRow = 12; persisted.context.view.cursorColumn = 8; persisted.context.view.scrollRow = 3;
	const serializer = new CodeEditorInputSerializer(f.sources.catalog), state = serializer.serialize(persisted);
	persisted.dispose();
	const restored = await serializer.deserialize(state);
	f.editor.editorParts.main.activeGroup.openEditor(restored);
	assert.equal(restored.context.view.cursorRow, 12); assert.equal(restored.context.view.cursorColumn, 8);
	assert.equal(restored.context.view.scrollRow, 3);
	assert.equal(restored.workingCopy, f.model); assert.equal(f.model.dirty, true);
});

test('ordinary Source reopen resolves both saved selection endpoints against text shortened while closed', t => {
	const source = Array.from({ length: 80 }, (_, row) => `-- row ${row} with readable source`).join('\n') + '\nreturn 1';
	const f = fixture(t, source);
	f.view.cursorRow = 50; f.view.cursorColumn = 8;
	f.view.selectionAnchor = { row: 49, column: 3 };
	f.model.completeSave(f.model.createSnapshot());
	f.editor.editorParts.main.activeGroup.close(f.input.id);
	f.model.pushEditOperations([{ offset: 0, deleteLength: f.model.buffer.length, text: 'return 1' }]);
	const reopened = resolveLuaCodeEditorInput(f.sources.catalog, f.model.resource);
	f.editor.editorParts.main.activeGroup.openEditor(reopened);
	assert.equal(f.editor.editorParts.main.activeGroup.model.activeTab, reopened); assert.equal(reopened.workingCopy, f.model);
	assert.equal(reopened.context.view.cursorRow, 0); assert.equal(reopened.context.view.cursorColumn, f.model.buffer.length);
	assert.equal(getSingleCursorSelectionRange(reopened.context.view), null);
	assert.equal(f.view.cursorRow, 50, 'the closed view remains retired rather than tracking the shortened document');
	assert.equal(f.model.buffer.getText(), 'return 1'); assert.equal(f.model.dirty, true);
});

for (const format of ['yaml', 'json'] as const) {
	test(`AEM ${format} Source opens its selected AST position in the same undoable working copy`, async t => {
		const f = fixture(t), source = format === 'yaml'
			? '# authored map\nevents:\n  story:\n    channel: music # keep this comment\n    rules: []\n'
			: '{\n  "events": { "story": { "channel": "music", "rules": [] } }\n}\n';
		const aem = openAemFixture(f, source, `res/audio/events.aem.${format}`);
		assert.ok(aem.input.tree.selectionIndex >= 0);
		const selectedKey = aem.input.tree.rows[aem.input.tree.selectionIndex].element.key;
		const range = aem.input.tree.rows[aem.input.tree.selectionIndex].element.node.range!;
		f.key('Enter'); const field = f.editor.textTarget!;
		assert.ok(field !== undefined); assert.equal(field.replaceText(0, field.readText().text.length, '"audiofx"'), true);
		f.key('Enter');
		const edited = source.slice(0, range[0]) + '"audiofx"' + source.slice(range[1]), version = aem.model.version;
		assert.equal(aem.model.buffer.getText(), edited); assert.equal(aem.model.canUndo, true);
		const position = { row: 0, column: 0 };
		aem.model.buffer.positionAt(aem.input.tree.rows[aem.input.tree.selectionIndex].element.node.range![0], position);
		f.editor.commands.execute('aem.source'); await setImmediate(); f.editor.update(0);
		const code = f.editor.editorParts.main.activeGroup.model.activeTab!; assert.ok(code.kind === 'code_editor');
		assert.ok(code.workingCopy === aem.model && code.resource === aem.input.resource && f.pane.code.model === aem.model);
		assert.notEqual(code.id, aem.input.id);
		assert.equal(f.pane.code.view!.cursorRow, position.row); assert.equal(f.pane.code.view!.cursorColumn, position.column);
		assert.equal(aem.model.version, version); assert.equal(aem.model.buffer.getText(), edited); assert.equal(aem.model.canUndo, true);
		f.key('KeyZ', KeyModifier.ctrl);
		assert.equal(aem.model.buffer.getText(), source); assert.equal(aem.model.canRedo, true);
		f.editor.editorParts.main.activeGroup.activate(aem.input.id); f.editor.update(0);
		assert.ok(f.editor.editorParts.main.activeGroup.model.activeTab === aem.input && aem.input.workingCopy === aem.model);
		assert.equal(aem.input.tree.rows[aem.input.tree.selectionIndex].element.key, selectedKey);
		assert.equal(aem.model.buffer.getText(), source); assert.equal(aem.model.canRedo, true);
		assert.equal(f.model.buffer.getText(), f.edited); assert.equal(f.model.version, f.version);
		assert.equal(f.host.runtime.machine.scheduler.nowCycles, f.cycles);
	});

	test(`AEM ${format} Add with no selection edits the actual empty root collection through Quick Input`, async t => {
		const f = fixture(t), source = format === 'yaml' ? '# authored empty map\n{}\n' : ' {\n}\n';
		const aem = openAemFixture(f, source, `res/audio/empty.aem.${format}`);
		assert.equal(aem.input.tree.selectionIndex, -1);
		const root = aem.input.tree.roots[0].element, range = root.node.range!;
		assert.deepEqual(root.path, []); assert.ok(root.node === aem.input.document!.contents);
		assert.equal(f.editor.commands.isEnabled('aem.add'), true);
		f.editor.commands.execute('aem.add');
		const picker = f.editor.editorParts.main.quickInput; assert.equal(picker.visible, true); assert.equal(picker.inputBox, false);
		// The selection is the authored property key, not the Quick Input's display wording.
		picker.model.list.selectionIndex = picker.model.list.rows.findIndex(row => row.item.label === 'events');
		assert.ok(picker.model.list.selectionIndex >= 0); await picker.accept();
		assert.equal(picker.visible, true); assert.equal(picker.inputBox, true);
		await picker.accept(); f.editor.update(0);
		assert.equal(picker.visible, false); assert.deepEqual(aem.input.document!.toJS(), { events: {} });
		const edited = aem.model.buffer.getText();
		assert.ok(edited.startsWith(source.slice(0, range[0])) && edited.endsWith(source.slice(range[1])), 'structured insertion preserves the authored bytes outside the root range');
		assert.equal(aem.model.canUndo, true);
		f.key('KeyZ', KeyModifier.ctrl);
		assert.equal(aem.model.buffer.getText(), source); assert.equal(aem.model.canRedo, true);
		assert.ok(f.editor.editorParts.main.activeGroup.model.activeTab === aem.input && aem.input.workingCopy === aem.model);
		assert.equal(f.model.buffer.getText(), f.edited); assert.equal(f.model.version, f.version);
		assert.equal(f.host.runtime.machine.scheduler.nowCycles, f.cycles);
	});
}

for (const control of ['tree', 'actions'] as const) {
	test(`concealing the actual AEM ${control} revokes its source mutation commands without discarding its working copy`, t => {
		const f = fixture(t), aem = openAemFixture(f);
		assert.ok(aem.input.tree.selectionIndex >= 0);
		f.key('Enter');
		assert.ok(f.editor.textTarget !== undefined);
		assert.equal(f.editor.textTarget!.replaceText(0, 'music'.length, 'audiofx'), true);
		f.key('Enter');
		const edited = aem.model.buffer.getText(), version = aem.model.version;
		assert.equal(edited, aem.source.replace('music', 'audiofx')); assert.equal(aem.model.canUndo, true);
		const selected = aem.input.tree.rows[aem.input.tree.selectionIndex];
		if (control === 'actions') {
			f.key('Tab'); f.key('Home');
			for (let step = 0; step <= aem.input.actionBar.items.length; step++) {
				if (aem.input.actionBar.items[aem.input.actionBar.focusedIndex]?.command === 'aem.remove') break;
				f.key('ArrowRight');
			}
			assert.equal(aem.input.actionBar.hasFocus, true);
			assert.equal(aem.input.actionBar.items[aem.input.actionBar.focusedIndex].command, 'aem.remove');
		}
		const target = inputFocus.admittedTarget;
		assert.ok(target !== null);
		problemsPanel.show(); problemsPanel.setFixedHeightPx(editorViewState.viewportHeight * 4); f.editor.update(0);
		assert.notEqual(inputFocus.admittedTarget, target);
		f.key(control === 'tree' ? 'Delete' : 'Enter'); f.key('KeyZ', KeyModifier.ctrl);
		assert.equal(aem.model.buffer.getText(), edited); assert.equal(aem.model.version, version);
		assert.equal(aem.model.canUndo, true); assert.equal(aem.model.canRedo, false);
		problemsPanel.hide(); f.editor.update(0);
		assert.notEqual(inputFocus.admittedTarget, target, 'recovery does not silently reclaim focus');
		f.key('Delete'); assert.equal(aem.model.buffer.getText(), edited);
		assert.ok(aem.input.tree.rows[aem.input.tree.selectionIndex] === selected);
		assert.ok(f.editor.editorParts.main.activeGroup.model.activeTab === aem.input && aem.input.workingCopy === aem.model);
		f.editor.editorParts.main.activeGroup.panes.activePane!.focus(); f.key('KeyZ', KeyModifier.ctrl);
		assert.equal(aem.model.buffer.getText(), aem.source); assert.equal(aem.model.canRedo, true);
		assert.equal(f.model.buffer.getText(), f.edited); assert.equal(f.model.version, f.version);
		assert.equal(f.host.runtime.machine.scheduler.nowCycles, f.cycles);
	});
}

test('the independently presented AEM property edit retains its own input above an unavailable main tree', t => {
	const f = fixture(t), aem = openAemFixture(f);
	assert.ok(aem.input.tree.selectionIndex >= 0);
	f.key('Enter');
	const field = f.editor.textTarget!;
	assert.ok(field !== undefined);
	const target = inputFocus.admittedTarget;
	problemsPanel.show(); problemsPanel.setFixedHeightPx(editorViewState.viewportHeight * 4); f.editor.update(0);
	assert.ok(f.editor.textTarget === field && inputFocus.admittedTarget === target);
	assert.equal(field.replaceText(0, 'music'.length, 'audiofx'), true);
	assert.equal(aem.model.buffer.getText(), aem.source, 'an independent field draft is not an accepted source edit');
	f.key('Enter');
	assert.equal(aem.model.buffer.getText(), aem.source.replace('music', 'audiofx'));
	assert.ok(f.editor.textTarget === undefined);
	problemsPanel.hide(); f.editor.update(0);
	assert.ok(inputFocus.admittedTarget === null);
	f.editor.editorParts.main.activeGroup.panes.activePane!.focus(); f.key('KeyZ', KeyModifier.ctrl);
	assert.equal(aem.model.buffer.getText(), aem.source); assert.equal(aem.model.canRedo, true);
	assert.equal(f.model.buffer.getText(), f.edited); assert.equal(f.model.version, f.version);
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, f.cycles);
});

for (const command of ['findLocal', 'lineJump', 'rename'] as const) test(`${command} synchronously publishes an arranged native field before the next frame`, t => {
	const f = fixture(t);
	if (command === 'rename') { f.key('End', KeyModifier.ctrl); f.key('ArrowLeft'); }
	f.editor.commands.execute(command);
	const field = command === 'findLocal' ? f.pane.find.state.field : command === 'lineJump' ? f.pane.lineJump.state.field : f.pane.rename.getField();
	assert.ok(f.editor.textTarget === field && f.editor.clipboardTarget === field);
	assert.ok(field.nativeCaret.width > 0 && field.nativeCaret.height > 0, 'accepted field focus needs an actual native input placement synchronously');
	assert.equal(f.model.buffer.getText(), f.edited); assert.equal(f.model.version, f.version);
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, f.cycles);
});

for (const command of ['findLocal', 'lineJump', 'rename'] as const) test(`${command} revokes a withheld field gesture, Paste and keyboard admission without editing Source`, async t => {
	const f = fixture(t, 'local value = 42\n' + '-- retained reading context\n'.repeat(100) + 'return value');
	t.after(() => pointerCapture.interrupt(false));
	if (command === 'rename') { f.key('End', KeyModifier.ctrl); f.key('ArrowLeft'); }
	f.editor.commands.execute(command); f.editor.update(0);
	const field = command === 'findLocal' ? f.pane.find.state.field : command === 'lineJump' ? f.pane.lineJump.state.field : f.pane.rename.getField();
	assert.ok(f.editor.textTarget === field);
	const seed = field.text, draft = command === 'lineJump' ? '12' : 'retained_draft';
	assert.equal(f.editor.textTarget!.replaceText(0, seed.length, draft), true); f.editor.update(0);
	assert.equal(field.canUndo, true);
	if (command === 'rename') {
		const bounds = getCodeAreaBounds(f.pane.code);
		f.editor.dispatchWheel({ x: (bounds.codeLeft + bounds.codeRight) / 2, y: (bounds.codeTop + bounds.codeBottom) / 2,
			deltaX: 0, deltaY: -12, attachmentDeltaY: -12, modifiers: KeyModifier.none, timestamp: 1 });
		f.editor.update(0);
	}
	const sourceScroll = f.view.scrollRow, revision = field.revision;
	const pending = Promise.withResolvers<ClipboardContents>();
	const read = t.mock.method(f.clipboard, 'read', () => pending.promise), execute = t.mock.method(f.clipboard, 'execute');
	f.key('KeyV', KeyModifier.ctrl); assert.equal(read.mock.callCount(), 1);
	const caret = field.caretRect(), x = caret.x + caret.width / 2, y = caret.y + caret.height / 2;
	f.editor.dispatchPointer({ x, y, buttons: PointerButton.Primary, pressedButtons: PointerButton.Primary,
		releasedButtons: 0, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 2 });
	assert.equal(pointerCapture.active, true);
	problemsPanel.show(); problemsPanel.setFixedHeightPx(editorViewState.viewportHeight * 4); f.editor.update(0);
	pending.resolve({ text: 'late_paste', images: [] }); await pending.promise;
	assert.ok(f.editor.textTarget === undefined && f.editor.clipboardTarget === undefined,
		'a retained field draft is not permission for native input outside its presented geometry');
	assert.equal(pointerCapture.active, false); assert.equal(pointerCapture.draining, true);
	f.key('Backspace'); f.key('KeyX', KeyModifier.ctrl); f.key('KeyV', KeyModifier.ctrl); f.key('KeyZ', KeyModifier.ctrl);
	assert.equal(read.mock.callCount(), 1); assert.equal(execute.mock.callCount(), 0);
	f.editor.dispatchPointer({ x: x + 32, y, buttons: PointerButton.Primary, pressedButtons: 0,
		releasedButtons: 0, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 3 });
	f.editor.dispatchPointer({ x: x + 32, y, buttons: 0, pressedButtons: 0,
		releasedButtons: PointerButton.Primary, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 4 });
	assert.equal(pointerCapture.draining, false); assert.equal(field.pointerSelecting, false);
	assert.equal(field.text, draft); assert.equal(field.revision, revision); assert.equal(field.canUndo, true);
	assert.equal(f.model.buffer.getText(), f.edited); assert.equal(f.model.version, f.version); assert.equal(f.view.scrollRow, sourceScroll);
	problemsPanel.hide(); f.editor.update(0);
	assert.ok(f.editor.textTarget === undefined, 'rearranging a retained field does not steal focus');
	assert.equal(f.view.scrollRow, sourceScroll);
	if (command === 'rename') {
		assert.equal(f.pane.rename.isVisible(), false); assert.equal(f.pane.rename.getMatchCount(), 0);
	} else {
		assert.equal(command === 'findLocal' ? f.pane.find.state.visible : f.pane.lineJump.state.visible, true);
		field.focusTarget.focus(); assert.ok(f.editor.textTarget === field);
		f.key('KeyZ', KeyModifier.ctrl); assert.equal(field.text, seed); assert.equal(field.canRedo, true);
	}
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, f.cycles);
});

test('Find remains an admitted text owner when its own bar is visible above a zero-height Source body', t => {
	const f = fixture(t);
	f.editor.commands.execute('findLocal'); f.editor.update(0);
	const field = f.pane.find.state.field, bar = f.pane.bars.searchBounds!, bounds = getWorkbenchEditorBounds();
	// Keep the produced Find bar exposed, including the group's actual tab chrome.
	const sourceBodyBudget = bounds.bottom - bar.bottom;
	problemsPanel.show(); problemsPanel.setFixedHeightPx(sourceBodyBudget); f.editor.update(0);
	assert.ok(!f.pane.code.focusTarget.canFocus!(), 'the physical body budget withholds Source, independently of its inline bar');
	assert.ok(f.editor.textTarget === field && f.editor.clipboardTarget === field);
	assert.ok(field.nativeCaret.width > 0 && field.nativeCaret.height > 0);
	assert.equal(f.editor.textTarget!.replaceText(0, field.text.length, 'visible_field'), true);
	assert.equal(field.text, 'visible_field'); assert.equal(f.model.buffer.getText(), f.edited); assert.equal(f.model.version, f.version);
	f.key('Escape');
	assert.equal(f.pane.find.state.visible, false);
	assert.ok(inputFocus.admittedTarget === f.pane.code.focusTarget && f.editor.textTarget !== undefined,
		'explicit Find close returns focus only after its own bar has freed Source client space');
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, f.cycles);
});

test('Rename rejected before field presentation retires its source-reading subscriptions and admits a later fresh operation', t => {
	const f = fixture(t);
	f.key('End', KeyModifier.ctrl); f.key('ArrowLeft');
	const subscribe = editorTextModelService.onDidChangeContent;
	let subscriptions = 0;
	t.mock.method(editorTextModelService, 'onDidChangeContent', listener => {
		const unbind = subscribe.call(editorTextModelService, listener); subscriptions++;
		return () => { subscriptions--; unbind(); };
	});
	problemsPanel.show(); problemsPanel.setFixedHeightPx(editorViewState.viewportHeight * 4); f.editor.update(0);
	f.editor.commands.execute('rename');
	assert.equal(f.pane.rename.isVisible(), false); assert.equal(f.pane.rename.isActive(), false);
	assert.equal(f.pane.rename.getMatchCount(), 0); assert.equal(subscriptions, 0, 'rejected Rename cannot retain a workspace-source observer');
	assert.ok(f.editor.textTarget === undefined && f.editor.clipboardTarget === undefined);
	problemsPanel.hide(); f.editor.update(0); f.editor.editorParts.main.activeGroup.panes.activePane!.focus();
	f.editor.commands.execute('rename');
	assert.equal(f.pane.rename.isActive(), true); assert.ok(f.pane.rename.getMatchCount() > 0); assert.equal(subscriptions, 1);
	f.key('Escape'); assert.equal(subscriptions, 0); assert.equal(f.pane.rename.isVisible(), false);
	assert.equal(f.model.buffer.getText(), f.edited); assert.equal(f.model.version, f.version); assert.equal(f.model.canUndo, true);
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, f.cycles);
});

test('actual inspector and source attachments preserve user-opened Files and Problems reading state', t => {
	const f = fixture(t), files = f.editor.resourcePanel, tree = files.files.tree;
	for (let index = 0; index < 20; index++) resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, f.resource(index));
	resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, f.resource(50));
	f.editor.diagnostics.computePending();
	assert.ok(problemsPanel.getDiagnostics().length >= 20, 'the real diagnostics producer supplies a scrollable authored-error list');
	files.show(); files.queuePendingSelection(f.resource(40)); files.applyPendingSelection();
	files.navigateFiles('left'); files.navigateFiles('left');
	const selectedFolder = files.files.selectedNode!; assert.equal(selectedFolder.collapsed, true);
	files.setScroll(10); const fileScroll = files.scroll; assert.ok(fileScroll > 0);
	problemsPanel.show();
	// This is explicit user part-size intent, not a pane-position or layout oracle.
	problemsPanel.setFixedHeightPx(73); problemsPanel.setSelectionIndex(14);
	problemsPanel.handlePointerWheel(12, getProblemsPanelBounds()!);
	const selectedDiagnostic = problemsPanel.selectedDiagnostic, diagnostics = problemsPanel.getDiagnostics(), problemScroll = problemsPanel.getScrollIndex();
	assert.ok(problemScroll > 0);
	const unchanged = () => {
		assert.equal(files.isVisible(), true); assert.equal(files.getMode(), 'resources'); assert.ok(files.files.tree === tree);
		assert.ok(files.files.selectedNode === selectedFolder); assert.equal(selectedFolder.collapsed, true); assert.equal(files.scroll, fileScroll);
		assert.equal(problemsPanel.isVisible, true); assert.ok(problemsPanel.getDiagnostics() === diagnostics);
		assert.ok(problemsPanel.selectedDiagnostic === selectedDiagnostic); assert.equal(problemsPanel.getScrollIndex(), problemScroll);
		assert.equal(problemsPanel.visibleHeight, 73, 'switching editors cannot replace the explicitly requested part size');
		assert.equal(f.model.buffer.getText(), f.edited); assert.equal(f.model.version, f.version); assert.equal(f.model.canUndo, true);
		assert.equal(f.host.runtime.machine.scheduler.nowCycles, f.cycles);
	};
	openGpuDebugger(f.editor.editorParts.main.activeGroup, f.editor.gpu); f.editor.update(0);
	const gpu = f.editor.editorParts.main.activeGroup.model.activeTab!;
	assert.equal(gpu.kind, 'gpu_debugger'); unchanged();
	f.editor.editorParts.main.activeGroup.activate(f.input.id); f.editor.update(0);
	assert.ok(f.editor.editorParts.main.activeGroup.model.activeTab === f.input); assert.ok(f.pane.code.model === f.model); assert.ok(f.pane.code.view === f.view); unchanged();
	f.editor.editorParts.main.activeGroup.openEditor(resolveLuaCodeEditorInput(f.sources.catalog, f.resource(50))); f.editor.update(0); unchanged();
	assert.ok(f.editor.editorParts.main.activeGroup.model.activeTab!.resource === f.resource(50));
	f.editor.editorParts.main.activeGroup.activate(f.input.id); f.editor.update(0); unchanged();
	f.key('KeyZ', KeyModifier.ctrl); assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canRedo, true);
	files.setFocused(true); files.hide(); assert.equal(files.isVisible(), false); assert.equal(files.isFocused(), false);
	problemsPanel.setFocused(true); inputFocus.moveFocus(false); assert.equal(problemsPanel.header.hasFocus, true); problemsPanel.hide(); assert.equal(problemsPanel.isVisible, false); assert.equal(problemsPanel.header.hasFocus, false);
});

test('actual inspector and source attachments leave Call Hierarchy expansion and reading ownership intact', t => {
	const f = fixture(t), panel = f.editor.resourcePanel;
	const calls = 'local function target() end\n'
		+ Array.from({ length: 20 }, (_, index) => `local function caller_${index}() target() end`).join('\n') + '\n'
		+ Array.from({ length: 40 }, (_, index) => `local function leaf_${index}() caller_0() end`).join('\n');
	const project = new EditorLuaSemanticProject(TEST_SYSTEM_CONTEXT_ID, new EditorTextModelService());
	const callsResource = { contextId: TEST_SYSTEM_CONTEXT_ID, path: 'calls.lua' };
	project.updateDocument(callsResource, calls);
	t.after(() => project.dispose());
	const frontend = buildLuaSemanticFrontendFromSnapshot(project.getSnapshot());
	const symbol = frontend.findSymbolsByPosition(resourceIdentityKey(callsResource), 1, 16)!;
	const hierarchy = new CallHierarchyModel(frontend, [symbol.targets[0].id], 'target', project);
	panel.showCallHierarchy(hierarchy); panel.prepareLayout();
	const firstLevel = panel.itemCount;
	panel.setSelectionIndex(1); panel.expandSelectedCallHierarchyNode();
	assert.ok(panel.itemCount > firstLevel, 'the real semantic producer supplied a nested expanded branch');
	panel.setSelectionIndex(25); panel.setScroll(10);
	const count = panel.itemCount, selected = panel.selectionIndex, scroll = panel.scroll; assert.ok(scroll > 0);
	const unchanged = () => {
		assert.equal(panel.isVisible(), true); assert.equal(panel.getMode(), 'command'); assert.equal(panel.itemCount, count);
		assert.equal(panel.selectionIndex, selected); assert.equal(panel.scroll, scroll);
		assert.equal(f.model.buffer.getText(), f.edited); assert.equal(f.model.version, f.version); assert.equal(f.model.canUndo, true);
		assert.equal(f.host.runtime.machine.scheduler.nowCycles, f.cycles);
	};
	openGpuDebugger(f.editor.editorParts.main.activeGroup, f.editor.gpu); f.editor.update(0); unchanged();
	f.editor.editorParts.main.activeGroup.activate(f.input.id); f.editor.update(0); unchanged();
	f.editor.editorParts.main.activeGroup.openEditor(resolveLuaCodeEditorInput(f.sources.catalog, f.resource(50))); f.editor.update(0); unchanged();
	panel.setSelectionIndex(1); panel.collapseSelectedCallHierarchyNode();
	assert.equal(panel.itemCount, firstLevel, 'the same retained hierarchy still owns its expanded branch');
	panel.setFocused(true); panel.hide();
	assert.equal(panel.isVisible(), false); assert.equal(panel.isFocused(), false); assert.equal(panel.getMode(), 'resources');
});

test('outgoing source presentation retires without clearing the retained context of another editor', t => {
	const f = fixture(t), context = f.input.context;
	f.pane.showRuntimeError(2, 1, 'Source presentation lifetime');
	const overlay = f.pane.code.runtimeError.activeOverlay, stop = f.pane.code.runtimeError.executionStopRow;
	assert.ok(overlay !== null); assert.ok(stop !== null);
	f.pane.code.caret.cursorRevealSuspended = true;
	openGpuDebugger(f.editor.editorParts.main.activeGroup, f.editor.gpu); f.editor.update(0);
	assert.equal(f.pane.code.runtimeError.activeOverlay, null); assert.equal(f.pane.code.runtimeError.executionStopRow, null);
	assert.equal(f.pane.code.caret.cursorRevealSuspended, false);
	assert.ok(context.runtimeErrorOverlay === overlay); assert.equal(context.executionStopRow, stop);
	f.editor.editorParts.main.activeGroup.activate(f.input.id); f.editor.update(0);
	assert.ok(f.pane.code.runtimeError.activeOverlay === overlay); assert.equal(f.pane.code.runtimeError.executionStopRow, stop);
	const other = resolveLuaCodeEditorInput(f.sources.catalog, f.resource(50));
	f.editor.editorParts.main.activeGroup.openEditor(other); f.editor.update(0);
	assert.equal(f.pane.code.runtimeError.activeOverlay, null); assert.equal(f.pane.code.runtimeError.executionStopRow, null);
	assert.ok(context.runtimeErrorOverlay === overlay); assert.equal(context.executionStopRow, stop);
	f.editor.editorParts.main.activeGroup.activate(f.input.id); f.editor.update(0);
	assert.ok(f.pane.code.model === f.model && f.pane.code.view === f.view);
	assert.ok(f.pane.code.runtimeError.activeOverlay === overlay); assert.equal(f.pane.code.runtimeError.executionStopRow, stop);
	assert.equal(f.model.buffer.getText(), f.edited); assert.equal(f.model.version, f.version);
	assert.equal(f.model.canUndo, true); assert.equal(f.host.runtime.machine.scheduler.nowCycles, f.cycles);
});

test('source presentation clears on workbench retirement and last-input close, then restores only its retained source', t => {
	const f = fixture(t), context = f.input.context;
	f.pane.showRuntimeError(2, 1, 'Retained source presentation');
	const overlay = f.pane.code.runtimeError.activeOverlay, stop = f.pane.code.runtimeError.executionStopRow;
	assert.ok(overlay !== null && stop !== null);
	f.editor.deactivate();
	assert.equal(f.pane.code.runtimeError.activeOverlay, null); assert.equal(f.pane.code.runtimeError.executionStopRow, null);
	assert.ok(context.runtimeErrorOverlay === overlay); assert.equal(context.executionStopRow, stop);
	f.editor.activate(); f.editor.update(0);
	assert.ok(f.pane.code.model === f.model && f.editor.editorParts.main.activeGroup.model.activeTab === f.input);
	assert.ok(f.pane.code.runtimeError.activeOverlay === overlay); assert.equal(f.pane.code.runtimeError.executionStopRow, stop);
	f.model.completeSave(f.model.createSnapshot());
	f.editor.editorParts.main.activeGroup.close(f.input.id);
	assert.equal(f.editor.editorParts.main.activeGroup.model.activeTab, null); assert.equal(f.pane.code.model, null);
	assert.equal(f.pane.code.runtimeError.activeOverlay, null); assert.equal(f.pane.code.runtimeError.executionStopRow, null);
	assert.equal(focusRuntimeErrorOverlay(f.editor.editorParts.main.activeGroup), false);
	assert.equal(f.editor.editorParts.main.activeGroup.model.activeTab, null, 'a closed error view cannot regain admission through overlay focus');
	const reopened = resolveLuaCodeEditorInput(f.sources.catalog, f.model.resource);
	t.after(() => reopened.dispose());
	assert.equal(reopened.workingCopy, f.model);
	assert.equal(reopened.context.runtimeErrorOverlay, null);
	assert.equal(reopened.context.executionStopRow, null);
	assert.equal(f.model.buffer.getText(), f.edited); assert.equal(f.model.version, f.version);
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, f.cycles);
});

test('an already-focused Source loses native editing admission and pending Paste when its entire body is withheld', async t => {
	const f = fixture(t);
	f.pane.code.focusTarget.focus();
	assert.ok(f.editor.textTarget !== undefined && f.editor.clipboardTarget !== undefined);
	const pending = Promise.withResolvers<ClipboardContents>();
	const read = t.mock.method(f.clipboard, 'read', () => pending.promise), execute = t.mock.method(f.clipboard, 'execute');
	f.key('KeyV', KeyModifier.ctrl); assert.equal(read.mock.callCount(), 1);
	problemsPanel.show(); problemsPanel.setFixedHeightPx(editorViewState.viewportHeight * 4); f.editor.update(0);
	pending.resolve({ text: 'late asynchronous paste', images: [] }); await pending.promise;
	assert.ok(f.editor.textTarget === undefined, 'zero-body Source must not publish a native editing target');
	assert.ok(f.editor.clipboardTarget === undefined, 'zero-body Source must not publish its clipboard capability');
	assert.ok(inputFocus.admittedTarget !== f.pane.code.focusTarget);
	f.key('Backspace'); f.key('KeyX', KeyModifier.ctrl); f.key('KeyV', KeyModifier.ctrl); f.key('KeyZ', KeyModifier.ctrl);
	assert.equal(read.mock.callCount(), 1); assert.equal(execute.mock.callCount(), 0);
	assert.equal(f.model.buffer.getText(), f.edited); assert.equal(f.model.version, f.version);
	problemsPanel.hide(); f.editor.update(0);
	assert.ok(f.editor.textTarget === undefined, 'recovering layout does not silently steal keyboard focus');
	f.pane.code.focusTarget.focus();
	assert.ok(f.editor.textTarget !== undefined && f.editor.clipboardTarget !== undefined);
	assert.ok(f.pane.code.model === f.model && f.editor.editorParts.main.activeGroup.model.activeTab === f.input);
	f.key('KeyZ', KeyModifier.ctrl); assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canRedo, true);
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, f.cycles);
});

test('withholding Source body retains its authored reading position, cursor and selection until fresh focus', t => {
	const f = fixture(t, '-- retained reading context\n'.repeat(100) + 'return 42');
	f.key('End', KeyModifier.ctrl); f.key('ArrowUp', KeyModifier.shift);
	const scroll = f.view.scrollRow, row = f.view.cursorRow, column = f.view.cursorColumn;
	const anchor = { ...f.view.selectionAnchor! };
	assert.ok(scroll > 0 && f.view.selectionAnchor !== null, 'real source navigation established a scrolled selection near EOF');
	problemsPanel.show(); problemsPanel.setFixedHeightPx(editorViewState.viewportHeight * 4); f.editor.update(0);
	assert.equal(f.view.scrollRow, scroll, 'zero-body layout cannot replace retained reading intent with a one-row viewport');
	assert.equal(f.view.cursorRow, row); assert.equal(f.view.cursorColumn, column); assert.deepEqual(f.view.selectionAnchor, anchor);
	problemsPanel.hide(); f.editor.update(0);
	assert.equal(f.view.scrollRow, scroll); assert.equal(f.view.cursorRow, row); assert.equal(f.view.cursorColumn, column);
	assert.deepEqual(f.view.selectionAnchor, anchor); assert.ok(f.editor.textTarget === undefined);
	assert.ok(f.pane.code.model === f.model && f.pane.code.view === f.view);
	assert.equal(f.model.buffer.getText(), f.edited); assert.equal(f.model.version, f.version);
	f.editor.editorParts.main.activeGroup.panes.activePane!.focus(); f.key('KeyZ', KeyModifier.ctrl);
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canRedo, true);
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, f.cycles);
});

test('ordinary inspector return preserves manual Source reading away from its retained caret', t => {
	const f = fixture(t, '-- retained reading context\n'.repeat(100) + 'return 42');
	f.key('ArrowRight', KeyModifier.shift);
	const bounds = getCodeAreaBounds(f.pane.code);
	f.editor.dispatchWheel({ x: (bounds.codeLeft + bounds.codeRight) / 2, y: (bounds.codeTop + bounds.codeBottom) / 2,
		deltaX: 0, deltaY: 12, attachmentDeltaY: 12, modifiers: KeyModifier.none, timestamp: 1 });
	f.editor.update(0);
	const scroll = f.view.scrollRow, column = f.view.cursorColumn, anchor = { ...f.view.selectionAnchor! };
	assert.ok(scroll > 0 && f.view.cursorRow === 0 && f.view.selectionAnchor !== null,
		'physical wheel scrolling moved the reading viewport away from its retained source selection');
	openGpuDebugger(f.editor.editorParts.main.activeGroup, f.editor.gpu); f.editor.update(0);
	f.editor.editorParts.main.activeGroup.activate(f.input.id); f.editor.update(0);
	assert.ok(f.pane.code.model === f.model && f.pane.code.view === f.view && f.editor.editorParts.main.activeGroup.model.activeTab === f.input);
	assert.equal(f.view.scrollRow, scroll, 'reattaching the same source geometry is not a request to reveal its offscreen caret');
	assert.equal(f.view.cursorRow, 0); assert.equal(f.view.cursorColumn, column); assert.deepEqual(f.view.selectionAnchor, anchor);
	assert.equal(f.model.buffer.getText(), f.edited); assert.equal(f.model.version, f.version); assert.equal(f.model.canUndo, true);
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, f.cycles);
});

test('the actual Problems sash preserves automatic sizing until motion and commits relative movement through final release', t => {
	const f = fixture(t); t.after(() => pointerCapture.interrupt(false));
	problemsPanel.show(); problemsPanel.setFixedHeightPx(0); f.editor.update(0);
	let bounds = getProblemsPanelBounds()!, x = (bounds.left + bounds.right) / 2;
	let y = (problemsPanel.resizeBounds.top + problemsPanel.resizeBounds.bottom) / 2;
	const automatic = problemsPanel.visibleHeight;
	f.editor.dispatchPointer({ x, y, buttons: PointerButton.Primary, pressedButtons: PointerButton.Primary,
		releasedButtons: 0, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 1 });
	assert.equal(pointerCapture.active, true);
	f.editor.dispatchPointer({ x, y, buttons: PointerButton.Primary, pressedButtons: 0,
		releasedButtons: 0, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 2 });
	f.editor.dispatchPointer({ x, y, buttons: 0, pressedButtons: 0,
		releasedButtons: PointerButton.Primary, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 3 });
	assert.equal(pointerCapture.active, false); assert.equal(problemsPanel.visibleHeight, automatic);
	for (let index = 0; index < 20; index++) resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, f.resource(index));
	f.editor.diagnostics.computePending(); f.editor.update(0);
	assert.ok(problemsPanel.visibleHeight > automatic, 'a stationary sash click must not pin the automatic content-size owner');
	problemsPanel.setFixedHeightPx(73); f.editor.update(0);
	bounds = getProblemsPanelBounds()!; x = (bounds.left + bounds.right) / 2;
	y = bounds.top - PROBLEMS_PANEL_DIVIDER_DRAG_MARGIN;
	f.editor.dispatchPointer({ x, y, buttons: PointerButton.Primary, pressedButtons: PointerButton.Primary,
		releasedButtons: 0, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 4 });
	assert.equal(pointerCapture.active, true);
	assert.equal(problemsPanel.visibleHeight, 73, 'grabbing the divider margin cannot jump the requested part size');
	f.editor.dispatchPointer({ x, y: y - 12, buttons: PointerButton.Primary, pressedButtons: 0,
		releasedButtons: 0, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 5 });
	assert.equal(problemsPanel.visibleHeight, 85, 'continuous drag changes the explicit size by its pointer displacement');
	f.editor.dispatchPointer({ x, y: y - 19, buttons: 0, pressedButtons: 0,
		releasedButtons: PointerButton.Primary, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 6 });
	assert.equal(problemsPanel.visibleHeight, 92, 'the release occurrence contributes its final movement');
	assert.equal(pointerCapture.active, false); assert.equal(pointerCapture.draining, false);
	problemsPanel.setFixedHeightPx(1000000); f.editor.update(0);
	bounds = getProblemsPanelBounds()!; const presented = bounds.bottom - bounds.top;
	x = (bounds.left + bounds.right) / 2; y = (problemsPanel.resizeBounds.top + problemsPanel.resizeBounds.bottom) / 2;
	f.editor.dispatchPointer({ x, y, buttons: PointerButton.Primary, pressedButtons: PointerButton.Primary,
		releasedButtons: 0, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 7 });
	assert.equal(pointerCapture.active, true); assert.equal(problemsPanel.visibleHeight, 1000000);
	f.editor.dispatchPointer({ x, y: y + 12, buttons: 0, pressedButtons: 0,
		releasedButtons: PointerButton.Primary, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 8 });
	assert.equal(problemsPanel.visibleHeight, presented - 12, 'drag begins at the displayed size, not an occluded larger request');
	assert.equal(f.model.buffer.getText(), f.edited); assert.equal(f.model.version, f.version);
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, f.cycles);
});

for (const retirement of ['input-cancel', 'deactivate', 'hide', 'zero-width'] as const) test(`Problems sash ${retirement} retires and drains before a fresh Source click`, t => {
	const f = fixture(t); t.after(() => pointerCapture.interrupt(false));
	problemsPanel.show(); problemsPanel.setFixedHeightPx(73); f.editor.update(0);
	f.ide.overlayRenderer.beginFrame(f.host.presenter); api.beginFrame(f.ide.overlayRenderer);
	f.editor.draw(); f.ide.overlayRenderer.endFrame();
	const caret = { ...f.editor.textTarget!.caretRect() };
	problemsPanel.setFocused(true);
	const bounds = getProblemsPanelBounds()!, x = (bounds.left + bounds.right) / 2;
	const y = (problemsPanel.resizeBounds.top + problemsPanel.resizeBounds.bottom) / 2;
	// The physical producer is down before the corresponding native editor occurrence.
	f.host.input.inputButton('pointer:0', 'pointer_primary', true, 1, 1, 1);
	f.editor.dispatchPointer({ x, y, buttons: PointerButton.Primary, pressedButtons: PointerButton.Primary,
		releasedButtons: 0, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 1 });
	assert.equal(pointerCapture.active, true, 'Problems must own a captured control, not a global resize flag');
	if (retirement === 'input-cancel') f.editor.cancelInput();
	else if (retirement === 'deactivate') { f.editor.deactivate(); f.editor.activate(); f.editor.update(0); }
	else if (retirement === 'hide') { problemsPanel.hide(); problemsPanel.show(); f.editor.update(0); }
	else { f.editor.updateViewport({ width: 0, height: 288 }); f.editor.updateViewport({ width: 384, height: 288 }); f.editor.update(0); }
	assert.equal(pointerCapture.active, false); assert.equal(pointerCapture.draining, true);
	const sourceX = caret.x + caret.width / 2, sourceY = caret.y + caret.height / 2;
	f.editor.dispatchPointer({ x: sourceX, y: sourceY, buttons: PointerButton.Primary, pressedButtons: 0,
		releasedButtons: 0, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 2 });
	assert.equal(problemsPanel.visibleHeight, 73, 'the retired hold cannot resize a recovered part');
	f.host.input.inputButton('pointer:0', 'pointer_primary', false, 0, 3, 1);
	f.editor.dispatchPointer({ x: sourceX, y: sourceY, buttons: 0, pressedButtons: 0,
		releasedButtons: PointerButton.Primary, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 3 });
	assert.equal(pointerCapture.active, false); assert.equal(pointerCapture.draining, false);
	problemsPanel.setFocused(true);
	f.host.input.inputButton('pointer:0', 'pointer_primary', true, 1, 4, 2);
	f.editor.dispatchPointer({ x: sourceX, y: sourceY, buttons: PointerButton.Primary, pressedButtons: PointerButton.Primary,
		releasedButtons: 0, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 4 });
	f.host.input.inputButton('pointer:0', 'pointer_primary', false, 0, 5, 2);
	f.editor.dispatchPointer({ x: sourceX, y: sourceY, buttons: 0, pressedButtons: 0,
		releasedButtons: PointerButton.Primary, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 5 });
	assert.equal(f.pane.code.focusTarget.hasFocus, true, 'the next fresh Source click must not be stolen by the retired sash');
	assert.equal(problemsPanel.visibleHeight, 73);
	assert.equal(f.model.buffer.getText(), f.edited); assert.equal(f.model.version, f.version);
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, f.cycles);
});

test('retiring Problems does not cancel the actual sibling tab-strip scrollbar gesture', t => {
	const f = fixture(t); t.after(() => pointerCapture.interrupt(false));
	problemsPanel.show(); problemsPanel.setFixedHeightPx(73);
	for (let index = 40; index < 48; index++) f.editor.editorParts.main.activeGroup.openEditor(resolveLuaCodeEditorInput(f.sources.catalog, f.resource(index)));
	f.editor.editorParts.main.activeGroup.activate(f.input.id); f.editor.update(0);
	const thumb = f.editor.editorParts.main.activeGroup.tabStrip.scrollbar.getThumb()!; assert.ok(thumb !== null);
	const x = (thumb.left + thumb.right) / 2, y = (thumb.top + thumb.bottom) / 2;
	const scroll = f.editor.editorParts.main.activeGroup.tabStrip.scrollbar.getScroll();
	f.editor.dispatchPointer({ x, y, buttons: PointerButton.Primary, pressedButtons: PointerButton.Primary,
		releasedButtons: 0, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 1 });
	assert.equal(pointerCapture.active, true);
	problemsPanel.hide(); f.editor.update(0);
	assert.equal(pointerCapture.active, true); assert.equal(pointerCapture.draining, false);
	f.editor.dispatchPointer({ x: x + 32, y, buttons: PointerButton.Primary, pressedButtons: 0,
		releasedButtons: 0, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 2 });
	assert.ok(f.editor.editorParts.main.activeGroup.tabStrip.scrollbar.getScroll() > scroll);
	f.editor.dispatchPointer({ x: x + 32, y, buttons: 0, pressedButtons: 0,
		releasedButtons: PointerButton.Primary, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 3 });
	assert.equal(pointerCapture.active, false); assert.equal(pointerCapture.draining, false);
	assert.equal(f.model.buffer.getText(), f.edited); assert.equal(f.model.version, f.version);
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, f.cycles);
});

test('an actual Files scrollbar gesture survives sibling editor activation while a source gesture retires and drains', t => {
	const source = 'local value = 42\n' + 'value = value + 1\n'.repeat(60) + 'return value';
	const f = fixture(t, source), files = f.editor.resourcePanel;
	t.after(() => pointerCapture.interrupt(false));
	files.show(); files.queuePendingSelection(f.resource(40)); files.applyPendingSelection();
	f.editor.update(0); files.prepareLayout();
	const thumb = f.editor.resourcePanel.resourceVertical.getThumb()!;
	assert.ok(thumb !== null);
	const x = (thumb.left + thumb.right) / 2, y = (thumb.top + thumb.bottom) / 2;
	// Published thumb bounds are input targets, never a pixel-position oracle.
	f.editor.dispatchPointer({ x, y, buttons: PointerButton.Primary, pressedButtons: PointerButton.Primary,
		releasedButtons: 0, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 1 });
	const chrome = pointerCapture.routeScope;
	assert.ok(pointerCapture.active && chrome !== undefined && chrome !== f.editor.editorParts.main.activeGroup.captureScope);
	const sourceScroll = f.view.scrollRow, fileScroll = files.scroll;
	openGpuDebugger(f.editor.editorParts.main.activeGroup, f.editor.gpu); f.editor.update(0);
	assert.ok(pointerCapture.active && pointerCapture.routeScope === chrome && !pointerCapture.draining);
	f.editor.editorParts.main.activeGroup.activate(f.input.id); f.editor.update(0);
	assert.ok(pointerCapture.active && pointerCapture.routeScope === chrome);
	f.editor.dispatchPointer({ x, y: y + 24, buttons: PointerButton.Primary, pressedButtons: 0,
		releasedButtons: 0, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 2 });
	assert.ok(files.scroll > fileScroll); assert.equal(f.view.scrollRow, sourceScroll);
	f.editor.dispatchPointer({ x, y: y + 24, buttons: 0, pressedButtons: 0,
		releasedButtons: PointerButton.Primary, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 3 });
	assert.equal(pointerCapture.active, false);
	f.ide.overlayRenderer.beginFrame(f.host.presenter); api.beginFrame(f.ide.overlayRenderer);
	f.editor.draw(); f.ide.overlayRenderer.endFrame();
	const codeThumb = f.pane.code.scrollbars.codeVertical.getThumb()!;
	assert.ok(codeThumb !== null);
	const codeX = (codeThumb.left + codeThumb.right) / 2, codeY = (codeThumb.top + codeThumb.bottom) / 2;
	f.editor.dispatchPointer({ x: codeX, y: codeY, buttons: PointerButton.Primary, pressedButtons: PointerButton.Primary,
		releasedButtons: 0, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 4 });
	assert.ok(pointerCapture.active && pointerCapture.routeScope === f.editor.editorParts.main.activeGroup.captureScope);
	const retainedFiles = files.scroll, retainedSource = f.view.scrollRow;
	openGpuDebugger(f.editor.editorParts.main.activeGroup, f.editor.gpu); f.editor.update(0);
	assert.equal(pointerCapture.active, false); assert.equal(pointerCapture.draining, true);
	f.editor.dispatchPointer({ x, y: y + 48, buttons: PointerButton.Primary, pressedButtons: 0,
		releasedButtons: 0, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 5 });
	assert.equal(files.scroll, retainedFiles); assert.equal(f.view.scrollRow, retainedSource);
	f.editor.dispatchPointer({ x, y: y + 48, buttons: 0, pressedButtons: 0,
		releasedButtons: PointerButton.Primary, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 6 });
	assert.equal(pointerCapture.active, false); assert.equal(pointerCapture.draining, false);
	assert.equal(f.model.buffer.getText(), f.edited); assert.equal(f.model.version, f.version);
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, f.cycles);
});

for (const mode of ['resources', 'command'] as const) test(`${mode} open intent survives whole-Studio suspension without resetting its retained reading owner`, t => {
	const f = fixture(t), panel = f.editor.resourcePanel;
	t.after(() => pointerCapture.interrupt(false));
	if (mode === 'resources') {
		panel.show(); panel.queuePendingSelection(f.resource(40)); panel.applyPendingSelection();
		panel.navigateFiles('left'); panel.navigateFiles('left');
	} else {
		const calls = 'local function target() end\n'
			+ Array.from({ length: 20 }, (_, index) => `local function caller_${index}() target() end`).join('\n') + '\n'
			+ Array.from({ length: 40 }, (_, index) => `local function leaf_${index}() caller_0() end`).join('\n');
		const project = new EditorLuaSemanticProject(TEST_SYSTEM_CONTEXT_ID, new EditorTextModelService());
		const callsResource = { contextId: TEST_SYSTEM_CONTEXT_ID, path: 'calls.lua' };
		project.updateDocument(callsResource, calls);
		t.after(() => project.dispose());
		const frontend = buildLuaSemanticFrontendFromSnapshot(project.getSnapshot());
		const symbol = frontend.findSymbolsByPosition(resourceIdentityKey(callsResource), 1, 16)!;
		panel.showCallHierarchy(new CallHierarchyModel(frontend, [symbol.targets[0].id], 'target', project));
		panel.setSelectionIndex(1); const firstLevel = panel.itemCount; panel.expandSelectedCallHierarchyNode();
		assert.ok(panel.itemCount > firstLevel); panel.setSelectionIndex(25);
	}
	panel.setRatioFromViewportX(144, editorViewState.viewportWidth);
	panel.setScroll(10); panel.setFocused(true); f.editor.update(0); panel.prepareLayout();
	const selected = panel.selectionIndex, count = panel.itemCount, scroll = panel.scroll, filesNode = panel.files.selectedNode;
	const requestedWidth = panel.getBounds()!.right - panel.getBounds()!.left;
	const thumb = panel.resourceVertical.getThumb()!; assert.ok(thumb !== null);
	const x = (thumb.left + thumb.right) / 2, y = (thumb.top + thumb.bottom) / 2;
	f.editor.dispatchPointer({ x, y, buttons: PointerButton.Primary, pressedButtons: PointerButton.Primary,
		releasedButtons: 0, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 1 });
	assert.equal(pointerCapture.active, true);
	assert.ok(scroll > 0);
	f.editor.deactivate();
	assert.equal(panel.visible, true, 'suspending Studio revokes presentation, not explicit open intent');
	assert.equal(pointerCapture.active, false); assert.equal(pointerCapture.draining, true);
	assert.equal(panel.isFocused(), false); assert.equal(panel.getBounds(), null);
	assert.equal(panel.getMode(), mode); assert.equal(panel.selectionIndex, selected); assert.equal(panel.itemCount, count); assert.equal(panel.scroll, scroll);
	panel.setFocused(true); assert.equal(panel.isFocused(), false, 'an unavailable part cannot regain focus');
	f.editor.activate(); f.editor.update(0);
	assert.equal(panel.visible, true); assert.equal(panel.getMode(), mode); assert.equal(panel.selectionIndex, selected);
	assert.equal(panel.itemCount, count); assert.equal(panel.scroll, scroll); assert.ok(panel.files.selectedNode === filesNode);
	assert.ok(panel.getBounds() !== null);
	// The committed user-sized span, at the same viewport, is the layout contract here.
	assert.equal(panel.getBounds()!.right - panel.getBounds()!.left, requestedWidth);
	f.editor.dispatchPointer({ x, y: y + 24, buttons: PointerButton.Primary, pressedButtons: 0,
		releasedButtons: 0, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 2 });
	assert.equal(panel.scroll, scroll, 'resuming Studio cannot turn an old hold into a new scrollbar gesture');
	f.editor.dispatchPointer({ x, y: y + 24, buttons: 0, pressedButtons: 0,
		releasedButtons: PointerButton.Primary, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 3 });
	assert.equal(pointerCapture.draining, false);
	panel.prepareLayout();
	const liveThumb = panel.resourceVertical.getThumb()!;
	const liveX = (liveThumb.left + liveThumb.right) / 2, liveY = (liveThumb.top + liveThumb.bottom) / 2;
	f.editor.dispatchPointer({ x: liveX, y: liveY, buttons: PointerButton.Primary, pressedButtons: PointerButton.Primary,
		releasedButtons: 0, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 4 });
	assert.equal(pointerCapture.active, true);
	// Another real workbench part consumes the editor client, while the physical canvas stays available.
	problemsPanel.show(); problemsPanel.setFixedHeightPx(1000000); f.editor.update(0);
	assert.equal(panel.visible, true); assert.equal(panel.getBounds(), null); assert.equal(panel.isFocused(), false);
	assert.equal(getWorkbenchEditorBounds().left, 0, 'an unavailable part contributes no editor-client inset in the same composition');
	assert.equal(pointerCapture.active, false); assert.equal(pointerCapture.draining, true);
	assert.equal(panel.resourceVertical.getThumb(), null); assert.equal(panel.resourceHorizontal.getThumb(), null);
	panel.setFocused(true); assert.ok(inputFocus.admittedTarget !== panel.focusTarget);
	assert.equal(panel.handleScrollbarPointer({ valid: true, insideViewport: true,
		viewportX: liveX, viewportY: liveY, pressedButtons: PointerButton.Primary,
		justPressedButtons: PointerButton.Primary, justReleasedButtons: 0 }), false,
		'a zero-area part cannot begin a scrollbar gesture through old track geometry');
	f.editor.dispatchWheel({ x: liveX, y: liveY, deltaX: 0, deltaY: 5, attachmentDeltaY: 5, modifiers: KeyModifier.none, timestamp: 5 });
	f.editor.dispatchPointer({ x: liveX, y: liveY + 24, buttons: PointerButton.Primary, pressedButtons: 0,
		releasedButtons: 0, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 6 });
	assert.equal(panel.scroll, scroll); assert.equal(panel.selectionIndex, selected); assert.equal(panel.getMode(), mode);
	f.editor.updateViewport({ width: 512, height: 288 }); f.editor.update(0);
	assert.equal(panel.getBounds(), null); assert.equal(panel.visible, true);
	problemsPanel.hide(); f.editor.update(0); panel.prepareLayout();
	assert.equal(getWorkbenchEditorBounds().left, panel.resizeBounds.right, 'recovery publishes the actual part and its reserved sash lane before editor layout');
	assert.equal(panel.getMode(), mode); assert.equal(panel.itemCount, count); assert.equal(panel.scroll, scroll);
	f.editor.dispatchPointer({ x: liveX, y: liveY + 24, buttons: PointerButton.Primary, pressedButtons: 0,
		releasedButtons: 0, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 7 });
	assert.equal(panel.scroll, scroll, 'layout recovery cannot replay the retired hold');
	f.editor.dispatchPointer({ x: liveX, y: liveY + 24, buttons: 0, pressedButtons: 0,
		releasedButtons: PointerButton.Primary, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 8 });
	assert.equal(pointerCapture.draining, false);
	assert.equal(panel.handleScrollbarPointer({ valid: true, insideViewport: true,
		viewportX: liveX, viewportY: liveY, pressedButtons: PointerButton.Primary,
		justPressedButtons: PointerButton.Primary, justReleasedButtons: 0 }), false,
		'the recovered part cannot admit a drag at its obsolete pre-resize thumb');
	const recoveredThumb = panel.resourceVertical.getThumb()!; assert.ok(recoveredThumb !== null);
	const recoveredX = (recoveredThumb.left + recoveredThumb.right) / 2, recoveredY = (recoveredThumb.top + recoveredThumb.bottom) / 2;
	f.editor.dispatchPointer({ x: recoveredX, y: recoveredY, buttons: PointerButton.Primary, pressedButtons: PointerButton.Primary,
		releasedButtons: 0, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 9 });
	assert.equal(pointerCapture.active, true);
	f.editor.dispatchPointer({ x: recoveredX, y: recoveredY + 24, buttons: PointerButton.Primary, pressedButtons: 0,
		releasedButtons: 0, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 10 });
	assert.ok(panel.scroll > scroll, 'freshly published thumb geometry admits a new actual gesture after recovery');
	f.editor.dispatchPointer({ x: recoveredX, y: recoveredY + 24, buttons: 0, pressedButtons: 0,
		releasedButtons: PointerButton.Primary, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 11 });
	assert.equal(pointerCapture.active, false); assert.equal(pointerCapture.draining, false);
	const dividerX = panel.layout.dividerLeft, dividerY = (panel.getBounds()!.top + panel.getBounds()!.bottom) / 2;
	const committedSpan = panel.getBounds()!.right - panel.getBounds()!.left;
	f.editor.dispatchPointer({ x: dividerX, y: dividerY, buttons: PointerButton.Primary, pressedButtons: PointerButton.Primary,
		releasedButtons: 0, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 12 });
	assert.equal(pointerCapture.active, true, 'the actual resource sash, not a resize flag, owns its hold');
	problemsPanel.show(); problemsPanel.setFixedHeightPx(1000000); f.editor.update(0);
	assert.equal(pointerCapture.active, false); assert.equal(pointerCapture.draining, true);
	problemsPanel.hide(); f.editor.update(0);
	f.editor.dispatchPointer({ x: dividerX + 32, y: dividerY, buttons: PointerButton.Primary, pressedButtons: 0,
		releasedButtons: 0, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 13 });
	assert.equal(panel.getBounds()!.right - panel.getBounds()!.left, committedSpan, 'the retired sash hold cannot resize the recovered part');
	f.editor.dispatchPointer({ x: dividerX + 32, y: dividerY, buttons: 0, pressedButtons: 0,
		releasedButtons: PointerButton.Primary, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 14 });
	assert.equal(pointerCapture.draining, false);
	f.editor.dispatchPointer({ x: dividerX, y: dividerY, buttons: PointerButton.Primary, pressedButtons: PointerButton.Primary,
		releasedButtons: 0, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 15 });
	assert.equal(pointerCapture.active, true);
	f.editor.dispatchPointer({ x: dividerX + 32, y: dividerY, buttons: PointerButton.Primary, pressedButtons: 0,
		releasedButtons: 0, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 16 });
	assert.ok(panel.getBounds()!.right - panel.getBounds()!.left > committedSpan, 'a fresh admitted sash gesture still changes the user size intent');
	f.editor.dispatchPointer({ x: dividerX + 32, y: dividerY, buttons: 0, pressedButtons: 0,
		releasedButtons: PointerButton.Primary, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 17 });
	// This strip belongs to an independent host: Problems withholds Main and Files,
	// so a Main-owned strip would correctly lose its physical capture as well.
	const tabGroup = f.editor.editorParts.createDocument().activeGroup, tabSource = new CodeEditorInput(f.model);
	tabGroup.openEditor(tabSource);
	for (let index = 40; index < 48; index++) tabGroup.openEditor(resolveLuaCodeEditorInput(f.sources.catalog, f.resource(index)));
	tabGroup.activate(tabSource.id); f.editor.update(0);
	const tabThumb = tabGroup.tabStrip.scrollbar.getThumb()!; assert.ok(tabThumb !== null);
	const tabX = (tabThumb.left + tabThumb.right) / 2, tabY = (tabThumb.top + tabThumb.bottom) / 2;
	const tabScroll = tabGroup.tabStrip.scrollbar.getScroll(), fileScroll = panel.scroll;
	f.editor.dispatchPointer({ x: tabX, y: tabY, buttons: PointerButton.Primary, pressedButtons: PointerButton.Primary,
		releasedButtons: 0, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 18 });
	assert.equal(pointerCapture.active, true);
	problemsPanel.show(); problemsPanel.setFixedHeightPx(1000000); f.editor.update(0);
	assert.equal(panel.getBounds(), null); assert.equal(panel.visible, true);
	assert.equal(pointerCapture.active, true, 'withholding Files cannot cancel a sibling tab-strip capture');
	assert.equal(pointerCapture.draining, false);
	f.editor.dispatchPointer({ x: tabX + 32, y: tabY, buttons: PointerButton.Primary, pressedButtons: 0,
		releasedButtons: 0, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 19 });
	assert.ok(tabGroup.tabStrip.scrollbar.getScroll() > tabScroll); assert.equal(panel.scroll, fileScroll);
	f.editor.dispatchPointer({ x: tabX + 32, y: tabY, buttons: 0, pressedButtons: 0,
		releasedButtons: PointerButton.Primary, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 20 });
	assert.equal(pointerCapture.active, false); problemsPanel.hide(); f.editor.update(0);
	assert.equal(f.model.buffer.getText(), f.edited); assert.equal(f.model.version, f.version);
	assert.equal(f.model.canUndo, true); assert.equal(f.host.runtime.machine.scheduler.nowCycles, f.cycles);
	panel.hide(); assert.equal(panel.visible, false); assert.equal(panel.getMode(), 'resources');
});

for (const stage of ['visible', 'pending', 'pending-roundtrip'] as const) test(`completion readonly publication retires its ${stage} automatic session without changing authored history`, t => {
	const f = fixture(t);
	f.key('End', KeyModifier.ctrl);
	assert.equal(f.editor.textTarget!.replaceText(f.model.buffer.length, f.model.buffer.length, '\nretur'), true);
	if (stage === 'visible') {
		f.host.clock.advance(200); f.editor.update(0.2);
		assert.equal(f.pane.code.inlineEdit.active, true); assert.equal(f.pane.completion.session!.trigger, 'typing');
	} else assert.ok(f.pane.completion.session === null);
	const source = f.model.buffer.getText(), version = f.model.version, resource = f.model.resource;
	const canUndo = f.model.canUndo, canRedo = f.model.canRedo;
	f.model.refreshResource({ ...resource, source: { ...resource.source!, generated: true } });
	assert.equal(f.model.readOnly, true);
	assert.equal(f.pane.code.inlineEdit.active, false, 'metadata publication must synchronously retire the admitted ghost');
	assert.ok(f.pane.completion.session === null);
	if (stage === 'pending-roundtrip') f.model.refreshResource(resource);
	f.host.clock.advance(200); f.editor.update(0.2);
	assert.equal(f.pane.code.inlineEdit.active, false); assert.ok(f.pane.completion.session === null);
	const tab = new KeyInputEvent('Tab', KeyModifier.none);
	assert.equal(f.pane.completion.handleKeybindings(tab), false); assert.equal(tab.consumed, false);
	assert.equal(f.model.buffer.getText(), source); assert.equal(f.model.version, version);
	assert.equal(f.model.canUndo, canUndo); assert.equal(f.model.canRedo, canRedo);
	f.model.refreshResource(resource); f.host.clock.advance(200); f.editor.update(0.2);
	assert.equal(f.pane.code.inlineEdit.active, false); assert.ok(f.pane.completion.session === null);
	assert.equal(f.model.buffer.getText(), source); assert.equal(f.model.version, version);
	assert.equal(f.model.canUndo, canUndo); assert.equal(f.model.canRedo, canRedo);
	f.key('Tab');
	assert.equal(f.model.buffer.getText(), source + f.model.language.indentationUnit,
		'writable return admits ordinary Tab indentation, not a resurrected source completion');
	assert.equal(f.model.version, version + 1);
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, f.cycles);
});

test('completion readonly subscription belongs only to the attached canonical model', t => {
	const f = fixture(t), previous = f.model;
	const other = resolveLuaCodeEditorInput(f.sources.catalog, f.resource(50));
	const model = other.context.model, subscribe = model.onDidChangeReadOnly;
	let subscriptions = 0;
	t.mock.method(model, 'onDidChangeReadOnly', listener => {
		const unbind = subscribe.call(model, listener); subscriptions++;
		return () => { subscriptions--; unbind(); };
	});
	f.editor.editorParts.main.activeGroup.openEditor(other); f.editor.update(0);
	assert.equal(subscriptions, 1);
	f.key('End', KeyModifier.ctrl);
	assert.equal(f.editor.textTarget!.replaceText(model.buffer.length, model.buffer.length, '\nretur'), true);
	f.host.clock.advance(200); f.editor.update(0.2);
	const session = f.pane.completion.session, ghostVersion = f.pane.code.inlineEdit.version;
	assert.ok(session !== null && f.pane.code.inlineEdit.active);
	previous.refreshResource({ ...previous.resource, source: { ...previous.resource.source!, generated: true } });
	assert.ok(f.pane.code.model === model); assert.ok(f.pane.completion.session === session);
	assert.equal(f.pane.code.inlineEdit.active, true); assert.equal(f.pane.code.inlineEdit.version, ghostVersion);
	for (let index = 0; index < 3; index++) { f.editor.editorParts.main.activeGroup.activate(other.id); f.editor.update(0); }
	assert.equal(subscriptions, 1, 'same-input reselection does not reattach the readonly observer');
	const source = model.buffer.getText(), version = model.version;
	model.refreshResource({ ...model.resource, source: { ...model.resource.source!, generated: true } });
	assert.ok(f.pane.completion.session === null); assert.equal(f.pane.code.inlineEdit.active, false);
	assert.equal(f.pane.code.inlineEdit.version, ghostVersion + 1);
	assert.equal(model.buffer.getText(), source); assert.equal(model.version, version);
	assert.equal(previous.buffer.getText(), f.edited); assert.equal(previous.version, f.version);
	f.editor.editorParts.main.activeGroup.activate(f.input.id); f.editor.update(0);
	assert.equal(subscriptions, 0, 'detaching the source retires its readonly observer');
});

test('a stationary captured tab drag advances from the actual host frame without pointer polling or guest execution', t => {
	const f = fixture(t); t.after(() => pointerCapture.interrupt(false));
	for (let index = 40; index < 52; index++) {
		f.editor.editorParts.main.activeGroup.openEditor(resolveLuaCodeEditorInput(f.sources.catalog, f.resource(index)));
		f.editor.update(0);
	}
	const input = f.editor.editorParts.main.activeGroup.model.activeTab!, bounds = f.editor.editorParts.main.activeGroup.tabStrip.layoutState.items.peek(f.editor.editorParts.main.activeGroup.model.indexOf(f.editor.editorParts.main.activeGroup.model.findById(input.id)!)).bounds;
	const viewport = f.editor.editorParts.main.activeGroup.tabStrip.layoutState.viewportBounds, bar = f.editor.editorParts.main.activeGroup.tabStrip.scrollbar;
	assert.ok(bar.getScroll() > 0, 'real retained source tabs must overflow the strip before an edge hold');
	const x = Math.max(bounds.left, viewport.left) + 3, y = bounds.top + 1;
	f.editor.dispatchPointer({ x, y, buttons: PointerButton.Primary, pressedButtons: PointerButton.Primary,
		releasedButtons: 0, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: f.host.clock.now() });
	assert.equal(pointerCapture.active, true);
	f.host.clock.advance(10);
	const edge = viewport.left + 1;
	f.editor.dispatchPointer({ x: edge, y, buttons: PointerButton.Primary, pressedButtons: 0,
		releasedButtons: 0, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: f.host.clock.now() });
	f.editor.update(0);
	const scroll = bar.getScroll(), order = f.editor.editorParts.main.activeGroup.model.tabs.map(tab => tab.id);
	f.host.clock.advance(500); f.editor.update(0.5);
	assert.ok(bar.getScroll() < scroll, 'host frames, not repeated pointer events, advance a stationary edge hold');
	assert.deepEqual(f.editor.editorParts.main.activeGroup.model.tabs.map(tab => tab.id), order, 'a held drag does not publish a tab reorder');
	const beforeRelease = bar.getScroll();
	f.host.clock.advance(500);
	f.editor.dispatchPointer({ x: edge, y, buttons: 0, pressedButtons: 0,
		releasedButtons: PointerButton.Primary, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: f.host.clock.now() });
	assert.equal(bar.getScroll(), beforeRelease, 'release resolves the drop without an extra temporal scroll step');
	assert.equal(pointerCapture.active, false); assert.ok(f.editor.editorParts.main.activeGroup.tabStrip.drag.state === null);
	assert.equal(f.model.buffer.getText(), f.edited); assert.equal(f.model.version, f.version);
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, f.cycles);
});

test('Home is an ordinary retained workspace editor and closing all editors leaves the group empty', async t => {
	const f = fixture(t);
	openHome(f.editor.editorParts.main.activeGroup, { id: 'home-source-context', projectRoot: '/workspace/current' }); f.editor.update(0);
	const home = f.editor.editorParts.main.activeGroup.model.activeTab!;
	assert.equal(home.kind, 'home');
	if (home.kind !== 'home') throw new Error('Home contribution');
	assert.deepEqual(home.workspaceContext, { id: 'home-source-context', projectRoot: '/workspace/current' });
	assert.equal(home.resource, undefined);
	assert.equal(home.isDirty(), false);
	assert.ok(f.editor.editorParts.main.activeGroup.panes.activePane!.input === home);
	assert.equal(f.editor.editorParts.main.activeGroup.panes.activePane!.companionGameMinimumWidth, undefined);
	const serialized = f.editor.editorInputSerializers.home.serialize(home);
	assert.equal(serialized, '', 'the attached workspace, not saved cartridge identity, supplies the Home subject');
	f.editor.editorParts.main.activeGroup.activate(f.input.id);
	openHome(f.editor.editorParts.main.activeGroup, { id: 'home-source-context', projectRoot: '/workspace/current' }); f.editor.update(0);
	assert.ok(f.editor.editorParts.main.activeGroup.model.activeTab === home);
	assert.equal(f.editor.editorParts.main.activeGroup.model.tabs.filter(input => input.kind === 'home').length, 1);
	assert.ok(f.editor.editorParts.main.activeGroup.model.tabs.includes(f.input));
	assert.ok(f.input.context.model === f.model);
	assert.equal(f.model.buffer.getText(), f.edited);
	assert.equal(f.model.version, f.version);
	assert.equal(f.model.canUndo, true);
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, f.cycles);
	for (const input of [...f.editor.editorParts.main.activeGroup.model.tabs]) {
		const close = f.editor.editorParts.main.activeGroup.close(input.id);
		if (f.editor.editorParts.main.actionPrompt.visible) { f.key('Tab'); f.key('Enter'); }
		assert.equal(await close, true);
	}
	f.editor.update(0);
	assert.equal(f.editor.editorParts.main.activeGroup.model.activeTab, null);
	assert.equal(f.editor.editorParts.main.activeGroup.panes.activePane, null);
	assert.equal(inputFocus.target, null);
	openHome(f.editor.editorParts.main.activeGroup, { id: 'home-source-context', projectRoot: '/workspace/current' }); f.editor.update(0);
	assert.equal(f.editor.editorParts.main.activeGroup.model.activeTab!.kind, 'home');
	assert.ok(f.editor.editorParts.main.activeGroup.model.activeTab !== home);
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, f.cycles);
});

test('Home publishes action geometry before accepting a fresh pointer release', t => {
	const f = fixture(t);
	openHome(f.editor.editorParts.main.activeGroup, { id: 'home-source-context', projectRoot: '/workspace/current' }); f.editor.update(0);
	const home = f.editor.editorParts.main.activeGroup.model.activeTab!;
	if (home.kind !== 'home') throw new Error('Home contribution');
	const bounds = home.sections[0].actions.items[1].bounds;
	const x = (bounds.left + bounds.right) / 2, y = (bounds.top + bounds.bottom) / 2;
	const invoke = t.mock.method(f.editor.commands, 'execute', () => {});
	f.editor.dispatchPointer({ x, y, buttons: PointerButton.Primary, pressedButtons: PointerButton.Primary,
		releasedButtons: 0, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 2 });
	assert.equal(pointerCapture.active, true);
	f.editor.dispatchPointer({ x, y, buttons: 0, pressedButtons: 0,
		releasedButtons: PointerButton.Primary, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 3 });
	assert.equal(invoke.mock.callCount(), 1);
	assert.equal(invoke.mock.calls[0].arguments[0], 'resourceSearch');
	assert.equal(pointerCapture.active, false);
});

test('Home cover revokes both a held action and keyboard admission before the next frame', t => {
	const f = fixture(t);
	openHome(f.editor.editorParts.main.activeGroup, { id: 'home-source-context', projectRoot: '/workspace/current' }); f.editor.update(0);
	const home = f.editor.editorParts.main.activeGroup.model.activeTab!;
	if (home.kind !== 'home') throw new Error('Home contribution');
	const focused = inputFocus.target!, bounds = home.sections[0].actions.items[0].bounds;
	const x = (bounds.left + bounds.right) / 2, y = (bounds.top + bounds.bottom) / 2;
	f.editor.dispatchPointer({ x, y, buttons: PointerButton.Primary, pressedButtons: PointerButton.Primary,
		releasedButtons: 0, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 2 });
	assert.equal(pointerCapture.active, true);
	const invoke = t.mock.method(f.editor.commands, 'execute', () => {});
	problemsPanel.show(); problemsPanel.setFixedHeightPx(1000000);
	f.editor.updateViewport({ width: 384, height: 288 });
	assert.equal(pointerCapture.active, false);
	assert.equal(pointerCapture.draining, true);
	assert.ok(inputFocus.admittedTarget !== focused, 'the physical surface withdraws input while the logical page remains retained');
	assert.ok(inputFocus.target !== focused);
	f.editor.dispatchKey(new KeyInputEvent('Enter', KeyModifier.none));
	f.editor.dispatchKey(new KeyInputEvent('Enter', KeyModifier.none, false, false));
	f.editor.dispatchPointer({ x, y, buttons: 0, pressedButtons: 0,
		releasedButtons: PointerButton.Primary, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 3 });
	assert.equal(invoke.mock.callCount(), 0);
	assert.equal(pointerCapture.draining, false);
	problemsPanel.hide(); f.editor.update(0);
	assert.ok(inputFocus.target !== focused, 'uncovering the retained page must not steal focus');
	assert.equal(f.model.buffer.getText(), f.edited);
	assert.equal(f.model.version, f.version);
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, f.cycles);
});

test('Home keyboard scroll retires a pointer action before a same-poll release', t => {
	const f = fixture(t); f.editor.resourcePanel.show();
	f.editor.updateViewport({ width: 256, height: 160 }); // Exercise a client that genuinely requires scrolling.
	openHome(f.editor.editorParts.main.activeGroup, { id: 'home-source-context', projectRoot: '/workspace/current' }); f.editor.update(0);
	const home = f.editor.editorParts.main.activeGroup.model.activeTab!;
	if (home.kind !== 'home') throw new Error('Home contribution');
	f.key('ArrowDown'); // Reveal the real action before starting its physical gesture.
	f.key('Escape'); // The actual Home action bar returns focus to its scroll view.
	const bounds = home.sections[0].actions.items[1].bounds;
	const x = (bounds.left + bounds.right) / 2, y = (bounds.top + bounds.bottom) / 2;
	f.editor.dispatchPointer({ x, y, buttons: PointerButton.Primary, pressedButtons: PointerButton.Primary,
		releasedButtons: 0, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 2 });
	assert.equal(pointerCapture.active, true);
	const invoke = t.mock.method(f.editor.commands, 'execute', () => {});
	f.editor.dispatchKey(new KeyInputEvent('PageDown', KeyModifier.none));
	assert.ok(home.viewport.scrollTop > 0, 'the actual scroll owner must move for this stale-release regression');
	assert.equal(pointerCapture.active, false);
	f.editor.dispatchPointer({ x, y, buttons: 0, pressedButtons: 0,
		releasedButtons: PointerButton.Primary, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 3 });
	assert.equal(invoke.mock.callCount(), 0);
	assert.equal(pointerCapture.draining, false);
});


test('runtime faults navigate only to authored text matching their retained installation', async t => {
	const f = fixture(t), image = f.sources.currentBlua32Media.system!;
	const originalGroup = f.editor.editorParts.main.activeGroup;
	const destination = f.editor.editorParts.splitGroup(originalGroup, 'right'); assert.ok(destination);
	const projection = f.input.createView(); destination.openEditor(projection);
	const proof = image.sources.get(toLuaModulePath(f.model.resource.path))!;
	const frame: SourceStackTraceFrame = { kind: 'source', resource: f.model.identity,
		functionName: 'entry', workspacePath: f.model.resource.path, line: 1, column: 1 };
	const details = { luaStack: [frame], sources: new Map([[frame, proof]]) };
	const edited = f.model.buffer.getText(), history = f.model.canUndo;
	f.editor.showRuntimeErrorInChunk(frame.resource, frame.line, frame.column, 'fault', details);
	await setImmediate();
	for (const group of f.editor.editorParts.groups) for (const input of group.model.tabs) if (input.kind === 'code_editor') {
		assert.equal(input.context.runtimeErrorOverlay, null, 'a captured address cannot mark a different authored revision');
	}
	assert.equal(f.model.buffer.getText(), edited); assert.equal(f.model.canUndo, history);
	f.model.undo();
	f.editor.showRuntimeErrorInChunk(frame.resource, frame.line, frame.column, 'fault', details);
	await setImmediate();
	const group = f.editor.editorParts.activeGroup, input = group.model.activeTab!;
	assert.ok(group === destination && input === projection);
	assert.ok(input.context.model === f.model && input.context.view !== f.view);
	assert.ok(originalGroup.model.activeTab === f.input); assert.equal(f.editor.editorParts.documents.length, 0);
	const pane = group.panes.getPane('code_editor') as CodeEditorPane;
	assert.ok(pane.code.runtimeError.activeOverlay!.details === details);
	assert.equal(f.pane.code.runtimeError.activeOverlay, null, 'the separate main view does not inherit document-local presentation');
});

test('typing during captured-fault opening retires location projection without replacing the source', async t => {
	const f = fixture(t); f.model.undo();
	const destination = f.editor.editorParts.main.activeGroup;
	const proof = f.sources.currentBlua32Media.system!.sources.get(toLuaModulePath(f.model.resource.path))!;
	const frame: SourceStackTraceFrame = { kind: 'source', resource: f.model.identity,
		functionName: 'entry', workspacePath: f.model.resource.path, line: 1, column: 1 };
	const details = { luaStack: [frame], sources: new Map([[frame, proof]]) };
	f.editor.showRuntimeErrorInChunk(frame.resource, frame.line, frame.column, 'fault', details);
	f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- newer authored revision\n' }]);
	const version = f.model.version;
	await setImmediate();
	const group = f.editor.editorParts.activeGroup, input = group.model.activeTab!;
	assert.ok(group === destination && input === f.input);
	assert.ok(input.context.model === f.model);
	assert.equal(f.editor.editorParts.documents.length, 0);
	assert.equal(input.context.runtimeErrorOverlay, null);
	assert.equal((group.panes.getPane('code_editor') as CodeEditorPane).code.runtimeError.activeOverlay, null);
	assert.equal(f.model.version, version); assert.equal(f.model.dirty, true);
});

test('an installed-only source path cannot substitute another authored file', async t => {
	const f = fixture(t), active = f.editor.editorParts.main.activeGroup.model.activeTab;
	const resource = { contextId: f.model.identity.contextId, path: 'only-in-another-build.lua' };
	const frame: SourceStackTraceFrame = { kind: 'source', resource,
		functionName: 'entry', workspacePath: resource.path, line: 1, column: 1 };
	const proof = { displayPath: resource.path, content: { kind: 'text' as const, text: 'return 99' } };
	f.editor.showRuntimeErrorInChunk(resource, frame.line, frame.column, 'fault', { luaStack: [frame], sources: new Map([[frame, proof]]) });
	await setImmediate();
	assert.equal(f.editor.editorParts.main.activeGroup.model.activeTab, active);
	assert.equal(editorTextModelService.get(resource), undefined);
	assert.equal(f.pane.code.runtimeError.activeOverlay, null);
});

for (const interruption of ['none', 'resume', 'another-tab', 'typing', 'symbols-only'] as const) {
	test(`debugger source projection retains its exact stop and document through asynchronous opening: ${interruption}`, async t => {
		const f = fixture(t); f.model.undo();
		const originalGroup = f.editor.editorParts.main.activeGroup;
		const destination = interruption === 'symbols-only' ? originalGroup : f.editor.editorParts.splitGroup(originalGroup, 'right');
		assert.ok(destination);
		const projection = interruption === 'symbols-only' ? f.input : f.input.createView();
		if (interruption !== 'symbols-only') destination.openEditor(projection);
		const image = f.sources.currentBlua32Media.system!;
		const word = image.symbols!.metadata.debugRanges.findIndex(range => range !== null
			&& toLuaModulePath(range.path) === toLuaModulePath(f.model.resource.path));
		assert.ok(word >= 0);
		const range = image.symbols!.metadata.debugRanges[word]!;
		const media = interruption === 'symbols-only'
			? { ...f.sources.currentBlua32Media, system: createBlua32SystemSourceImage(image.layout, image.symbols, image.biosImports,
				new Map(), image.sourceContextId) } : f.sources.currentBlua32Media;
		const pc = image.layout.header.textAddress + word * INSTRUCTION_BYTES;
		if (interruption === 'none') {
			f.ide.debugger.source.install(media, [new Map([[pc, 0]]), new Map(), new Map()]);
			assert.equal(f.ide.debugger.source.shouldStop(-1, pc), true);
		} else f.ide.debugger.source.stop = { id: 1, thread: f.host.runtime.machine.cpu.activeThread,
			media, domain: -1, pc, inlineDepth: 0, reason: RuntimeDebuggerStopReason.Step };
		const pending = presentRuntimeDebuggerStop(f.editor, f.ide.debugger, f.sources.catalog);
		await Promise.resolve(); // The source attaches before the debugger projection's continuation.
		const group = f.editor.editorParts.activeGroup, input = group.model.activeTab!;
		assert.ok(group === destination && input === projection);
		assert.equal(f.editor.editorParts.documents.length, 0);
		assert.ok(originalGroup.model.activeTab === f.input);
		if (interruption !== 'symbols-only') {
			assert.ok(input !== f.input);
			assert.ok(input.context.model === f.model && input.context.view !== f.view);
		}
		if (interruption === 'resume') f.ide.debugger.source.resume(RuntimeDebuggerResumeMode.Continue);
		else if (interruption === 'another-tab') f.editor.commands.execute('gpuDebugger');
		else if (interruption === 'typing') f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- later\n' }]);
		const active = group.model.activeTab, text = f.model.buffer.getText(), version = f.model.version;
		await pending;
		assert.ok(group.model.activeTab === active);
		assert.equal(f.model.buffer.getText(), text); assert.equal(f.model.version, version);
		assert.equal(input.context.executionStopRow, interruption === 'none' ? range.start.line - 1 : null);
		assert.equal(f.input.context.executionStopRow, null);
		if (interruption === 'none') {
			const pane = group.panes.getPane('code_editor') as CodeEditorPane;
			assert.equal(pane.code.runtimeError.executionStopRow, range.start.line - 1);
			f.ide.debugger.source.resume(RuntimeDebuggerResumeMode.Continue);
			assert.equal(input.context.executionStopRow, null);
			assert.equal(pane.code.runtimeError.executionStopRow, null);
			openGpuDebugger(group, f.editor.gpu);
			group.activate(input.id);
			assert.equal(input.context.executionStopRow, null);
			assert.equal(pane.code.runtimeError.executionStopRow, null, 'reattachment cannot resurrect a retired debugger stop');
			assert.equal(f.input.context.executionStopRow, null);
		}
	});
}

for (const mode of ['run', 'debug', 'play'] as const) {
	test(`ordinary ${mode} starts directly; companion selection is a separate explicit command`, async t => {
		const f = fixture(t);
		const sourceState = createScenarioTestSourceState([createScenarioTestSourceRecord('fixture_assert.lua', 1,
			"return { kind = 'integration', tests = { sample = function() end } }")]);
		const primary = sourceState.catalog.getContext(TEST_CARTRIDGE_CONTEXT_IDS[0]);
		f.sources.catalog.admitContext(primary);
		sourceState.catalog.dispose();
		f.editor.scenarioLab.open(f.editor.editorParts.main.activeGroup);
		f.editor.update(0);
		const view = f.editor.scenarioLab.resolveInput().view;
		const selected = f.editor.scenarioLab.runs.collection.findModuleBySourcePath(primary.id, 'fixture_assert.lua');
		const originalScope = selected.children[0].id;
		view.testPane.selectionIndex = view.testPane.rows.findIndex(row => row.id === originalScope);
		assert.ok(view.testPane.selectionIndex >= 0);
		updateSelectedScenarioNode(view);
		const admitted = new Error('fixture admission reached');
		const start = mode === 'play'
			? t.mock.method(f.editor.play.service, 'start', () => { throw admitted; })
			: t.mock.method(f.editor.scenarioLab.runs, 'start', () => { throw admitted; });
		const ordinary = mode === 'play' ? 'scenarioLab.play' : mode === 'debug' ? 'scenarioLab.debug' : 'scenarioLab.run';
		const explicit = mode === 'play' ? 'scenarioLab.playWithCompanion'
			: mode === 'debug' ? 'scenarioLab.debugWithCompanion' : 'scenarioLab.runWithCompanion';
		assert.equal(f.editor.commands.isEnabled(ordinary), true);
		assert.throws(() => f.editor.commands.execute(ordinary), error => error === admitted);
		assert.equal(start.mock.callCount(), 1);
		assert.equal(f.editor.quickInput.visible, false);
		const first = start.mock.calls[0].arguments;
		assert.equal(first[0], mode === 'play' ? selected : originalScope);
		assert.equal(first[mode === 'play' ? 1 : 2], null);
		start.mock.resetCalls();
		assert.equal(f.editor.commands.isEnabled(explicit), true);
		f.editor.commands.execute(explicit);
		const picker = f.editor.editorParts.main.quickInput;
		assert.equal(picker.visible, true);
		assert.equal(f.editor.quickInput.visible, false);
		assert.equal(start.mock.callCount(), 0);
		// A later UI selection cannot retarget the original logical scope/module.
		view.testPane.selectionIndex = 0;
		updateSelectedScenarioNode(view);
		picker.model.list.selectionIndex = picker.model.list.rows.findIndex(row => 'contextId' in row.item && row.item.contextId === primary.id);
		assert.ok(picker.model.list.selectionIndex >= 0);
		assert.throws(() => picker.accept(), error => error === admitted);
		assert.equal(start.mock.callCount(), 1);
		const chosen = start.mock.calls[0].arguments;
		assert.equal(chosen[0], mode === 'play' ? selected : originalScope);
		assert.equal(chosen[mode === 'play' ? 1 : 2], primary.id);
		assert.equal(f.editor.quickInput.visible, false);
	});
}
