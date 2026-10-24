// Actual list-focused Ctrl+F reuses existing contribution filters, not source Find.
// Run: npm run ide:test -- nemesis_s tests/ide/list_find_ux.idetest.js --ttl 120
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true }))); await t.frames(2);
	t.controlInput(codes.slice().reverse().map(code => ({ type: 'key', code, down: false }))); await t.frames(2);
};
const type = async text => { for (const letter of text) await press(letter === ' ' ? 'Space' : `Key${letter.toUpperCase()}`); };
const click = async bounds => {
	t.controlInput([{ type: 'pointer', x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 },
		{ type: 'button', button: 'primary', down: true }]); await t.frames(1);
	t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(2);
};
let captures = 0;
const capture = async label => {
	t.assert(++captures <= 29, 'list Find exceeded its bounded capture budget');
	t.controlInput([{ type: 'pointer', x: 382, y: 285 }]); await t.frames(2);
	t.log(`VISUAL ${label}`); t.capture(label);
};
await t.waitForCart(); await t.frames(90); t.openLuaSource('cart.lua'); await t.frames(2);
const code = t.activeWorkbenchTab(), sourceModel = code.workingCopy, source = sourceModel.buffer.getText(), sourceVersion = sourceModel.version;
t.command('gpuDebugger'); await t.frames(2); const gpu = t.activeWorkbenchTab();
t.assert(gpu.kind === 'gpu_debugger', 'the actual GPU contribution did not open');
for (let step = 0; step < 4; step++) { t.command('stepFrame'); await t.frames(8); }
t.assert(gpu.history.count > 1 && gpu.projection.rows.length > 1, 'the real cartridge did not emit a selectable GPU history');
const cycles = t.runtime().machine.scheduler.nowCycles, media = t.sourceState().currentBlua32Media;
const unchanged = () => {
	t.assert(sourceModel.buffer.getText() === source && sourceModel.version === sourceVersion && !sourceModel.dirty, 'list Find mutated canonical Lua source');
	t.assert(t.runtime().machine.scheduler.nowCycles === cycles && t.sourceState().currentBlua32Media === media, 'list Find executed or replaced the paused program');
};
const modalHistory = async (name, input, viewport) => {
	const first = input.history.firstSequence, end = input.history.endSequence, generation = input.history.generation, revision = input.history.revision;
	const firstRecord = end > first ? JSON.stringify(input.history.at(first)) : undefined;
	const facts = () => {
		t.assert(input.history.firstSequence === first && input.history.endSequence === end && input.history.generation === generation && input.history.revision === revision,
			`${name}: filtering changed actual history retention or generation`);
		if (firstRecord !== undefined) t.assert(JSON.stringify(input.history.at(first)) === firstRecord, `${name}: filtering rewrote the captured event or operation`);
		unchanged();
	};
	for (const font of ['tiny', 'msx']) {
		t.assert(input.layout.font.variant === font, `${name}: the actual list font does not match its declared matrix phase`);
		for (const theme of ['light', 'dark']) {
			await click({ left: viewport.bounds.left, right: viewport.bounds.right, top: viewport.bounds.top, bottom: viewport.bounds.top + input.layout.rowHeight });
			await press('End'); await press('ControlLeft', 'KeyF'); await capture(`${name}-find-${font}-${theme}-query`);
			await press('ControlLeft', 'KeyA'); await type('zzzz'); await press('Enter');
			t.log(`LIST_FIND ${name}/${font}/${theme} ${JSON.stringify({ filter: input.filter, rows: input.projection.rows.length })}`);
			t.assert(input.filter === 'zzzz' && input.projection.rows.length === 0, `${name}: actual CtrlF did not open and accept its existing Filter query`);
			if (theme === 'light') await capture(`${name}-find-${font}-accepted`);
			await press('ControlLeft', 'KeyF'); await press('ArrowRight'); await press('KeyX'); await press('Escape');
			t.assert(input.filter === 'zzzz', `${name}: cancelled query edits escaped into the committed filter`);
			await press('ControlLeft', 'KeyF'); await press('ArrowRight'); await press('KeyX'); await press('Enter');
			t.assert(input.filter === 'zzzzx', `${name}: reopening Filter lost its previous committed query`);
			await press('ControlLeft', 'KeyF'); await press('ControlLeft', 'KeyA'); await press('ControlLeft', 'KeyC');
			await press('Backspace'); await press('ControlLeft', 'KeyV'); await press('Enter');
			t.assert(input.filter === 'zzzzx', `${name}: the real query clipboard round-trip lost its complete text`);
			await press('ControlLeft', 'KeyF'); await press('ControlLeft', 'KeyA'); await press('Backspace'); await press('Enter');
			t.assert(input.filter === '', `${name}: clearing the actual query did not restore the unfiltered list`);
			await press('ShiftLeft', 'Tab'); t.assert(input.actions.hasFocus, `${name}: accepting Filter did not return to the actual list focus ring`);
			await press('ControlLeft', 'KeyF'); await press('Escape');
			t.assert(!input.actions.hasFocus, `${name}: a toolbar action alias borrowed the list's keyboard Find capability`);
			if (name === 'gpu' && font === 'tiny' && theme === 'light') {
				await press('ControlLeft', 'ShiftLeft', 'KeyP'); await type('list find'); await press('ControlLeft', 'Home'); await press('Enter');
				await capture('gpu-list-find-palette-existing-filter'); await press('ControlLeft', 'KeyA'); await type('zzzz'); await press('Enter');
				t.assert(input.filter === 'zzzz', 'the actual List: Find Palette command did not use the focused list capability');
				await press('ControlLeft', 'KeyF'); await press('ControlLeft', 'KeyA'); await press('Backspace'); await press('Enter');
				await press('ShiftLeft', 'Tab'); t.assert(input.actions.hasFocus, 'the real toolbar did not take keyboard focus');
				await press('ControlLeft', 'ShiftLeft', 'KeyP'); await type('list find'); await press('ControlLeft', 'Home'); await press('Enter');
				await type('leak'); await press('Enter'); t.assert(input.filter === '', 'the Palette exposed List: Find through a toolbar command-context alias');
				await press('Escape'); t.assert(input.actions.hasFocus, 'the negative Palette case did not return to its actual toolbar origin'); await press('Escape');
			}
			facts(); t.command('theme-toggle'); await t.frames(2);
		}
		await press('ControlLeft', 'ShiftLeft', 'KeyT');
	}
};
await modalHistory('gpu', gpu, gpu.list);
t.command('gteDebugger'); await t.frames(2); const gte = t.activeWorkbenchTab();
t.assert(gte.kind === 'gte_debugger' && gte.history.count === 0, 'the real 2D cartridge acquired fabricated GTE records');
await modalHistory('gte', gte, gte.list);
t.command('events'); await t.frames(2); const events = t.activeWorkbenchTab();
t.assert(events.kind === 'event_viewer' && events.history.count > 0, 'the actual event history did not open');
await modalHistory('events', events, events.viewport);
t.command('romInspector'); await t.frames(2); await press('ArrowDown'); await press('Enter'); await t.frames(3);
const rom = t.activeWorkbenchTab(); t.assert(rom.kind === 'rom_inspector' && rom.snapshot.domain === 0, 'the actual cartridge ROM catalog did not open');
const snapshot = rom.snapshot, sections = rom.model.inspection.sections, categories = rom.model.keyEntries;
for (const font of ['tiny', 'msx']) {
	t.assert(rom.layout.font.variant === font, 'the actual ROM catalog font does not match its declared matrix phase');
	for (const theme of ['light', 'dark']) {
		await click({ left: rom.list.bounds.left, right: rom.list.bounds.right, top: rom.list.bounds.top, bottom: rom.list.bounds.top + rom.layout.rowHeight });
		await press('ControlLeft', 'KeyF'); await capture(`rom-find-${font}-${theme}-field`);
		await press('ControlLeft', 'KeyA'); await type('zzzz');
		t.assert(rom.model.filter === 'zzzz' && rom.model.rows.length === 0, 'ROM CtrlF did not focus its actual live filter field');
		await press('Escape'); t.assert(rom.model.filter === 'zzzz', 'ROM Escape incorrectly reverted the existing live filter');
		if (theme === 'light') await capture(`rom-find-${font}-accepted`);
		await press('ControlLeft', 'KeyF'); await press('ArrowRight'); await press('KeyX'); await press('Enter');
		t.assert(rom.model.filter === 'zzzzx', 'ROM Find lost its retained live query when reopened');
		await press('ControlLeft', 'KeyF'); await press('ControlLeft', 'KeyA'); await press('ControlLeft', 'KeyC'); await press('Backspace');
		await press('ControlLeft', 'KeyV'); t.assert(rom.model.filter === 'zzzzx', 'the actual ROM filter clipboard route lost its query');
		await press('ControlLeft', 'KeyA'); await press('Backspace'); await press('Enter');
		t.assert(rom.model.filter === '' && rom.model.rows.length > 0, 'clearing ROM Find did not restore the real catalog');
		await press('Tab'); t.assert(rom.actions.hasFocus, 'ROM filter acceptance did not return to its actual list'); await press('Escape');
		t.assert(rom.snapshot === snapshot && rom.model.inspection.sections === sections && rom.model.keyEntries === categories, 'ROM Find changed the mounted snapshot or byte accounting');
		unchanged(); t.command('theme-toggle'); await t.frames(2);
	}
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
t.openLuaSource('cart.lua'); await t.frames(2);
for (const font of ['tiny', 'msx']) {
	await press('ControlLeft', 'Home'); await press('ControlLeft', 'KeyF'); await press('ControlLeft', 'KeyA'); await type('function'); await t.frames(6);
	await capture(`source-find-preserved-${font}`); await press('Enter'); await press('Escape');
	const view = code.context.view, anchor = view.selectionAnchor;
	t.assert(t.activeWorkbenchTab() === code && anchor !== null, 'source CtrlF was replaced by a generic list filter');
	const start = sourceModel.buffer.offsetAt(anchor.row, anchor.column), end = sourceModel.buffer.offsetAt(view.cursorRow, view.cursorColumn);
	t.assert(source.slice(Math.min(start, end), Math.max(start, end)) === 'function', 'source Find no longer selects its actual matched source range');
	unchanged(); await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
t.command('actorLab'); await t.frames(2); const actor = t.activeWorkbenchTab(); await press('Enter');
t.assert(actor.kind === 'actor_lab' && actor.actorPresent, 'the actual Actor Lab intro picker did not open');
for (const font of ['tiny', 'msx']) {
	t.assert(actor.layout.font.variant === font, 'the actual Actor Lab font does not match its declared matrix phase');
	const selected = actor.outline.rows[actor.outline.selectionIndex].element.node;
	await press('ControlLeft', 'KeyF'); await type('timelines'); await capture(`actor-find-preserved-${font}`); await press('Escape');
	t.assert(actor.outline.rows[actor.outline.selectionIndex].element.node === selected, 'cancelling Actor Find changed its real selected actor member');
	unchanged(); await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
unchanged(); t.assert(captures === 29, 'the declared list/source/actor Find matrix was incomplete');
for (let index = 0; index < t.logMessageCount(); index++)
	t.assert(t.logMessage(index).level !== 3, `List Find workflow logged an error: ${t.logMessage(index).message}`);
