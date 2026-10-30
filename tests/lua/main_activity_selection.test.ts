import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyModifier } from '../../hosts/common/input/text';
import type { StudioBuildJob } from '../../hosts/common/studio_builds';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { setFieldText } from '../../ide/editor/ui/inline/text_field';
import { inputFocus } from '../../ide/input/focus';
import { BuildOutputActivity } from '../../ide/workbench/contrib/builds/activity';
import { openBuildLog } from '../../ide/workbench/contrib/builds/editor_input';
import { ScenePrimaryClient } from '../../ide/workbench/contrib/scene_editor/primary_client';
import { selectSceneOutlineRow } from '../../ide/workbench/contrib/scene_editor/outline';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import type { WorkspaceBuilds } from '../../ide/workbench/services/builds';
import { createActualSourcePanes } from '../helpers/source_panes';

const SCENE = `local scenes = require('cartlib/world/scene_library')
scenes.register('activity-context', { objects = {
 { member_id = 'selected', definition_id = 'actor', spatial = { local_transform = { 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 2, 3 } } },
} })
return {}
`;
const OUTPUT = 'first needle\nsecond needle\nthird needle\n';
const ERROR = 'exact build failure\r\n';

async function fixture(t: TestContext, failed = false, initialResult = true) {
	const f = createActualSourcePanes(t, false, [['scene.lua', SCENE], ['cartlib/world/scene_library.lua', 'return {}']]);
	f.editor.setFontVariant('tiny');
	const job: StudioBuildJob = { request: { requestId: 'activity-request', target: 'fixture-product', debug: true, optLevel: 0 },
		state: failed ? 'failed' : 'completed', phase: 'published', acceptedAt: 0, updatedAt: 1,
		version: { generation: 1, sequence: 1 }, error: failed ? ERROR : undefined };
	let reads = 0;
	const builds: WorkspaceBuilds = { jobs: [job], pending: [], targets: async () => ['fixture-product'],
		get: async () => job, log: async () => { reads++; return OUTPUT; },
		submit: async () => assert.fail('reading cannot submit a build'), cancel: async () => assert.fail('reading cannot cancel a build'),
		forget: () => assert.fail('reading cannot discard a build') };
	f.editor.builds = builds;
	const main = f.editor.mainWorkspace, result = f.editor.buildOutputs!.get(job);
	const activity = main.activities.clientWithId('builds.output'); assert.ok(activity instanceof BuildOutputActivity);
	await result.refresh(); if (initialResult) activity.select(result);
	main.regionLayout.activityHeight = 130; f.update();
	return { ...f, main, activity, result, job, builds, reads: () => reads };
}

test('an actual native authoring draft can veto activity selection without publishing or blurring it', async t => {
	const f = await fixture(t), resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!;
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource), document = f.ide.sceneSources.get(model);
	assert.equal(await f.editor.openSceneInMain(() => ({ model, subject: { document, sourceVersion: model.version, scene: document.scenes[0] } }), inputFocus.target!), true);
	const primary = f.main.primary; assert.ok(primary instanceof ScenePrimaryClient);
	selectSceneOutlineRow(primary.view.hierarchy, 1); primary.hierarchy.update(); primary.details.update();
	const field = primary.details.control.controls[0]; field.field.focusTarget.focus(); setFieldText(field.field, 'not an integer', true);
	const source = model.buffer.getText(), selected = f.main.activity;
	assert.equal(f.main.openActivity('builds.output'), false);
	assert.ok(f.main.activity === selected && f.main.activities.selectedId === 'problems');
	assert.ok(inputFocus.admittedTarget === field.field.focusTarget);
	assert.equal(model.buffer.getText(), source); assert.equal(model.dirty, false);
});

test('a newer native owner admitted during activity departure supersedes the older switch', async t => {
	const f = await fixture(t), problems = f.editor.problems;
	f.main.openActivity('problems'); assert.ok(inputFocus.admittedTarget === problems.focusTarget);
	const generation = problems.scope.contextGeneration;
	const unbind = problems.focusTarget.onDidBlur(() => { unbind(); f.second.focus(); });
	t.after(unbind);
	assert.equal(f.main.openActivity('builds.output'), false);
	assert.ok(f.main.activity === problems && problems.attached && !f.activity.attached);
	assert.equal(problems.scope.contextGeneration, generation);
	assert.ok(inputFocus.admittedTarget === f.second.code.focusTarget);
});

test('background activity selection preserves foreign native focus but hands a departing activity to its selected peer', async t => {
	const f = await fixture(t), source = f.first.code.focusTarget;
	f.first.focus();
	assert.equal(f.main.openActivity('builds.output', { focus: false }), true);
	assert.ok(f.main.activity === f.activity && f.activity.attached && inputFocus.admittedTarget === source);
	f.main.openActivity('problems');
	assert.equal(f.main.openActivity('builds.output', { focus: false }), true);
	assert.ok(inputFocus.admittedTarget === f.activity.commandTarget);
});

for (const variant of ['tiny', 'msx'] as const) test(`${variant} native activity selection and reader Tab boundaries include the permanent selector exactly once`, async t => {
	const f = await fixture(t); f.editor.setFontVariant(variant); f.update();
	const selector = f.main.activities.commandTarget;
	f.main.openActivity('problems'); selector.focus();
	f.key('End'); f.key('Enter');
	assert.ok(f.main.activity === f.activity && inputFocus.admittedTarget === f.activity.commandTarget);
	const body = f.activity.commandTarget;
	f.key('Tab', KeyModifier.shift); const chooser = inputFocus.admittedTarget!;
	assert.ok(chooser !== body && chooser !== selector && chooser.getCommand('builds.output.choose')!.isEnabled());
	f.key('Tab', KeyModifier.shift); assert.ok(inputFocus.admittedTarget === selector);
	f.key('Tab'); const hide = inputFocus.admittedTarget; assert.ok(hide !== null && hide !== selector && hide !== body);
	f.key('Tab'); assert.ok(inputFocus.admittedTarget === body);
	f.key('KeyF', KeyModifier.ctrl); const query = inputFocus.admittedTarget!;
	assert.ok(query !== body && query.textInput !== undefined);
	f.key('Tab'); const actions = inputFocus.admittedTarget!; assert.ok(actions !== query && actions !== selector && actions !== body);
	f.key('Tab'); assert.ok(inputFocus.admittedTarget === selector);
	f.key('Tab', KeyModifier.shift); assert.ok(inputFocus.admittedTarget === body);
	assert.equal(f.firstInput.workingCopy.buffer.getText(), f.source);
});

test('a hidden activity reader retains its own query and selection but cannot borrow the visible activity surface', async t => {
	const f = await fixture(t); f.main.openActivity('builds.output');
	const body = f.activity.commandTarget;
	f.key('KeyF', KeyModifier.ctrl); const field = inputFocus.admittedTarget!, query = field.textInput!;
	assert.equal(query.replaceText(0, query.readText().text.length, 'needle'), true); f.update(); f.key('Enter'); f.key('Escape');
	assert.ok(inputFocus.admittedTarget === body); const selected = body.clipboard!.copy!(); assert.equal(selected, 'needle');
	const reads = f.reads(), generation = f.activity.scope.contextGeneration;
	f.main.openActivity('problems');
	assert.equal(f.activity.attached, false); assert.ok(f.activity.scope.contextGeneration > generation);
	assert.equal(body.focus(), false); assert.equal(field.focus(), false);
	assert.ok(inputFocus.admittedTarget === f.editor.problems.focusTarget);
	assert.equal(query.readText().text, 'needle');
	f.main.openActivity('builds.output');
	assert.ok(inputFocus.admittedTarget === body); assert.equal(body.clipboard!.copy!(), selected);
	f.key('KeyF', KeyModifier.ctrl); assert.ok(inputFocus.admittedTarget === field); assert.equal(field.textInput!.readText().text, 'needle');
	assert.equal(f.reads(), reads, 'native reattachment never refreshes a workspace observation');
});

test('the permanent activity selector has no document Source fallback and retired client origins cannot regain it', async t => {
	const f = await fixture(t), group = f.editor.editorParts.main.activeGroup;
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!;
	f.editor.sceneEditor.openResource(group, resource); f.update();
	f.main.openActivity('problems');
	const selector = f.main.activities.commandTarget; selector.focus();
	const opening = t.mock.method(f.editor.navigation, 'openSource');
	for (const command of ['editor.source', 'editor.sourceToSide'] as const) {
		assert.equal(f.editor.commands.isEnabled(command, selector), false); f.editor.commands.execute(command, selector);
	}
	const origin = f.editor.problems.focusTarget;
	f.main.openActivity('builds.output');
	assert.equal(f.editor.commands.isEnabled('editor.source', origin), false); f.editor.commands.execute('editor.source', origin);
	assert.equal(opening.mock.callCount(), 0); assert.equal(group.model.tabs.length, 1);
	assert.ok(inputFocus.admittedTarget === f.activity.commandTarget);
});

test('Main and an independent document reader share request data but never channel, query or native selection', async t => {
	const f = await fixture(t, true), input = openBuildLog(f.firstGroup, f.result); await f.result.refresh(); f.update();
	input.view.output.setQuery('document query'); input.view.output.select(0, 5);
	f.main.openActivity('builds.output'); const body = f.activity.commandTarget;
	body.getCommand('buildLog.output')!.run(); f.key('KeyF', KeyModifier.ctrl);
	const query = inputFocus.admittedTarget!.textInput!;
	assert.equal(query.replaceText(0, query.readText().text.length, 'needle'), true); f.update(); f.key('Enter'); f.key('Escape');
	assert.equal(body.clipboard!.copy!(), 'needle'); assert.equal(input.view.channel, 'error');
	assert.equal(input.view.output.query, 'document query'); assert.equal(input.view.output.copy(), 'first');
	assert.ok(input.view.result === f.activity.selectedResult);
	f.main.openActivity('problems'); await f.firstGroup.close(input.id); f.update();
	assert.equal(f.result.isDisposed, false); f.main.openActivity('builds.output');
	assert.equal(body.clipboard!.copy!(), 'needle'); assert.ok(f.activity.selectedResult === f.result);
});

test('workspace recovery retains the selected concrete activity ID and requested placement without serializing its reader', async t => {
	const f = await fixture(t); f.main.regionLayout.activityHeight = 117; f.main.openActivity('builds.output');
	const body = f.activity.commandTarget, state = JSON.parse(JSON.stringify(f.main.serialize()));
	assert.equal(state.activityId, 'builds.output'); assert.equal(state.activeClient, 'activity'); assert.equal(state.primary, null);
	f.main.openActivity('problems'); f.main.regionLayout.activityHeight = 81; f.main.setActivityVisible(false);
	const restore = f.main.beginRestore();
	try {
		assert.equal(await restore.restore(state, () => assert.fail('an unbound primary needs no source factory')), true);
		restore.focusClient(); f.update();
		assert.equal(f.main.activities.selectedId, 'builds.output'); assert.equal(f.main.regionLayout.activityHeight, 117);
		assert.equal(f.main.regionLayout.activityVisible, true); assert.ok(f.main.activity === f.activity && f.activity.selectedResult === f.result);
		assert.ok(inputFocus.admittedTarget === body);
	} finally { restore.dispose(); }
});

test('a newer background activity selection during primary restoration is not refocused as the saved activity', async t => {
	const f = await fixture(t), resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!;
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource), document = f.ide.sceneSources.get(model);
	assert.equal(await f.editor.openSceneInMain(() => ({ model, subject: { document, sourceVersion: model.version, scene: document.scenes[0] } }), inputFocus.target!), true);
	f.main.openActivity('builds.output'); const state = f.main.serialize(); f.second.focus();
	const foreground = inputFocus.admittedTarget, ready = Promise.withResolvers<void>(), request = f.main.beginRestore();
	try {
		const restoration = request.restore(state, async (record, surfaces, scope, isCurrent) => {
			await ready.promise; return f.editor.restorePrimaryClient(record, surfaces, scope, isCurrent);
		});
		assert.equal(f.main.openActivity('problems', { focus: false }), true);
		assert.ok(inputFocus.admittedTarget === foreground);
		ready.resolve(); assert.equal(await restoration, true); request.focusClient(); f.update();
		assert.equal(f.main.activities.selectedId, 'problems'); assert.ok(inputFocus.admittedTarget === foreground);
	} finally { ready.resolve(); request.dispose(); }
});

test('same request IDs from replacement providers do not rebind Main or document readers to a namesake observation', async t => {
	const f = await fixture(t), input = openBuildLog(f.firstGroup, f.result); await f.result.refresh(); f.update();
	f.main.openActivity('builds.output'); const retained = f.activity.commandTarget;
	retained.getCommand('buildLog.copyAll')!.run(); assert.equal(await f.editor.clipboard.readText(), OUTPUT);
	f.editor.builds = { ...f.builds, log: async () => 'replacement provider bytes\n' };
	assert.equal(f.result.isDisposed, true); assert.ok(input.view.result === f.result && f.activity.selectedResult === f.result);
	assert.equal(retained.getCommand('buildLog.refresh')!.isEnabled(), false);
	retained.getCommand('buildLog.copyAll')!.run(); assert.equal(await f.editor.clipboard.readText(), OUTPUT);
	const newer = f.editor.buildOutputs!.get(f.job); await newer.refresh();
	assert.ok(newer !== f.result); assert.equal(f.activity.select(newer, { focus: true }), true);
	assert.ok(f.activity.selectedResult === newer && input.view.result === f.result);
	f.activity.commandTarget.getCommand('buildLog.copyAll')!.run();
	assert.equal(await f.editor.clipboard.readText(), 'replacement provider bytes\n');
	assert.equal(input.view.output.buffer.getText(), OUTPUT);
});

test('an unbound Build Output activity keeps its actual chooser and selector native boundaries', async t => {
	const f = await fixture(t, false, false); f.main.openActivity('builds.output');
	const chooser = inputFocus.admittedTarget, selector = f.main.activities.commandTarget;
	assert.ok(chooser !== null && chooser === f.activity.commandTarget && chooser !== selector);
	assert.equal(chooser.getCommand('builds.output.choose')!.isEnabled(), true);
	f.key('Tab'); assert.ok(inputFocus.admittedTarget === selector);
	f.key('Tab', KeyModifier.shift); assert.ok(inputFocus.admittedTarget === chooser);
	f.main.openActivity('problems'); assert.equal(chooser.focus(), false);
	assert.equal(f.activity.selectedResult, undefined);
});

for (const supersededBy of ['hide', 'activity', 'native focus', 'provider'] as const)
	test(`an asynchronous build observation cannot undo newer ${supersededBy} after native picker admission`, async t => {
		const f = await fixture(t, false, false); f.main.openActivity('builds.output');
		const ready = Promise.withResolvers<StudioBuildJob>(), reads = f.reads();
		const get = t.mock.method(f.builds, 'get', () => ready.promise);
		f.editor.commands.execute('builds.output.choose', f.activity.commandTarget);
		assert.equal(f.editor.quickInput.visible, true); f.key('Enter');
		assert.equal(get.mock.callCount(), 1); assert.equal(f.editor.quickInput.visible, false);
		assert.ok(f.activity.selectedResult === f.result && inputFocus.admittedTarget === f.activity.commandTarget);
		assert.equal(f.result.loading, true);
		// This is the picker-admitted shared operation, not another UI request or preflight read.
		const reading = f.result.refresh(); assert.equal(get.mock.callCount(), 1);
		if (supersededBy === 'hide') {
			f.first.focus(); const source = inputFocus.admittedTarget;
			const header = f.main.activities.headerBounds, x = header.right - 4, y = (header.top + header.bottom) / 2;
			for (const down of [true, false]) f.editor.dispatchPointer({ x, y, buttons: down ? PointerButton.Primary : 0,
				pressedButtons: down ? PointerButton.Primary : 0, releasedButtons: down ? 0 : PointerButton.Primary,
				cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 1 });
			assert.equal(f.main.regionLayout.activityVisible, false);
			assert.ok(inputFocus.admittedTarget === source, 'native header Close does not borrow or blur a separate Source client');
		} else if (supersededBy === 'activity') f.main.openActivity('problems');
		else if (supersededBy === 'native focus') f.second.focus();
		else f.editor.builds = { ...f.builds };
		const foreground = inputFocus.admittedTarget, selected = f.main.activity, visible = f.main.regionLayout.activityVisible;
		ready.resolve(f.job); await reading; f.update();
		assert.ok(f.activity.selectedResult === f.result && f.main.activity === selected && inputFocus.admittedTarget === foreground);
		assert.equal(f.main.regionLayout.activityVisible, visible);
		assert.equal(f.reads(), reads + (supersededBy === 'provider' ? 0 : 1));
	});
