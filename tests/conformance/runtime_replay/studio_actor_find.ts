import { hidKeyUsageForCode } from '../../../hosts/common/input/hid_keys';
import { IO_INP_KEYS } from '../../../machine/ts/spec/bmsx/io';
import { IO_WORD_SIZE } from '../../../machine/ts/spec/bmsx/memory_map';
import { inputFocus } from '../../../ide/input/focus';
import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import type { ActorLabEditorPane } from '../../../ide/workbench/contrib/actor_lab/editor_pane';
import type { ActorMemberChoice } from '../../../ide/workbench/contrib/actor_lab/member_choices';
import { ACTOR_TOOLS_SOURCE } from '../../helpers/actor_tools_fixture';
import { check, type StudioFixture } from './studio_fixture';

/** Authored source setup, then real menu/keyboard navigation; invalidation uses physical frame history. */
export async function runStudioActorFind(test: StudioFixture) {
	const { runtime, ide, harness, guest, frame, until, press, click, cycles, runPaletteCommand } = test;
	await until(() => cycles() > runtime.timing.cpuHz * 13, 'actor find: boot authoring');
	await press('ControlRight', 'ShiftRight');
	harness.openLuaSource('cart.lua');
	const source = harness.getActiveEditorDocument().model;
	source.pushEditOperations([{ offset: 0, deleteLength: source.buffer.length, text: ACTOR_TOOLS_SOURCE
		.replace("local display<const>", "local gpu<const> = require('cartlib/gx/gpu')\nlocal display<const>")
		.replace('systems = {}', "systems = { require('cartlib/input/input_system') }")
		.replace("fsm_component.factory({ 'walker' })", "fsm_component.factory({ 'walker', 'walker' })")
		.replace('} }, parked = {},', '} }, parked = { initial = \'wait\', states = { wait = {} } },')
		.replaceAll("'motion'", "'wait'")
		.replace('\tworld:render()', '\tworld:render()\n\tgpu.fill_rect_color(16, 16, 80, 80, 0xff26a3bb)\n\tgpu.fill_rect_color(112, 64, 208, 160, 0xffbd7841)') }]);
	await runPaletteCommand('Run: Reboot'); await press('Enter');
	await until(() => guest.global('actor_tool_ready') === true && test.tasks.ready, 'actor find: real World constructs duplicate machine instances');
	const ready = runtime.frameScheduler.lastTickSequence;
	await until(() => runtime.frameScheduler.lastTickSequence >= ready + 4 && test.tasks.ready, 'actor find: retain physical frame history');
	await press('ControlRight', 'ShiftRight');
	await test.runMenuCommand('pause');
	await runPaletteCommand('Run: Next Frame');
	await until(() => ide.frameNavigation.active === undefined, 'actor find: baseline frame boundary settles');
	await runPaletteCommand('Actor Lab: Open'); await press('Enter'); await frame();
	const lab = getActiveTab();
	if (lab.kind !== 'actor_lab') throw new Error('Actor Lab required');
	const pane = ide.editor.editorPanes.activePane as ActorLabEditorPane, inspector = pane.inspector;
	const outline = lab.outline, picker = ide.editor.quickInput;
	const nests = outline.rows.filter(row => row.element.node.kind === 'state' && row.element.node.name === 'nest');
	check(nests.length === 2, 'real cartlib exposes two distinct instances of the same machine definition');
	const collapsed = nests[1], target = collapsed.children.find(row => row.element.node.name === 'wait')!;
	const targetHash = target.element.node.hashId;
	await press('Home');
	for (let index = 0; index < outline.rows.indexOf(collapsed); index++) await press('ArrowDown');
	await press('ArrowLeft'); await press('Home');
	await runPaletteCommand('Actor Lab: Toggle Follow Active Behavior');
	await runPaletteCommand('Actor Lab: Inspect Instance'); await press('End');
	check(collapsed.collapsed && !outline.rows.includes(target) && lab.follow.target !== undefined,
		'follow leaves the inactive nested target collapsed and absent from visible rows');
	const before = { selection: outline.rows[outline.selectionIndex], path: JSON.stringify(lab.selectionPath),
		follow: lab.follow.target, scroll: outline.scroll, property: inspector.model.rows[inspector.model.selectionIndex].element,
		detailsScroll: inspector.model.viewport.scrollTop, details: lab.details, cycles: cycles(),
		heap: runtime.machine.cpu.luaHeap.usedBytes(), callbacks: guest.global('actor_tool_callbacks') };
	await test.capture?.('before-find');
	await click(lab.actionBar.items.find(item => item.command === 'actorLab.more')!.bounds);
	check(ide.editor.contextMenu.visible && ide.editor.contextMenu.model.rows.some(row => row.command === 'actorLab.find' && row.enabled),
		'Find in Actor is reachable in the ordinary More menu');
	await test.capture?.('find-menu');
	await test.clickContextCommand('actorLab.find');
	check(picker.visible && picker.model.list.rows.some(row => (row.item as ActorMemberChoice).node === target.element.node), 'menu opens the existing transient QuickPick');
	await test.clipboard.writeText('wait'); await press('ControlLeft', 'KeyV');
	const duplicates = picker.model.list.rows.map(row => row.item as ActorMemberChoice);
	check(duplicates.length === 5 && duplicates.every(item => item.label === 'wait'),
		'collapsed descendants and same-label timeline/state instances all participate in Find');
	check(new Set(duplicates.map(item => `${item.description}\n${item.detail}`)).size === duplicates.length
		&& duplicates.some(item => item.node.kind === 'timeline') && duplicates.some(item => item.node.kind === 'state')
		&& duplicates.some(item => item.detail.includes('nest')) && duplicates.some(item => item.detail.includes('parked')),
		'visible descriptions distinguish kind, ancestry and equal-path runtime instances');
	await test.capture?.('duplicate-results');
	await press('ArrowDown'); await press('Escape');
	check(!picker.visible && outline.rows[outline.selectionIndex] === before.selection && JSON.stringify(lab.selectionPath) === before.path
		&& lab.follow.target === before.follow && outline.scroll === before.scroll && collapsed.collapsed
		&& inspector.visible && lab.details === before.details && inspector.model.rows[inspector.model.selectionIndex].element === before.property
		&& inspector.model.viewport.scrollTop === before.detailsScroll,
		'opening, filtering, highlighting and canceling change neither actor selection, follow, scroll nor Details');
	await test.capture?.('find-cancelled');

	check(lab.follow.target !== undefined, 'follow remains active before explicit search navigation');
	await press('ControlLeft', 'KeyF');
	check(picker.visible && picker.model.list.rows.some(row => (row.item as ActorMemberChoice).node === target.element.node), 'Ctrl+F in Actor Lab Details opens the same member catalog rather than source search');
	await test.clipboard.writeText('wAiT nEsT'); await press('ControlLeft', 'KeyV');
	check(picker.model.list.rows.length === 2, 'shared filtering matches mixed-case terms across label and ancestry');
	const targetIndex = picker.model.list.rows.findIndex(row => (row.item as ActorMemberChoice).node.hashId === targetHash);
	check(targetIndex >= 0, 'the catalog retains the exact hidden target');
	for (let index = 0; index < targetIndex; index++) await press('ArrowDown');
	await test.capture?.('exact-target-filtered');
	await press('Enter'); await frame();
	check(!picker.visible && outline.rows[outline.selectionIndex] === target && target.element.node.hashId === targetHash
		&& !collapsed.collapsed && lab.follow.target === undefined,
		'acceptance expands ancestry and selects the exact duplicate instance while stopping follow');
	check(outline.selectionIndex >= outline.scroll && outline.selectionIndex < outline.scroll + outline.layout.visibleRowCount
		&& inspector.visible && lab.details === before.details && pane.detailsWindow.visible && lab.detailsWindow.open
		&& lab.previewBounds.right > lab.previewBounds.left && lab.previewBounds.bottom > lab.previewBounds.top,
		'accepted target is visibly revealed while retained Details and the embedded game frame remain available');
	check(cycles() === before.cycles && runtime.machine.cpu.luaHeap.usedBytes() === before.heap && guest.global('actor_tool_callbacks') === before.callbacks,
		'Find performs no guest execution or guest allocation');
	await test.capture?.('exact-target-revealed');

	await runPaletteCommand('Actor Lab: Show Live FSM Graph');
	check(lab.presentation === 'graph' && inspector.visible, 'the live machine graph keeps Details and the game preview');
	await press('ControlLeft', 'KeyF');
	check(picker.visible, 'graph Ctrl+F opens the same member catalog');
	await test.clipboard.writeText('wait timeline'); await press('ControlLeft', 'KeyV');
	check(picker.model.list.rows.length === 1 && (picker.model.list.rows[0].item as ActorMemberChoice).node.kind === 'timeline',
		'graph search includes members outside the currently displayed machine');
	const timeline = (picker.model.list.rows[0].item as ActorMemberChoice).node;
	await press('Enter'); await frame();
	check(lab.presentation === 'outline' && outline.rows[outline.selectionIndex].element.node === timeline
		&& inputFocus.target === pane.runtimeControlContext && inspector.visible,
		'accepting from the graph restores outline presentation and focus at the exact member');
	await test.capture?.('graph-find-return');

	await test.runMenuCommand('pause');
	await click(test.visiblePreviewPoint(lab.previewBounds));
	const previewFocus = inputFocus.target;
	test.setKey('ControlLeft', true); test.setKey('KeyF', true);
	const usage = hidKeyUsageForCode('KeyF'), address = IO_INP_KEYS + (usage >>> 5) * IO_WORD_SIZE, mask = 1 << (usage & 31);
	await until(() => (runtime.machine.memory.readIoU32(address) & mask) !== 0, 'actor find: Ctrl+F reaches the preview guest ICU');
	check(!picker.visible && inputFocus.target === previewFocus && previewFocus?.guestInput?.bounds === lab.previewBounds
		&& ide.editor.guestInputRecipient !== null && inspector.visible,
		'local Find shortcut never steals ordinary game-preview input or closes Details');
	test.setKey('ControlLeft', false); test.setKey('KeyF', false); await frame();
	await press('ShiftLeft', 'F1');
	await press('ControlLeft', 'KeyF');
	check(picker.visible, 'Find can be reopened after returning from the game preview');
	await test.clipboard.writeText('wait nest'); await press('ControlLeft', 'KeyV');
	const historyPosition = cycles();
	// A host-triggered operation deliberately exercises the real history lifecycle while the popup owns keyboard focus.
	ide.frameNavigation.step(-1);
	await until(() => ide.frameNavigation.active === undefined && cycles() < historyPosition, 'actor find: physical history restore invalidates open picker');
	check(!picker.visible && picker.model.list.rows.length === 0 && inspector.visible && lab.historical,
		'physical runtime invalidation closes the stale catalog and releases its borrowed results');
	await test.capture?.('history-invalidated');
	await runPaletteCommand('Actor Lab: Find in Actor');
	await test.clipboard.writeText('wait nest'); await press('ControlLeft', 'KeyV');
	const restoredIndex = picker.model.list.rows.findIndex(row => (row.item as ActorMemberChoice).node.hashId === targetHash);
	check(restoredIndex >= 0, 'a new catalog resolves the restored guest instance rather than retaining the old picker');
	for (let index = 0; index < restoredIndex; index++) await press('ArrowDown');
	await press('Enter'); await frame();
	check(outline.rows[outline.selectionIndex].element.node.hashId === targetHash && inspector.visible,
		'Find accepts the exact current instance after a real history restore');
	await test.capture?.('history-target-revealed');
	return { find: 'pass', duplicateResults: duplicates.length, targetHash, historyPosition, restoredPosition: cycles() };
}
