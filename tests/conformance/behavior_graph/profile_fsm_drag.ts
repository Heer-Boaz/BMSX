import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { resolve } from 'node:path';
import { EditorTextModel } from '../../../ide/editor/model/text_model';
import { EditorFont } from '../../../ide/editor/ui/view/font';
import { editorViewState } from '../../../ide/editor/ui/view/state';
import { measureText, measureTextRange } from '../../../ide/editor/common/text/layout';
import { NodeGraphLayoutEngine } from '../../../ide/node/graph_layout';
import { InputFocusService } from '../../../ide/input/focus';
import { WorkbenchSourceEditReview } from '../../../ide/workbench/ui/source_edit_review/control';
import { drawWorkbenchSourceEditReview } from '../../../ide/workbench/render/source_edit_review';
import { buildBehaviorSourceDocument } from '../../../ide/workbench/contrib/behavior_lens/recognizer';
import { createBehaviorLensViewState } from '../../../ide/workbench/contrib/behavior_lens/view_model';
import { selectBehaviorLensDefinition } from '../../../ide/workbench/contrib/behavior_lens/layout';
import { selectStateMachineSource } from '../../../ide/workbench/contrib/behavior_lens/state_machine_selection';
import { beginStateMachineDrag, stateMachineConnectionEnds, type StateMachineRetargetDrop } from '../../../ide/workbench/contrib/behavior_lens/state_machine_drag';
import { stateMachineRetargetImpacts } from '../../../ide/workbench/contrib/behavior_lens/state_machine_review';
import { BehaviorLensInput } from '../../../ide/workbench/contrib/behavior_lens/editor_input';
import { buildLuaFileSemanticData } from '../../../toolchain/ts/lua/semantic/model';
import { HostOverlayQuadStream } from '../../../machine/ts/render/host_overlay/quad_stream';
import { api } from '../../../ide/runtime/overlay_api';
import { createHostOverlayFixture } from '../../helpers/host_overlay';
import { medianMilliseconds } from '../../helpers/performance';

async function main() {
	for (const registrations of [32, 1024]) {
		const source = `local machines<const> = require('cartlib/fsm/library')
local shared<const> = { on={go=function() return 'idle' end}, initial='idle', states={idle={},active={}} }
${Array.from({ length: registrations }, (_, index) => `machines.register('fixture.${index}',shared)`).join('\n')}`;
		const model = new EditorTextModel({ domain: 0, path: 'profile.lua', source: { type: 'lua', resid: 'profile' } }, 'lua', source);
		const document = buildBehaviorSourceDocument(model.resource, buildLuaFileSemanticData(source, model.resource.path));
		editorViewState.font = new EditorFont('tiny');
		const font = editorViewState.font.renderFont();
		const view = createBehaviorLensViewState(document, model, 'state-graph');
		selectBehaviorLensDefinition(view, document.definitions[0].rowKey);
		const graph = view.presentation; assert.ok(graph.kind === 'state-graph');
		const input = new BehaviorLensInput(model, view, () => new NodeGraphLayoutEngine(new Worker(resolve('ide/node/graph_layout_worker.cjs'))));
		const focus = new InputFocusService();
		const review = new WorkbenchSourceEditReview(focus, focus.createTarget());
		try {
			input.updatePresentation(font); await input.graphLayout.settled; input.updatePresentation(font);
			const viewport = graph.viewport;
			viewport.layout(0, 0, 384, 288);
			const edge = viewport.model.edges.find(edge => edge.link.reference.kind === 'state-outcome')!;
			viewport.selection = edge;
			view.selection = selectStateMachineSource(edge.link.reference, model.buffer);
			const node = viewport.model.nodes.find(node => node.source.label === 'active')!;
			const x = (node.bounds.left + node.bounds.right) / 2;
			const y = node.bounds.top + node.headerHeight / 2;
			const start = { kind: 'connection' as const, edge, end: 'target' as const };
			let dropped: Parameters<StateMachineRetargetDrop>;
			const accept: StateMachineRetargetDrop = (...result) => { dropped = result; };
			let observed = 0;
			const capabilityMicroseconds = medianMilliseconds(() => {
				for (let i = 0; i < 10000; i += 1) if (stateMachineConnectionEnds(model, view, edge) === 'target') observed += 1;
			}) / 10;
			const firstCandidateMicroseconds = medianMilliseconds(() => {
				for (let i = 0; i < 100; i += 1) {
					const gesture = beginStateMachineDrag(model, view, start, accept)!;
					gesture.dragOver(x, y); if (gesture.feedback.accepted) observed += 1;
				}
			}) * 10;
			const gesture = beginStateMachineDrag(model, view, start, accept)!;
			gesture.dragOver(x, y); assert.equal(gesture.feedback.accepted, true);
			const movingInsideTargetMicroseconds = medianMilliseconds(() => {
				for (let i = 0; i < 1000; i += 1) gesture.dragOver(x + (i & 1), y);
			});
			gesture.drop();
			const proposal = dropped![1];
			assert.equal(proposal.uses.length, registrations);
			let measurements = 0;
			const measure = (text: string, start: number, end: number) => { measurements += 1; return measureTextRange(text, start, end); };
			const layout = () => review.layout(font, measure, measureText, viewport.bounds);
			const open = () => review.show({ model, title: 'RETARGET FSM', summary: `${registrations} RECOGNIZED USES: idle -> active`,
				items: stateMachineRetargetImpacts(view, proposal), apply() { throw new Error('Profile must not edit source.'); }, openSource() {} });
			const impactOpenLayoutMicroseconds = medianMilliseconds(() => {
				for (let i = 0; i < 10; i += 1) { open(); layout(); review.clear(); }
			}) * 100;
			open(); layout();
			const formatted = measurements;
			const rows = review.tree.rows;
			const retainedReviewLayoutMicroseconds = medianMilliseconds(() => { for (let i = 0; i < 1000; i += 1) layout(); });
			const { presenter, renderer, queue } = createHostOverlayFixture(384, 288);
			const stream = new HostOverlayQuadStream();
			const draw = () => {
				renderer.beginFrame(presenter); api.beginFrame(renderer); drawWorkbenchSourceEditReview(review); renderer.endFrame();
				const frame = queue.consumeOverlayFrame(); stream.reset(384, 288);
				for (let i = 0; i < frame.commandCount; i += 1) stream.appendEntry(frame.commandKinds[i], frame.commandRefs[i]);
			};
			draw(); const storage = stream.floatData;
			const reviewAndQuadsMicroseconds = medianMilliseconds(() => { for (let i = 0; i < 1000; i += 1) draw(); });
			assert.equal(measurements, formatted); assert.equal(review.tree.rows, rows); assert.equal(stream.floatData, storage);
			assert.equal(model.version, 1); assert.ok(observed > 0);
			console.log(JSON.stringify({ registrations, capabilityMicroseconds, firstCandidateMicroseconds, movingInsideTargetMicroseconds,
				impactOpenLayoutMicroseconds, retainedReviewLayoutMicroseconds, reviewAndQuadsMicroseconds,
				boundary: 'Actual source index and native-worker geometry retained before timing. 10 warmups / median of 25 batches. No parser, layout-worker timing, complete pointer dispatch, GPU raster, guest, Hot Resume, heap/GC or complete Studio frame.' }));
		} finally { review.dispose(); input.dispose(); model.dispose(); }
	}
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
