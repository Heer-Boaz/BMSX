import type { StudioFixture } from './studio_fixture';
import { reachNemesisTitle } from './studio_nemesis_navigation';
import { testStudioBehaviorNavigation } from './studio_behavior_navigation';
import { testStudioBehaviorPicker } from './studio_behavior_picker';
import { testStudioBehaviorKinds } from './studio_behavior_kinds';
import { testStudioCommandPalette } from './studio_command_palette';
import { testStudioNavigation } from './studio_navigation';
import { testStudioQuickPick } from './studio_quick_pick';

const workflows = {
	'behavior-kinds': testStudioBehaviorKinds,
	'behavior-navigation': testStudioBehaviorNavigation,
	'behavior-picker': testStudioBehaviorPicker,
	'command-palette': testStudioCommandPalette,
	'quick-input': testStudioQuickPick,
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
