import { editorViewState } from '../../ide/editor/ui/view/state';
import { beforeEach } from 'node:test';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import assert from 'node:assert/strict';
import test from 'node:test';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { CartMapController } from '../../ide/workbench/contrib/cart_maps/controller';
import { CartMapInput } from '../../ide/workbench/contrib/cart_maps/editor_input';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { resolveTextCodeEditorInput } from '../../ide/workbench/ui/code_tab/io';
import { createTestEditorGroup } from '../helpers/editor_panes';
import { createScenarioTestSourceState } from '../helpers/scenario_sources';
import { ContextMenuController } from '../../ide/workbench/services/context_menu/controller';
import { QuickInputController } from '../../ide/workbench/services/quick_input/controller';
import { inputFocus } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';

beforeEach(() => configureFontVariant('tiny'));

test('a map picker retains only its explicit destination group lifetime', t => {
	const sources = createScenarioTestSourceState([]), destination = createTestEditorGroup(), sibling = createTestEditorGroup();
	const menu = new ContextMenuController(inputFocus, pointerCapture), picker = new QuickInputController(menu, undefined, undefined, { scope: inputFocus.workbenchScope, bounds: { left: 0, top: 0, right: editorViewState.viewportWidth, bottom: editorViewState.viewportHeight }, kind: 'workspace' });
	const controller = new CartMapController(sources.catalog);
	t.after(() => { picker.dispose(); menu.dispose(); destination.dispose(); sibling.dispose(); inputFocus.setTarget(null); });
	controller.open(destination, picker);
	assert.equal(picker.visible, true);
	sibling.dispose();
	assert.equal(picker.visible, true, 'retiring another group does not revoke this opening');
	destination.dispose();
	assert.equal(picker.visible, false, 'a pending choice cannot later open into its retired destination');
});

test('a map choice cannot reopen its destination when chrome return focus retires that group', async t => {
	const sources = createScenarioTestSourceState([]), destination = createTestEditorGroup();
	sources.catalog.registerTextSources(TEST_CARTRIDGE_CONTEXT_IDS[0], [{ type: 'data', resid: 'stage',
		source_path: 'res/data/nemesis_s_stage.yaml', sourcemeta: { text: 'map_rows: ["m "]\n' } }]);
	const menu = new ContextMenuController(inputFocus, pointerCapture), picker = new QuickInputController(menu, undefined, undefined, { scope: inputFocus.workbenchScope, bounds: { left: 0, top: 0, right: editorViewState.viewportWidth, bottom: editorViewState.viewportHeight }, kind: 'workspace' });
	const controller = new CartMapController(sources.catalog), chrome = inputFocus.createTarget();
	const unbindKeyboard = chrome.bindKeyboard(() => {});
	const open = t.mock.method(controller, 'openResource');
	t.after(() => {
		picker.dispose(); menu.dispose(); destination.dispose(); unbindKeyboard();
		editorTextModelService.clear(); inputFocus.setTarget(null);
	});
	chrome.focus();
	controller.open(destination, picker);
	assert.equal(picker.invocationOrigin, chrome);
	assert.equal(picker.model.items.length, 1);
	picker.model.list.selectionIndex = 0;
	let returned = 0;
	const unbindFocus = chrome.onDidFocus(() => { unbindFocus(); returned++; destination.dispose(); });
	t.after(unbindFocus);
	picker.accept();
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.equal(returned, 1);
	assert.equal(open.mock.callCount(), 0, 'retirement during focus return revokes the selected map callback');
	assert.equal(destination.panes.activePane, null);
	assert.equal(destination.model.tabs.length, 0);
	assert.equal(picker.visible, false);
});

test('one map controller admits concurrent Source views into their explicit destination groups', async t => {
	const sources = createScenarioTestSourceState([]), first = createTestEditorGroup(), second = createTestEditorGroup();
	const resource = { contextLabel: 'Fixture project', sourceFilePath: 'res/data/nemesis_s_stage.yaml', location: { kind: 'workspace' as const, path: 'res/data/nemesis_s_stage.yaml' },
		contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'res/data/nemesis_s_stage.yaml', source: { resid: 'stage', type: 'data' } } as const;
	const model = editorTextModelService.retain(resource, 'yaml', 'map_rows: ["m m "]\n');
	const left = new CartMapInput(model, 'nemesis'), right = new CartMapInput(model, 'nemesis');
	first.openEditor(left); second.openEditor(right);
	t.after(() => { first.dispose(); second.dispose(); editorTextModelService.clear(); });
	const controller = new CartMapController(sources.catalog);
	controller.openSource(first, left);
	controller.openSource(second, right);
	await new Promise<void>(resolve => setImmediate(resolve));
	const firstSource = first.model.activeTab, secondSource = second.model.activeTab;
	assert.ok(firstSource?.kind === 'code_editor'); assert.ok(secondSource?.kind === 'code_editor');
	assert.notEqual(firstSource, secondSource);
	assert.notEqual(firstSource.context.view, secondSource.context.view);
	assert.equal(firstSource.workingCopy, model); assert.equal(secondSource.workingCopy, model);
	assert.equal(first.model.findById(left.id), left); assert.equal(second.model.findById(right.id), right);
	firstSource.context.view.cursorColumn = 4;
	assert.notEqual(secondSource.context.view.cursorColumn, firstSource.context.view.cursorColumn,
		'two admitted Source views share authored text, not presentation state');
});

for (const existing of [false, true]) test(`superseded map source opening disposes only its unadmitted candidate (${existing ? 'retained' : 'new'} source view)`, async t => {
	const sources = createScenarioTestSourceState([]), group = createTestEditorGroup();
	const resource = { contextLabel: 'Fixture project', sourceFilePath: 'res/data/nemesis_s_stage.yaml', location: { kind: 'workspace' as const, path: 'res/data/nemesis_s_stage.yaml' }, contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'res/data/nemesis_s_stage.yaml', source: { resid: 'stage', type: 'data' } } as const;
	const model = editorTextModelService.retain(resource, 'yaml', 'map_rows: ["m "]\n');
	const input = new CartMapInput(model, 'nemesis');
	t.after(() => {
		group.dispose(); input.dispose();
		editorTextModelService.clear();
	});
	const retained = existing ? await resolveTextCodeEditorInput(sources.catalog, resource) : undefined;
	if (retained !== undefined) group.model.add(retained);
	const disposed: CodeEditorInput[] = [];
	const dispose = CodeEditorInput.prototype.dispose;
	t.mock.method(CodeEditorInput.prototype, 'dispose', function (this: CodeEditorInput) { disposed.push(this); dispose.call(this); });
	const controller = new CartMapController(sources.catalog);
	controller.openSource(group, input);
	group.panes.beginOpen();
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.equal(group.panes.activePane, null);
	assert.equal(disposed.length, 1);
	const candidate = disposed[0];
	assert.equal(candidate.workingCopy, model);
	if (retained !== undefined) {
		assert.notEqual(candidate, retained);
		assert.notEqual(candidate.context.view, retained.context.view);
		assert.equal(group.model.findById(retained.id), retained);
		retained.context.view.cursorColumn = 3;
	} else assert.equal(group.model.tabs.length, 0);
	candidate.context.view.cursorColumn = 3;
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- prefix\n' }]);
	assert.equal(candidate.context.view.cursorRow, 0, 'discarded candidates no longer observe the canonical model');
	if (retained !== undefined) assert.equal(retained.context.view.cursorRow, 1, 'the retained sibling keeps its binding');

});
