import { semanticSnapshot } from '../../lua/semantic_test_harness';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { resolve } from 'node:path';
import { medianMilliseconds } from '../../helpers/performance';
import { createHostOverlayFixture } from '../../helpers/host_overlay';
import { Font } from '../../../machine/ts/render/shared/bmsx_font';
import { HostOverlayQuadStream } from '../../../machine/ts/render/host_overlay/quad_stream';
import { EditorFont } from '../../../ide/editor/ui/view/font';
import { editorViewState } from '../../../ide/editor/ui/view/state';
import { EditorTextModel } from '../../../ide/editor/model/text_model';
import { NodeGraphLayoutEngine } from '../../../ide/node/graph_layout';
import { buildLuaFileSemanticData } from '../../../toolchain/ts/lua/semantic/model';
import { buildBehaviorSourceDocument } from '../../../ide/workbench/contrib/behavior_lens/recognizer';
import { createBehaviorLensViewState } from '../../../ide/workbench/contrib/behavior_lens/view_model';
import { selectBehaviorLensDefinition } from '../../../ide/workbench/contrib/behavior_lens/layout';
import { BehaviorLensInput } from '../../../ide/workbench/contrib/behavior_lens/editor_input';
import { api } from '../../../ide/runtime/overlay_api';
import { drawWorkbenchGraph } from '../../../ide/workbench/render/graph';

class MeasuredFont extends Font {
	public measurements = 0;
	public override measure(text: string): number { this.measurements += 1; return super.measure(text); }
}

async function main() {
	for (const copies of [1, 12, 48]) {
		const source = `local fsm<const> = require('cartlib/fsm/library')
local step<const> = function(actor) if actor.a then return '../active' end if actor.b then return '../active' end return nil end
local shared<const> = { initial = 'idle', states = { idle = { update = step }, active = { on = { reset = '../idle' } } } }
fsm.register('profile', { initial = 'lane0', states = { ${Array.from({ length: copies }, (_, index) => `lane${index} = shared`).join(',')} } })`;
		const model = new EditorTextModel({ domain: 0, path: 'profile.lua', source: { resid: 'profile', type: 'lua' } }, 'lua', source);
		const document = buildBehaviorSourceDocument(model.resource, semanticSnapshot(buildLuaFileSemanticData(source, model.resource.path)));
		editorViewState.font = new EditorFont('tiny');
		const view = createBehaviorLensViewState(document, model, 'state-graph', assert.fail);
		selectBehaviorLensDefinition(view, document.definitions[0].rowKey);
		const graph = view.presentation;
		assert.ok(graph.kind === 'state-graph');
		const font = new MeasuredFont({ variant: 'tiny' });
		const input = new BehaviorLensInput(model, view, () => new NodeGraphLayoutEngine(new Worker(resolve('ide/node/graph_layout_worker.cjs'))));
		try {
			const samples: number[] = [];
			for (let index = 0; index < 6; index += 1) {
				graph.dirty = true;
				const start = performance.now();
				input.updatePresentation(font);
				await input.graphLayout.settled;
				input.updatePresentation(font);
				assert.equal(graph.layoutState.kind, 'ready');
				samples.push(performance.now() - start);
			}
			const generation = graph.viewport.model;
			assert.equal(generation.nodes.length, copies * 3 + 1);
			assert.equal(generation.edges.length, copies * 4 + 1);
			graph.viewport.layout(0, 0, 384, 288);
			graph.viewport.reveal(generation.nodes[2]);
			const { presenter, renderer, queue } = createHostOverlayFixture(384, 288);
			const stream = new HostOverlayQuadStream();
			const draw = () => {
				renderer.beginFrame(presenter); api.beginFrame(renderer);
				drawWorkbenchGraph(graph.viewport, null, true); renderer.endFrame();
				const frame = queue.consumeOverlayFrame(); stream.reset(384, 288);
				for (let index = 0; index < frame.commandCount; index += 1) stream.appendEntry(frame.commandKinds[index], frame.commandRefs[index]);
			};
			for (let index = 0; index < 1000; index += 1) draw();
			const storage = stream.floatData;
			const measurements = font.measurements;
			// 1,000 operations measured in milliseconds -> microseconds per operation.
			const warmUpdateMicroseconds = medianMilliseconds(() => { for (let index = 0; index < 1000; index += 1) input.updatePresentation(font); });
			const drawAndQuadsMicroseconds = medianMilliseconds(() => { for (let index = 0; index < 1000; index += 1) draw(); });
			assert.equal(graph.viewport.model, generation);
			assert.equal(stream.floatData, storage);
			assert.equal(font.measurements, measurements);
			console.log(JSON.stringify({ scopes: generation.nodes.length, edges: generation.edges.length, firstLayoutMs: samples[0],
				medianLayoutMs: samples.slice(1).sort((a, b) => a - b)[2], warmUpdateMicroseconds, drawAndQuadsMicroseconds,
				warmFontMeasurements: font.measurements - measurements, retainedQuadStorage: true,
				boundary: 'concrete FSM projection, native Node thread routing and publication; warm update + overlay/quad emission, not parsing/GPU raster/Studio frame total' }));
		} finally { input.dispose(); }
	}
}

main();
