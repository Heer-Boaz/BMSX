import { createWebGLBackend, createWebGPUBackend } from '../../../hosts/browser/backend';
import { HeadlessGPUBackend } from '../../../machine/ts/render/headless/backend';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { createStudioFixture, check } from './studio_fixture';
import { runStudioWorkflows } from './studio_workflows';
import { testStudioWebGpuReadbacks } from './studio_webgpu_readbacks';
import { testCapturedSourceReboot } from './studio_source_workflows';
import { testSceneSourceAfterReboot } from './studio_scene_source';

/** Independent renderer projects run the same Studio workflow. */
export const studioBackends = {
	software: async (canvas: HTMLCanvasElement) => {
		const backend = new HeadlessGPUBackend(canvas.width, canvas.height, PSX_MACHINE_SPEC.gxGpuVramBytes);
		const test = await createStudioFixture(canvas, backend);
		const result = await runStudioWorkflows(test);
		await testCapturedSourceReboot(test);
		await testSceneSourceAfterReboot(test);
		// Publish the real software-rendered final framebuffer for the screenshot.
		// No replacement drawing or per-frame screenshot conversion.
		canvas.width = backend.framebufferWidth;
		canvas.height = backend.framebufferHeight;
		canvas.getContext('2d').putImageData(new ImageData(
			Uint8ClampedArray.from(backend.borrowPresentedPixels()), canvas.width, canvas.height,
		), 0, 0);
		return result;
	},
	webgl2: async (canvas: HTMLCanvasElement) => {
		const backend = createWebGLBackend(canvas, PSX_MACHINE_SPEC.gxGpuVramBytes);
		const test = await createStudioFixture(canvas, backend);
		const result = await runStudioWorkflows(test);
		await testCapturedSourceReboot(test);
		await testSceneSourceAfterReboot(test);
		check(backend.gl.getError() === backend.gl.NO_ERROR, 'WebGL2 workflow raised a graphics error');
		return result;
	},
	webgpu: async (canvas: HTMLCanvasElement) => {
		const adapter = await navigator.gpu.requestAdapter();
		const backend = await createWebGPUBackend(canvas, adapter, PSX_MACHINE_SPEC.gxGpuVramBytes);
		const errors: string[] = [];
		backend.device.addEventListener('uncapturederror', event => errors.push(event.error.message));
		const test = await createStudioFixture(canvas, backend);
		const result = await runStudioWorkflows(test);
		const readbacks = await testStudioWebGpuReadbacks(test, backend);
		await testCapturedSourceReboot(test);
		await testSceneSourceAfterReboot(test);
		check(errors.length === 0, errors.join('\n'));
		return { ...result, readbacks };
	},
};
