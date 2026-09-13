import type { Table } from '../../../machine/ts/machine/cpu/table';
import { buildModuleExportSlotName } from '../../../toolchain/ts/lua/module_path';
import { traceSinkFieldName } from '../../../toolchain/ts/lua/compiler/trace_statement';
import { PRELOAD_TRACE_CHANNELS } from '../../helpers/preload_source_fixture';
import { actionPromptState } from '../../../ide/workbench/contrib/modal/action_prompt';
import { getTextFileRuntimeSourceStatus } from '../../../ide/workbench/services/working_copy/runtime_source_status';
import { chooseBehavior } from './studio_behavior_picker';
import { check, type StudioFixture } from './studio_fixture';

/** Tool-selected initialization survives the ordinary Studio source/install workflow. */
export async function runStudioPreload(test: StudioFixture) {
	const { runtime, ide, tasks, harness, guest, press, until, cycles, runMenuCommand, runPaletteCommand, rewind, history, settle } = test;
	await until(() => cycles() > runtime.timing.cpuHz * 13, 'preload: normal BIOS and independent source cart boot');
	await press('ControlRight', 'ShiftRight'); await runMenuCommand('pause');
	const moduleValue = (path: string) => guest.global(buildModuleExportSlotName(path, []));
	const registrations = () => guest.readStringMember(moduleValue('game'), 'registrations');
	const observation = moduleValue('observation'), actor = guest.readStringMember(moduleValue('game'), 'actor');
	const recorded = (expectedType: string) => {
		const current = moduleValue('observation');
		const actor = guest.readStringMember(moduleValue('game'), 'actor');
		const bindings = guest.readStringMember(current, 'completed_bindings') as Table;
		const program = bindings.get(actor);
		const programs = guest.readStringMember(current, 'programs') as Table;
		const capture = programs.get(program);
		const nodes = guest.readStringMember(capture, 'nodes') as Table;
		check(nodes.arrayLength === 2 && guest.formatValue(guest.readStringMember(nodes.get(1), 'type')) === expectedType,
			`preload: actual completed compilation retains ${expectedType}, including erased single-child structure`);
		return program;
	};
	const configuration = () => {
		const image = ide.sources.currentBlua32Media.cartridgeSlots[0]!;
		check(JSON.stringify(image.symbols!.metadata.traceStatements) === JSON.stringify(PRELOAD_TRACE_CHANNELS)
			&& JSON.stringify(image.symbols!.metadata.preloadModules) === '["observation"]', 'preload: installed settings survive source rebuild');
		check(!image.layout.constants.includes(traceSinkFieldName('fixture.tick')),
			'preload: unrelated tick statement remains erased');
	};
	check(registrations() === 1, 'preload: first registration occurred before entry');
	let previousProgram = recorded('sequence'); configuration();
	await runPaletteCommand('Behavior Lens: Open Behavior Tree (BT)');
	await chooseBehavior(test, 'BT preload.tree', 'BEHAVIOR TREES');
	await runPaletteCommand('Behavior Tree: Inspect Runtime Instance');
	check(ide.editor.quickInput.visible && ide.editor.quickInput.model.list.rows.length === 1,
		'preload: ordinary Studio inspector attaches late to the actual indexed actor');
	await press('Enter'); await press('Escape');

	await runPaletteCommand('Run: Hot Resume');
	await until(() => tasks.ready && registrations() === 2 && !runtime.completionCallPending(), 'preload: no-change init recompiles the BT');
	await press('ControlRight', 'ShiftRight'); await runMenuCommand('pause');
	check(moduleValue('observation') === observation && guest.readStringMember(moduleValue('game'), 'actor') === actor,
		'preload: init retains observation and actor identities');
	let program = recorded('sequence'); check(program !== previousProgram, 'preload: init recorded a new real program');
	previousProgram = program;
	harness.openLuaSource('game.lua');
	const model = harness.getActiveEditorDocument().model;
	const position = model.buffer.getText().indexOf("type = 'sequence'") + "type = '".length;
	model.pushEditOperations([{ offset: position, deleteLength: 'sequence'.length, text: 'selector' }]);
	model.pushEditOperations([{ offset: model.buffer.length, deleteLength: 0, text: '\nlocal =\n' }]);
	const beforeFailure = ide.sources.currentBlua32Media, failurePosition = cycles();
	await runPaletteCommand('Run: Hot Resume'); await press('Enter');
	await until(() => tasks.ready, 'preload: invalid source is rejected by the normal compiler');
	check(ide.sources.currentBlua32Media === beforeFailure && cycles() === failurePosition && registrations() === 2
		&& moduleValue('observation') === observation, 'preload: failed compilation neither installs settings nor resets observation');
	recorded('sequence');
	model.undo();
	await runPaletteCommand('Run: Hot Resume');
	check(actionPromptState.prompt?.action === 'hot-resume', 'preload: changed source goes through Save/Hot Resume');
	await press('Enter');
	await until(() => tasks.ready && registrations() === 3 && !runtime.completionCallPending(), 'preload: changed module installed and rebound');
	await press('ControlRight', 'ShiftRight'); await runMenuCommand('pause');
	configuration(); program = recorded('selector');
	check(getTextFileRuntimeSourceStatus(ide.sources, model) === 'applied', 'preload: changed authored source matches the live installation');
	check(program !== previousProgram && moduleValue('observation') === observation
		&& guest.readStringMember(moduleValue('game'), 'actor') === actor,
		'preload: changed lowering recorded without resetting the observer or the actor');

	// Changed source forces the boot rebuild path, not merely reuse of existing code.
	harness.openLuaSource('game.lua'); await press('ControlLeft', 'KeyZ');
	await runPaletteCommand('Run: Reboot');
	check(actionPromptState.prompt?.action === 'reboot', 'preload: source Undo requires Save/Reboot');
	await press('Enter');
	await until(() => tasks.ready && cycles() > runtime.timing.cpuHz * 13, 'preload: reboot completes');
	await press('ControlRight', 'ShiftRight'); await runMenuCommand('pause');
	check(registrations() === 1 && moduleValue('observation') !== observation, 'preload: cold startup creates a new recorder before registration');
	configuration(); recorded('sequence');
	check(getTextFileRuntimeSourceStatus(ide.sources, model) === 'applied', 'preload: source Undo matches the rebooted installation');
	await runMenuCommand('pause');
	await until(() => history.latestCycles > history.earliestCycles + runtime.timing.cpuHz * 2, 'preload: snapshots include the observation tables');
	await press('ControlRight', 'ShiftRight'); await runMenuCommand('pause');
	rewind.seekTo(history.earliestCycles); await settle(); recorded('sequence');
	rewind.seekTo(history.latestCycles); await settle(); recorded('sequence');
	check(getTextFileRuntimeSourceStatus(ide.sources, model) === 'applied', 'preload: rewind retains the installed source revision');
	console.info('STUDIO: preloaded BT compilation, late instance inspection, init, source Hot Resume, Reboot and rewind PASS');
	return { hostFrames: test.observations.hostFrames, hotResumeInstalls: 1 };
}
