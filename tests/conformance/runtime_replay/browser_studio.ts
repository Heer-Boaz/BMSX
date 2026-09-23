import { runStudioScenario, finishStudioScenario, type StudioScenario } from './studio_scenarios';
import { createStudioFixture } from './studio_fixture';
import { createStudioRenderer, type StudioRendererKind } from './studio_renderer';
import { testStudioWebGpuReadbacks } from './studio_webgpu_readbacks';

/** Independent renderer projects run the same Studio workflow. */
export async function runStudio(kind: StudioRendererKind, canvas: HTMLCanvasElement, scenario: StudioScenario, capture?: (name: string) => Promise<void>) {
	const renderer = await createStudioRenderer(kind, canvas, capture);
	const test = await createStudioFixture(canvas, renderer.backend, renderer.capture);
	const result = await runStudioScenario(test, scenario);
	const readbacks = renderer.kind === 'webgpu' && scenario.kind === 'workflows' ? await testStudioWebGpuReadbacks(test, renderer.backend) : null;
	await finishStudioScenario(test, scenario);
	await renderer.finish();
	return { ...result, readbacks };
}
