// Regression: real Starcatch Progress tab context menus preserve one editor per group.
// Run: npm run ide:test -- starcatch tests/ide/progress_window_return.idetest.js
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true }))); await t.frames(2);
	t.controlInput(codes.slice().reverse().map(code => ({ type: 'key', code, down: false }))); await t.frames(2);
};
const type = async text => {
	for (const character of text) await press(character === ' ' ? 'Space' : `Key${character.toUpperCase()}`);
};
const secondary = async (x, y) => {
	t.controlInput([{ type: 'pointer', x, y }, { type: 'button', button: 'secondary', down: true }]); await t.frames(2);
	t.controlInput([{ type: 'button', button: 'secondary', down: false }]); await t.frames(2);
};
const accept = async command => {
	const menu = t.contextMenu();
	t.assert(menu.visible && menu.model.rows.some(row => row.command === command && row.enabled),
		'the actual context menu must admit the requested operation');
	await press('Home');
	for (let step = 0; step < menu.model.rows.length && menu.model.rows[menu.model.selectedIndex]?.command !== command; step++) await press('ArrowDown');
	t.assert(menu.model.rows[menu.model.selectedIndex]?.command === command, 'ordinary menu navigation must reach its admitted action');
	await press('Enter'); await t.frames(3);
};
const tabContext = async input => {
	const items = t.activeEditorGroup().tabStrip.layoutState.items;
	let tab;
	for (let index = 0; index < items.length; index++) if (items.peek(index).input === input) tab = items.peek(index);
	t.assert(tab !== undefined, 'the retained editor must have a real visible tab');
	await secondary(tab.bounds.left + 4, (tab.bounds.top + tab.bounds.bottom) / 2);
};
await t.waitForCart(); await t.frames(90); t.openLuaSource('entry.lua'); await t.frames(3);
t.command('progression'); await t.frames(2); await press('Enter'); await t.frames(3);
const original = t.activeWorkbenchTab(), main = t.activeEditorGroup();
t.assert(original.kind === 'lua_program' && original.programKind === 'progression', 'the shipped Progress producer must open');
// A distinct shipped producer remains a separate editor. Same-file occurrence negatives live at the matching owner.
t.command('inputBindings'); await t.frames(2); await press('Enter'); await t.frames(3);
const other = t.activeWorkbenchTab();
t.assert(other.kind === 'lua_program' && other.programKind === 'input' && other !== original,
	'a different authored producer must remain independently retained');
t.command('progression'); await t.frames(2); await press('Enter'); await t.frames(3);
t.assert(t.activeWorkbenchTab() === original, 'ordinary opening must reuse the original Progress editor');
const documents = [original.workingCopy, other.workingCopy].map(model => ({ model, source: model.buffer.getText(), version: model.version, history: model.history }));
const cycles = t.runtime().machine.scheduler.nowCycles;
for (const mode of ['editor', 'group', 'drag']) {
	const count = t.workbenchTabs().length;
	const order = [...main.model.tabs];
	await tabContext(original); await accept('window.copyEditor');
	const copy = t.activeWorkbenchTab(), floating = t.activeEditorGroup();
	t.assert(copy.kind === 'lua_program' && copy !== original && copy.id !== original.id && copy.workingCopy === original.workingCopy,
		'New Window must retain an independent view over the same canonical editor');
	t.assert(copy.programKind === original.programKind && copy.occurrenceRange.start === original.occurrenceRange.start
		&& copy.occurrenceRange.end === original.occurrenceRange.end, 'the copied view must name the same authored producer');
	if (mode === 'drag') {
		const tabs = floating.tabStrip.layoutState.items;
		let tab;
		for (let index = 0; index < tabs.length; index++) if (tabs.peek(index).input === copy) tab = tabs.peek(index);
		t.assert(tab !== undefined, 'the copied view must expose its actual source tab');
		t.controlInput([{ type: 'pointer', x: tab.bounds.left + 3, y: (tab.bounds.top + tab.bounds.bottom) / 2 },
			{ type: 'button', button: 'primary', down: true }]); await t.frames(1);
		const target = main.tabStrip.layoutState.viewportBounds;
		t.controlInput([{ type: 'pointer', x: target.left + 1, y: (target.top + target.bottom) / 2 }]); await t.frames(3);
		t.log('VISUAL progress-copy-semantic-tab-target'); t.capture('progress-copy-semantic-tab-target');
		t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(4);
	} else if (mode === 'editor') { await tabContext(copy); await accept('window.moveEditor'); }
	else {
		const layout = floating.tabStrip.layoutState, last = layout.items.peek(layout.items.length - 1);
		const start = Math.max(last.bounds.right, layout.viewportBounds.left);
		t.assert(start < layout.viewportBounds.right, 'the actual group strip must expose an unoccupied context target');
		await secondary((start + layout.viewportBounds.right) / 2, (layout.viewportBounds.top + layout.viewportBounds.bottom) / 2);
		await accept('group.move');
	}
	// This is user-entered picker text, not an assertion freezing presentation wording.
	if (mode !== 'drag') {
		await type(mode === 'editor' ? 'main workspace' : 'merge main workspace'); await press('Enter'); await t.frames(4);
	}
	const tabs = t.workbenchTabs();
	t.assert(t.activeEditorGroup() === main && t.activeWorkbenchTab() === original && tabs.length === count
		&& tabs.includes(original) && !tabs.includes(copy) && tabs.includes(other),
		'merging a copied Progress view must retain its existing editor without duplicating or losing another producer');
	t.assert(tabs.filter(input => input.kind === 'lua_program' && input.programKind === original.programKind
		&& input.workingCopy === original.workingCopy && input.occurrenceRange.start === original.occurrenceRange.start
		&& input.occurrenceRange.end === original.occurrenceRange.end).length === 1, 'one group must retain one editor for this producer occurrence');
	t.assert(mode !== 'group' || floating.surface.retired, 'whole-group merge must retire the departed floating owner');
	if (mode === 'drag') t.assert(order.every((input, index) => main.model.tabs[index] === input),
		'dropping a copied view on its semantic receiver must preserve the existing tab order, not insert at the pointer gap');
	for (const document of documents) t.assert(document.model.buffer.getText() === document.source
		&& document.model.version === document.version && document.model.history === document.history && !document.model.dirty,
		'presentation must preserve exact source bytes, document generation, history and clean state');
	t.assert(t.runtime().machine.scheduler.nowCycles === cycles, 'presentation must not execute the paused guest');
	t.log(`PROGRESS-WINDOW-RETURN:${mode}:PASS`);
}

// Move is the same retained-input operation when a context-menu destination creates a split.
for (const font of ['tiny', 'msx']) {
	for (const theme of ['light', 'dark']) {
		const direction = font === 'tiny' ? 'right' : 'down', count = t.workbenchTabs().length;
		await tabContext(original); await accept('window.moveEditor');
		await type(`${direction} main workspace`);
		t.log(`VISUAL progress-move-split-${font}-${theme}-destination`); t.capture(`progress-move-split-${font}-${theme}-destination`);
		await press('Enter'); await t.frames(4);
		const receiver = t.activeEditorGroup();
		t.assert(receiver !== main && receiver.model.activeTab === original && t.activeWorkbenchTab() === original,
			'the context-menu split must transfer the exact retained Progress input rather than copy or reopen it');
		t.assert(!main.model.tabs.includes(original) && main.model.tabs.includes(other)
			&& main.model.tabs.length + receiver.model.tabs.length === count,
			'splitting must preserve the other producer and transfer rather than duplicate the moved editor');
		t.log(`VISUAL progress-move-split-${font}-${theme}-result`); t.capture(`progress-move-split-${font}-${theme}-result`);
		await tabContext(original); await accept('window.moveEditor');
		await type('main workspace group '); await press('Digit1'); await press('Enter'); await t.frames(4);
		t.assert(t.activeEditorGroup() === main && t.activeWorkbenchTab() === original && t.workbenchTabs().length === count,
			'returning from a split must restore the same input to its original group without a duplicate');
		for (const document of documents) t.assert(document.model.buffer.getText() === document.source
			&& document.model.version === document.version && document.model.history === document.history && !document.model.dirty,
			'context-menu split/return changed canonical source, history or clean state');
		t.assert(t.runtime().machine.scheduler.nowCycles === cycles, 'context-menu split/return executed the paused guest');
		t.command('theme-toggle'); await t.frames(2);
	}
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
