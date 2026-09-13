import { runStudioScenario, finishStudioScenario, type StudioScenario } from './studio_scenarios';
import { createWebGLBackend, createWebGPUBackend } from '../../../hosts/browser/backend';
import { HeadlessGPUBackend } from '../../../machine/ts/render/headless/backend';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { createStudioFixture, check } from './studio_fixture';
import { testStudioWebGpuReadbacks } from './studio_webgpu_readbacks';

/** Independent renderer projects run the same Studio workflow. */
export const studioBackends = {
	software: async (canvas: HTMLCanvasElement, scenario: StudioScenario, capture?: (name: string) => Promise<void>) => {
		const backend = new HeadlessGPUBackend(canvas.width, canvas.height, PSX_MACHINE_SPEC.gxGpuVramBytes);
		// Publish actual software output only at explicit capture points, not every frame.
		const present = () => {
			canvas.width = backend.framebufferWidth;
			canvas.height = backend.framebufferHeight;
			canvas.getContext('2d').putImageData(new ImageData(
				Uint8ClampedArray.from(backend.borrowPresentedPixels()), canvas.width, canvas.height,
			), 0, 0);
		};
		const test = await createStudioFixture(canvas, backend, capture === undefined ? undefined : async name => {
			present();
			await capture(name);
		});
		const result = await runStudioScenario(test, scenario);
		await finishStudioScenario(test, scenario);
		present();
		return result;
	},
	webgl2: async (canvas: HTMLCanvasElement, scenario: StudioScenario, capture?: (name: string) => Promise<void>) => {
		const backend = createWebGLBackend(canvas, PSX_MACHINE_SPEC.gxGpuVramBytes);
		const test = await createStudioFixture(canvas, backend, capture);
		const result = await runStudioScenario(test, scenario);
		await finishStudioScenario(test, scenario);
		check(backend.gl.getError() === backend.gl.NO_ERROR, 'WebGL2 workflow raised a graphics error');
		return result;
	},
	webgpu: async (canvas: HTMLCanvasElement, scenario: StudioScenario, capture?: (name: string) => Promise<void>) => {
		const adapter = await navigator.gpu.requestAdapter();
		const backend = await createWebGPUBackend(canvas, adapter, PSX_MACHINE_SPEC.gxGpuVramBytes);
		const errors: string[] = [];
		backend.device.addEventListener('uncapturederror', event => errors.push(event.error.message));
		const test = await createStudioFixture(canvas, backend, capture);
		const result = await runStudioScenario(test, scenario);
		const readbacks = scenario.kind === 'workflows' ? await testStudioWebGpuReadbacks(test, backend) : null;
		await finishStudioScenario(test, scenario);
		check(errors.length === 0, errors.join('\n'));
		return { ...result, readbacks };
	},
};
