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
import { presentActionEffects } from './studio_behavior_kinds';
import { testStudioPointerCapture } from './studio_pointer_capture';
import { testStudioSceneViewport } from './studio_scene_viewport';
import type { StudioFixture } from './studio_fixture';

export type StudioScenario = { kind: 'workflows' | 'fsm-initial' | 'fsm-retarget' | 'bt-reparent' }
	| { kind: 'navigation'; cart: NavigationCart };

/** One scenario composition for every renderer project; backend checks remain in their project. */
export function runStudioScenario(test: StudioFixture, scenario: StudioScenario) {
	switch (scenario.kind) {
		case 'workflows': return runStudioWorkflows(test);
		case 'navigation': return runStudioPointerNavigation(test, scenario.cart);
		case 'fsm-initial': return runStudioFsmInitialLive(test);
		case 'fsm-retarget': return runStudioFsmDragLive(test);
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
