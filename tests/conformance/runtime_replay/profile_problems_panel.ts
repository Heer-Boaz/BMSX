import { VirtualHeadlessClock } from '../../../hosts/node/headless/clock';
import { configureFontVariant } from '../../../ide/editor/ui/view/view';
import { ProblemsPanelController } from '../../../ide/workbench/contrib/problems/panel/controller';
import type { EditorDiagnostic } from '../../../ide/common/models';
import { api } from '../../../ide/runtime/overlay_api';
import { HostOverlayQuadStream } from '../../../machine/ts/render/host_overlay/quad_stream';
import { createHostOverlayFixture } from '../../helpers/host_overlay';
import { medianMilliseconds } from '../../helpers/performance';

// Retained painter and actual GPU-quad submission only; not a browser frame or raster budget.
for (const font of ['tiny', 'msx'] as const) for (const diagnosticCount of [0, 16, 1024]) {
	configureFontVariant(new VirtualHeadlessClock(), font, null);
	const diagnostics: EditorDiagnostic[] = Array.from({ length: diagnosticCount }, (_, index) => ({
		row: index, startColumn: 0, endColumn: 1, severity: 'error', contextId: 'code:0\0probe.lua', path: 'probe.lua',
		message: `Undefined name in authored callback ${index}; a wrapped source diagnostic.`,
	}));
	const controller = new ProblemsPanelController(); controller.show(); controller.setDiagnostics(diagnostics);
	const { renderer, presenter, queue } = createHostOverlayFixture(256, 212);
	const bounds = { left: 0, top: 100, right: 256, bottom: 200 };
	const draw = () => {
		renderer.beginFrame(presenter); api.beginFrame(renderer);
		controller.draw(bounds); renderer.endFrame();
		return queue.consumeOverlayFrame();
	};
	const stream = new HostOverlayQuadStream();
	const drawMicroseconds = medianMilliseconds(() => {
		for (let index = 0; index < 1000; index += 1) draw();
	});
	const drawAndQuadsMicroseconds = medianMilliseconds(() => {
		for (let index = 0; index < 100; index += 1) {
			const frame = draw(); stream.reset(256, 212);
			for (let command = 0; command < frame.commandCount; command += 1) stream.appendEntry(frame.commandKinds[command], frame.commandRefs[command]);
		}
	}) * 10;
	console.log(JSON.stringify({ font, diagnosticCount, drawMicroseconds, drawAndQuadsMicroseconds,
		commands: draw().commandCount, quadBatches: stream.batchCount }));
}
