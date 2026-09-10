import { medianMilliseconds } from '../../helpers/performance';
import { Font } from '../../../machine/ts/render/shared/bmsx_font';
import { HostOverlayQuadStream } from '../../../machine/ts/render/host_overlay/quad_stream';
import { buildLuaFileSemanticData } from '../../../toolchain/ts/lua/semantic/model';
import { buildBehaviorSourceDocument } from '../../../ide/workbench/contrib/behavior_lens/recognizer';
import { projectBehaviorTreeGraph } from '../../../ide/workbench/contrib/behavior_lens/graph_projection';
import { layoutBehaviorTreeGraph } from '../../../ide/workbench/contrib/behavior_lens/graph_geometry';
import { WorkbenchGraphViewport } from '../../../ide/workbench/ui/graph/viewport';
import { drawWorkbenchGraph } from '../../../ide/workbench/render/graph';
import { api } from '../../../ide/runtime/overlay_api';
import { createHostOverlayFixture } from '../../helpers/host_overlay';


class MeasuredFont extends Font {
	public measurements = 0;
	public override measure(text: string): number { this.measurements += 1; return super.measure(text); }
}

for (const [siblings, opaqueChild] of [[24, false], [1024, false], [24, true], [1024, true]] as const) {
	const source = `local trees<const> = require('cartlib/behaviour_tree/library')
local shared<const> = { type = 'sequence', children = { { type = 'wait', duration_ticks = 2 }, ${opaqueChild ? 'make_node()' : "{ type = 'task', task = actions.move }"} } }
trees.register('profile', { root = { type = 'sequence', children = { ${'shared,'.repeat(siblings)} } } })`;
	const resource = { domain: 0 as const, path: 'profile.lua' };
	const semantic = buildLuaFileSemanticData(source, resource.path);
	const sourceProjectionMs = medianMilliseconds(() => { buildBehaviorSourceDocument(resource, semantic); });
	const definition = buildBehaviorSourceDocument(resource, semantic).definitions[0];
	if (definition.behaviorKind !== 'behavior_tree') throw new Error('profile requires the BT fixture');
	const font = new MeasuredFont({ variant: 'tiny' });
	const cardProjectionMs = medianMilliseconds(() => { projectBehaviorTreeGraph(definition, font); });
	const projection = projectBehaviorTreeGraph(definition, font);
	const layoutAndRoutesMs = medianMilliseconds(() => { layoutBehaviorTreeGraph(projection); });
	const view = new WorkbenchGraphViewport(layoutBehaviorTreeGraph(projection));
	view.layout(0, 24, 384, 276);
	view.scrollX = -192;
	view.scrollY = -8;
	const hitMicroseconds = medianMilliseconds(() => { for (let index = 0; index < 1000; index += 1) view.hitTest(100 + index % 128, 60 + index % 128); });
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
	const backing = stream.floatData;
	const measurements = font.measurements;
	const drawAndQuadsMicroseconds = medianMilliseconds(() => { for (let index = 0; index < 1000; index += 1) draw(); });
	console.log(JSON.stringify({ siblings, opaqueChild, nodes: view.model.nodes.length, sourceProjectionMs, cardProjectionMs, layoutAndRoutesMs,
		hitMicroseconds, drawAndQuadsMicroseconds, visibleQuads: stream.count,
		warmFontMeasurements: font.measurements - measurements, retainedQuadStorage: backing === stream.floatData,
		boundary: 'cold source/card/layout phases; warm hit and overlay emission plus quad stream; excludes parsing, GPU upload/raster and total Studio frame' }));
}
