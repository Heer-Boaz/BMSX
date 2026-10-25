// Canonical AEM edits belong to admitted controls, not merely an attached input.
// Run: npm run ide:test -- nemesis_s tests/ide/aem_admission.idetest.js
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true }))); await t.frames(2);
	t.controlInput(codes.slice().reverse().map(code => ({ type: 'key', code, down: false }))); await t.frames(2);
};
const pointer = async (x, y, down) => {
	t.controlInput([{ type: 'pointer', x, y }, { type: 'button', button: 'primary', down }]); await t.frames(2);
};
const drag = async (x, from, to) => {
	await pointer(x, from, true);
	t.controlInput([{ type: 'pointer', x, y: to }]); await t.frames(2);
	await pointer(x, to, false);
};
const capture = async label => { await t.frames(2); t.log(`VISUAL ${label}`); t.capture(label); };
await t.waitForCart(); await t.frames(90); t.openLuaSource('cart.lua'); await t.frames(3);
t.command('runtime.pause'); t.command('aem'); await t.frames(2); await press('Enter'); await t.frames(3);
const input = t.activeWorkbenchTab();
t.assert(input.kind === 'aem_editor', 'the actual canonical audio event map did not open');
const model = input.workingCopy, original = model.buffer.getText(), media = t.sourceState().currentBlua32Media;
const cycles = t.runtime().machine.scheduler.nowCycles;
const selectProperty = async () => {
	const tree = input.tree;
	const x = tree.layout.contentLeft + tree.layout.twistieWidth + 2;
	await pointer(x, tree.layout.contentTop + tree.layout.rowHeight / 2, true);
	await pointer(x, tree.layout.contentTop + tree.layout.rowHeight / 2, false);
	await press('Home');
	const target = tree.rows.findIndex(row => row.element.key === '["events","story","channel"]');
	t.assert(target >= 0, 'the authored audio channel fixture disappeared');
	for (let index = 0; index < target; index++) await press('ArrowDown');
	t.assert(tree.rows[tree.selectionIndex].element.key === '["events","story","channel"]', 'ordinary tree navigation selected another authored node');
};
const unchanged = (source, version, undo, redo) => {
	t.assert(t.activeWorkbenchTab() === input && input.workingCopy === model && model.buffer.getText() === source
		&& model.version === version && model.canUndo === undo && model.canRedo === redo,
		'a concealed AEM control changed canonical source, history or working-copy identity');
	t.assert(t.runtime().machine.scheduler.nowCycles === cycles && t.sourceState().currentBlua32Media === media,
		'authoring admission executed or replaced the paused program');
};
for (const font of ['tiny', 'msx']) {
	for (const theme of ['light', 'dark']) {
		await selectProperty(); await press('Enter'); await press('ControlLeft', 'KeyA');
		for (const code of ['KeyA', 'KeyU', 'KeyD', 'KeyI', 'KeyO', 'KeyF', 'KeyX']) await press(code);
		await press('Enter');
		const edited = model.buffer.getText(), version = model.version;
		t.assert(edited !== original && model.canUndo, 'the real property control did not create the undoable authored fixture');
		t.command('problems'); await t.frames(90);
		const divider = { x: input.layout.left + 12, visible: input.layout.bottom, hidden: input.layout.top - 1 };
		const selected = input.tree.rows[input.tree.selectionIndex];
		await drag(divider.x, divider.visible, divider.hidden);
		t.assert(input.tree.layout.visibleRowCount === 0, 'the actual Problems gesture did not withhold the AEM tree');
		await capture(`aem-${font}-${theme}-tree-concealed`);
		for (const codes of [['Delete'], ['ControlLeft', 'KeyZ'], ['ControlLeft', 'KeyX'], ['ControlLeft', 'KeyV']]) {
			await press(...codes); unchanged(edited, version, true, false);
		}
		await drag(divider.x, divider.hidden, divider.visible);
		await press('Delete'); unchanged(edited, version, true, false);
		t.assert(input.tree.rows[input.tree.selectionIndex] === selected, 'geometry recovery replaced the selected authored property');
		await capture(`aem-${font}-${theme}-tree-recovered`);
		await selectProperty(); await press('Tab'); await press('Home');
		for (let step = 0; step <= input.actionBar.items.length; step++) {
			if (input.actionBar.items[input.actionBar.focusedIndex]?.command === 'aem.remove') break;
			await press('ArrowRight');
		}
		t.assert(input.actionBar.hasFocus && input.actionBar.items[input.actionBar.focusedIndex]?.command === 'aem.remove',
			'the actual AEM action bar did not focus its registered Remove action');
		// Other controls may publish a different status-height budget. Start the
		// next gesture at the current sash, never the earlier reading projection.
		const actionsDivider = { x: input.layout.left + 12, visible: input.layout.bottom, hidden: input.layout.top - 1 };
		await drag(actionsDivider.x, actionsDivider.visible, actionsDivider.hidden);
		t.assert(input.tree.layout.visibleRowCount === 0 && !input.actionBar.hasFocus,
			'the actual Problems gesture did not retire the constrained AEM action owner');
		await press('Enter'); await press('ControlLeft', 'KeyZ'); unchanged(edited, version, true, false);
		await capture(`aem-${font}-${theme}-actions-concealed`);
		await drag(actionsDivider.x, actionsDivider.hidden, actionsDivider.visible);
		await press('Enter'); unchanged(edited, version, true, false);
		await selectProperty(); await press('ControlLeft', 'KeyZ');
		t.assert(model.buffer.getText() === original && model.canRedo, 'fresh tree focus did not restore its canonical Undo owner');
		await press('ControlLeft', 'ShiftLeft', 'KeyZ');
		t.assert(model.buffer.getText() === edited, 'ordinary Redo did not retain the accepted property edit');
		await press('ControlLeft', 'KeyZ');
		t.assert(model.buffer.getText() === original, 'ordinary Undo did not restore the exact authored fixture');
		t.command('problems'); await t.frames(3); t.command('theme-toggle'); await t.frames(2);
	}
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
