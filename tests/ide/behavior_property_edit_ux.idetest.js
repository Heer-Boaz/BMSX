// Shipped ActionEffect drafts and all three Behavior Lens toolbars at actual Game Panel minima.
// Run: npm run ide:test -- nemesis_s tests/ide/behavior_property_edit_ux.idetest.js --ttl 120
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true }))); await t.frames(2);
	t.controlInput(codes.map(code => ({ type: 'key', code, down: false }))); await t.frames(2);
};
const click = async bounds => {
	t.controlInput([{ type: 'pointer', x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 },
		{ type: 'button', button: 'primary', down: true }]); await t.frames(1);
	t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(2);
};
const typeDigits = async text => { for (const digit of text) await press(`Digit${digit}`); };
const capture = async label => { await t.frames(2); t.log(`VISUAL ${label}`); t.capture(label); };
const choose = async (path, query) => {
	t.openLuaSource(path); await t.frames(2); t.command('behaviorLens'); await t.frames(2);
	for (const character of query) await press(character === ' ' ? 'Space' : `Key${character.toUpperCase()}`);
	await press('Enter'); await t.frames(3);
	const input = t.activeWorkbenchTab();
	t.assert(input.kind === 'behavior_lens', 'the real behavior definition chooser did not open a lens');
	return input;
};
const minimum = async input => {
	t.command('gameView.togglePanel'); await t.frames(3);
	t.controlInput([{ type: 'pointer', x: input.view.layout.right + 2, y: 80 }, { type: 'button', button: 'primary', down: true }]); await t.frames(1);
	t.controlInput([{ type: 'pointer', x: 50, y: 80 }]); await t.frames(2);
	t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(2);
	const layout = input.view.layout;
	t.assert(layout.right - layout.left === (layout.font.variant === 'tiny' ? 78 : 118), 'the actual Game Panel did not reach its supported font-dependent minimum');
};
const sourceAction = input => input.view.presentation.actionBar.items.find(item => item.command === 'behaviorLens.source');
const more = input => input.view.presentation.actionBar.overflow.button;
const bounded = input => {
	const { layout, presentation } = input.view, bar = presentation.actionBar;
	for (const item of bar.items) if (item.visible && !item.overflowed)
		t.assert(item.bounds.left >= layout.left && item.bounds.right <= layout.right, 'a primary Behavior Lens action escaped its editor');
	t.assert(more(input).visible && more(input).icon === 'more' && more(input).bounds.right > more(input).bounds.left,
		'the narrow toolbar has no real reachable symbol More');
	t.assert(sourceAction(input).visible && !sourceAction(input).overflowed, 'Source is not directly reachable at the real supported minimum');
	const commands = [...bar.items.filter(item => item.visible && !item.overflowed).map(item => item.command),
		...bar.overflow.items.filter(item => item.type === 'command').map(item => item.command)];
	t.assert(new Set(commands).size === commands.length && commands.every(command => command !== 'behaviorLens.more'),
		'More duplicates a primary action or contains a second legacy More');
};
const selectPeriod = async input => {
	const tree = input.view.presentation.tree;
	const index = tree.rows.findIndex(row => row.element.kind === 'property' && row.element.write?.field.name === 'period_ms');
	t.assert(index >= 0, 'the actual authored period field is missing');
	await click({ left: tree.layout.contentLeft + 15, right: tree.layout.contentLeft + 17,
		top: tree.layout.contentTop + 1, bottom: tree.layout.contentTop + 3 });
	await press('Home'); for (let row = 0; row < index; row++) await press('ArrowDown');
	const element = tree.rows[tree.selectionIndex].element;
	t.assert(element.kind === 'property' && element.write.field.name === 'period_ms', 'ordinary property navigation selected another written field');
	return element;
};
const editPeriod = async input => {
	const element = await selectPeriod(input);
	// A real property context menu contributes Edit first; Enter is normal menu input.
	await press('ShiftLeft', 'F10'); await press('Home'); await press('Enter');
	return element;
};
const snapshot = input => [...input.view.source.models.values()].map(model => ({ model, source: model.buffer.getText() }));
const unchangedDependencies = (snapshots, owner) => {
	for (const item of snapshots) if (item.model !== owner)
		t.assert(item.model.buffer.getText() === item.source, 'a property edit rewrote a referenced/imported canonical source');
};
await t.waitForCart(); await t.frames(90);
const input = await choose('cart.lua', 'effect fire salvo');
t.assert(input.view.presentation.kind === 'properties' && input.workingCopy.resource.path === 'player/actioneffects.lua', 'the chooser did not select the shipped player ActionEffect');
const model = input.workingCopy, original = model.buffer.getText(), cycles = t.runtime().machine.scheduler.nowCycles;
const dependencies = snapshot(input);
for (let font = 0; font < 2; font++) {
	await minimum(input); bounded(input);
	const variant = input.view.layout.font.variant;
	for (let theme = 0; theme < 2; theme++) {
		const element = await editPeriod(input), write = element.write;
		const range = write.file.chunk.locations.range(write.field.value.span);
		const start = model.buffer.offsetAt(range.start.line - 1, range.start.column - 1), end = model.buffer.offsetAt(range.end.line - 1, range.end.column);
		await typeDigits('1234567');
		t.assert(model.buffer.getText() === original, 'the temporary Effect draft published before acceptance');
		await capture(`effect-${variant}-theme-${theme}-minimum-seven-digit-draft`);
		await press('ControlLeft', 'KeyZ'); await press('Enter');
		t.assert(model.buffer.getText() === original.slice(0, start) + '123456' + original.slice(end), 'local draft Undo was routed to canonical history or lost its suffix');
		t.command('undo'); await t.frames(3); t.assert(model.buffer.getText() === original, 'document Undo did not restore exact authored Effect bytes');
		await editPeriod(input); await typeDigits('1234567'); await press('ControlLeft', 'KeyZ'); await press('ControlLeft', 'ShiftLeft', 'KeyZ'); await press('Enter');
		t.assert(model.buffer.getText() === original.slice(0, start) + '1234567' + original.slice(end), 'local draft Redo did not restore the typed expression');
		t.command('undo'); await t.frames(3); t.assert(model.buffer.getText() === original, 'accepted Effect draft did not remain one canonical undo step');
		await editPeriod(input); await typeDigits('7654321'); await press('Escape');
		t.assert(model.buffer.getText() === original, 'Escape accepted the pending Effect draft');
		const selected = await selectPeriod(input), expected = selected.write.file.chunk.locations.range(selected.write.field.span);
		await click(sourceAction(input).bounds); await t.frames(3);
		const code = t.activeWorkbenchTab();
		t.assert(code.kind === 'code_editor' && code.workingCopy === model, 'Effect Source lost its exact canonical model');
		t.assert(code.context.view.cursorRow === expected.start.line - 1 && code.context.view.cursorColumn === expected.start.column - 1, 'Effect Source did not open its actual written field');
		t.assert(await choose('player/actioneffects.lua', 'effect fire salvo') === input, 'returning from Source replaced the retained Effect input');
		unchangedDependencies(dependencies, model);
		t.command('theme-toggle'); await t.frames(2);
	}
	// Non-modal property editing preserves ordinary workbench command admission.
	const commandElement = await editPeriod(input), commandRange = commandElement.write.file.chunk.locations.range(commandElement.write.field.value.span);
	const commandStart = model.buffer.offsetAt(commandRange.start.line - 1, commandRange.start.column - 1);
	const commandEnd = model.buffer.offsetAt(commandRange.end.line - 1, commandRange.end.column);
	const accepted123 = original.slice(0, commandStart) + '123' + original.slice(commandEnd);
	await typeDigits('123'); await press('ControlLeft', 'ShiftLeft', 'KeyP');
	t.assert(model.buffer.getText() === accepted123, 'opening Command Palette did not accept the actual pending property first');
	for (const code of ['KeyU', 'KeyN', 'KeyD', 'KeyO', 'KeyX']) await press(code);
	await press('ControlLeft', 'KeyZ');
	t.assert(model.buffer.getText() === accepted123, 'Quick Input local Undo escaped into its originating document');
	await capture(`effect-${variant}-palette-query-local-undo`);
	await press('Enter');
	t.assert(model.buffer.getText() === original, 'Quick Input did not undo its query suffix and invoke the real document Undo command');
	await editPeriod(input); await typeDigits('123'); await press('ControlLeft', 'ShiftLeft', 'KeyP');
	t.assert(model.buffer.getText() === accepted123, 'a subsequent Palette request lost property-source admission');
	await press('Escape'); await press('Home');
	t.assert(input.view.presentation.tree.selectionIndex === 0 && model.buffer.getText() === accepted123, 'Palette cancel did not return to the real property content');
	t.command('undo'); await t.frames(3); t.assert(model.buffer.getText() === original, 'Palette cancellation duplicated the accepted canonical edit');
	for (const keys of [['Tab'], ['ShiftLeft', 'Tab']]) {
		await editPeriod(input); await typeDigits('123'); await press(...keys);
		t.assert(model.buffer.getText() === accepted123, 'Tab/ShiftTab did not accept exactly the current property draft');
		t.command('undo'); await t.frames(3); t.assert(model.buffer.getText() === original, 'Tab/ShiftTab accepted the same field more than once');
	}
	await editPeriod(input); await typeDigits('123'); await press('Enter');
	t.assert(model.buffer.getText() === accepted123 && model.dirty, 'the valid authored edit did not establish an unsaved canonical working copy');
	await editPeriod(input); await press('ShiftLeft', 'Digit9'); await press('ControlLeft', 'KeyS');
	t.assert(model.buffer.getText() === accepted123 && model.dirty, 'Save accepted an invalid expression or saved past the invalid active draft');
	await capture(`effect-${variant}-invalid-draft-blocked-save`);
	await press('Escape'); t.command('undo'); await t.frames(3);
	t.assert(model.buffer.getText() === original, 'invalid-draft cancellation did not preserve the prior canonical undo step');
	// A popup opened by a pending draft belongs to the OLD generation and must retire.
	const element = await editPeriod(input), range = element.write.file.chunk.locations.range(element.write.field.value.span);
	const start = model.buffer.offsetAt(range.start.line - 1, range.start.column - 1), end = model.buffer.offsetAt(range.end.line - 1, range.end.column);
	const expression = '123456789 + 123456789 + 123456789 + 123456789 + 123456789 + 123456789';
	for (const character of expression) {
		if (character === ' ') await press('Space');
		else if (character === '+') await press('ShiftLeft', 'Equal');
		else await press(`Digit${character}`);
	}
	await click(more(input).bounds); await t.frames(3);
	const edited = original.slice(0, start) + expression + original.slice(end);
	t.assert(model.buffer.getText() === edited, 'More lost, duplicated or retargeted the accepted longer expression');
	await press('Home'); t.assert(input.view.presentation.tree.selectionIndex === 0, 'the retired old-generation popup retained keyboard focus');
	await capture(`effect-${variant}-pending-draft-retired-more`);
	await selectPeriod(input); await click(more(input).bounds);
	// Authored properties.actions ends with Registered Definitions; Remove precedes it.
	await press('End'); await press('ArrowUp'); await press('Enter'); await t.frames(3);
	t.assert(!input.view.presentation.tree.rows.some(row => row.element.kind === 'property' && row.element.write?.field.name === 'period_ms'), 'Remove did not target the current accepted period field');
	t.assert(model.buffer.getText().includes('owner:fire_weapon_salvo()'), 'Remove damaged the adjacent authored handler');
	await capture(`effect-${variant}-removed-current-written-field`);
	t.command('undo'); await t.frames(3); t.assert(model.buffer.getText() === edited, 'Undo did not separate current-field removal from the preceding accepted draft');
	t.command('undo'); await t.frames(3); t.assert(model.buffer.getText() === original, 'two document Undos did not restore exact Effect source');
	// Reopen only after the pending draft's OLD More lifetime has retired.
	await editPeriod(input);
	for (const character of expression) {
		if (character === ' ') await press('Space');
		else if (character === '+') await press('ShiftLeft', 'Equal');
		else await press(`Digit${character}`);
	}
	await click(more(input).bounds); await t.frames(3);
	t.assert(model.buffer.getText() === edited, 'the pending Add property draft did not publish to its original owner');
	await press('Home'); t.assert(input.view.presentation.tree.selectionIndex === 0, 'the retired Add popup kept hidden keyboard focus');
	await selectPeriod(input); await click(more(input).bounds);
	// Registered Definitions / Remove / Add are the last eligible authored actions.
	await press('End'); await press('ArrowUp'); await press('ArrowUp'); await press('Enter');
	await press('Enter'); await press('ControlLeft', 'KeyA'); await typeDigits('3'); await press('Enter'); await t.frames(3);
	const added = input.view.presentation.tree.rows.find(row => row.element.kind === 'property' && row.element.write?.field.name === 'initial_cooldown_ms');
	t.assert(added !== undefined && added.element.write.field.value.value === 3 && model.buffer.getText().includes(expression),
		'the fresh Add picker/prompt was retired or used the preceding source generation');
	await capture(`effect-${variant}-added-property-after-accepted-draft`);
	t.command('undo'); await t.frames(3); t.assert(model.buffer.getText() === edited, 'Undo did not separate Add from its preceding accepted property draft');
	t.command('undo'); await t.frames(3); t.assert(model.buffer.getText() === original, 'Add plus property Undo did not restore exact authored bytes');
	unchangedDependencies(dependencies, model);
	t.command('gameView.closePanel'); await t.frames(3); await press('ControlLeft', 'ShiftLeft', 'KeyT');
}

// The same responsive owner serves actual behavior-tree and state-machine lenses.
for (const [path, query, kind] of [['enemies/moon_tree.lua', 'bt moon', 'graph'], ['player/player.lua', 'fsm player', 'state-graph']]) {
	const lens = await choose(path, query), source = lens.workingCopy.buffer.getText();
	t.assert(lens.view.presentation.kind === kind, 'the real chooser selected a different behavior presentation');
	if (kind === 'state-graph') await lens.graphLayout.settled;
	for (let font = 0; font < 2; font++) {
		await minimum(lens); bounded(lens);
		for (let theme = 0; theme < 2; theme++) {
			await click(more(lens).bounds); await capture(`behavior-${kind}-${lens.view.layout.font.variant}-theme-${theme}-minimum-more`); await press('Escape');
			t.command('theme-toggle'); await t.frames(2);
		}
		await click(sourceAction(lens).bounds); await t.frames(3);
		t.assert(t.activeWorkbenchTab().kind === 'code_editor' && t.activeWorkbenchTab().workingCopy === lens.workingCopy, 'a narrow behavior toolbar opened a different Source owner');
		t.assert(await choose(path, query) === lens && lens.workingCopy.buffer.getText() === source, 'toolbar navigation replaced a retained lens or rewrote source');
		t.command('gameView.closePanel'); await t.frames(3); await press('ControlLeft', 'ShiftLeft', 'KeyT');
	}
}
t.assert(model.buffer.getText() === original && t.runtime().machine.scheduler.nowCycles === cycles, 'Behavior authoring changed canonical source or advanced the paused guest');
for (let index = 0; index < t.logMessageCount(); index++) t.assert(t.logMessage(index).level !== 3, `Behavior editing logged an error: ${t.logMessage(index).message}`);
