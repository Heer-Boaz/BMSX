import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import type { WorkspaceBuilds } from '../../ide/workbench/services/builds';
import type { StudioBuildJob } from '../../hosts/common/studio_builds';
import { showBuildJobs } from '../../ide/workbench/contrib/builds/commands';
import { PlayEditorInput } from '../../ide/workbench/contrib/play/editor_input';
import { PlayHandle } from '../../ide/workbench/services/play/service';
import { createActualSourcePanes } from '../helpers/source_panes';

test('Build Jobs delivers its captured output to a document without replacing the main work subject', async t => {
	const f = createActualSourcePanes(t);
	f.editor.commands.execute('home');
	const main = f.editor.editorParts.main, subject = main.activeGroup.model.activeTab, pane = main.activeGroup.panes.activePane;
	const job: StudioBuildJob = { request: { requestId: 'captured-build', target: 'fixture', debug: true, optLevel: 0 },
		state: 'failed', phase: 'compile', acceptedAt: 1, updatedAt: 2, version: { generation: 1, sequence: 1 }, error: 'Captured diagnostic' };
	const builds: WorkspaceBuilds = {
		jobs: [job], pending: [], targets: async () => [], get: async () => job, log: async () => 'Captured output',
		submit: async () => assert.fail('viewing a receipt must not submit a build'),
		cancel: async () => assert.fail('viewing a receipt must not cancel a build'),
		forget: () => assert.fail('viewing a receipt must not discard a build'),
	};
	f.editor.builds = builds;
	showBuildJobs(f.editor);
	await f.editor.quickInput.accept(); await setImmediate();
	// Select the existing log action; delivery and receipt identity are the contract, not its caption.
	f.editor.quickInput.model.list.selectionIndex = 2;
	await f.editor.quickInput.accept(); await setImmediate();
	const group = f.editor.editorParts.activeGroup, input = group.model.activeTab;
	assert.ok(group !== main.activeGroup && input?.kind === 'build_log');
	assert.ok(input.job === job);
	assert.ok(main.activeGroup.model.activeTab === subject && main.activeGroup.panes.activePane === pane);
});

test('Play Source reuses the authored document view without replacing its main Play client', async t => {
	const f = createActualSourcePanes(t);
	const cycles = f.host.runtime.machine.scheduler.nowCycles;
	const handle = new PlayHandle(f.firstInput.workingCopy.resource, 'Fixture', f.source, 0, null, undefined);
	handle.preparation = Promise.resolve();
	f.ide.play.current = handle;
	const input = new PlayEditorInput(handle, f.ide.play), main = f.editor.editorParts.main;
	main.activeGroup.openEditor(input); f.update();
	const pane = main.activeGroup.panes.activePane;
	f.editor.commands.execute('play.source', pane!.commandTarget); await setImmediate(); f.update();
	assert.ok(main.activeGroup.model.activeTab === input && main.activeGroup.panes.activePane === pane);
	assert.ok(f.editor.editorParts.activeGroup === f.firstGroup);
	assert.ok(f.firstGroup.model.activeTab === f.firstInput);
	assert.ok(f.ide.play.current === handle);
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
});
