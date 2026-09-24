import { RUNTIME_INSPECTION_CALLBACKS_SOURCE, RUNTIME_INSPECTION_CART_SOURCE } from '../../helpers/runtime_inspection_fixture';
import { RUNTIME_INSPECTION_TREES_SOURCE } from '../../helpers/runtime_inspection_bt_fixture';
import { actionPromptState } from '../../../ide/workbench/contrib/modal/action_prompt';
import { hoverState } from '../../../ide/editor/contrib/hover/state';
import { getTextFileRuntimeSourceStatus } from '../../../ide/workbench/services/working_copy/runtime_source_status';
import { runtimeLuaSourceRegistry } from '../../../ide/runtime/sources';
import { editorChromeState } from '../../../ide/workbench/ui/chrome_state';
import { check, codePositionBounds, createStudioLuaSource, type StudioFixture } from './studio_fixture';
import * as constants from '../../../ide/common/constants';
import { resolveThemeTokenColor } from '../../../ide/theme/tokens';
import { openRuntimeEffectInspector, openRuntimeEffectPicker, testRuntimeEffectSource } from './studio_actioneffect_runtime';
import { openRuntimeStateInspector, openRuntimeStatePicker, testRuntimeStateSource } from './studio_fsm_runtime';
import { openRegisteredDefinition, openRegisteredDefinitionPicker, testActorlessDefinitionCatalog, testEmptyDefinitionCatalog } from './studio_definition_catalog';
import { inspectRuntimeTreeBlackboard, openRuntimeTreeInspector, openRuntimeTreePicker, testRuntimeTreeSource } from './studio_bt_runtime';

/** Borrowed values are consumed by the existing hover, not a parallel test inspector. */
export async function runStudioRuntimeInspection(test: StudioFixture) {
	const { runtime, ide, tasks, harness, guest, press, until, frame, cycles, runMenuCommand, runPaletteCommand, rewind, history, settle } = test;
	await until(() => cycles() > runtime.timing.cpuHz * 13, 'inspection: normal boot');
	await press('ControlRight', 'ShiftRight');
	await runMenuCommand('pause');
	await createStudioLuaSource(test, 'inspection_callbacks.lua', RUNTIME_INSPECTION_CALLBACKS_SOURCE);
	const callbacks = harness.getActiveEditorDocument().model;
	const callbackLines = RUNTIME_INSPECTION_CALLBACKS_SOURCE.split('\n');
	const recursiveStop = callbackLines.findIndex(line => line.includes('return 0')) + 1;
	harness.toggleLuaBreakpoint(callbacks.resource.path, recursiveStop);
	await createStudioLuaSource(test, 'inspection_trees.lua', RUNTIME_INSPECTION_TREES_SOURCE);
	harness.openLuaSource('cart.lua');
	const model = harness.getActiveEditorDocument().model;
	const source = RUNTIME_INSPECTION_CART_SOURCE;
	model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: source }]);
	const beforeInstances = source.split('\n').findIndex(line => line.startsWith('inspection_first =')) + 1;
	const beforeRegistration = source.split('\n').findIndex(line => line === 'configure()') + 1;
	harness.toggleLuaBreakpoint(model.resource.path, beforeRegistration);
	harness.toggleLuaBreakpoint(model.resource.path, beforeInstances);
	await runPaletteCommand('Run: Reboot');
	check(actionPromptState.prompt?.request.action === 'reboot', 'inspection: independent fixture uses actual Save/Reboot');
	await press('Enter');
	await until(() => tasks.ready && ide.debugger.source.stop !== undefined && ide.editor.isActive, 'inspection: recursive callback stops before its inner return');
	check(harness.getActiveCodeContext()!.model === callbacks
		&& harness.getActiveCodeContext()!.executionStopRow === recursiveStop - 1, 'inspection: stop belongs to the imported recursive callback');
	const valueRow = callbackLines.findIndex(line => line.includes('return value + nested'));
	const valueColumn = callbackLines[valueRow].indexOf('value');
	const recursiveCycles = cycles(), recursiveVersion = callbacks.version, recursiveHeap = runtime.machine.cpu.luaHeap.usedBytes();
	check(harness.getHover(valueRow, valueColumn)!.contentLines.includes('value: unavailable in the suspended stack'),
		'inspection: a dead inner local must not display the outer invocation value 11');
	check(cycles() === recursiveCycles && callbacks.version === recursiveVersion && runtime.machine.cpu.luaHeap.usedBytes() === recursiveHeap,
		'inspection: recursive hover does not execute guest code or write source');
	harness.toggleLuaBreakpoint(callbacks.resource.path, recursiveStop);
	await press('F5');
	await until(() => tasks.ready && ide.debugger.source.stop !== undefined && ide.editor.isActive && guest.global('inspection_init_count') === 0,
		'inspection: initialized libraries before the first registration');
	await testEmptyDefinitionCatalog(test);
	await openRuntimeTreePicker(test, 0);
	await press('Escape');
	harness.toggleLuaBreakpoint(model.resource.path, beforeRegistration);
	await press('F5');
	await until(() => tasks.ready && ide.debugger.source.stop !== undefined && ide.editor.isActive && guest.global('inspection_init_count') === 1,
		'inspection: actual registrations before creating instances');
	await testActorlessDefinitionCatalog(test);
	await openRuntimeTreePicker(test, 0);
	await press('Escape');
	harness.toggleLuaBreakpoint(model.resource.path, beforeInstances);
	await press('F5');
	await until(() => guest.global('inspection_fsm_ready') === true, 'inspection: effect and FSM instances are attached');
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
	await testRuntimeEffectSource(test);
	await testRuntimeStateSource(test);
	await testRuntimeTreeSource(test);
	const initialInspector = await openRuntimeEffectInspector(test, 'second', 20);

	const library = runtimeLuaSourceRegistry(ide.sources, 0)!.module2lua['cartlib/actioneffects/actioneffect_component'];
	const rebindLine = library.src.split('\n').findIndex(line => line.includes('effect.definition = definition')) + 1;
	harness.toggleLuaBreakpoint(library.source_path, rebindLine);
	const fsmLibrary = runtimeLuaSourceRegistry(ide.sources, 0)!.module2lua['cartlib/fsm/fsm'];
	// The constructor uses the same assignment; select the one after the actual rebind owner.
	const fsmLines = fsmLibrary.src.split('\n');
	const fsmRebindStart = fsmLines.findIndex(line => line.startsWith('rebind_definition_tree = function'));
	const fsmRebindStop = fsmLines.findIndex((line, index) => index > fsmRebindStart && line.includes('self.frame_evaluator = definition.frame_evaluator')) + 1;
	check(fsmRebindStop > fsmRebindStart, 'inspection: actual FSM rebind assignment exists');
	harness.toggleLuaBreakpoint(fsmLibrary.source_path, fsmRebindStop);
	const btLibrary = runtimeLuaSourceRegistry(ide.sources, 0)!.module2lua['cartlib/behaviour_tree/bt_component'];
	const btRebindStop = btLibrary.src.split('\n').findIndex(line => line.includes('self.evaluate = program.evaluate')) + 1;
	harness.toggleLuaBreakpoint(btLibrary.source_path, btRebindStop);
	const media = ide.sources.currentBlua32Media;
	await runPaletteCommand('Run: Hot Resume');
	await until(() => ide.debugger.source.stop !== undefined && ide.editor.isActive && guest.global('inspection_init_count') === 2, 'inspection: unchanged init stops inside first component rebind');
	check(!initialInspector.visible, 'inspection: execution ends the previous instance inspection');
	check(ide.sources.currentBlua32Media === media, 'inspection: no-change init is not a new source installation');
	check(harness.getActiveCodeContext()!.model.resource.path === library.source_path
		&& harness.getActiveCodeContext()!.executionStopRow === rebindLine - 1,
		'inspection: debugger awaits source attachment before placing the stop marker, even when a lens was active');
	inspect('inspection_effect.definition.period_ms', 20);
	inspect('inspection_other.definition.period_ms', 20);
	const publishedEffect = await openRegisteredDefinition(test, 'effect', 'pulse');
	check(publishedEffect.model.rows.find(row => row.element.label === 'PERIOD')!.element.value === '30',
		'catalog: no-change init published 30 before either old instance has rebound');
	await openRuntimeEffectInspector(test, 'first', 20);
	await press('F5');
	await until(() => ide.debugger.source.stop !== undefined && ide.editor.isActive, 'inspection: second component rebind stops');
	inspect('inspection_effect.definition.period_ms', 30);
	inspect('inspection_other.definition.period_ms', 20);
	await openRuntimeEffectInspector(test, 'first', 30);
	await openRuntimeEffectInspector(test, 'second', 20);
	harness.toggleLuaBreakpoint(library.source_path, rebindLine);
	await press('F5');
	await until(() => ide.debugger.source.stop !== undefined && ide.editor.isActive, 'inspection: FSM rebind stops after the first root definition write');
	await openRuntimeStateInspector(test, 'first', 20, '');
	await openRuntimeStateInspector(test, 'first', 10);
	await openRuntimeStateInspector(test, 'second', 10);
	const publishedState = await openRegisteredDefinition(test, 'fsm', 'walker', 'walker:/nest');
	check(publishedState.model.rows.find(row => row.element.label === 'LOADED DEFAULTS')!.element.value === 'revision: 20',
		'catalog: published child differs from the old child still retained by both actors');
	harness.toggleLuaBreakpoint(fsmLibrary.source_path, fsmRebindStop);
	await press('F5');
	await until(() => ide.debugger.source.stop !== undefined && ide.editor.isActive, 'inspection: first BT blackboard rebound, second retains its old layout');
	await inspectRuntimeTreeBlackboard(test, 'first', 2);
	await inspectRuntimeTreeBlackboard(test, 'second', 1);
	harness.toggleLuaBreakpoint(btLibrary.source_path, btRebindStop);
	const blackboard = runtimeLuaSourceRegistry(ide.sources, 0)!.module2lua['cartlib/behaviour_tree/blackboard'];
	const layoutWrite = blackboard.src.split('\n').findIndex(line => line.includes('self._layout = layout')) + 1;
	const valuesWrite = blackboard.src.split('\n').findIndex(line => line.includes('self._values = values')) + 1;
	harness.toggleLuaBreakpoint(blackboard.source_path, layoutWrite);
	await press('F5');
	await until(() => ide.debugger.source.stop !== undefined && ide.editor.isActive, 'inspection: second BT before its layout publication');
	await inspectRuntimeTreeBlackboard(test, 'second', 1);
	await press('F5');
	await until(() => ide.debugger.source.stop !== undefined && ide.editor.isActive, 'inspection: first binding of a previously absent blackboard');
	const unbound = await openRuntimeTreeInspector(test, 'bare');
	check(unbound.model.rows.find(row => row.element.label === 'BLACKBOARD LAYOUT')!.element.value === 'nil'
		&& unbound.model.rows.find(row => row.element.label === 'BLACKBOARD STORAGE')!.element.value === 'nil',
		'runtime BT: a real mid-binding stop shows unbound storage, not fabricated values');
	harness.toggleLuaBreakpoint(blackboard.source_path, layoutWrite);
	harness.toggleLuaBreakpoint(blackboard.source_path, valuesWrite);
	await press('F5');
	await until(() => ide.debugger.source.stop !== undefined && ide.editor.isActive, 'inspection: blackboard layout exists before its values write');
	const partial = await openRuntimeTreeInspector(test, 'bare');
	check(partial.model.rows.find(row => row.element.label === 'BLACKBOARD LAYOUT')!.element.value.includes('bound_later')
		&& partial.model.rows.find(row => row.element.label === 'BLACKBOARD STORAGE')!.element.value === 'nil'
		&& !partial.model.rows.some(row => row.element.label === 'BLACKBOARD / bound_later'),
		'runtime BT: named initial values are not substituted for missing stored values');
	await test.capture?.('bt-binding');
	harness.toggleLuaBreakpoint(blackboard.source_path, valuesWrite);
	await press('F5');
	await until(() => !runtime.completionCallPending() && !ide.debugger.plans.controlActive, 'inspection: rebind completes');
	await press('ControlRight', 'ShiftRight');
	await runMenuCommand('pause');
	inspect('inspection_other.definition.period_ms', 30);
	inspect('inspection_effect.cooldown_until_ms', 107);
	await openRuntimeStateInspector(test, 'first', 20);
	await openRuntimeStateInspector(test, 'second', 20);
	await inspectRuntimeTreeBlackboard(test, 'second', 2);

	const period = source.indexOf('* 10');
	model.pushEditOperations([{ offset: period + 2, deleteLength: 2, text: '12' }]);
	inspect('inspection_effect.definition.period_ms', 'unavailable: source differs from installed code');
	check(getTextFileRuntimeSourceStatus(ide.sources, model) === 'pending', 'inspection: authored expression is not installed definition state');
	model.undo();
	inspect('inspection_effect.definition.period_ms', 30);
	model.pushEditOperations([{ offset: model.buffer.length, deleteLength: 0, text: '\nlocal broken = )\n' }]);
	const beforeFailure = cycles();
	await runPaletteCommand('Run: Hot Resume');
	check(actionPromptState.prompt?.request.action === 'hot-resume', 'inspection: invalid source uses ordinary compilation gate');
	await press('Enter');
	await until(() => tasks.ready, 'inspection: compile rejection completes');
	check(cycles() === beforeFailure && guest.global('inspection_init_count') === 2 && ide.sources.currentBlua32Media === media,
		'inspection: failed compilation leaves the installed definition untouched');
	model.undo();
	inspect('inspection_effect.definition.period_ms', 30);
	await openRuntimeEffectInspector(test, 'first', 30);
	await inspectRuntimeTreeBlackboard(test, 'first', 2);

	model.pushEditOperations([{ offset: period + 2, deleteLength: 2, text: '12' }]);
	await runPaletteCommand('Run: Hot Resume');
	check(actionPromptState.prompt?.request.action === 'hot-resume', 'inspection: changed definition uses Save/Hot Resume');
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
	await openRuntimeEffectInspector(test, 'first', 48);
	await openRuntimeStateInspector(test, 'first', 30);
	await inspectRuntimeTreeBlackboard(test, 'first', 3);
	const installedCatalog = await openRegisteredDefinition(test, 'effect', 'pulse');
	check(installedCatalog.model.rows.find(row => row.element.label === 'PERIOD')!.element.value === '48', 'catalog: new code installation reads its live registry capture');

	await runMenuCommand('pause');
	await until(() => history.latestCycles > history.earliestCycles + runtime.timing.cpuHz * 2 && tasks.ready, 'inspection: continuous history contains multiple checkpoints');
	await press('ControlRight', 'ShiftRight');
	await runMenuCommand('pause');
	const latestTick = guest.global('inspection_tick') as number;
	inspect('inspection_tick', latestTick);
	const rewindInspector = await openRuntimeEffectInspector(test, 'second', 48);
	rewind.seekTo(history.earliestCycles);
	await settle();
	check(!rewindInspector.visible, 'inspection: restore ends the previous instance projection');
	check(hoverState.tooltip === null, 'inspection: restore ends the old hover lifetime');
	const restoredTick = guest.global('inspection_tick') as number;
	check(restoredTick < latestTick, 'inspection: rewind selected an older heap');
	inspect('inspection_tick', restoredTick);
	inspect('inspection_effect.definition.period_ms', 48);
	check(guest.global('inspection_callback_count') === 0, 'inspection: readback never invoked a callback');
	await openRuntimeEffectInspector(test, 'first', 48);
	await openRuntimeEffectPicker(test);
	rewind.seekTo(history.latestCycles); await settle();
	check(!ide.editor.quickInput.visible, 'inspection: restore invalidates the borrowed instance choices');
	await openRuntimeStatePicker(test, 'first');
	rewind.seekTo(history.earliestCycles); await settle();
	check(!ide.editor.quickInput.visible, 'inspection: restore also invalidates the borrowed FSM state scope');
	const restoredFsm = await openRuntimeStateInspector(test, 'first', 30);
	rewind.seekTo(history.latestCycles); await settle();
	check(!restoredFsm.visible, 'inspection: restore invalidates the FSM property projection');
	await openRegisteredDefinitionPicker(test, 'fsm');
	rewind.seekTo(history.earliestCycles); await settle();
	check(!ide.editor.quickInput.visible, 'catalog: restore releases the borrowed registry choices');
	const restoredCatalog = await openRegisteredDefinition(test, 'effect', 'pulse');
	check(restoredCatalog.model.rows.find(row => row.element.label === 'PERIOD')!.element.value === '48', 'catalog: reselect reads the restored registry');
	rewind.seekTo(history.latestCycles); await settle();
	check(!restoredCatalog.visible, 'catalog: restore releases the retained property projection');
	const btBeforeRestore = await inspectRuntimeTreeBlackboard(test, 'first', 3);
	rewind.seekTo(history.earliestCycles); await settle();
	check(!btBeforeRestore.visible, 'runtime BT: restore releases the retained property projection');
	await inspectRuntimeTreeBlackboard(test, 'second', 3);
	await openRuntimeTreePicker(test);
	rewind.seekTo(history.latestCycles); await settle();
	check(!ide.editor.quickInput.visible, 'runtime BT: restore releases the borrowed component choices');
	inspect('inspection_effect.definition.period_ms', 48);
	await frame();
	const expression = 'inspection_effect.definition.period_ms';
	const lines = model.buffer.getText().split('\n');
	const row = lines.findIndex(line => line.includes(expression));
	const column = lines[row].indexOf(expression) + expression.length - 1;
	await ide.editor.navigation.focusChunkSource(model.resource, { row, startColumn: column, endColumn: column });
	await frame();
	const position = cycles(), version = model.version;
	for (const theme of ['dark', 'light']) {
		test.setKey('AltLeft', false);
		test.movePointer({ left: -10, top: -10, right: -10, bottom: -10 });
		await frame();
		await press('ControlLeft', 'AltLeft', 'KeyT');
		check(constants.getActiveIdeThemeVariant() === theme, 'inspection: real theme shortcut');
		test.setKey('AltLeft', true);
		test.movePointer(codePositionBounds(row, column));
		await until(() => hoverState.tooltip !== null && hoverState.tooltip.bubbleBounds !== null, 'inspection: physical Alt-hover paints the current runtime value');
		check(hoverState.tooltip!.contentLines.join('\n').includes(`${expression} = 48 (number)`), 'inspection: pointer reaches the same runtime reader');
	}
	check(cycles() === position && model.version === version && guest.global('inspection_callback_count') === 0,
		'inspection: theme and pointer do not mutate guest or source');
	console.info('STUDIO: actual ActionEffect/FSM/BT instances, retained definitions and blackboards, rebind/binding stops, imported callbacks, no-change init, source divergence, compile failure and rewind inspection PASS');
	return { hostFrames: test.observations.hostFrames, initCount: 3, restoredTick, latestTick,
		renderProof: { ...ide.overlayRenderer.viewportSize, topBarBottom: editorChromeState.topBarBounds.bottom,
			hover: { ...hoverState.tooltip!.bubbleBounds, text: resolveThemeTokenColor(constants.HOVER_TOOLTIP_TEXT),
				background: resolveThemeTokenColor(constants.HOVER_TOOLTIP_BACKGROUND) } } };
}
