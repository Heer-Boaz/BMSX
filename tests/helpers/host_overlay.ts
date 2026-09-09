import { HeadlessVideoOutput } from '../../hosts/node/headless/video_output';
import { OverlayRenderer } from '../../ide/runtime/overlay_renderer';
import { VideoPresenter } from '../../machine/ts/render/video_presenter';
import { HeadlessGPUBackend } from '../../machine/ts/render/headless/backend';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';

export function createHostOverlayFixture(width: number, height: number) {
	const backend = new HeadlessGPUBackend(width, height, PSX_MACHINE_SPEC.gxGpuVramBytes);
	backend.resizePresentationTarget(width, height);
	const presenter = new VideoPresenter(new HeadlessVideoOutput(width, height), backend, width, height);
	const queue = presenter.hostOverlayQueue;
	const renderer = new OverlayRenderer(queue);
	return { backend, presenter, queue, renderer };
}
