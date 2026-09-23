import { createWebGLBackend, createWebGPUBackend } from '../../../hosts/browser/backend';
import { HeadlessGPUBackend } from '../../../machine/ts/render/headless/backend';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { check } from './studio_fixture';

export type StudioRendererKind = 'software' | 'webgl2' | 'webgpu';

/** Browser-test renderer ownership: actual presentation at capture points and backend error checks. */
export async function createStudioRenderer(kind: StudioRendererKind, canvas: HTMLCanvasElement, capture?: (name: string) => Promise<void>) {
	if (kind === 'software') {
		const backend = new HeadlessGPUBackend(canvas.width, canvas.height, PSX_MACHINE_SPEC.gxGpuVramBytes);
		const present = () => {
			canvas.width = backend.framebufferWidth;
			canvas.height = backend.framebufferHeight;
			canvas.getContext('2d').putImageData(new ImageData(
				Uint8ClampedArray.from(backend.borrowPresentedPixels()), canvas.width, canvas.height,
			), 0, 0);
		};
		return { kind, backend, capture: capture === undefined ? undefined : async (name: string) => { present(); await capture(name); }, finish: present };
	}
	if (kind === 'webgl2') {
		const backend = createWebGLBackend(canvas, PSX_MACHINE_SPEC.gxGpuVramBytes);
		return { kind, backend, capture, finish: () => check(backend.gl.getError() === backend.gl.NO_ERROR, 'WebGL2 workflow raised a graphics error') };
	}
	const adapter = await navigator.gpu.requestAdapter();
	const backend = await createWebGPUBackend(canvas, adapter, PSX_MACHINE_SPEC.gxGpuVramBytes);
	const errors: string[] = [];
	backend.device.addEventListener('uncapturederror', event => errors.push(event.error.message));
	return { kind, backend, capture, finish: async () => {
		await backend.device.queue.onSubmittedWorkDone();
		check(errors.length === 0, errors.join('\n'));
	} };
}
