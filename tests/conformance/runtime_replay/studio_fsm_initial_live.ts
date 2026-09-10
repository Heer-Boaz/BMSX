import { FSM_INITIAL_CART_SOURCE } from '../../helpers/fsm_initial_fixture';
import { actionPromptState } from '../../../ide/workbench/contrib/modal/action_prompt';
import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import { getTextFileRuntimeSourceStatus } from '../../../ide/workbench/services/working_copy/runtime_source_status';
import { chooseBehavior, revealLensOccurrence } from './studio_behavior_picker';
import { check, type StudioFixture } from './studio_fixture';

/** One actual author/edit/install loop on each renderer, using an independent authored FSM. */
export async function runStudioFsmInitialLive(test: StudioFixture) {
	const { runtime, ide, execution, tasks, harness, guest, press, click, until, frame, cycles, runMenuCommand, runPaletteCommand } = test;
	await until(() => cycles() > runtime.timing.cpuHz * 13, 'initial live: normal cart boot');
	await press('ControlRight', 'ShiftRight');
	await runMenuCommand('pause');
	harness.openLuaSource('cart.lua');
	const model = harness.getActiveEditorDocument().model;
	model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: FSM_INITIAL_CART_SOURCE }]);
	await runPaletteCommand('Run: Reboot');
	check(actionPromptState.prompt?.action === 'reboot', 'initial live: fixture is authored through the ordinary Save/Reboot prompt');
	await press('Enter');
	await until(() => tasks.ready && ide.sources.cartridgeSlots[0]!.installedBlua32Sources.get('cart') === FSM_INITIAL_CART_SOURCE,
		'initial live: compiler and media owner install the authored source');
	await until(() => guest.global('fsm_initial_init_count') === 1 && !runtime.completionCallPending(), 'initial live: cold fixture executes its explicit registration');
	await press('ControlRight', 'ShiftRight');
	check(!execution.userPaused, 'initial live: explicit Reboot requested fresh execution');
	await runMenuCommand('pause');
	const machine = guest.global('fsm_initial_machine');
	const idle = guest.readStringMember(machine, 'current_state');
	const data = guest.readStringMember(idle, 'data');
	check(guest.formatValue(guest.readStringMember(machine, 'current_id')) === 'idle', 'initial live: cold default is idle');
	check(guest.readStringMember(data, 'retained') === 73, 'initial live: actual mutable FSM data exists');
	await runPaletteCommand('Behavior Lens: Open State Machine (FSM)');
	await chooseBehavior(test, 'FSM fixture.initial', 'STATE MACHINES');
	const lens = getActiveTab();
	if (lens.kind !== 'behavior_lens' || lens.view.presentation.kind !== 'state-graph') throw new Error('initial live: FSM graph required');
	await lens.graphLayout.settled; await frame();
	const graph = lens.view.presentation;
	const active = graph.viewport.model.nodes.find(node => node.source.label === 'active')!;
	await revealLensOccurrence(test, lens.view, active.source.rowKey);
	const position = cycles();
	const media = ide.sources.currentBlua32Media;
	await click(graph.actionBar.items[2].bounds, 6);
	await lens.graphLayout.settled; await frame();
	const changed = FSM_INITIAL_CART_SOURCE.replace("'idle'),", "'active'),");
	check(model.buffer.getText() === changed && cycles() === position && ide.sources.currentBlua32Media === media,
		'initial live: visible Set Initial writes source without executing or patching the guest');
	check(guest.readStringMember(machine, 'current_state') === idle && getTextFileRuntimeSourceStatus(ide.sources, model) === 'pending',
		'initial live: authored and installed definitions are distinct');
	await runPaletteCommand('Run: Hot Resume');
	check(actionPromptState.prompt?.action === 'hot-resume', 'initial live: graph edit enters the normal dirty-source prompt');
	await press('Enter');
	await until(() => tasks.ready && !runtime.completionCallPending() && guest.global('fsm_initial_init_count') === 2,
		'initial live: actual Hot Resume installs the edited initializer and executes it');
	check(model.lastSavedSource === changed && getTextFileRuntimeSourceStatus(ide.sources, model) === 'applied', 'initial live: saved and installed source agree');
	check(guest.global('fsm_initial_machine') === machine && guest.readStringMember(machine, 'current_state') === idle
		&& guest.readStringMember(idle, 'data') === data && guest.readStringMember(data, 'retained') === 73,
		'initial live: Hot Resume preserves the actual machine, active state and data');
	check(guest.formatValue(guest.readStringMember(guest.readStringMember(machine, 'definition'), 'initial')) === 'active',
		'initial live: the retained machine is bound to the edited definition, not its old initial value');
	await press('ControlRight', 'ShiftRight'); await runMenuCommand('pause');
	await runPaletteCommand('Edit: Undo');
	await lens.graphLayout.settled; await frame();
	check(model.buffer.getText() === FSM_INITIAL_CART_SOURCE, 'initial live: ordinary graph Undo restores source');
	await runPaletteCommand('Run: Hot Resume');
	check(actionPromptState.prompt?.action === 'hot-resume', 'initial live: undone source has the same installation gate');
	await press('Enter');
	await until(() => tasks.ready && !runtime.completionCallPending() && guest.global('fsm_initial_init_count') === 3, 'initial live: Undo revision is installed');
	check(guest.global('fsm_initial_machine') === machine
		&& guest.formatValue(guest.readStringMember(guest.readStringMember(machine, 'definition'), 'initial')) === 'idle', 'initial live: Undo rebind retains identity');
	check(guest.readStringMember(machine, 'current_state') === idle && guest.readStringMember(idle, 'data') === data
		&& guest.readStringMember(data, 'retained') === 73, 'initial live: Undo installation preserves the current state and data');
	check(model.lastSavedSource === FSM_INITIAL_CART_SOURCE && getTextFileRuntimeSourceStatus(ide.sources, model) === 'applied',
		'initial live: undone source is both saved and installed');
	await press('ControlRight', 'ShiftRight'); await runMenuCommand('pause');
	await runPaletteCommand('Edit: Redo');
	await lens.graphLayout.settled; await frame();
	check(model.buffer.getText() === changed, 'initial live: ordinary graph Redo restores authored edit');
	await runPaletteCommand('Run: Hot Resume');
	check(actionPromptState.prompt?.action === 'hot-resume', 'initial live: Redo revision enters the ordinary prompt');
	await press('Enter');
	await until(() => tasks.ready && !runtime.completionCallPending() && guest.global('fsm_initial_init_count') === 4, 'initial live: Redo revision is installed');
	check(guest.global('fsm_initial_machine') === machine && guest.readStringMember(machine, 'current_state') === idle, 'initial live: three installs do not restart the FSM');
	check(guest.formatValue(guest.readStringMember(guest.readStringMember(machine, 'definition'), 'initial')) === 'active'
		&& guest.readStringMember(idle, 'data') === data && guest.readStringMember(data, 'retained') === 73,
		'initial live: Redo installs the changed definition without replacing or resetting data');
	check(model.lastSavedSource === changed && getTextFileRuntimeSourceStatus(ide.sources, model) === 'applied',
		'initial live: redone source is both saved and installed');
	await press('ControlRight', 'ShiftRight'); await runMenuCommand('pause');
	await runPaletteCommand('Run: Reboot');
	await until(() => tasks.ready && guest.global('fsm_initial_init_count') === 1, 'initial live: explicit cold reboot executes edited source');
	await until(() => guest.global('fsm_initial_machine') !== machine, 'initial live: cold startup instantiates a new machine');
	check(guest.formatValue(guest.readStringMember(guest.global('fsm_initial_machine'), 'current_id')) === 'active', 'initial live: new instance starts in the authored initial state');
	await press('ControlRight', 'ShiftRight');
	check(!execution.userPaused, 'initial live: explicit cold reboot is not an implicit pause');
	await runMenuCommand('pause');
	await runPaletteCommand('Behavior Lens: Open State Machine (FSM)');
	await chooseBehavior(test, 'FSM fixture.initial', 'STATE MACHINES');
	await lens.graphLayout.settled; await frame();
	await revealLensOccurrence(test, lens.view, graph.viewport.model.nodes.find(node => node.source.label === 'idle')!.source.rowKey);
	console.info('STUDIO: FSM initial live edit and three Hot Resume installs PASS');
	return { hostFrames: test.observations.hostFrames, hotResumeInstalls: 3, coldInitial: 'active' };
}
