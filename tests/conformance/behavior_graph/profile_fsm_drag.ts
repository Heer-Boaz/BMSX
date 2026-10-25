import { semanticSnapshot } from '../../lua/semantic_test_harness';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { resolve } from 'node:path';
import { EditorTextModelService } from '../../../ide/editor/model/model_service';
import { EditorFont } from '../../../ide/editor/ui/view/font';
import { editorViewState } from '../../../ide/editor/ui/view/state';
import { measureTextRange } from '../../../ide/editor/common/text/layout';
import { NodeGraphLayoutEngine } from '../../../ide/node/graph_layout';
import { buildBehaviorSourceDocument } from '../../../ide/workbench/contrib/behavior_lens/recognizer';
import { createBehaviorLensViewState } from '../../../ide/workbench/contrib/behavior_lens/view_model';
import { selectBehaviorLensDefinition } from '../../../ide/workbench/contrib/behavior_lens/layout';
import { selectStateMachineSource } from '../../../ide/workbench/contrib/behavior_lens/state_machine_selection';
import { beginStateMachineDrag, stateMachineConnectionEnds, type StateMachineRetargetDrop } from '../../../ide/workbench/contrib/behavior_lens/state_machine_drag';
import { stateMachineRetargetImpacts } from '../../../ide/workbench/contrib/behavior_lens/state_machine_review';
import { createStateMachineRetargetEdit } from '../../../ide/workbench/contrib/behavior_lens/state_machine_edit';
import { BehaviorLensInput } from '../../../ide/workbench/contrib/behavior_lens/editor_input';
import { buildLuaFileSemanticData } from '../../../toolchain/ts/lua/semantic/model';
import { medianMilliseconds } from '../../helpers/performance';
import { WorkspaceEditProposal } from '../../../ide/workbench/services/working_copy/workspace_edit';
import { WorkspaceSourceContext } from '../../../ide/workbench/services/working_copy/source_context';
import { WorkspaceEditReviewInput } from '../../../ide/workbench/contrib/edit_review/editor_input';
import { layoutEditReviewRows } from '../../../ide/workbench/contrib/edit_review/projection';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from '../../helpers/scenario_sources';

async function main() {
	const imported = process.argv.includes('--imported');
	for (const registrations of [32, 1024]) {
		const source = `local machines<const> = require('cartlib/fsm/library')
local shared<const> = ${imported ? "require('provider')" : "{ on={go=function() return 'idle' end}, initial='idle', states={idle={},active={}} }"}
${Array.from({ length: registrations }, (_, index) => `machines.register('fixture.${index}',shared)`).join('\n')}`;
		const providerSource = "return { on={go=function() return 'idle' end}, initial='idle', states={idle={},active={}} }";
		const sources = createScenarioTestSourceState([createScenarioTestSourceRecord('profile.lua', 1, source),
			createScenarioTestSourceRecord('provider.lua', 1, providerSource)]);
		const models = new EditorTextModelService();
		const model = models.retain(sources.luaResources.find(resource => resource.path === 'profile.lua')!, 'lua', source);
		const provider = models.retain(sources.luaResources.find(resource => resource.path === 'provider.lua')!, 'lua', providerSource);
		const document = buildBehaviorSourceDocument(model.resource, semanticSnapshot(buildLuaFileSemanticData(source, model.resource.path),
			buildLuaFileSemanticData(provider.buffer.getText(), provider.resource.path)));
		editorViewState.font = new EditorFont('tiny');
		const font = editorViewState.font.renderFont();
		const view = createBehaviorLensViewState(document, model, 'state-graph', path => { assert.equal(path, provider.resource.path); return provider; });
		selectBehaviorLensDefinition(view, document.definitions[0].rowKey);
		const graph = view.presentation; assert.ok(graph.kind === 'state-graph');
		const input = new BehaviorLensInput(model, view, () => new NodeGraphLayoutEngine(new Worker(resolve('ide/node/graph_layout_worker.cjs'))));
		try {
			input.updatePresentation(font); await input.graphLayout.settled; input.updatePresentation(font);
			const viewport = graph.viewport;
			viewport.layout(0, 0, 384, 288);
			const edge = viewport.model.edges.find(edge => edge.link.reference.kind === 'state-outcome')!;
			viewport.selection = edge;
			view.selection = selectStateMachineSource(edge.link.reference, view.source.models);
			const node = Array.from(viewport.model.nodesBySource.values()).find(node => node.source.label === 'active')!;
			const x = (node.bounds.left + node.bounds.right) / 2;
			const y = node.bounds.top + node.headerHeight / 2;
			const start = { kind: 'connection' as const, edge, end: 'target' as const };
			let dropped: Parameters<StateMachineRetargetDrop>;
			const accept: StateMachineRetargetDrop = (...result) => { dropped = result; };
			let observed = 0;
			const capabilityMicroseconds = medianMilliseconds(() => {
				for (let i = 0; i < 10000; i += 1) if (stateMachineConnectionEnds(view, edge) === 'target') observed += 1;
			}) / 10;
			const firstCandidateMicroseconds = medianMilliseconds(() => {
				for (let i = 0; i < 100; i += 1) {
					const gesture = beginStateMachineDrag(view, start, accept)!;
					gesture.dragOver(x, y); if (gesture.feedback.accepted) observed += 1;
				}
			}) * 10;
			const gesture = beginStateMachineDrag(view, start, accept)!;
			gesture.dragOver(x, y); assert.equal(gesture.feedback.accepted, true);
			const movingInsideTargetMicroseconds = medianMilliseconds(() => {
				for (let i = 0; i < 1000; i += 1) gesture.dragOver(x + (i & 1), y);
			});
			gesture.drop();
			const [selection, target] = dropped!;
			assert.equal(target.uses.length, registrations);
			const targetModel = view.source.models.get(target.file.file)!;
			let reviewRows = 0;
			const reviewPreparationProjectionMicroseconds = medianMilliseconds(() => {
				for (let i = 0; i < 10; i += 1) {
					const context = new WorkspaceSourceContext(models, sources);
					for (const source of view.source.models.values()) context.read(source);
					const edit = createStateMachineRetargetEdit(targetModel, view, selection, target);
					const evidence = { summary: `${target.uses.length} RECOGNIZED USES: ${target.literal.value} -> ${target.text}`,
						items: stateMachineRetargetImpacts(view, target) };
					const proposal = new WorkspaceEditProposal('Retarget FSM', context, { kind: 'edit', edits: new Map([[targetModel, edit]]) });
					const review = new WorkspaceEditReviewInput(proposal, evidence);
					layoutEditReviewRows(review, viewport.bounds.right - viewport.bounds.left - 8, measureTextRange);
					reviewRows = review.rows.length;
					review.dispose();
				}
			}) * 100;
			assert.ok(reviewRows > 0); assert.ok(observed > 0);
			assert.equal(model.version, 1); assert.equal(provider.version, 1);
			assert.equal(model.buffer.getText(), source); assert.equal(provider.buffer.getText(), providerSource);
			assert.equal(model.canUndo, false); assert.equal(provider.canUndo, false);
			console.log(JSON.stringify({ imported, registrations, capabilityMicroseconds, firstCandidateMicroseconds, movingInsideTargetMicroseconds,
				reviewPreparationProjectionMicroseconds, reviewRows,
				boundary: 'Actual source index and native-worker geometry retained before timing. Review timing includes captured workspace context, exact retarget edit, immutable evidence, unified proposal/input projection and disposal. 10 warmups / median of 25 batches. No parser, layout-worker timing, retained pane layout/render, quads, complete pointer dispatch, GPU raster, guest, Hot Resume, heap/GC or complete Studio frame.' }));
		} finally { input.dispose(); models.clear(); }
	}
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
