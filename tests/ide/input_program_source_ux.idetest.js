// A shipped input factory follows its exported member to the canonical provider.
// Run: npm run ide:test -- starcatch tests/ide/input_program_source_ux.idetest.js
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true }))); await t.frames(2);
	t.controlInput(codes.slice().reverse().map(code => ({ type: 'key', code, down: false }))); await t.frames(2);
};
const capture = async label => { await t.frames(2); t.log(`VISUAL ${label}`); t.capture(label); };
const accept = async command => {
	const menu = t.contextMenu();
	t.assert(menu.visible && menu.model.rows.some(row => row.command === command && row.enabled), 'the actual property menu must admit its requested action');
	await press('Home');
	for (let step = 0; step < menu.model.rows.length && menu.model.rows[menu.model.selectedIndex]?.command !== command; step++) await press('ArrowDown');
	t.assert(menu.model.rows[menu.model.selectedIndex]?.command === command, 'ordinary menu navigation must address the selected property');
	await press('Enter'); await t.frames(3);
};
await t.waitForCart(); await t.frames(90); t.openLuaSource('entry.lua'); await t.frames(3);
t.command('inputBindings'); await t.frames(2); await press('Enter'); await t.frames(3);
const input = t.activeWorkbenchTab();
t.assert(input.kind === 'lua_program' && input.programKind === 'input', 'the shipped input producer must open through its ordinary picker');
const provider = [...input.sourceModels.values()].find(model => model.resource.path === 'actions.lua');
t.assert(provider !== undefined && provider !== input.workingCopy, 'member projection must retain the canonical provider separately from the factory consumer');
const source = provider.buffer.getText(), consumer = input.workingCopy, consumerSource = consumer.buffer.getText(), consumerVersion = consumer.version;
const cycles = t.runtime().machine.scheduler.nowCycles, key = '["bindings",1,"on","hold"]';
for (const font of ['tiny', 'msx']) {
	for (const theme of ['light', 'dark']) {
		const tree = input.tree, index = tree.rows.findIndex(row => row.element.key === key);
		t.assert(index >= 0 && input.sourceModels.get(tree.rows[index].element.file.file) === provider,
			'the actual exported binding must name its provider occurrence, not an unresolved placeholder');
		const x = tree.layout.contentLeft + tree.layout.twistieWidth + 4, y = tree.layout.contentTop + tree.layout.rowHeight / 2;
		t.controlInput([{ type: 'pointer', x, y }, { type: 'button', button: 'primary', down: true }]); await t.frames(1);
		t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(2);
		await press('Home');
		for (let row = 0; row < index; row++) await press('ArrowDown');
		t.assert(tree.rows[tree.selectionIndex].element.key === key, 'ordinary property navigation must retain the exported binding');
		await capture(`input-provider-${font}-${theme}`);
		await press('ContextMenu'); await accept('luaProgram.edit');
		await press('ControlLeft', 'KeyA');
		for (const code of ['Quote', 'KeyB', 'BracketLeft', 'KeyP', 'BracketRight', 'Quote']) await press(code);
		await press('Enter'); await t.frames(3);
		// Exact canonical source is the data-integrity contract, not incidental UI wording.
		t.assert(provider.buffer.getText() === source.replace("'touch[p] || a[p]'", "'b[p]'"), 'editing the binding must change only its original provider expression');
		t.assert(provider.dirty && input.isDirty(), 'the composite program must retain the changed provider working copy');
		t.assert(consumer.buffer.getText() === consumerSource && consumer.version === consumerVersion && !consumer.dirty,
			'provider editing must not rewrite the factory or its imported-member expression');
		await capture(`input-provider-${font}-${theme}-edited`);
		await press('ControlLeft', 'KeyZ'); await t.frames(3);
		t.assert(provider.buffer.getText() === source && !provider.dirty && !input.isDirty(), 'ordinary program Undo must restore the exact provider without changing its consumer');
		t.assert(t.runtime().machine.scheduler.nowCycles === cycles, 'source-backed input authoring executed the paused guest');
		t.command('theme-toggle'); await t.frames(2);
	}
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
for (let index = 0; index < t.logMessageCount(); index++)
	t.assert(t.logMessage(index).level !== 3, `Input provider workflow logged an error: ${t.logMessage(index).message}`);
