import { TEST_SYSTEM_CONTEXT_ID, TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import { createTestEditorParts } from '../helpers/editor_panes';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import type { CartEditor } from '../../ide/cart_editor';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { inputFocus } from '../../ide/input/focus';
import { openCreateResourcePrompt } from '../../ide/workbench/contrib/resources/create';
import type { QuickPickItem } from '../../ide/workbench/services/quick_input/provider';
import { resolveLuaCodeEditorInput } from '../../ide/workbench/ui/code_tab/io';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from '../helpers/scenario_sources';

function fixture(t: TestContext, path: string, canonicalPath: string, generated = false) {
	const clock = new VirtualHeadlessClock();
	configureFontVariant('tiny');
	editorViewState.viewportWidth = 384; editorViewState.viewportHeight = 288;
	const source = { ...createScenarioTestSourceRecord(path, 1), normalized_source_path: canonicalPath, generated };
	const sources = createScenarioTestSourceState([source]);
	const resource = sources.catalog.resources.find(resource => resource.contextId === TEST_CARTRIDGE_CONTEXT_IDS[0] && resource.path === path)!;
	const parts = createTestEditorParts(t), part = parts.createDocument(), group = part.activeGroup;
	group.model.initialize(resolveLuaCodeEditorInput(sources.catalog, resource));
	const picker = part.quickInput;
	const editor = { editorParts: parts } as CartEditor;
	t.after(() => {
		editorTextModelService.clear(); inputFocus.setTarget(null);
	});
	return { clock, sources, editor, picker, resource, group, part };
}

test('New File uses a project resource authoring directory, including a project-local library-named folder', t => {
	const f = fixture(t, 'cartlib/local.lua', 'carts/nemesis_s/cartlib/local.lua');
	openCreateResourcePrompt(f.editor, f.group, f.sources.catalog, f.clock);
	assert.equal(f.picker.inputBox, true);
	// This is the actual proposed filesystem directory, not the prompt wording.
	assert.equal(f.picker.field.text, 'cartlib/');
	assert.equal(f.group.model.activeTab!.resource, f.resource);
});

for (const stage of ['project chooser', 'filename'] as const) {
	test(`New File ${stage} retires with its explicit destination independently of chrome focus`, t => {
		const f = stage === 'project chooser'
			? fixture(t, 'cartlib/shared.lua', 'cartlib/shared.lua')
			: fixture(t, 'local.lua', 'carts/nemesis_s/local.lua');
		const chrome = inputFocus.createTarget(), unbindKeyboard = chrome.bindKeyboard(() => {});
		t.after(unbindKeyboard);
		chrome.focus();
		openCreateResourcePrompt(f.editor, f.group, f.sources.catalog, f.clock);
		assert.ok(f.picker.invocationOrigin === chrome, 'an explicit foreground command retains its real invoker');
		assert.ok(inputFocus.target === f.picker.field.focusTarget, 'the requested destination chooser receives foreground input');
		assert.equal(f.picker.visible, true);
		assert.equal(f.picker.inputBox, stage === 'filename');
		f.group.dispose();
		assert.equal(f.picker.visible, false);
		assert.equal(f.group.panes.activePane, null);
		assert.equal(f.group.model.tabs.length, 0);
	});
}

test('New File cannot advance after focus return retires its invoking part context', t => {
	const f = fixture(t, 'cartlib/shared.lua', 'cartlib/shared.lua');
	f.part.focus();
	const origin = inputFocus.target!;
	assert.ok(origin === f.group.focusTarget, 'the Part delegates to its concrete empty group focus owner');
	const input = t.mock.method(f.picker, 'input');
	openCreateResourcePrompt(f.editor, f.group, f.sources.catalog, f.clock);
	assert.ok(f.picker.invocationOrigin === origin);
	const projects = f.picker.model.items as readonly (QuickPickItem & { contextId: string })[];
	f.picker.model.list.selectionIndex = f.picker.model.list.rows.findIndex(row => projects[row.itemIndex].contextId === TEST_CARTRIDGE_CONTEXT_IDS[0]);
	assert.ok(f.picker.model.list.selectionIndex >= 0);
	let returned = 0;
	const unbindFocus = origin.onDidFocus(() => { unbindFocus(); returned++; f.part.scope.retireContext(); });
	t.after(unbindFocus);
	f.picker.accept();
	assert.equal(returned, 1);
	assert.equal(input.mock.callCount(), 0, 'the retired project choice cannot create a filename session');
	assert.equal(f.picker.visible, false);
	assert.equal(f.group.panes.activePane, null);
	assert.ok(f.group.model.activeTab!.resource === f.resource, 'retiring an operation context does not delete its authored document');
});

for (const [path, generated] of [['cartlib/shared.lua', false], ['testlib/context.lua', false], ['bmsx/assets.lua', true]] as const) {
	test(`New File from ${path} asks for an authoring project instead of borrowing its execution context`, t => {
		const f = fixture(t, path, path, generated);
		openCreateResourcePrompt(f.editor, f.group, f.sources.catalog, f.clock);
		assert.equal(f.picker.visible, true); assert.equal(f.picker.inputBox, false);
		const projects = f.picker.model.items as readonly (QuickPickItem & { contextId: string })[];
		assert.deepEqual(new Set(projects.map(project => project.contextId)), new Set([TEST_SYSTEM_CONTEXT_ID, TEST_CARTRIDGE_CONTEXT_IDS[0]]));
		f.picker.model.list.selectionIndex = f.picker.model.list.rows.findIndex(row => projects[row.itemIndex].contextId === TEST_CARTRIDGE_CONTEXT_IDS[0]);
		f.picker.accept();
		assert.equal(f.picker.inputBox, true);
		assert.equal(f.picker.field.text, '', 'the explicitly chosen project cannot inherit an external or generated directory');
		assert.equal(f.group.model.activeTab!.resource, f.resource);
	});
}
