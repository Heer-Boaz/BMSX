import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { resetSemanticProjects } from '../../ide/editor/contrib/intellisense/semantic/workspace/state';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { InputFocusScope, inputFocus, type InputFocusTarget } from '../../ide/input/focus';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import type { MainWorkspaceClient, MainWorkspaceRegionClient } from '../../ide/workbench/common/main_workspace_client';
import { WorkbenchMenu } from '../../ide/workbench/ui/menu/model';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { createTestEditorWorkspace } from '../helpers/editor_panes';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from '../helpers/scenario_sources';
import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';

function fixture(t: TestContext) {
	configureFontVariant('tiny');
	const sources = createScenarioTestSourceState([
		createScenarioTestSourceRecord('a.lua', 1, 'return 1'), createScenarioTestSourceRecord('b.lua', 1, 'return 2'),
		createScenarioTestSourceRecord('c.lua', 1, 'return 3'),
	]);
	const model = (path: string) => resolveLuaTextFileModel(editorTextModelService, sources.catalog,
		sources.catalog.resolveResource({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path })!);
	const inputs = [new CodeEditorInput(model('a.lua')), new CodeEditorInput(model('b.lua')), new CodeEditorInput(model('c.lua'))];
	const { editorParts, mainWorkspace: main } = createTestEditorWorkspace(t);
	const group = editorParts.main.activeGroup;
	for (const input of inputs) group.openEditor(input, { preserveFocus: true });
	const viewport = inputFocus.createTarget(null, new InputFocusScope(Symbol('actual viewport'), group.focusScope));
	t.after(() => { inputFocus.setTarget(null); editorTextModelService.clear(); resetSemanticProjects(editorTextModelService); sources.catalog.dispose(); });
	let constructions = 0, disposals = 0;
	const bind = (input: CodeEditorInput, target: InputFocusTarget = viewport, beforeReturn?: () => void,
		isCurrent: () => boolean = () => group.model.contains(input)) => main.bindPrimary(input, target, (_surfaces, scope) => {
		constructions++;
		const commandTarget = inputFocus.createTarget(null, scope);
		const region = (): MainWorkspaceRegionClient => ({ scope, commandTarget, attached: false,
			contextActions: new WorkbenchMenu([], undefined), description: input.workingCopy.resource.path,
			measure: (_font, constraints) => { constraints.minimumWidth = 0; constraints.preferredWidth = 0; constraints.minimumHeight = 0; },
			attach() { this.attached = true; }, detach() { this.attached = false; }, layout() {}, update() {}, focus() {}, setHeaderVisible() {} });
		const client: MainWorkspaceClient = { input, viewportTarget: target, scope, commandTarget, hierarchy: region(), details: region(),
			preferredPart: 'viewport', statusItems: [], attach() {}, onDidChange: () => () => {}, isCurrent: () => true,
			update() {}, focus() {}, updateStatus() {}, dispose() { disposals++; } };
		beforeReturn?.(); return client;
	}, isCurrent, () => group.captureNavigationEntry());
	return { main, group, inputs, viewport, bind, constructions: () => constructions, disposals: () => disposals };
}

test('companion binding settles only the outgoing document draft and never owns the documents', t => {
	const f = fixture(t), [a, b] = f.inputs;
	assert.equal(f.bind(a), true);
	const first = f.main.primary!, edit = inputFocus.createTarget(null, first.scope);
	let valid = false, commits = 0;
	edit.edit = { get pending() { return true; }, commit: () => { commits++; return valid; }, cancel() {} };
	assert.equal(edit.focus(), true);
	assert.equal(f.bind(b), false); assert.equal(f.constructions(), 1);
	assert.equal(f.main.primary, first); assert.equal(a.attachedEditScope, first.scope);
	assert.equal(f.group.model.contains(a), true); assert.equal(f.group.model.contains(b), true);
	assert.equal(f.main.preparePrimaryUnbind(a, f.viewport), false);
	assert.equal(f.main.primary, first); assert.equal(a.attachedEditScope, first.scope);
	valid = true;
	assert.equal(f.bind(b), true); assert.equal(commits, 3); assert.equal(f.disposals(), 1);
	assert.equal(a.attachedEditScope, undefined); assert.equal(b.attachedEditScope, f.main.primary!.scope);
	assert.equal(f.main.preparePrimaryUnbind(a, f.viewport), true); f.main.retirePrimary(a, f.viewport); assert.equal(f.main.primary!.input, b);
	assert.equal(f.main.preparePrimaryUnbind(b, f.viewport), true); f.main.retirePrimary(b, f.viewport); assert.equal(b.attachedEditScope, undefined);
	assert.equal(f.group.model.contains(a), true); assert.equal(f.group.model.contains(b), true);
});

test('a newer binding published by draft settlement wins over the old handoff', t => {
	const f = fixture(t), [a, b, c] = f.inputs;
	assert.equal(f.bind(a), true);
	const edit = inputFocus.createTarget(null, f.main.primary!.scope);
	let pending = true;
	edit.edit = { get pending() { return pending; }, commit: () => { pending = false; assert.equal(f.bind(c), true); return true; }, cancel() {} };
	assert.equal(edit.focus(), true);
	assert.equal(f.bind(b), false);
	assert.equal(f.main.primary!.input, c); assert.equal(c.attachedEditScope, f.main.primary!.scope);
	assert.equal(a.attachedEditScope, undefined); assert.equal(b.attachedEditScope, undefined);
});

test('a candidate cannot overwrite a newer binding admitted during its construction', t => {
	const f = fixture(t), [a, b, c] = f.inputs;
	assert.equal(f.bind(a), true);
	assert.equal(f.bind(b, f.viewport, () => assert.equal(f.bind(c), true)), false);
	assert.equal(f.main.primary!.input, c);
	assert.equal(a.attachedEditScope, undefined); assert.equal(b.attachedEditScope, undefined);
	assert.equal(c.attachedEditScope, f.main.primary!.scope); assert.equal(f.disposals(), 2);
});

test('a currentness callback cannot admit a candidate after publishing a newer binding', t => {
	const f = fixture(t), [a, b, c] = f.inputs;
	assert.equal(f.bind(a), true);
	let calls = 0;
	assert.equal(f.bind(b, f.viewport, undefined, () => {
		if (++calls === 2) assert.equal(f.bind(c), true);
		return true;
	}), false);
	assert.equal(f.main.primary!.input, c);
	assert.equal(f.constructions(), 2, 'the superseded candidate is never constructed');
	assert.equal(b.attachedEditScope, undefined); assert.equal(c.attachedEditScope, f.main.primary!.scope);
});
