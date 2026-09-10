import assert from 'node:assert/strict';
import test from 'node:test';
import { Font } from '../../machine/ts/render/shared/bmsx_font';
import { HostOverlayQuadStream } from '../../machine/ts/render/host_overlay/quad_stream';
import { Host2DKind } from '../../machine/ts/render/host_overlay/commands';
import type { PolyRenderSubmission } from '../../machine/ts/render/shared/submissions';
import { WorkbenchGraphConnectionPreview } from '../../ide/workbench/ui/graph/connection';
import { api } from '../../ide/runtime/overlay_api';
import { drawWorkbenchGraph } from '../../ide/workbench/render/graph';
import { graphConnectionFixture } from '../helpers/graph_connection_fixture';
import { createHostOverlayFixture } from '../helpers/host_overlay';

class MeasuredFont extends Font {
	public measurements = 0;
	public override measure(text: string): number { this.measurements += 1; return super.measure(text); }
}

test('moving and stationary connections reuse preview, overlay command, translated point, glyph and quad buffers', () => {
	const font = new MeasuredFont({ variant: 'tiny' });
	const f = graphConnectionFixture(font);
	f.view.selection = f.edge;
	const feedback = new WorkbenchGraphConnectionPreview(f.edge, 'target');
	feedback.target = f.target; feedback.moveTo(248, 146);
	const handles = { edge: f.edge, ends: 'both' as const };
	const { presenter, renderer, queue } = createHostOverlayFixture(384, 288);
	const stream = new HostOverlayQuadStream();
	const draw = () => {
		renderer.beginFrame(presenter); api.beginFrame(renderer);
		drawWorkbenchGraph(f.view, null, true, feedback, handles);
		renderer.endFrame();
		const frame = queue.consumeOverlayFrame();
		stream.reset(384, 288);
		for (let i = 0; i < frame.commandCount; i += 1) stream.appendEntry(frame.commandKinds[i], frame.commandRefs[i]);
		return frame;
	};
	const first = draw();
	const refs = first.commandRefs.slice(0, first.commandCount);
	const polylines = refs.filter((_, i) => first.commandKinds[i] === Host2DKind.Poly) as PolyRenderSubmission[];
	assert.equal(polylines.length, 4, 'parallel route/arrow plus preview route/arrow; no old selected route');
	const translated = polylines.map(poly => poly.points);
	const sourcePoints = feedback.points; const sourceArrow = feedback.arrow; const quadStorage = stream.floatData;
	const measurements = font.measurements;
	draw();
	for (let frame = 0; frame < 100; frame += 1) {
		// The publication uses copied translated points, not a later mutable gesture.
		feedback.target = frame % 2 === 0 ? f.target : f.oldTarget;
		feedback.moveTo(248 + frame % 2, 146); f.view.scrollX = frame % 8;
		const current = draw();
		assert.equal(current.commandCount, refs.length);
		for (let i = 0; i < refs.length; i += 1) assert.equal(current.commandRefs[i], refs[i]);
		for (let i = 0; i < translated.length; i += 1) assert.equal(polylines[i].points, translated[i]);
		draw();
	}
	assert.notEqual(translated[2], sourcePoints);
	assert.notEqual(translated[3], sourceArrow);
	assert.equal(feedback.points, sourcePoints); assert.equal(feedback.arrow, sourceArrow);
	assert.equal(font.measurements, measurements);
	assert.equal(stream.floatData, quadStorage);
	assert.equal(f.view.model, f.model);
});
