import { runStudioScenario, finishStudioScenario, type StudioScenario } from './studio_scenarios';
import { createStudioFixture } from './studio_fixture';
import { createStudioRenderer, type StudioRendererKind } from './studio_renderer';
import { testStudioWebGpuReadbacks } from './studio_webgpu_readbacks';
import { runStudioBuildOutput } from './studio_build_output';

/** Independent renderer projects run the same Studio workflow. */
export async function runStudio(kind: StudioRendererKind, canvas: HTMLCanvasElement, scenario: StudioScenario | { kind: 'build-output' }, capture?: (name: string) => Promise<void>) {
	const renderer = await createStudioRenderer(kind, canvas, capture);
	const test = await createStudioFixture(canvas, renderer.backend, renderer.capture);
	const result = await (scenario.kind === 'build-output' ? runStudioBuildOutput(test) : runStudioScenario(test, scenario));
	const readbacks = renderer.kind === 'webgpu' && scenario.kind === 'workflows' ? await testStudioWebGpuReadbacks(test, renderer.backend) : null;
	if (scenario.kind !== 'build-output') await finishStudioScenario(test, scenario);
	await renderer.finish();
	return { ...result, readbacks };
}
