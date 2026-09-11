import { testStudioSceneViewport } from './studio_scene_viewport';
import { runStudioFsmDragLive } from './studio_fsm_drag_live';
import { runStudioFsmInitialLive } from './studio_fsm_initial_live';
import { presentBehaviorTreeGraph } from './studio_behavior_graph';
import { createWebGLBackend, createWebGPUBackend } from '../../../hosts/browser/backend';
import { HeadlessGPUBackend } from '../../../machine/ts/render/headless/backend';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { createStudioFixture, check } from './studio_fixture';
import { runStudioWorkflows } from './studio_workflows';
import { testStudioWebGpuReadbacks } from './studio_webgpu_readbacks';
import { testCapturedSourceReboot } from './studio_source_workflows';
import { testSceneSourceAfterReboot, presentSceneEditor } from './studio_scene_source';
import { presentCommandPalette } from './studio_command_palette';
import { testStudioScenarioOutput } from './studio_scenario_output';
import { testStudioScenarioExecution } from './studio_scenario_execution';
import { presentActionEffects } from './studio_behavior_kinds';
import { testStudioPointerCapture } from './studio_pointer_capture';
import { runStudioPointerNavigation, type NavigationCart } from './studio_pointer_navigation';

/** Independent renderer projects run the same Studio workflow. */
export const studioBackends = {
	software: async (canvas: HTMLCanvasElement, navigation: NavigationCart | null = null, fsm: 'initial' | 'retarget' | null = null) => {
		const backend = new HeadlessGPUBackend(canvas.width, canvas.height, PSX_MACHINE_SPEC.gxGpuVramBytes);
		const test = await createStudioFixture(canvas, backend);
		const result = fsm === 'retarget' ? await runStudioFsmDragLive(test) : fsm === 'initial' ? await runStudioFsmInitialLive(test) : navigation === null ? await runStudioWorkflows(test) : await runStudioPointerNavigation(test, navigation);
		if (navigation === null && fsm === null) {
			await testCapturedSourceReboot(test);
			await testSceneSourceAfterReboot(test);
			await testStudioScenarioExecution(test);
			await testStudioScenarioOutput(test);
			await presentSceneEditor(test);
			await presentCommandPalette(test);
			await presentActionEffects(test);
			await testStudioPointerCapture(test);
		}
		if (fsm === null) await presentBehaviorTreeGraph(test);
		if (navigation === null && fsm === null) await testStudioSceneViewport(test);
		// Publish the real software-rendered final framebuffer for the screenshot.
		// No replacement drawing or per-frame screenshot conversion.
		canvas.width = backend.framebufferWidth;
		canvas.height = backend.framebufferHeight;
		canvas.getContext('2d').putImageData(new ImageData(
			Uint8ClampedArray.from(backend.borrowPresentedPixels()), canvas.width, canvas.height,
		), 0, 0);
		return result;
	},
	webgl2: async (canvas: HTMLCanvasElement, navigation: NavigationCart | null = null, fsm: 'initial' | 'retarget' | null = null) => {
		const backend = createWebGLBackend(canvas, PSX_MACHINE_SPEC.gxGpuVramBytes);
		const test = await createStudioFixture(canvas, backend);
		const result = fsm === 'retarget' ? await runStudioFsmDragLive(test) : fsm === 'initial' ? await runStudioFsmInitialLive(test) : navigation === null ? await runStudioWorkflows(test) : await runStudioPointerNavigation(test, navigation);
		if (navigation === null && fsm === null) {
			await testCapturedSourceReboot(test);
			await testSceneSourceAfterReboot(test);
			await testStudioScenarioExecution(test);
			await testStudioScenarioOutput(test);
			await presentSceneEditor(test);
			await presentCommandPalette(test);
			await presentActionEffects(test);
			await testStudioPointerCapture(test);
		}
		if (fsm === null) await presentBehaviorTreeGraph(test);
		if (navigation === null && fsm === null) await testStudioSceneViewport(test);
		check(backend.gl.getError() === backend.gl.NO_ERROR, 'WebGL2 workflow raised a graphics error');
		return result;
	},
	webgpu: async (canvas: HTMLCanvasElement, navigation: NavigationCart | null = null, fsm: 'initial' | 'retarget' | null = null) => {
		const adapter = await navigator.gpu.requestAdapter();
		const backend = await createWebGPUBackend(canvas, adapter, PSX_MACHINE_SPEC.gxGpuVramBytes);
		const errors: string[] = [];
		backend.device.addEventListener('uncapturederror', event => errors.push(event.error.message));
		const test = await createStudioFixture(canvas, backend);
		const result = fsm === 'retarget' ? await runStudioFsmDragLive(test) : fsm === 'initial' ? await runStudioFsmInitialLive(test) : navigation === null ? await runStudioWorkflows(test) : await runStudioPointerNavigation(test, navigation);
		const readbacks = navigation === null && fsm === null ? await testStudioWebGpuReadbacks(test, backend) : null;
		if (navigation === null && fsm === null) {
			await testCapturedSourceReboot(test);
			await testSceneSourceAfterReboot(test);
			await testStudioScenarioExecution(test);
			await testStudioScenarioOutput(test);
			await presentSceneEditor(test);
			await presentCommandPalette(test);
			await presentActionEffects(test);
			await testStudioPointerCapture(test);
		}
		if (fsm === null) await presentBehaviorTreeGraph(test);
		if (navigation === null && fsm === null) await testStudioSceneViewport(test);
		check(errors.length === 0, errors.join('\n'));
		return { ...result, readbacks };
	},
};
