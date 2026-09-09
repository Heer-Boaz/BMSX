import assert from 'node:assert/strict';
import { EditorTextModel } from '../../../ide/editor/model/text_model';
import { EditorFont } from '../../../ide/editor/ui/view/font';
import { editorViewState } from '../../../ide/editor/ui/view/state';
import { measureTextRange } from '../../../ide/editor/common/text/layout';
import { buildLuaFileSemanticData } from '../../../toolchain/ts/lua/semantic/model';
import { buildBehaviorSourceDocument } from '../../../ide/workbench/contrib/behavior_lens/recognizer';
import { BehaviorLensInput } from '../../../ide/workbench/contrib/behavior_lens/editor_input';
import { createBehaviorLensViewState } from '../../../ide/workbench/contrib/behavior_lens/view_model';
import { selectBehaviorLensDefinition } from '../../../ide/workbench/contrib/behavior_lens/layout';
import { projectActionEffectProperties } from '../../../ide/workbench/contrib/behavior_lens/action_effect_properties';
import { layoutWorkbenchPropertyTree } from '../../../ide/workbench/ui/property_tree';
import { WorkbenchPropertyTreePointer } from '../../../ide/workbench/ui/property_tree_pointer';
import { drawWorkbenchPropertyTree } from '../../../ide/workbench/render/property_tree';
import { api } from '../../../ide/runtime/overlay_api';
import { HostOverlayQuadStream } from '../../../machine/ts/render/host_overlay/quad_stream';
import { ACTIONEFFECT_SOURCE } from '../../helpers/actioneffect_source_fixture';
import { createHostOverlayFixture } from '../../helpers/host_overlay';
import { medianMilliseconds } from '../../helpers/performance';

class MeasuredEditorFont extends EditorFont {
	public measurements = 0;
	public override advance(char: string): number { this.measurements += 1; return super.advance(char); }
}

for (const requirements of [1, 256, 4096]) {
	const source = ACTIONEFFECT_SOURCE.replace("{ 'ready' }", `{ ${Array.from({ length: requirements }, (_, index) => `'tag.${index}'`).join(', ')} }`);
	const model = new EditorTextModel({ domain: 0, path: 'effects.lua', source: { resid: 'effects', type: 'lua' } }, 'lua', source);
	const document = buildBehaviorSourceDocument(model.resource, buildLuaFileSemanticData(source, model.resource.path));
	const font = new MeasuredEditorFont('tiny');
	editorViewState.font = font;
	const view = createBehaviorLensViewState(document, model, 'properties');
	selectBehaviorLensDefinition(view, document.definitions[1].rowKey);
	Object.assign(view.layout, { left: 0, right: 384, headerBottom: 12, bottom: 268 });
	const properties = view.presentation;
	const definition = document.definitions[1];
	assert.ok(properties.kind === 'properties' && definition.behaviorKind === 'action_effect');
	const input = new BehaviorLensInput(model, view, () => assert.fail('a property projection must not construct a graph engine'));
	try {
		const projectMs = medianMilliseconds(() => projectActionEffectProperties(view, properties, definition, model.buffer));
		const layoutMs = medianMilliseconds(() => {
			properties.tree.textDirty = true;
			layoutWorkbenchPropertyTree(properties.tree, font.renderFont(), measureTextRange, 0, 13, 384, 268);
		});
		input.updatePresentation(font.renderFont());
		const roots = properties.tree.roots.slice();
		const rows = properties.tree.rows;
		const pointer = new WorkbenchPropertyTreePointer();
		const snapshot = { valid: true, insideViewport: true, primaryPressed: false, viewportX: 200, viewportY: 50 };
		const { presenter, renderer, queue } = createHostOverlayFixture(384, 288);
		const stream = new HostOverlayQuadStream();
		const draw = () => {
			renderer.beginFrame(presenter); api.beginFrame(renderer);
			drawWorkbenchPropertyTree(properties.tree); renderer.endFrame();
			const frame = queue.consumeOverlayFrame(); stream.reset(384, 288);
			for (let index = 0; index < frame.commandCount; index += 1) stream.appendEntry(frame.commandKinds[index], frame.commandRefs[index]);
		};
		for (let index = 0; index < 1000; index += 1) draw();
		const storage = stream.floatData;
		const measurements = font.measurements;
		// A batch of 1,000 operations in milliseconds is microseconds per operation.
		const warmUpdateMicroseconds = medianMilliseconds(() => { for (let index = 0; index < 1000; index += 1) input.updatePresentation(font.renderFont()); });
		const hitMicroseconds = medianMilliseconds(() => { for (let index = 0; index < 1000; index += 1) pointer.handle(properties.tree, snapshot, false, index); });
		const drawAndQuadsMicroseconds = medianMilliseconds(() => { for (let index = 0; index < 1000; index += 1) draw(); });
		assert.equal(font.measurements, measurements);
		assert.equal(properties.tree.rows, rows);
		assert.deepEqual(properties.tree.roots, roots);
		assert.equal(stream.floatData, storage);
		assert.equal(input.graphLayout.state.kind, 'idle');
		console.log(JSON.stringify({ requirements, rows: rows.length, projectMs, layoutMs, warmUpdateMicroseconds, hitMicroseconds, drawAndQuadsMicroseconds,
			warmFontMeasurements: 0, retainedQuadStorage: true,
			boundary: 'one selected effect; cold projection/text layout, warm concrete input/hit/overlay+quad emission; excludes source analysis, GPU raster and full Studio frames' }));
	} finally { input.dispose(); }
}
