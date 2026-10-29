import { TEST_SYSTEM_CONTEXT_ID, TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import { createTestEditorParts } from '../helpers/editor_panes';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { HeadlessClipboard } from '../../hosts/node/headless/clipboard';
import type { CartEditor } from '../../ide/cart_editor';
import { IdeMicrotaskQueue } from '../../ide/common/microtask_queue';
import { editorRuntimeState } from '../../ide/editor/common/runtime_state';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { inputFocus } from '../../ide/input/focus';
import { openCreateResourcePrompt } from '../../ide/workbench/contrib/resources/create';
import { RuntimeIdeState } from '../../ide/workbench/state';
import type { QuickPickItem } from '../../ide/workbench/services/quick_input/provider';
import { resolveLuaCodeEditorInput } from '../../ide/workbench/ui/code_tab/io';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from '../helpers/scenario_sources';
import { createHostFrameFixture } from '../helpers/host_frame';
import { SCENE_VIEWPORT_SOURCE } from '../fixtures/studio/scene_viewport';

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

function commandFixture(t: TestContext) {
	configureFontVariant('tiny');
	editorViewState.viewportWidth = 384; editorViewState.viewportHeight = 288;
	const host = createHostFrameFixture();
	const sources = createScenarioTestSourceState([
		createScenarioTestSourceRecord('scripts/background.lua', 1, SCENE_VIEWPORT_SOURCE),
		createScenarioTestSourceRecord('receiver/target.lua', 1),
		createScenarioTestSourceRecord('cartlib/world/scene_library.lua', 1, 'return {}'),
	]);
	const unused = (): never => { throw new Error('Resource creation admission does not request domain work.'); };
	const ide = new RuntimeIdeState(host.runtime, host.presenter, { capture: unused }, unused,
		{ measureDisplay: () => ({ left: 0, top: 0, width: 384, height: 288 }) },
		host.input, host.audio, host.tasks, host.execution, host.rewind, host.clock, new HeadlessClipboard(),
		new IdeMicrotaskQueue(), { log() {} }, 0.3, { width: 384, height: 288 }, sources, new Map(), unused, unused, unused);
	const editor = ide.editor, group = editor.editorParts.main.activeGroup;
	editorRuntimeState.active = true; editor.interaction.setActive(true);
	const resource = sources.catalog.luaResources.find(resource => resource.path === 'scripts/background.lua')!;
	const input = resolveLuaCodeEditorInput(sources.catalog, resource);
	group.openEditor(input); editor.update(0);
	const receiverPart = editor.editorParts.createDocument(), receiver = receiverPart.activeGroup;
	receiver.openEditor(resolveLuaCodeEditorInput(sources.catalog,
		sources.catalog.luaResources.find(resource => resource.path === 'receiver/target.lua')!));
	editor.update(0);
	t.after(async () => {
		inputFocus.setTarget(null); await editor.shutdown();
		host.audio.dispose(); host.input.dispose(); editorTextModelService.clear();
	});
	return { ide, editor, group, input, receiverPart, receiver };
}

const NEW_SOURCE_COMMANDS = ['createResource', 'aem.create', 'animation.create', 'animation.createSprite',
	'progression.createProgram', 'input.createBindings', 'behaviorLens.createEffect'] as const;

for (const command of NEW_SOURCE_COMMANDS) {
	test(`${command} from Main chooses an explicit project instead of the background destination document`, async t => {
		const f = commandFixture(t);
		const document = f.ide.sceneSources.get(f.input.workingCopy);
		assert.equal(await f.editor.openSceneInMain(f.input.workingCopy,
			{ document, sourceVersion: f.input.workingCopy.version, scene: document.scenes[0] },
			f.group.panes.activePane!.commandTarget), true);
		const origin = f.editor.mainWorkspace.primary!.commandTarget;
		assert.equal(f.editor.mainWorkspace.isPrimaryTarget(origin), true);
		f.editor.commands.execute(command, origin, undefined, f.receiver.panes.activePane!.commandTarget);
		const picker = f.receiverPart.quickInput;
		assert.equal(picker.visible, true);
		assert.equal(picker.inputBox, false, 'a receiving group is not the authoring project subject');
		const projects = picker.model.items as readonly (QuickPickItem & { contextId: string })[];
		assert.deepEqual(new Set(projects.map(project => project.contextId)), new Set([TEST_SYSTEM_CONTEXT_ID, TEST_CARTRIDGE_CONTEXT_IDS[0]]));
		assert.ok(f.group.model.activeTab === f.input, 'offering project choice must not replace the background document');
	});

	for (const explicit of [false, true]) test(`${command} retains its ${explicit ? 'explicit' : 'implicit'} source across an independent receiving document`, t => {
		const f = commandFixture(t), origin = f.group.panes.activePane!.commandTarget;
		f.editor.commands.execute(command, origin, explicit ? f.input : undefined, f.receiver.panes.activePane!.commandTarget);
		const picker = f.receiverPart.quickInput;
		assert.equal(picker.visible, true); assert.equal(picker.inputBox, true);
		assert.equal(picker.field.text, command === 'aem.create' ? 'res/data/events.aem.yaml' : 'scripts/',
			'the proposed filesystem path belongs to the captured document, not UI wording');
		assert.ok(f.group.model.activeTab === f.input);
	});
}

test('New File from root Files chrome retains ordinary active-document inheritance', t => {
	const f = commandFixture(t);
	assert.equal(f.group.focus(), true);
	f.editor.commands.execute('resources.focus');
	const origin = f.editor.resourcePanel.focusTarget;
	assert.ok(inputFocus.admittedTarget === origin);
	assert.equal(f.editor.mainWorkspace.isPrimaryTarget(origin), false);
	assert.equal(f.editor.mainWorkspace.isActivityTarget(origin), false);
	f.editor.commands.execute('createResource', origin);
	const picker = f.editor.editorParts.main.quickInput;
	assert.equal(picker.visible, true); assert.equal(picker.inputBox, true);
	assert.equal(picker.field.text, 'scripts/', 'root document chrome keeps its existing authoring directory contract');
	assert.ok(f.group.model.activeTab === f.input);
});

test('New File uses a project resource authoring directory, including a project-local library-named folder', t => {
	const f = fixture(t, 'cartlib/local.lua', 'carts/nemesis_s/cartlib/local.lua');
	openCreateResourcePrompt(f.editor, f.group, f.sources.catalog, f.clock, f.resource);
	assert.equal(f.picker.inputBox, true);
	// This is the actual proposed filesystem directory, not the prompt wording.
	assert.equal(f.picker.field.text, 'cartlib/');
	assert.equal(f.group.model.activeTab!.resource, f.resource);
});

test('New File without a resource seed asks for a project even when its receiver has an authored document', t => {
	const f = fixture(t, 'scripts/background.lua', 'carts/nemesis_s/scripts/background.lua');
	openCreateResourcePrompt(f.editor, f.group, f.sources.catalog, f.clock, undefined);
	assert.equal(f.picker.visible, true); assert.equal(f.picker.inputBox, false);
	const projects = f.picker.model.items as readonly (QuickPickItem & { contextId: string })[];
	assert.deepEqual(new Set(projects.map(project => project.contextId)), new Set([TEST_SYSTEM_CONTEXT_ID, TEST_CARTRIDGE_CONTEXT_IDS[0]]));
	assert.ok(f.group.model.activeTab!.resource === f.resource);
});

for (const stage of ['project chooser', 'filename'] as const) {
	test(`New File ${stage} retires with its explicit destination independently of chrome focus`, t => {
		const f = stage === 'project chooser'
			? fixture(t, 'cartlib/shared.lua', 'cartlib/shared.lua')
			: fixture(t, 'local.lua', 'carts/nemesis_s/local.lua');
		const chrome = inputFocus.createTarget(), unbindKeyboard = chrome.bindKeyboard(() => {});
		t.after(unbindKeyboard);
		chrome.focus();
		openCreateResourcePrompt(f.editor, f.group, f.sources.catalog, f.clock, f.resource);
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
	openCreateResourcePrompt(f.editor, f.group, f.sources.catalog, f.clock, f.resource);
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
		openCreateResourcePrompt(f.editor, f.group, f.sources.catalog, f.clock, f.resource);
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
