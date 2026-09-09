import assert from 'node:assert/strict';
import ELK from 'elkjs/lib/elk.bundled';
import { medianMilliseconds } from '../../helpers/performance';
import { compoundGraphFixture, type CompoundFixtureLink, type CompoundFixtureNode } from '../../helpers/compound_graph_fixture';
import { createHostOverlayFixture } from '../../helpers/host_overlay';
import { Font } from '../../../machine/ts/render/shared/bmsx_font';
import { HostOverlayQuadStream } from '../../../machine/ts/render/host_overlay/quad_stream';
import { api } from '../../../ide/runtime/overlay_api';
import { drawWorkbenchGraph } from '../../../ide/workbench/render/graph';
import { WorkbenchGraphViewport } from '../../../ide/workbench/ui/graph/viewport';
import { layoutWorkbenchCompoundGraph, type WorkbenchCompoundModel } from '../../../ide/workbench/ui/graph/compound_layout';

class MeasuredFont extends Font {
	public measurements = 0;
	public override measure(text: string): number { this.measurements += 1; return super.measure(text); }
}

async function main() {
	// Explicit in-process Node cost boundary, not the browser's Worker composition.
	const engine = new ELK({ algorithms: ['layered'] });
	for (const copies of [1, 16, 64]) {
		const font = new MeasuredFont({ variant: 'tiny' });
		const samples: number[] = [];
		let model: WorkbenchCompoundModel<CompoundFixtureNode, CompoundFixtureLink>;
		for (let sample = 0; sample < 6; sample += 1) {
			const roots: CompoundFixtureNode[] = [];
			const links: CompoundFixtureLink[] = [];
			for (let index = 0; index < copies; index += 1) {
				const graph = compoundGraphFixture(font);
				roots.push(...graph.roots);
				links.push(...graph.links);
				if (index > 0) links.push({ source: roots[index - 1], target: roots[index], label: 'NEXT', proof: `next-${index}` });
			}
			const start = performance.now();
			model = await layoutWorkbenchCompoundGraph(font, roots, links, engine);
			samples.push(performance.now() - start);
		}
		const view = new WorkbenchGraphViewport(model!);
		view.layout(8, 24, 376, 240);
		const room = model!.nodes.find(node => node.name === 'ROOM')!;
		view.scrollX = room.bounds.left - 6;
		view.scrollY = room.bounds.top - 6;
		const { presenter, queue, renderer } = createHostOverlayFixture(384, 288);
		const stream = new HostOverlayQuadStream();
		const draw = () => {
			renderer.beginFrame(presenter);
			api.beginFrame(renderer);
			drawWorkbenchGraph(view, null, true);
			renderer.endFrame();
			const frame = queue.consumeOverlayFrame();
			stream.reset(384, 288);
			for (let index = 0; index < frame.commandCount; index += 1) stream.appendEntry(frame.commandKinds[index], frame.commandRefs[index]);
		};
		for (let index = 0; index < 1000; index += 1) draw();
		const storage = stream.floatData;
		const measurements = font.measurements;
		const hitMicroseconds = medianMilliseconds(() => { for (let index = 0; index < 1000; index += 1) view.hitTest(100 + index % 128, 60 + index % 128); });
		const drawAndQuadsMicroseconds = medianMilliseconds(() => { for (let index = 0; index < 1000; index += 1) draw(); });
		assert.equal(font.measurements, measurements);
		assert.equal(stream.floatData, storage);
		console.log(JSON.stringify({ copies, nodes: model!.nodes.length, edges: model!.edges.length, firstLayoutMs: samples[0],
			medianLayoutMs: samples.slice(1).sort((a, b) => a - b)[2], hitMicroseconds, drawAndQuadsMicroseconds,
			warmFontMeasurements: font.measurements - measurements, retainedQuadStorage: stream.floatData === storage,
			boundary: 'ELK request/routing/geometry; warm hit and overlay emission + quad stream; no parsing, GPU raster or Studio frame total' }));
	}
}

main();
