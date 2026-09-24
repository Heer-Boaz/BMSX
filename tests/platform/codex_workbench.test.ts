import { BehaviorSourceDocuments } from '../../ide/workbench/contrib/behavior_lens/source_documents';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexSession } from '../../hosts/node/codex/session';
import { EditorTextModelService } from '../../ide/editor/model/model_service';
import { WorkspaceSourceTools } from '../../ide/workbench/services/assistant/source_tools';
import { STUDIO_SOURCE_TOOLS } from '../../ide/workbench/services/assistant/source_tool_protocol';
import type { WorkspaceEditProposal } from '../../ide/workbench/services/working_copy/workspace_edit';
import { WorkspaceEditReviewInput } from '../../ide/workbench/contrib/edit_review/editor_input';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from '../helpers/scenario_sources';
import { createCodexModelFixture, CODEX_FIXTURE_DONE } from '../helpers/codex_model_fixture.mjs';
import { ResourceDiagnosticsService } from '../../ide/workbench/services/diagnostics/resource_diagnostics';
import { RuntimeLuaTooling } from '../../ide/runtime/lua_tooling';
import { SuspendedGuestSession } from '../../ide/runtime/suspended_guest';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { createTestRuntime, createTestRuntimeRomPayload } from '../helpers/runtime_sources';
import { createRuntimeInspectionFixture } from '../helpers/runtime_inspection';
import { TextFileSaveService } from '../../ide/workbench/services/working_copy/text_file_save';

test('real Codex tool exchange reads unsaved models and hands off a shared review, never a filesystem patch', { timeout: 15000 }, async t => {
	const root = await mkdtemp(join(tmpdir(), 'bmsx-codex-workbench-'));
	const models = new EditorTextModelService(), connection = new AbortController();
	const sources = createScenarioTestSourceState([createScenarioTestSourceRecord('cart.lua', 1, 'return old\n'),
		createScenarioTestSourceRecord('helper.lua', 1, 'return old, old\n')]);
	const main = models.retain(sources.luaResources.find(resource => resource.path === 'cart.lua')!, 'lua', 'return old\n');
	main.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- UNSAVED COMMENT\n' }]);
	const before = main.buffer.getText();
	const runtime = createTestRuntime(createTestRuntimeRomPayload());
	const tooling = new RuntimeLuaTooling(sources, new SuspendedGuestSession(runtime));
	const { tasks, presenter } = createRuntimeInspectionFixture(runtime, sources, tooling.suspendedGuest);
	const diagnostics = new ResourceDiagnosticsService(models, tooling, new VirtualHeadlessClock());
	const storage = {
		getItem: () => null, setItem: () => assert.fail('not Save'), removeItem: () => assert.fail('not Delete'),
	};
	const saves = new TextFileSaveService(models, storage, new VirtualHeadlessClock(), sources, tooling, runtime, tasks);
	const sourceTools = new WorkspaceSourceTools(models, sources, storage, diagnostics, connection.signal, new BehaviorSourceDocuments(models, sources), saves);
	const proposals: WorkspaceEditProposal[] = [];
	let completed!: () => void;
	const done = new Promise<void>(resolve => { completed = resolve; });
	const call = (id: string, name: string, args: unknown) => ({ type: 'function_call', call_id: id, name, arguments: JSON.stringify(args) });
	const outputs = (body: { input: { type: string; output: string }[] }) => body.input.filter(item => item.type === 'function_call_output').map(item => JSON.parse(item.output));
	const model = await createCodexModelFixture(t, [
		[call('list', 'studio_list_sources', {})],
		body => outputs(body)[0].map((resource: { resource: string }, index: number) => call(`read:${index}`, 'studio_read_source', { resource: resource.resource })),
		body => outputs(body).slice(1).map((read: { receipt: string }, index: number) => call(`diagnostics:${index}`, 'studio_read_diagnostics', { receipt: read.receipt })),
		body => [call('proposal', 'studio_propose_edits', { title: 'Codex fixture: old to new', files: outputs(body).slice(1, 3).map(
			(read: { receipt: string; source: string }) => ({ receipt: read.receipt,
				edits: [{ offset: read.source.indexOf('old'), deleteLength: 3, text: 'new', expectedText: 'old' }] })) })],
		CODEX_FIXTURE_DONE,
	]);
	let session: CodexSession | undefined;
	t.after(async () => {
		connection.abort();
		if (session) { const exit = await session.closed; assert.equal(exit.forced, false); assert.equal(exit.code, 0); }
		for (const proposal of proposals) proposal.dispose();
		sourceTools.dispose(); await saves.shutdown(); presenter.dispose(); diagnostics.dispose(); models.clear(); await rm(root, { recursive: true });
	});
	session = await CodexSession.open({ signal: connection.signal, profileDirectory: root,
		provider: { name: 'Offline workbench fixture', model: 'mock-model', baseUrl: `${model.url}/v1` }, tools: STUDIO_SOURCE_TOOLS,
		async executeTool(call) {
			const result = await sourceTools.execute(call.tool, call.arguments);
			if (result.kind === 'proposal') proposals.push(result.proposal);
			return { success: true, text: JSON.stringify(result.data) };
		},
		onEvent(event) {
			if (event.type === 'turn-completed') { sourceTools.dispose(); completed(); }
		},
	});
	await session.startTurn('Read both files and propose replacing old with new.', []);
	await done;
	assert.equal(proposals.length, 1);
	const review = new WorkspaceEditReviewInput(proposals[0]); t.after(() => review.dispose());
	assert.equal(review.proposal.state, 'pending');
	assert.equal(main.buffer.getText(), before);
	assert.equal(models.get({ domain: 0, path: 'helper.lua' })!.dirty, false);
	assert.ok(JSON.stringify(model.requests[2]).includes('UNSAVED COMMENT'));
	assert.deepEqual(model.requests[0].tools.map(tool => tool.name), STUDIO_SOURCE_TOOLS.map(tool => tool.name));
	const evidence = outputs(model.requests[3]).slice(3);
	assert.deepEqual(evidence.map(result => result.status), ['ready', 'ready']);
	assert.ok(evidence.every(result => result.diagnostics.some(marker => marker.message.includes("'old' is not defined"))));
	const offered = outputs(model.requests[4]).at(-1);
	assert.deepEqual(offered, { status: 'review-required', review: offered.review, files: 2 });
	assert.match(offered.review, /\/review$/);
	review.proposal.apply();
	assert.equal(main.buffer.getText(), before.replace('old', 'new'));
	assert.equal(main.lastSavedSource, 'return old\n');
	models.get({ domain: 0, path: 'helper.lua' })!.undo();
	assert.equal(main.buffer.getText(), before);
	main.redo();
	assert.equal(main.buffer.getText(), before.replace('old', 'new'));
});
