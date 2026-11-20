import type { StudioFixture } from './studio_fixture';
import { reachNemesisTitle } from './studio_nemesis_navigation';
import { testStudioBehaviorNavigation } from './studio_behavior_navigation';
import { testStudioBehaviorPicker } from './studio_behavior_picker';
import { testStudioBehaviorKinds } from './studio_behavior_kinds';
import { testStudioBehaviorSourceGraph } from './studio_behavior_source';
import { testStudioBehaviorImports } from './studio_behavior_imports';
import { testStudioBehaviorInspector } from './studio_behavior_inspector';
import { testStudioCommandPalette } from './studio_command_palette';
import { testStudioNavigation } from './studio_navigation';
import { testStudioQuickPick } from './studio_quick_pick';
import { testStudioBtDrag } from './studio_bt_drag';
import { testStudioBtReparent } from './studio_bt_reparent';
import { testStudioSourceBookmarks } from './studio_source_bookmarks';
import { testStudioFsmBookmarks } from './studio_fsm_bookmarks';
import { testStudioActionEffectSource } from './studio_actioneffect_source';
import { testStudioActionEffectEdit } from './studio_actioneffect_edit';
import { testStudioFsmSelection } from './studio_fsm_selection';
import { testStudioFsmInitial } from './studio_fsm_initial';
import { testScenePlacementIdentity } from './studio_scene_identity';

const workflows = {
	'actioneffect-edit': testStudioActionEffectEdit,
	'actioneffect-source': testStudioActionEffectSource,
	'behavior-imports': testStudioBehaviorImports,
	'behavior-inspector': testStudioBehaviorInspector,
	'behavior-kinds': testStudioBehaviorKinds,
	'behavior-navigation': testStudioBehaviorNavigation,
	'behavior-picker': testStudioBehaviorPicker,
	'behavior-source': testStudioBehaviorSourceGraph,
	'bt-drag': testStudioBtDrag,
	'bt-reparent': testStudioBtReparent,
	'bt-bookmarks': testStudioSourceBookmarks,
	'command-palette': testStudioCommandPalette,
	'fsm-bookmarks': testStudioFsmBookmarks,
	'fsm-initial': testStudioFsmInitial,
	'fsm-selection': testStudioFsmSelection,
	'quick-input': testStudioQuickPick,
	'scene-identity': testScenePlacementIdentity,
	'source-navigation': testStudioNavigation,
};

/** These workflow cases start from the shipped cart, not a previous case's state. */
export async function runStudioWorkflowCase(test: StudioFixture, name: string) {
	if (!Object.hasOwn(workflows, name)) throw new Error(`Unknown Studio case '${name}'; choose ${Object.keys(workflows).join(', ')}`);
	const { runtime, until, cycles, press, runMenuCommand, observations } = test;
	await until(() => cycles() > runtime.timing.cpuHz * 13, 'boot into real cart');
	await reachNemesisTitle(test);
	await press('ControlRight', 'ShiftRight');
	await runMenuCommand('pause');
	await workflows[name as keyof typeof workflows](test);
	return { name, hostFrames: observations.hostFrames };
}
