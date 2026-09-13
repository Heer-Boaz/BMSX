import { RUNTIME_INSPECTION_CART_SOURCE } from '../../helpers/runtime_inspection_fixture';
import { actionPromptState } from '../../../ide/workbench/contrib/modal/action_prompt';
import { hoverState } from '../../../ide/editor/contrib/hover/state';
import { getTextFileRuntimeSourceStatus } from '../../../ide/workbench/services/working_copy/runtime_source_status';
import { runtimeLuaSourceRegistry } from '../../../ide/runtime/sources';
import { editorChromeState } from '../../../ide/workbench/ui/chrome_state';
import { check, type StudioFixture } from './studio_fixture';

/** Borrowed values are consumed by the existing hover, not a parallel test inspector. */
export async function runStudioRuntimeInspection(test: StudioFixture) {
	const { runtime, ide, tasks, harness, guest, press, until, frame, cycles, runMenuCommand, runPaletteCommand, rewind, history, settle } = test;
	await until(() => cycles() > runtime.timing.cpuHz * 13, 'inspection: normal boot');
	await press('ControlRight', 'ShiftRight');
	await runMenuCommand('pause');
	harness.openLuaSource('cart.lua');
	const model = harness.getActiveEditorDocument().model;
	const source = RUNTIME_INSPECTION_CART_SOURCE;
	model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: source }]);
	await runPaletteCommand('Run: Reboot');
	check(actionPromptState.prompt?.action === 'reboot', 'inspection: independent fixture uses actual Save/Reboot');
	await press('Enter');
	await until(() => tasks.ready && guest.global('inspection_init_count') === 1 && !runtime.completionCallPending(), 'inspection: actual registration and grants');
	await until(() => guest.global('inspection_effect') !== null, 'inspection: effect instance is granted');
	await press('ControlRight', 'ShiftRight');
	await runMenuCommand('pause');

	const inspect = (expression: string, expected: number | string) => {
		harness.openLuaSource(model.resource.path);
		const lines = model.buffer.getText().split('\n');
		const row = lines.findIndex(line => line.includes(expression));
		check(row >= 0, `inspection: authored expression ${expression}`);
		const column = lines[row].indexOf(expression) + expression.length - 1;
		const position = cycles(), version = model.version, heap = runtime.machine.cpu.luaHeap.usedBytes();
		const tooltip = harness.getHover(row, column)!;
		check(tooltip.contentLines.join('\n').includes(`${expression} = ${expected} (number)`)
			|| tooltip.contentLines.join('\n').includes(`${expression}: ${expected}`),
			`inspection: ${expression} expected ${expected}, got ${tooltip.contentLines.join('\n')}`);
		check(harness.getHover(row, column) === tooltip, 'inspection: repeated stationary hover retains its projection');
		check(model.version === version && cycles() === position && runtime.machine.cpu.luaHeap.usedBytes() === heap
			&& guest.global('inspection_callback_count') === 0, 'inspection: read does not mutate source, heap, clock or execute callbacks');
	};
	inspect('inspection_effect.definition.period_ms', 20);
	inspect('inspection_effect.cooldown_until_ms', 107);
	inspect('inspection_effect.active_count', 1);
	inspect('inspection_other.cooldown_until_ms', 207);
	check(guest.readStringMember(guest.global('inspection_effect'), 'definition')
		=== guest.readStringMember(guest.global('inspection_other'), 'definition'), 'inspection: two instances share the actual definition');

	const library = runtimeLuaSourceRegistry(ide.sources, 0)!.module2lua['cartlib/actioneffects/actioneffect_component'];
	const rebindLine = library.src.split('\n').findIndex(line => line.includes('effect.definition = definition')) + 1;
	harness.toggleLuaBreakpoint(library.source_path, rebindLine);
	const media = ide.sources.currentBlua32Media;
	await runPaletteCommand('Run: Hot Resume');
	await until(() => ide.debugger.stopped && ide.editor.isActive && guest.global('inspection_init_count') === 2, 'inspection: unchanged init stops inside first component rebind');
	check(ide.sources.currentBlua32Media === media, 'inspection: no-change init is not a new source installation');
	inspect('inspection_effect.definition.period_ms', 20);
	inspect('inspection_other.definition.period_ms', 20);
	await press('F5');
	await until(() => ide.debugger.stopped && ide.editor.isActive, 'inspection: second component rebind stops');
	inspect('inspection_effect.definition.period_ms', 30);
	inspect('inspection_other.definition.period_ms', 20);
	harness.toggleLuaBreakpoint(library.source_path, rebindLine);
	await press('F5');
	await until(() => !runtime.completionCallPending() && !ide.debugger.plans.controlActive, 'inspection: rebind completes');
	await press('ControlRight', 'ShiftRight');
	await runMenuCommand('pause');
	inspect('inspection_other.definition.period_ms', 30);
	inspect('inspection_effect.cooldown_until_ms', 107);

	const period = source.indexOf('* 10');
	model.pushEditOperations([{ offset: period + 2, deleteLength: 2, text: '12' }]);
	inspect('inspection_effect.definition.period_ms', 'unavailable: source differs from installed code');
	check(getTextFileRuntimeSourceStatus(ide.sources, model) === 'pending', 'inspection: authored expression is not installed definition state');
	model.undo();
	inspect('inspection_effect.definition.period_ms', 30);
	model.pushEditOperations([{ offset: model.buffer.length, deleteLength: 0, text: '\nlocal broken = )\n' }]);
	const beforeFailure = cycles();
	await runPaletteCommand('Run: Hot Resume');
	check(actionPromptState.prompt?.action === 'hot-resume', 'inspection: invalid source uses ordinary compilation gate');
	await press('Enter');
	await until(() => tasks.ready, 'inspection: compile rejection completes');
	check(cycles() === beforeFailure && guest.global('inspection_init_count') === 2 && ide.sources.currentBlua32Media === media,
		'inspection: failed compilation leaves the installed definition untouched');
	model.undo();
	inspect('inspection_effect.definition.period_ms', 30);

	model.pushEditOperations([{ offset: period + 2, deleteLength: 2, text: '12' }]);
	await runPaletteCommand('Run: Hot Resume');
	check(actionPromptState.prompt?.action === 'hot-resume', 'inspection: changed definition uses Save/Hot Resume');
	await press('Enter');
	await until(() => tasks.ready && guest.global('inspection_init_count') === 3 && !runtime.completionCallPending(),
		'inspection: changed source installs and rebinds both instances');
	check(ide.sources.currentBlua32Media !== media, 'inspection: source installation replaces the debug image');
	await press('ControlRight', 'ShiftRight');
	await runMenuCommand('pause');
	inspect('inspection_effect.definition.period_ms', 48);
	inspect('inspection_other.definition.period_ms', 48);
	inspect('inspection_effect.cooldown_until_ms', 107);
	inspect('inspection_effect.active_count', 1);

	await runMenuCommand('pause');
	await until(() => history.latestCycles > history.earliestCycles + runtime.timing.cpuHz * 2 && tasks.ready, 'inspection: continuous history contains multiple checkpoints');
	await press('ControlRight', 'ShiftRight');
	await runMenuCommand('pause');
	const latestTick = guest.global('inspection_tick') as number;
	inspect('inspection_tick', latestTick);
	rewind.seekTo(history.earliestCycles);
	await settle();
	check(hoverState.tooltip === null, 'inspection: restore ends the old hover lifetime');
	const restoredTick = guest.global('inspection_tick') as number;
	check(restoredTick < latestTick, 'inspection: rewind selected an older heap');
	inspect('inspection_tick', restoredTick);
	inspect('inspection_effect.definition.period_ms', 48);
	check(guest.global('inspection_callback_count') === 0, 'inspection: readback never invoked a callback');
	await frame();
	console.info('STUDIO: actual ActionEffect definition/instance, rebind stops, no-change init, source divergence, compile failure and rewind inspection PASS');
	return { hostFrames: test.observations.hostFrames, initCount: 3, restoredTick, latestTick,
		renderProof: { ...ide.overlayRenderer.viewportSize, topBarBottom: editorChromeState.topBarBounds.bottom } };
}
