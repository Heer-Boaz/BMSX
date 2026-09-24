import { runStudioTerminal } from './studio_terminal';
import { runStudioFrameRecovery } from './studio_frame_recovery';
import { runStudioExecutionOperations } from './studio_execution_operations';
import { runStudioSourceSaves } from './studio_source_saves';
import { runStudioBootOperations } from './studio_boot_operations';
import { runStudioResourceContext } from './studio_resource_context';
import { runStudioEditReview } from './studio_edit_review';
import { runStudio2025Scenes } from './studio_2025_scenes';
import { runStudioPietiousScenes } from './studio_pietious_scenes';
import { runStudioRuntimeInspection } from './studio_runtime_inspection';
import { runStudioPreload } from './studio_preload';
import { runStudioNemesisScenes } from './studio_nemesis_scenes';
import { runStudioBtReparentLive } from './studio_bt_reparent_live';
import { runStudioFsmDragLive } from './studio_fsm_drag_live';
import { runStudioFsmInitialLive } from './studio_fsm_initial_live';
import { runStudioPointerNavigation, type NavigationCart } from './studio_pointer_navigation';
import { runStudioWorkflows } from './studio_workflows';
import { presentBehaviorTreeGraph } from './studio_behavior_graph';
import { testCapturedSourceReboot } from './studio_source_workflows';
import { testSceneSourceAfterReboot, presentSceneEditor } from './studio_scene_source';
import { presentCommandPalette } from './studio_command_palette';
import { testStudioScenarioOutput } from './studio_scenario_output';
import { testStudioScenarioExecution } from './studio_scenario_execution';
import { runStudioTestRunner } from './studio_test_runner';
import { presentActionEffects } from './studio_behavior_kinds';
import { testStudioPointerCapture } from './studio_pointer_capture';
import { runStudioSceneViewport, testStudioSceneViewport } from './studio_scene_viewport';
import type { StudioFixture } from './studio_fixture';

export type StudioScenario = { kind: 'frame-recovery' | 'terminal' | 'workflows' | 'edit-review' | 'resource-context' | 'boot-operations' | 'source-saves' | 'execution-operations' | 'test-runner' | 'scene-viewport' | 'fsm-initial' | 'fsm-retarget' | 'fsm-retarget-imported' | 'bt-reparent' | 'runtime-inspection' | 'preload' | 'nemesis-scenes' }
	| { kind: 'cart-scenes'; cart: '2025' | 'pietious' }
	| { kind: 'navigation'; cart: NavigationCart };

/** One scenario composition for every renderer project; backend checks remain in their project. */
export function runStudioScenario(test: StudioFixture, scenario: StudioScenario) {
	switch (scenario.kind) {
		case 'frame-recovery': return runStudioFrameRecovery(test);
		case 'terminal': return runStudioTerminal(test);
		case 'resource-context': return runStudioResourceContext(test);
		case 'edit-review': return runStudioEditReview(test);
		case 'boot-operations': return runStudioBootOperations(test);
		case 'source-saves': return runStudioSourceSaves(test);
		case 'execution-operations': return runStudioExecutionOperations(test);
		case 'scene-viewport': return runStudioSceneViewport(test);
		case 'test-runner': return runStudioTestRunner(test);
		case 'cart-scenes': return scenario.cart === '2025' ? runStudio2025Scenes(test) : runStudioPietiousScenes(test);
		case 'nemesis-scenes': return runStudioNemesisScenes(test);
		case 'workflows': return runStudioWorkflows(test);
		case 'runtime-inspection': return runStudioRuntimeInspection(test);
		case 'preload': return runStudioPreload(test);
		case 'navigation': return runStudioPointerNavigation(test, scenario.cart);
		case 'fsm-initial': return runStudioFsmInitialLive(test);
		case 'fsm-retarget': return runStudioFsmDragLive(test);
		case 'fsm-retarget-imported': return runStudioFsmDragLive(test, true);
		case 'bt-reparent': return runStudioBtReparentLive(test);
	}
}

/** Post-installation phase runs after any renderer-specific live callback/readback checks. */
export async function finishStudioScenario(test: StudioFixture, scenario: StudioScenario): Promise<void> {
	if (scenario.kind === 'workflows') {
		await testCapturedSourceReboot(test);
		await testSceneSourceAfterReboot(test);
		await testStudioScenarioExecution(test);
		await testStudioScenarioOutput(test);
		await presentSceneEditor(test);
		await presentCommandPalette(test);
		await presentActionEffects(test);
		await testStudioPointerCapture(test);
	}
	if (scenario.kind === 'workflows' || scenario.kind === 'navigation') await presentBehaviorTreeGraph(test);
	if (scenario.kind === 'workflows') await testStudioSceneViewport(test);
}
