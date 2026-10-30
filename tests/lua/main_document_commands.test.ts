import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import type { StudioBuildJob } from '../../hosts/common/studio_builds';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { inputFocus } from '../../ide/input/focus';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { BuildOutputActivity } from '../../ide/workbench/contrib/builds/activity';
import { ScenePrimaryClient } from '../../ide/workbench/contrib/scene_editor/primary_client';
import { selectSceneOutlineRow } from '../../ide/workbench/contrib/scene_editor/outline';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import type { WorkspaceBuilds } from '../../ide/workbench/services/builds';
import { SCENE_VIEWPORT_SOURCE } from '../fixtures/studio/scene_viewport';
import { createActualSourcePanes } from '../helpers/source_panes';

type Origin = 'hierarchy' | 'details' | 'problems' | 'output';
const DOCUMENT_COMMANDS = ['tabs.close', 'tabs.closeOthers', 'tabs.closeAll', 'tabs.next', 'tabs.previous',
	'window.moveEditor', 'window.copyEditor'] as const;

async function fixture(t: TestContext, origin: Origin = 'hierarchy', dirty = true) {
	const f = createActualSourcePanes(t, false, [['scene.lua', SCENE_VIEWPORT_SOURCE], ['cartlib/world/scene_library.lua', 'return {}']]);
	const main = f.editor.mainWorkspace, group = f.editor.editorParts.main.activeGroup;
	const first = new CodeEditorInput(f.firstInput.workingCopy), second = new CodeEditorInput(f.secondInput.workingCopy);
	group.openEditor(first); group.openEditor(second);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!;
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource), document = f.ide.sceneSources.get(model);
	assert.equal(await f.editor.openSceneInMain(() => ({ model, subject: { document, sourceVersion: model.version, scene: document.scenes[0] } }), inputFocus.target!), true);
	const primary = main.primary; assert.ok(primary instanceof ScenePrimaryClient);
	assert.equal(selectSceneOutlineRow(primary.view.hierarchy, 1), true);
	if (dirty) for (const input of [first, second]) input.workingCopy.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- retained document edit\n' }]);
	f.update();
	if (origin === 'hierarchy' || origin === 'details') main.focusPrimary(origin);
	else {
		if (origin === 'output') {
			const job: StudioBuildJob = { request: { requestId: 'command-subject-output', target: 'fixture-product', debug: true, optLevel: 0 },
				state: 'completed', phase: 'published', acceptedAt: 0, updatedAt: 1, version: { generation: 1, sequence: 1 } };
			const builds: WorkspaceBuilds = { jobs: [job], pending: [], targets: async () => ['fixture-product'], get: async () => job,
				log: async () => 'retained build output\n', submit: async () => assert.fail('document commands cannot submit a build'),
				cancel: async () => assert.fail('document commands cannot cancel a build'), forget: () => assert.fail('document commands cannot discard a build') };
			f.editor.builds = builds;
			const output = f.editor.buildOutputs!.get(job); await output.refresh();
			const activity = main.activities.clientWithId('builds.output'); assert.ok(activity instanceof BuildOutputActivity);
			activity.select(output);
		}
		main.regionLayout.activityHeight = 100;
		assert.equal(main.openActivity(origin === 'output' ? 'builds.output' : 'problems'), true);
	}
	f.update();
	const target = inputFocus.admittedTarget; assert.ok(target !== null);
	assert.equal(origin === 'hierarchy' || origin === 'details' ? main.isPrimaryTarget(target) : main.isActivityTarget(target), true);
	assert.ok(group.model.activeTab === second && main.primary === primary);
	return { ...f, main, group, first, second, primary, target };
}

for (const origin of ['hierarchy', 'details', 'problems', 'output'] as const) {
	for (const command of DOCUMENT_COMMANDS) test(`${origin} ${command} has no implicit ordinary document subject`, async t => {
		const f = await fixture(t, origin), parts = f.editor.editorParts;
		const documents = [...parts.documents], memberships = parts.groups.map(group => ({ group, inputs: [...group.model.tabs], active: group.model.activeTab }));
		const selection = f.primary.consumer.selection, firstSource = f.first.workingCopy.buffer.getText(), secondSource = f.second.workingCopy.buffer.getText();
		const enabled = f.editor.commands.isEnabled(command, f.target);
		f.editor.commands.execute(command, f.target); await setImmediate();
		assert.ok(parts.documents.length === documents.length && parts.documents.every((part, index) => part === documents[index]),
			'a primary/activity action cannot create or transfer an unrelated document window');
		assert.ok(memberships.every(({ group, inputs, active }) => group.model.tabs.length === inputs.length
			&& group.model.tabs.every((input, index) => input === inputs[index]) && group.model.activeTab === active),
			'a primary/activity action cannot close or cycle ordinary document membership');
		assert.equal([parts.main, ...parts.documents].some(part => part.quickInput.visible), false, 'a subject-less action cannot open a Move Editor chooser');
		assert.ok(f.main.primary === f.primary && f.primary.consumer.selection === selection);
		assert.equal(f.first.workingCopy.buffer.getText(), firstSource); assert.equal(f.second.workingCopy.buffer.getText(), secondSource);
		assert.equal(f.first.workingCopy.dirty, true); assert.equal(f.second.workingCopy.dirty, true);
		assert.equal(f.first.workingCopy.canUndo, true); assert.equal(f.second.workingCopy.canUndo, true);
		assert.ok(inputFocus.admittedTarget === f.target);
		assert.equal(enabled, false);
	});
}

for (const origin of ['hierarchy', 'problems'] as const) {
	for (const binding of ['native', 'contextual', 'disabled local', 'declined capture'] as const)
		test(`${origin} ${binding} capability owns its document-named action without fallback`, async t => {
			const f = await fixture(t, origin), inputs = [...f.group.model.tabs]; let runs = 0;
			if (binding !== 'native') f.target.commandContext.registerCommand('tabs.close', {
				contextual: true, isEnabled: () => true, run: () => { runs++; },
			});
			if (binding !== 'contextual') f.target.registerCommand('tabs.close', {
				isEnabled: () => binding !== 'disabled local', run: () => { runs++; },
				capture: binding === 'declined capture' ? () => undefined : undefined,
			});
			assert.equal(f.editor.commands.isEnabled('tabs.close', f.target), binding !== 'disabled local');
			f.editor.commands.execute('tabs.close', f.target); await setImmediate();
			assert.equal(runs, binding === 'disabled local' || binding === 'declined capture' ? 0 : 1);
			assert.ok(f.group.model.tabs.length === inputs.length && f.group.model.tabs.every((input, index) => input === inputs[index]));
			assert.ok(f.group.model.activeTab === f.second && f.main.primary === f.primary && inputFocus.admittedTarget === f.target);
		});
}

for (const command of ['tabs.close', 'tabs.closeOthers'] as const)
	test(`Main can explicitly address an inactive document for ${command}`, async t => {
		const f = await fixture(t);
		assert.equal(f.editor.commands.isEnabled(command, f.target, f.first), true);
		f.editor.commands.execute(command, f.target, f.first); await setImmediate();
		const retained = command === 'tabs.close' ? f.second : f.first;
		assert.ok(f.group.model.tabs.length === 1 && f.group.model.tabs[0] === retained && f.group.model.activeTab === retained);
		assert.ok(f.firstGroup.model.activeTab === f.firstInput && f.secondGroup.model.activeTab === f.secondInput);
		assert.ok(f.main.primary === f.primary);
	});

test('an inactive tab context remains an exact document subject rather than the group active input', async t => {
	const f = await fixture(t), target = f.group.tabStrip.focusTarget;
	assert.equal(f.editor.commands.isEnabled('tabs.close', target, f.first), true);
	f.editor.commands.execute('tabs.close', target, f.first); await setImmediate();
	assert.ok(!f.group.model.contains(f.first) && f.group.model.activeTab === f.second && f.group.model.contains(f.second));
	assert.ok(f.main.primary === f.primary);
});

for (const origin of ['hierarchy', 'problems'] as const)
	test(`${origin} can explicitly close an inactive document owned by another part`, async t => {
		const f = await fixture(t, origin), foreignActive = new CodeEditorInput(f.second.workingCopy);
		f.firstGroup.openEditor(foreignActive);
		const enabled = f.editor.commands.isEnabled('tabs.close', f.target, f.firstInput);
		f.editor.commands.execute('tabs.close', f.target, f.firstInput); await setImmediate();
		assert.ok(!f.firstGroup.model.contains(f.firstInput) && f.firstGroup.model.activeTab === foreignActive);
		assert.ok(f.group.model.contains(f.first) && f.group.model.activeTab === f.second && f.secondGroup.model.activeTab === f.secondInput);
		assert.ok(f.main.primary === f.primary);
		assert.equal(enabled, true);
	});

for (const origin of ['shell', 'no target'] as const) test(`${origin} invocation intentionally addresses the captured active document`, async t => {
	const f = await fixture(t), target = origin === 'shell' ? f.editor.statusBar.focusTarget : null;
	assert.equal(f.editor.commands.isEnabled('tabs.close', target), true);
	f.editor.commands.execute('tabs.close', target); await setImmediate();
	assert.ok(!f.group.model.contains(f.second) && f.group.model.activeTab === f.first && f.group.model.contains(f.first));
	assert.ok(f.main.primary === f.primary);
});

test('explicit workspace Close All remains workspace-wide from the Main authored context', async t => {
	const f = await fixture(t, 'hierarchy', false), selection = f.primary.consumer.selection;
	assert.equal(f.editor.commands.isEnabled('editors.closeAll', f.target), true);
	f.editor.commands.execute('editors.closeAll', f.target); await setImmediate();
	assert.equal(f.editor.editorParts.groups.every(group => group.model.tabs.length === 0), true);
	assert.ok(f.main.primary === f.primary && f.primary.consumer.selection === selection && f.primary.consumer.isCurrent);
});
