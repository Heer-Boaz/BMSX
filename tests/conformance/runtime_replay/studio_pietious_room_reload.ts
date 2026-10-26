import type { Value } from '../../../machine/ts/machine/cpu/value';
import { editorFeedbackState } from '../../../ide/common/feedback_state';
import { editorChromeState } from '../../../ide/workbench/ui/chrome_state';
import { typeSourceText } from './studio_scene_authoring';
import { check, type StudioFixture } from './studio_fixture';

/** Recreate the currently loaded YAML-derived room through the Actor Lab method UI.
 * This proves runtime lifetime, not YAML editing or asset application.
 * No source replacement, injected Lua or direct guest mutation. */
export async function testPietiousRoomReload(test: StudioFixture, castle: () => Value, member: (key: string) => Value) {
	const { guest, press, until, ide } = test;
	await press('ControlRight', 'ShiftRight');
	await test.runMenuCommand('pause');
	const originalRoom = guest.readStringMember(castle(), 'room');
	const originalLevel = guest.readStringMember(castle(), 'level');
	const originalRockX = guest.readStringMember(member('rock_002_01'), 'x');
	const session = guest.readStringMember(castle(), 'session');
	const player = guest.readStringMember(castle(), 'player');
	const status = guest.readStringMember(player, 'status');
	const health = guest.readStringMember(status, 'health');
	const x = guest.readStringMember(player, 'x'), y = guest.readStringMember(player, 'y');
	const enemy = member('enemy_002_01');
	await test.click(editorChromeState.menuEntryBounds.view);
	const item = test.ide.editor.contextMenu.model.rows.find(row => row.command === 'actorLab')!;
	await test.clickContextCommand(item.command!);
	const picker = ide.editor.quickInput;
	check(picker.visible, 'Actor Lab offers the actual running instances');
	await typeSourceText(test, 'd');
	const index = picker.model.list.rows.findIndex(row => row.item.label === 'd');
	check(index >= 0, 'director is visible by its real runtime id');
	for (let i = 0; i < index; i++) await press('ArrowDown');
	await press('Enter');
	const lab = ide.editor.editorGroup.model.activeTab;
	if (lab.kind !== 'actor_lab') throw new Error('Actor Lab did not open');
	await until(() => lab.outline.rows.length > 0 && lab.outline.rows[0].element.node.label === 'd', 'inspect the actual director');
	const reload = async () => {
		const previous = ide.actorExecution.lastResult;
		await test.runPaletteCommand('Actor Lab: Call Lua Method');
		check(picker.visible, `call picker opens: visible=${picker.visible} title=${picker.title} ready=${test.tasks.ready} dirty=${lab.dirty} status=${lab.status}`);
		await typeSourceText(test, 'reload_room');
		check(picker.visible && picker.model.list.rows[0]?.item.label === 'reload_room',
			`method discovery finds the cart-owned room operation: visible=${picker.visible} title=${picker.title} query=${picker.field.text} ready=${test.tasks.ready}`);
		await press('Enter');
		await press('Enter');
		await until(() => {
			check(!editorFeedbackState.message.text.startsWith('Actor operation failed:'), editorFeedbackState.message.text);
			return ide.actorExecution.active === undefined && ide.actorExecution.lastResult !== previous;
		},
			'room reload settles its guest call, GPU work and recording checkpoint');
		check(ide.actorExecution.lastResult!.result!.status === 'completed', 'the actual Actor operation completed');
	};
	await reload();
	const rebuiltRoom = guest.readStringMember(castle(), 'room');
	check(rebuiltRoom !== originalRoom && guest.readStringMember(originalRoom, 'world') === null
		&& guest.readStringMember(guest.readStringMember(originalRoom, 'scene'), 'closed') === true,
		'room recreation tears down the outgoing scene');
	check(guest.readStringMember(castle(), 'level') === originalLevel && guest.readStringMember(member('rock_002_01'), 'x') === originalRockX,
		'explicit reload reuses the loaded level and its unchanged YAML placement');
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
	check(lab.running && !test.execution.userPaused, 'Run Resume resumes the live Actor Lab preview');
	await press('ControlRight', 'ShiftRight');
	check(!ide.editor.isActive, 'the ordinary Studio toggle returns to the running game');
	console.info('STUDIO: Pietious Actor Lab room recreation from loaded YAML and retained session PASS');
}
