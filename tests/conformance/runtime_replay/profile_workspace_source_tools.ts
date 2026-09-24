import { BehaviorSourceDocuments } from '../../../ide/workbench/contrib/behavior_lens/source_documents';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import { EditorTextModelService } from '../../../ide/editor/model/model_service';
import { WorkspaceSourceTools } from '../../../ide/workbench/services/assistant/source_tools';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from '../../helpers/scenario_sources';
import { ResourceDiagnosticsService } from '../../../ide/workbench/services/diagnostics/resource_diagnostics';
import { RuntimeLuaTooling } from '../../../ide/runtime/lua_tooling';
import { SuspendedGuestSession } from '../../../ide/runtime/suspended_guest';
import { VirtualHeadlessClock } from '../../../hosts/node/headless/clock';
import { createTestRuntime, createTestRuntimeRomPayload } from '../../helpers/runtime_sources';
import { createRuntimeInspectionFixture } from '../../helpers/runtime_inspection';
import { TextFileSaveService } from '../../../ide/workbench/services/working_copy/text_file_save';

// Explicit tool admission/preview size probe, not inference, frame time or a before/after claim.
async function main(): Promise<void> {
	for (const count of [16, 256, 4096]) {
		const models = new EditorTextModelService();
		const source = createScenarioTestSourceRecord('review.lua', 1, 'return old\n'.repeat(count));
		const sources = createScenarioTestSourceState([source]);
		const runtime = createTestRuntime(createTestRuntimeRomPayload());
		const tooling = new RuntimeLuaTooling(sources, new SuspendedGuestSession(runtime));
		const { tasks, presenter } = createRuntimeInspectionFixture(runtime, sources, tooling.suspendedGuest);
		const storage = { getItem: () => null, setItem: () => assert.fail(), removeItem: () => assert.fail() };
		const saves = new TextFileSaveService(models, storage, new VirtualHeadlessClock(), sources, tooling, runtime, tasks);
		const diagnostics = new ResourceDiagnosticsService(models, tooling, new VirtualHeadlessClock());
		const model = models.retain(sources.luaResources[0], 'lua', source.src);
		let reads = 0;
		const getText = model.buffer.getText.bind(model.buffer);
		model.buffer.getText = () => { reads++; return getText(); };
		const edits = Array.from({ length: count }, (_, index) => ({ offset: index * 11 + 7, deleteLength: 3, expectedText: 'old', text: 'new_name' }));
		const capture: number[] = [], proposal: number[] = [];
		for (let sample = 0; sample < 30; sample++) {
			const started = performance.now();
			const tools = new WorkspaceSourceTools(models, sources, storage, diagnostics, new AbortController().signal, new BehaviorSourceDocuments(models, sources), saves);
			const catalog = await tools.execute('studio_list_sources', {}); assert.ok(catalog.kind === 'sources');
			const read = await tools.execute('studio_read_source', { resource: catalog.data[0].resource }); assert.ok(read.kind === 'source');
			const captured = performance.now();
			const result = await tools.execute('studio_propose_edits', { title: 'Profile', files: [{ receipt: read.data.receipt, edits }] });
			assert.ok(result.kind === 'proposal');
			const prepared = performance.now();
			if (sample >= 10) { capture.push(captured - started); proposal.push(prepared - captured); }
			result.proposal.dispose(); tools.dispose();
		}
		assert.equal(reads, 1, 'shared source snapshot is materialized only once across all captured contexts and preview projections');
		capture.sort((a, b) => a - b); proposal.sort((a, b) => a - b);
		console.log(JSON.stringify({ edits: count, sourceReads: reads, captureMedianMs: capture[10], proposalMedianMs: proposal[10] }));
		await saves.shutdown(); presenter.dispose(); diagnostics.dispose(); models.clear();
	}
}

void main();
