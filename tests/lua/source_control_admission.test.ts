import { TEST_SYSTEM_CONTEXT_ID } from '../helpers/runtime_sources';
import { createScenarioTestSourceRecord } from '../helpers/scenario_sources';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { HeadlessClipboard } from '../../hosts/node/headless/clipboard';
import { IdeMicrotaskQueue } from '../../ide/common/microtask_queue';
import { CodeEditorPane } from '../../ide/workbench/contrib/code_editor/editor_pane';
import { editorRuntimeState } from '../../ide/editor/common/runtime_state';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { inputFocus } from '../../ide/input/focus';
import { captureInstalledLuaSources, registerLuaSourceRecord, type LuaSourceRegistry } from '../../ide/runtime/source_registry';
import { createBlua32SystemSourceImage } from '../../ide/runtime/sources';
import { SceneEditorPane } from '../../ide/workbench/contrib/scene_editor/editor_pane';
import { LuaProgramEditorPane } from '../../ide/workbench/contrib/lua_program/editor_pane';
import { problemsPanel } from '../../ide/workbench/contrib/problems/panel/controller';
import { RuntimeIdeState } from '../../ide/workbench/state';
import { resolveLuaCodeEditorInput } from '../../ide/workbench/ui/code_tab/io';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { linkTestSystemBlua32 } from '../helpers/blua32';
import { createHostFrameFixture } from '../helpers/host_frame';
import { createTestRuntime, createTestSystemImageRuntimeSourceState } from '../helpers/runtime_sources';
import { parseLuaChunk } from './cpu_test_harness';

const SCENE_SOURCE = `local scenes = require('cartlib/world/scene_library')
scenes.register('room', { objects = {
    { member_id = 'actor', definition_id = 'sprite', options = {
        pos = { x = 1, y = 2, z = 3 }, color = 0xff00aabb, visible = true,
    } },
} })`;
const PROGRAM_SOURCE = `local progression = require('cartlib/progression')
progression.compile_program({ rules = { { id = 'authored', on = 'hit' } }, filters = {}, handlers = {} })`;

/** Real retained source, panes and native key admission; the paused guest is not an authoring engine. */
function fixture(t: TestContext, source: string, apiModule: string) {
	const boot = 'return 0', path = 'source.lua';
	const image = linkTestSystemBlua32(compileLuaChunkToProgram(parseLuaChunk(boot, path), [],
		{ entrySource: boot, programDomain: 'system', optLevel: 0 }));
	const host = createHostFrameFixture(createTestRuntime(image.romBytes)); host.runtime.boot();
	const registry: LuaSourceRegistry = { records: [], path2lua: {}, module2lua: {}, entrySourcePath: path,
		projectRootPath: '', can_boot_from_source: true, revision: 0 };
	registerLuaSourceRecord(registry, { resid: path, type: 'lua', src: boot, base_src: boot,
		source_path: path, normalized_source_path: path, module_path: 'source', update_timestamp: 0,
		base_update_timestamp: 0, generated: false, sourceKind: 'project', program_module: true });
	const apiPath = `${apiModule}.lua`;
	registerLuaSourceRecord(registry, createScenarioTestSourceRecord(apiPath, 0, '', apiPath));
	const sources = createTestSystemImageRuntimeSourceState(image.romBytes, registry);
	sources.currentBlua32Media = { system: createBlua32SystemSourceImage(image.image, image.symbols, image.biosImports,
		captureInstalledLuaSources(registry, image.symbols!.metadata.compiledModulePaths), TEST_SYSTEM_CONTEXT_ID), cartridgeSlots: [null, null] };
	const unused = (): never => { throw new Error('Source control admission does not request external work.'); };
	const ide = new RuntimeIdeState(host.runtime, host.presenter, { capture: unused }, unused,
		{ measureDisplay: () => ({ left: 0, top: 0, width: editorViewState.viewportWidth, height: editorViewState.viewportHeight }) },
		host.input, host.audio, host.tasks, host.execution, host.rewind, host.clock, new HeadlessClipboard(),
		new IdeMicrotaskQueue(), { log() {} }, 0.3, { width: 384, height: 288 }, sources, new Map(), unused, unused, unused);
	const editor = ide.editor;
	editor.editorGroup.openEditor(resolveLuaCodeEditorInput(sources.catalog, sources.catalog.resolveResource({ contextId: TEST_SYSTEM_CONTEXT_ID, path: registry.entrySourcePath })!));
	t.after(async () => {
		const pane = editor.editorGroup.panes.activePane;
		if (pane instanceof SceneEditorPane) {
			for (const control of pane.controls) control.cancel();
			for (const control of pane.options.controls) control.cancel();
		}
		inputFocus.cancelInput();
		problemsPanel.hide(); problemsPanel.setFixedHeightPx(0); inputFocus.setTarget(null);
		await editor.shutdown(); host.audio.dispose(); host.input.dispose();
	});
	editorRuntimeState.active = true; host.input.setPointerAdmissionMode('routed'); editor.update(0);
	const model = (editor.editorGroup.panes.getPane('code_editor') as CodeEditorPane).code.model!;
	model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: source }]);
	const version = model.version, cycles = host.runtime.machine.scheduler.nowCycles;
	const press = (code: string, modifiers = KeyModifier.none) => {
		editor.dispatchKey(new KeyInputEvent(code, modifiers));
		editor.dispatchKey(new KeyInputEvent(code, modifiers, false, false)); editor.update(0);
	};
	const unchanged = () => {
		assert.equal(model.buffer.getText(), source); assert.equal(model.version, version);
		assert.equal(model.canUndo, true); assert.equal(model.canRedo, false);
		assert.equal(host.runtime.machine.scheduler.nowCycles, cycles);
	};
	const scene = () => {
		editor.sceneEditor.openResource(editor.editorGroup, model.resource); editor.update(0);
		const input = editor.editorGroup.model.activeTab!, pane = editor.editorGroup.panes.activePane!;
		assert.ok(input.kind === 'scene_editor' && pane instanceof SceneEditorPane);
		press('Home'); press('ArrowDown'); press('Enter');
		assert.equal(input.outline.rows[input.outline.selectionIndex].element.kind, 'member');
		return { input, pane };
	};
	return { editor, model, press, unchanged, scene };
}

for (const kind of ['position', 'option'] as const) test(`Scene ${kind} draft loses source authority immediately on readonly metadata publication`, t => {
	const f = fixture(t, SCENE_SOURCE, 'cartlib/world/scene_library'), { pane } = f.scene();
	const control = kind === 'position' ? pane.controls[0] : pane.options.controls[0];
	control.field.focusTarget.focus(); assert.ok(inputFocus.admittedTarget === control.field.focusTarget);
	assert.equal(f.editor.textTarget!.replaceText(0, control.field.text.length, '9'), true);
	assert.equal(control.pending, true); f.unchanged();
	const resource = f.model.resource;
	f.model.refreshResource({ ...resource, source: { ...resource.source, generated: true } });
	assert.equal(control.field.readOnly, true, 'source metadata must publish authority loss without a content or frame update');
	assert.equal(control.pending, false); assert.ok(inputFocus.admittedTarget !== control.field.focusTarget);
	f.model.refreshResource(resource); f.press('Enter'); f.unchanged();
	assert.equal(control.pending, false, 'writable return cannot revive a revoked draft');
});

test('covering the Scene detail client retires its draft without publishing through blur', t => {
	const f = fixture(t, SCENE_SOURCE, 'cartlib/world/scene_library'), { input, pane } = f.scene(), control = pane.controls[0];
	control.field.focusTarget.focus();
	assert.equal(f.editor.textTarget!.replaceText(0, control.field.text.length, '9'), true);
	assert.equal(control.pending, true);
	problemsPanel.show(); problemsPanel.setFixedHeightPx(editorViewState.viewportHeight * 4); f.editor.update(0);
	assert.equal(input.details.height, 0, 'the actual Problems layout must cover the source client');
	assert.ok(inputFocus.admittedTarget !== control.field.focusTarget);
	assert.equal(control.pending, false); f.unchanged();
	f.press('Enter'); f.press('Digit8'); f.unchanged();
	problemsPanel.hide(); f.editor.update(0);
	assert.ok(inputFocus.admittedTarget !== control.field.focusTarget, 'recovery does not reactivate hidden draft input');
});

for (const target of ['outline', 'actions'] as const) test(`a fully covered Scene ${target} cannot retain destructive keyboard admission`, t => {
	const f = fixture(t, SCENE_SOURCE, 'cartlib/world/scene_library'), { input } = f.scene();
	f.press('Escape');
	if (target === 'actions') f.press('Tab', KeyModifier.shift);
	assert.ok(inputFocus.admittedTarget !== null);
	assert.equal(input.actionBar.hasFocus, target === 'actions');
	problemsPanel.show(); problemsPanel.setFixedHeightPx(editorViewState.viewportHeight * 4); f.editor.update(0);
	assert.ok(inputFocus.admittedTarget === null, 'no covered Scene control retains keyboard admission');
	assert.equal(input.actionBar.hasFocus, false);
	f.press('Delete'); f.unchanged();
	problemsPanel.hide(); f.editor.update(0);
	f.press('Delete'); f.unchanged();
});

test('Scene readonly subscriptions follow input attachment, not repeated selection', async t => {
	const f = fixture(t, SCENE_SOURCE, 'cartlib/world/scene_library'), subscribe = f.model.onDidChangeReadOnly;
	let subscriptions = 0;
	t.mock.method(f.model, 'onDidChangeReadOnly', listener => {
		const unbind = subscribe.call(f.model, listener); subscriptions++;
		return () => { subscriptions--; unbind(); };
	});
	const { pane } = f.scene();
	// One listener belongs to the Scene input; another active source kind must replace it.
	assert.equal(subscriptions, 1);
	f.editor.sceneEditor.openResource(f.editor.editorGroup, f.model.resource); f.editor.update(0);
	assert.equal(subscriptions, 1);
	f.editor.commands.execute('sceneEditor.source', inputFocus.target!.commandContext); await setImmediate(); f.editor.update(0);
	assert.ok(f.editor.editorGroup.panes.activePane !== pane);
	assert.equal(subscriptions, 1, 'Source replaces, rather than retains, the Scene observer');
	f.editor.sceneEditor.openResource(f.editor.editorGroup, f.model.resource); f.editor.update(0);
	assert.ok(f.editor.editorGroup.panes.activePane === pane);
	assert.equal(subscriptions, 1);
	f.unchanged();
});

test('a fully covered Lua Program has no destructive keyboard admission and preserves its selected source', t => {
	const f = fixture(t, PROGRAM_SOURCE, 'cartlib/progression');
	f.editor.luaPrograms.openResource(f.editor.editorGroup, f.model.resource, 'progression'); f.editor.update(0);
	const input = f.editor.editorGroup.model.activeTab!, pane = f.editor.editorGroup.panes.activePane!;
	assert.ok(input.kind === 'lua_program' && pane instanceof LuaProgramEditorPane);
	const target = input.tree.rows.findIndex(row => row.element.field !== undefined && row.element.container?.structural);
	assert.ok(target >= 0); f.press('Home');
	for (let index = 0; index < target; index++) f.press('ArrowDown');
	assert.equal(f.editor.commands.isEnabled('luaProgram.remove'), true);
	const selected = input.tree.rows[input.tree.selectionIndex].element;
	problemsPanel.show(); problemsPanel.setFixedHeightPx(editorViewState.viewportHeight * 4); f.editor.update(0);
	assert.equal(input.tree.layout.visibleRowCount, 0, 'the actual Problems layout must cover every authored row');
	assert.ok(inputFocus.admittedTarget === null, 'covered source controls cannot retain keyboard admission');
	f.press('Delete'); f.unchanged();
	assert.ok(input.tree.rows[input.tree.selectionIndex].element === selected);
	problemsPanel.hide(); f.editor.update(0);
	f.press('Delete'); f.unchanged();
	pane.focus(); assert.equal(f.editor.commands.isEnabled('luaProgram.remove'), true);
});
