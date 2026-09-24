import type { Value } from '../../../machine/ts/machine/cpu/value';
import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import { editorFeedbackState } from '../../../ide/common/feedback_state';
import { editorChromeState } from '../../../ide/workbench/ui/chrome_state';
import { TOP_BAR_MENUS, type TopBarMenuItem } from '../../../ide/workbench/ui/top_bar/menu';
import { openScene, editPosition, typeSourceText } from './studio_scene_authoring';
import { check, type StudioFixture } from './studio_fixture';

/** Real source properties, Hot Resume, then the ordinary Actor Lab method UI.
 * No source replacement, clipboard, injected Lua or direct guest mutation. */
export async function testPietiousRoomReload(test: StudioFixture, castle: () => Value, member: (key: string) => Value) {
	const { guest, press, until, ide, runtime } = test;
	await press('ControlRight', 'ShiftRight');
	await test.runMenuCommand('pause');
	const originalRoom = guest.readStringMember(castle(), 'room');
	const originalLevel = guest.readStringMember(castle(), 'level');
	const scene = await openScene(test, 'rooms/room_002', 5);
	await editPosition(test, scene, 3, 0, 120);
	await press('ControlLeft', 'ShiftLeft', 'KeyS');
	await until(() => test.tasks.ready && !runtime.completionCallPending() && !ide.debugger.plans.mutationActive
		&& !ide.editor.isActive, 'Hot Resume installs the edited scene registration');
	await press('ControlRight', 'ShiftRight');
	await test.runMenuCommand('pause');
	check(guest.readStringMember(castle(), 'level') === originalLevel
		&& guest.readStringMember(castle(), 'room') === originalRoom
		&& guest.readStringMember(member('rock_002_01'), 'x') === 112,
		'Hot Resume preserves a coherent live room until explicit recreation');
	const session = guest.readStringMember(castle(), 'session');
	const player = guest.readStringMember(castle(), 'player');
	const status = guest.readStringMember(player, 'status');
	const health = guest.readStringMember(status, 'health');
	const x = guest.readStringMember(player, 'x'), y = guest.readStringMember(player, 'y');
	const enemy = member('enemy_002_01');
	await test.click(editorChromeState.menuEntryBounds.view);
	const item = TOP_BAR_MENUS.view.items.find((entry): entry is TopBarMenuItem => entry.type === 'command' && entry.command === 'actorLab')!;
	await test.click(item.bounds);
	const picker = ide.editor.quickInput;
	check(picker.visible && picker.title === 'RUNNING ACTORS', 'Actor Lab offers the actual running instances');
	await typeSourceText(test, 'd');
	const index = picker.model.list.rows.findIndex(row => row.item.label === 'd');
	check(index >= 0, 'director is visible by its real runtime id');
	for (let i = 0; i < index; i++) await press('ArrowDown');
	await press('Enter');
	const lab = getActiveTab();
	if (lab.kind !== 'actor_lab') throw new Error('Actor Lab did not open');
	await until(() => lab.outline.rows.length > 0 && lab.outline.rows[0].element.node.label === 'd', 'inspect the actual director');
	const reload = async () => {
		await test.click(lab.actionBar.items.find(action => action.command === 'actorLab.call')!.bounds);
		check(picker.visible && picker.title === 'CALL / d', `call picker opens: visible=${picker.visible} title=${picker.title} ready=${test.tasks.ready} dirty=${lab.dirty} status=${lab.status}`);
		await typeSourceText(test, 'reload_room');
		check(picker.visible && picker.model.list.rows[0]?.item.label === 'reload_room',
			`method discovery finds the cart-owned room operation: visible=${picker.visible} title=${picker.title} query=${picker.field.text} ready=${test.tasks.ready}`);
		await press('Enter');
		check(picker.title === 'd:reload_room(...)', 'method arguments are shown by the real call dialog');
		await press('Enter');
		await until(() => {
			check(!editorFeedbackState.message.text.startsWith('Actor operation failed:'), editorFeedbackState.message.text);
			return test.tasks.ready && !runtime.completionCallPending() && !ide.debugger.plans.mutationActive;
		},
			'room reload completes through the scheduled guest call');
	};
	await reload();
	const rebuiltRoom = guest.readStringMember(castle(), 'room');
	check(rebuiltRoom !== originalRoom && guest.readStringMember(originalRoom, 'world') === null
		&& guest.readStringMember(guest.readStringMember(originalRoom, 'scene'), 'closed') === true,
		'room recreation tears down the outgoing scene');
	check(guest.readStringMember(castle(), 'level') !== originalLevel && guest.readStringMember(member('rock_002_01'), 'x') === 120,
		'explicit reload applies the current definition and edited placement');
	check(member('enemy_002_01') !== enemy && guest.readStringMember(enemy, 'world') === null,
		'transient enemies are recreated, not carried over');
	check(guest.readStringMember(castle(), 'session') === session && guest.readStringMember(castle(), 'player') === player
		&& guest.readStringMember(player, 'status') === status && guest.readStringMember(status, 'health') === health
		&& guest.readStringMember(player, 'x') === x && guest.readStringMember(player, 'y') === y,
		'reload retains the actual session, health and player pose');
	check(guest.readStringMember(player, 'room') === rebuiltRoom, 'travelling player binds to the reconstructed room');
	await reload();
	check(guest.readStringMember(rebuiltRoom, 'world') === null, 'a second UI reload also releases its previous room');
	await test.capture?.('reloaded-room');
	await test.runMenuCommand('pause');
	check(!ide.editor.isActive, 'Run Resume returns to the running game');
	console.info('STUDIO: Pietious source edit, Hot Resume, explicit room recreation and retained session PASS');
}
