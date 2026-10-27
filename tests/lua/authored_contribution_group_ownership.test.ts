import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { getOrCreateSemanticProject } from '../../ide/editor/contrib/intellisense/semantic/workspace/state';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { inputFocus } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { SuspendedGuestSession } from '../../ide/runtime/suspended_guest';
import { AemEditorController } from '../../ide/workbench/contrib/aem/controller';
import { LuaProgramController } from '../../ide/workbench/contrib/lua_program/controller';
import { collectLuaPrograms } from '../../ide/workbench/contrib/lua_program/source';
import { ContextMenuController } from '../../ide/workbench/services/context_menu/controller';
import { QuickInputController } from '../../ide/workbench/services/quick_input/controller';
import { resolveLuaCodeEditorInput } from '../../ide/workbench/ui/code_tab/io';
import { createTestEditorGroup } from '../helpers/editor_panes';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from '../helpers/scenario_sources';
import { createTestRuntime, createTestRuntimeRomPayload, TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';

const PROGRAM = "local progression = require('cartlib/progression')\nprogression.compile_program({ rules = {}, filters = {}, handlers = {} })";

function fixture(t: TestContext) {
	configureFontVariant('tiny');
	editorViewState.viewportWidth = 384; editorViewState.viewportHeight = 288;
	const sources = createScenarioTestSourceState([
		createScenarioTestSourceRecord('program.lua', 1, PROGRAM),
		createScenarioTestSourceRecord('cartlib/progression.lua', 1, 'return {}'),
	]);
	sources.catalog.registerTextSources(TEST_CARTRIDGE_CONTEXT_IDS[0], [{ type: 'aem', resid: 'events', source_path: 'events.aem.yaml' }]);
	const audio = sources.catalog.resolveResource({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'events.aem.yaml' })!;
	const audioModel = editorTextModelService.retain(audio, 'aem', 'events: {}\n');
	const resource = sources.catalog.resolveResource({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'program.lua' })!;
	const first = createTestEditorGroup(), second = createTestEditorGroup();
	first.openEditor(resolveLuaCodeEditorInput(sources.catalog, resource));
	second.openEditor(resolveLuaCodeEditorInput(sources.catalog, resource));
	const menu = new ContextMenuController(inputFocus, pointerCapture), picker = new QuickInputController(menu, undefined, undefined, { scope: inputFocus.workbenchScope, bounds: { left: 0, top: 0, right: editorViewState.viewportWidth, bottom: editorViewState.viewportHeight }, kind: 'workspace' });
	const guest = new SuspendedGuestSession(createTestRuntime(createTestRuntimeRomPayload()));
	const aem = new AemEditorController(sources, guest, null!, null!);
	const programs = new LuaProgramController(sources, guest, null!, null!, null!);
	t.after(() => {
		picker.dispose(); menu.dispose(); first.dispose(); second.dispose();
		editorTextModelService.clear(); inputFocus.setTarget(null);
	});
	return { sources, resource, audioModel, first, second, menu, picker, aem, programs };
}

test('a shared audio controller opens into its requested group despite focus returning to another group', async t => {
	const f = fixture(t), sibling = f.second.model.activeTab;
	f.first.panes.activePane!.focus();
	f.aem.open(f.first, f.picker);
	f.picker.accept();
	f.second.panes.activePane!.focus();
	await new Promise<void>(resolve => setImmediate(resolve));
	const opened = f.first.model.activeTab;
	assert.ok(opened?.kind === 'aem_editor');
	assert.equal(opened.workingCopy, f.audioModel);
	assert.equal(f.second.model.activeTab, sibling);
	assert.equal(inputFocus.target?.scope, f.second.focusScope, 'delayed resolution does not steal the later focus');
});

for (const kind of ['aem', 'lua'] as const) test(`${kind} opening picker belongs only to its requested group`, t => {
	const f = fixture(t);
	f.first.panes.activePane!.focus();
	if (kind === 'aem') f.aem.open(f.first, f.picker);
	else f.programs.open(f.first, f.picker, 'progression');
	assert.equal(f.picker.visible, true);
	f.second.dispose();
	assert.equal(f.picker.visible, true, 'retiring another group cannot cancel this request');
	f.first.dispose();
	assert.equal(f.picker.visible, false, 'retiring the destination cancels its opening request');
	assert.equal(f.first.model.tabs.length, 0);
});

for (const kind of ['aem', 'lua'] as const) test(`${kind} chooser retains its invoking attachment independently of its destination group`, t => {
	const f = fixture(t), destination = f.first.model.activeTab, origin = f.second.model.activeTab;
	f.second.panes.activePane!.focus();
	if (kind === 'aem') f.aem.open(f.first, f.picker);
	else f.programs.open(f.first, f.picker, 'progression');
	assert.equal(f.picker.visible, true);
	f.second.panes.clearEditor();
	assert.equal(f.picker.visible, false, 'retiring the invoking attachment revokes the pending choice');
	assert.equal(f.first.model.activeTab, destination, 'the requested destination remains untouched');
	assert.equal(f.second.model.activeTab, origin, 'retained input membership does not extend attachment authority');
});

for (const kind of ['aem', 'lua'] as const) test(`${kind} destination retirement during invoking-control blur cancels before provider preparation`, t => {
	const f = fixture(t);
	f.first.panes.activePane!.focus();
	const origin = inputFocus.target!;
	t.after(origin.onDidBlur(next => { if (next === f.picker.field.focusTarget) f.first.dispose(); }));
	if (kind === 'aem') f.aem.open(f.first, f.picker);
	else f.programs.open(f.first, f.picker, 'progression');
	assert.equal(f.picker.visible, false);
	assert.equal(f.first.model.tabs.length, 0);
});

test('Lua opening choices consume the canonical source published by invoking-control blur', t => {
	const f = fixture(t), input = f.first.model.activeTab;
	assert.ok(input?.kind === 'code_editor');
	const model = input.workingCopy;
	model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: 'return 0' }]);
	f.first.panes.activePane!.focus();
	const origin = inputFocus.target!;
	t.after(origin.onDidBlur(next => {
		if (next === f.picker.field.focusTarget) model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: PROGRAM }]);
	}));
	f.programs.open(f.first, f.picker, 'progression');
	assert.equal(f.picker.model.items.length, 1, 'the picker sees the producer admitted during blur, not the earlier source snapshot');
	assert.equal(model.buffer.getText(), PROGRAM);
	assert.equal(model.canUndo, true);
});

test('one Lua program controller retains distinct group inputs over the same canonical working copy', t => {
	const f = fixture(t);
	const project = getOrCreateSemanticProject(editorTextModelService, f.resource.contextId);
	project.synchronizeSources(f.sources.catalog);
	const occurrence = collectLuaPrograms(f.resource, project.getSnapshot())[0];
	assert.ok(occurrence);
	const first = f.programs.openOccurrence(f.first, occurrence);
	const second = f.programs.openOccurrence(f.second, occurrence);
	assert.notEqual(first, second);
	assert.equal(first.workingCopy, second.workingCopy);
	assert.equal(f.first.model.activeTab, first);
	assert.equal(f.second.model.activeTab, second);
	assert.notEqual(first.tree, second.tree);
	first.tree.selectionIndex = 1;
	assert.notEqual(first.tree.selectionIndex, second.tree.selectionIndex);
	assert.equal(f.programs.openOccurrence(f.first, occurrence), first, 'reuse is scoped to the requested group');
	assert.equal(f.second.model.activeTab, second);
	const source = first.workingCopy;
	source.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- retained source\n' }]);
	assert.equal(first.workingCopy, source); assert.equal(second.workingCopy, source);
	assert.equal(source.canUndo, true);
	f.first.dispose();
	assert.equal(f.second.model.activeTab, second);
	assert.equal(second.workingCopy.buffer.getText(), `-- retained source\n${PROGRAM}`);
	assert.equal(source.canUndo, true, 'retiring a view does not retire its sibling source history');
});


for (const kind of ['aem', 'program'] as const) test(`one shared ${kind} controller opens only the actual operation picker`, t => {
	const f = fixture(t);
	const local = new QuickInputController(f.menu, undefined, undefined,
		{ scope: f.second.focusScope, bounds: { left: 30, top: 40, right: 310, bottom: 240 }, kind: 'part', reveal() {} });
	t.after(() => local.dispose());
	const root = t.mock.method(f.picker, 'pick', () => assert.fail('the shared controller cannot open an unrelated root picker'));
	f.second.panes.activePane!.focus();
	if (kind === 'aem') f.aem.open(f.second, local);
	else f.programs.open(f.second, local, 'progression');
	assert.equal(local.visible, true); assert.equal(f.picker.visible, false);
	assert.equal(root.mock.callCount(), 0);
	f.first.dispose();
	assert.equal(local.visible, true, 'retiring another group does not retire the chosen dialog');
	f.second.dispose();
	assert.equal(local.visible, false, 'the actual destination lifetime retires its operation dialog');
});
