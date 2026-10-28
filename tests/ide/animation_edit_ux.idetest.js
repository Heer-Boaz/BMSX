// Actual EndDemo property draft, followed by physical +Key on the same input.
// Run: npm run ide:test -- nemesis_s tests/ide/animation_edit_ux.idetest.js
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true })));
	await t.frames(2);
	t.controlInput(codes.map(code => ({ type: 'key', code, down: false })));
	await t.frames(2);
};
const click = async (x, y) => {
	t.controlInput([{ type: 'pointer', x, y }, { type: 'button', button: 'primary', down: true }]);
	await t.frames(1);
	t.controlInput([{ type: 'button', button: 'primary', down: false }]);
	await t.frames(2);
};
const secondaryClick = async (x, y) => {
	t.controlInput([{ type: 'pointer', x, y }, { type: 'button', button: 'secondary', down: true }]); await t.frames(1);
	t.controlInput([{ type: 'button', button: 'secondary', down: false }]); await t.frames(2);
};
const capture = async label => { await t.frames(2); t.log(`VISUAL ${label}`); t.capture(label); };
await t.waitForCart(); await t.frames(90); t.openLuaSource('cart.lua'); await t.frames(2);
t.command('animation'); await t.frames(2);
for (const code of ['KeyE', 'KeyN', 'KeyD']) await press(code);
await press('Enter'); await t.frames(3);
const input = t.activeWorkbenchTab();
t.assert(input.kind === 'animation' && input.workingCopy.resource.path === 'end_demo.lua', 'the real EndDemo source did not open');
const source = input.workingCopy.buffer.getText(), cycles = t.runtime().machine.scheduler.nowCycles;
const showClient = async client => {
	const action = input.clientBar.items.find(item => item.command === `animation.${client}`);
	await click((action.bounds.left + action.bounds.right) / 2, (action.bounds.top + action.bounds.bottom) / 2);
	t.assert(input.activeClient === client && input.layout[`${client}Visible`], 'ordinary client navigation did not reveal its actual retained control');
};
await press('ArrowDown');
for (const variant of ['tiny', 'msx']) {
	await showClient('keys');
	const viewport = input.keys.range.bounds;
	await click(input.keys.xAt(0), (viewport.top + viewport.bottom) / 2);
	t.assert(input.trackIndex === 0 && input.keyIndex === 0, 'the actual first authored key was not selected');
	// EndDemo's written-reference coordinates are intentionally unresolved. Author a
	// second rendered key through the real prompt, then undo it before the original edit/history cases.
	await click(input.keys.xAt(1), (input.keys.range.bounds.top + input.keys.range.bounds.bottom) / 2);
	const temporaryCoordinate = input.keys.cursor;
	t.assert(input.keyIndex === -1 && temporaryCoordinate > 0, 'ordinary empty-lane input did not place a distinct new-key cursor');
	const addTemporary = input.actionBar.items.find(item => item.command === 'animation.addKey');
	await click((addTemporary.bounds.left + addTemporary.bounds.right) / 2, (addTemporary.bounds.top + addTemporary.bounds.bottom) / 2);
	await press('ControlLeft', 'KeyA'); await press('Digit9'); await press('Enter'); await t.frames(3);
	const temporaryKeyIndex = input.keyIndex, temporaryKey = input.document.tracks[0].keys[temporaryKeyIndex];
	t.assert(input.document.tracks[0].keys.length === 3 && temporaryKey.coordinate.value === temporaryCoordinate && temporaryKey.value.value === 9,
		'the real +Key prompt did not publish its selected literal key');
	const contextSource = input.workingCopy.buffer.getText();
	const keyDetails = input.details, priorProperty = keyDetails.rows.findIndex(row => row.element.field === temporaryKey.value.field);
	t.assert(priorProperty >= 0, 'the selected key has no real value property');
	await showClient('details');
	await click(keyDetails.layout.contentRight - 3, keyDetails.layout.contentTop + (priorProperty - (keyDetails.scroll | 0) + 0.5) * keyDetails.layout.rowHeight);
	await showClient('keys');
	await secondaryClick(input.keys.xAt(input.keys.positionAt(0)), (input.keys.range.bounds.top + input.keys.range.bounds.bottom) / 2);
	t.assert(input.trackIndex === 0 && input.keyIndex === 0 && input.workingCopy.buffer.getText() === contextSource,
		'secondary key input did not target the clicked key without editing or dragging it');
	await press('End'); t.assert(input.keyIndex === 0, 'key-context End leaked to the underlying last-key navigation');
	await capture(`animation-${variant}-key-context`);
	await press('Escape'); await press('ArrowRight');
	t.assert(input.trackIndex === 0 && input.keyIndex === temporaryKeyIndex && input.document.tracks[0].keys[temporaryKeyIndex] === temporaryKey, 'key-menu Escape did not return to the clicked key client');
	await press('ShiftLeft', 'F10'); await press('Home');
	t.assert(input.keyIndex === temporaryKeyIndex, 'key ShiftF10 did not consume Home in its actual context menu');
	await press('Escape');
	await showClient('tracks');
	const tracks = input.tracks, targetTrack = input.document.tracks[1];
	const trackRow = tracks.rows.findIndex(row => row.track === targetTrack);
	t.assert(trackRow >= 0, 'the real second track is unavailable');
	await secondaryClick(tracks.layout.contentLeft + 4, tracks.layout.contentTop + (trackRow - (tracks.scroll | 0) + 0.5) * tracks.layout.rowHeight);
	t.assert(input.trackIndex === 1 && input.keyIndex === -1 && input.keySelection === undefined && input.detailSelection === undefined,
		'secondary track input retained a previous key/property command subject');
	await press('ArrowDown'); t.assert(input.trackIndex === 1, 'track context navigation leaked into the underlying track list');
	await capture(`animation-${variant}-track-context`);
	await press('Escape'); await press('ArrowUp');
	t.assert(input.trackIndex === 0 && input.keyIndex === -1, 'track-menu Escape did not return to the clicked track client');
	await press('ShiftLeft', 'F10'); await press('ArrowDown');
	t.assert(input.trackIndex === 0, 'track ShiftF10 did not own ordinary menu navigation');
	const trackSource = input.document.tracks[0], trackRange = trackSource.file.chunk.locations.range(trackSource.field.span);
	await press('End'); await press('Enter'); await t.frames(2);
	const trackCode = t.activeWorkbenchTab();
	t.assert(trackCode.kind === 'code_editor' && trackCode.workingCopy === input.workingCopy
		&& trackCode.context.view.cursorRow === trackRange.start.line - 1 && trackCode.context.view.cursorColumn === trackRange.start.column - 1,
		'track menu Source did not open the canonical track rather than a prior property/key');
	await press('AltLeft', 'ArrowLeft');
	t.assert(t.activeWorkbenchTab() === input && input.workingCopy.buffer.getText() === contextSource,
		'track context Source/Back replaced its input or edited canonical source');
	await press('ControlLeft', 'KeyZ');
	t.assert(input.workingCopy.buffer.getText() === source && !input.workingCopy.dirty && input.document.tracks[0].keys.length === 2,
		'ordinary Undo did not remove the temporary context key and restore the exact pristine working copy');
	await showClient('keys');
	await click(input.keys.xAt(0), (input.keys.range.bounds.top + input.keys.range.bounds.bottom) / 2);
	t.assert(input.trackIndex === 0 && input.keyIndex === 0, 'the first authored key did not regain selection after track Source');
	const tree = input.details, index = tree.rows.findIndex(row => row.element.field === input.document.tracks[0].keys[0].value.field);
	t.assert(index >= 0 && input.document.tracks[0].keys[0].value.value === 1, 'the actual initial key value is missing');
	const property = tree.rows[index].element, valueRange = property.source.file.chunk.locations.range(property.field.value.span);
	const valueStart = input.workingCopy.buffer.offsetAt(valueRange.start.line - 1, valueRange.start.column - 1);
	const valueEnd = input.workingCopy.buffer.offsetAt(valueRange.end.line - 1, valueRange.end.column);
	const propertySource = source.slice(0, valueStart) + '2' + source.slice(valueEnd);
	await showClient('details');
	await click(tree.layout.contentRight - 3, tree.layout.contentTop + (index - (tree.scroll | 0) + 0.5) * tree.layout.rowHeight);
	await press('Enter'); await press('Digit2');
	t.assert(input.workingCopy.buffer.getText() === source, 'a pending property draft wrote canonical source before acceptance');
	await capture(`animation-${variant}-pending-property`);
	const add = input.actionBar.items.find(item => item.command === 'animation.addKey');
	t.assert(add.visible && !add.overflowed && add.enabled, 'the real +Key action is not a primary command');
	await click((add.bounds.left + add.bounds.right) / 2, (add.bounds.top + add.bounds.bottom) / 2);
	t.assert(input.document.tracks[0].keys[0].value.value === 2 && input.workingCopy.buffer.getText() === propertySource,
		'physical +Key did not first publish only the original property draft');
	await capture(`animation-${variant}-key-value-prompt-after-property`);
	// An actual usable prompt accepts a fresh value; a prompt retired by a late
	// semantic refresh leaves these ordinary keys in the Details list instead.
	await press('ControlLeft', 'KeyA'); await press('Digit9'); await press('Enter'); await t.frames(3);
	t.assert(input.document.tracks[0].keys.length === 3, 'the new key prompt was retired after committing the preceding property draft');
	t.assert(input.document.tracks[0].keys[2].value.value === 9, 'the actual prompt did not author its supplied key value');
	await capture(`animation-${variant}-new-key-after-property`);
	const keyedSource = input.workingCopy.buffer.getText();
	t.log(JSON.stringify({ historyKeyboard: 'animation-after-key-prompt', variant, toolbarFocused: input.actionBar.hasFocus, track: input.trackIndex, key: input.keyIndex }));
	t.assert(!input.actionBar.hasFocus, 'the actual key prompt did not return to its originating property client');
	await press('ControlLeft', 'KeyZ');
	t.assert(input.workingCopy.buffer.getText() === propertySource && input.document.tracks[0].keys.length === 2
		&& input.document.tracks[0].keys[0].value.value === 2, 'keyboard Undo did not separate the new key from the preceding property edit');
	const issuingTrack = input.trackIndex, issuingKey = input.keyIndex;
	await press('ControlLeft', 'KeyY');
	t.assert(input.workingCopy.buffer.getText() === keyedSource && input.document.tracks[0].keys.length === 3
		&& input.document.tracks[0].keys[2].value.value === 9, 'keyboard Redo did not restore the exact authored key insertion');
	await press('ControlLeft', 'KeyZ');
	t.assert(input.workingCopy.buffer.getText() === propertySource && input.trackIndex === issuingTrack && input.keyIndex === issuingKey,
		'keyboard Undo did not restore the preceding source and selected animation subject');
	await showClient('keys');
	await click(input.keys.xAt(0), (input.keys.range.bounds.top + input.keys.range.bounds.bottom) / 2);
	t.assert(input.trackIndex === 0 && input.keyIndex === 0, 'ordinary key-lane input did not focus the first authored key');
	t.log(JSON.stringify({ historyKeyboard: 'animation-key-client', variant, toolbarFocused: input.actionBar.hasFocus, track: input.trackIndex, key: input.keyIndex }));
	await press('ControlLeft', 'KeyY');
	t.assert(input.workingCopy.buffer.getText() === keyedSource && input.trackIndex === 0 && input.keyIndex === 0,
		'key-client keyboard Redo lost the exact source edit or the selected retained key');
	await press('ControlLeft', 'KeyZ');
	t.assert(input.workingCopy.buffer.getText() === propertySource && input.trackIndex === 0 && input.keyIndex === 0,
		'key-client keyboard Undo did not retain the selected authored key and preceding property source');
	await press('ControlLeft', 'KeyZ');
	t.assert(input.workingCopy.buffer.getText() === source && !input.workingCopy.dirty, 'ordinary keyboard Undo did not recover exact canonical source');
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
// The same real property stays editable at the supported outer Game Panel minimum.
// Its readable draft surface belongs to the root workarea, not the tiny Details cell.
await showClient('keys');
const firstKeys = input.keys.range.bounds;
await click(input.keys.xAt(0), (firstKeys.top + firstKeys.bottom) / 2);
t.assert(input.trackIndex === 0 && input.keyIndex === 0, 'the first actual authored key did not regain selection after Undo');
t.command('gameView.togglePanel'); await t.frames(3);
for (const variant of ['tiny', 'msx']) {
	const mainArea = t.mainAreaLayout(), companionVisible = mainArea.visible;
	if (companionVisible) {
		const sash = mainArea.split.position;
		t.controlInput([{ type: 'pointer', x: sash, y: 80 }, { type: 'button', button: 'primary', down: true }]); await t.frames(1);
		t.controlInput([{ type: 'pointer', x: 50, y: 80 }]); await t.frames(2);
		t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(2);
	}
	const presentation = companionVisible ? 'companion' : 'full-companion-hidden';
	await showClient('tracks');
	if (input.layout.mode === 'compact') t.assert(!input.layout.keysVisible && !input.layout.detailsVisible,
		'the compact layout still squeezes all Animation clients into one unreadable body');
	// The selected source subject is independent of the compact visible client.
	t.assert(input.trackIndex === 0 && input.keyIndex === 0, 'Tracks navigation replaced the selected authored key');
	await press('ShiftLeft', 'Tab');
	t.assert(input.clientBar.hasFocus, 'the compact client selector is not keyboard reachable from its actual body');
	await press('Home'); await press('ArrowRight'); await press('Enter');
	t.assert(input.activeClient === 'keys' && input.layout.keysVisible, 'keyboard client navigation did not reveal the selected key editor');
	if (input.layout.mode === 'compact') t.assert(!input.layout.tracksVisible && !input.layout.detailsVisible,
		'compact keyboard navigation retained an unselected client');
	await showClient('details');
	const tree = input.details, index = tree.rows.findIndex(row => row.element.field === input.document.tracks[0].keys[0].value.field);
	t.assert(index >= 0 && input.document.tracks[0].keys[0].value.value === 1, 'the selected authored key value was lost at minimum width');
	const property = tree.rows[index].element, valueRange = property.source.file.chunk.locations.range(property.field.value.span);
	const valueStart = input.workingCopy.buffer.offsetAt(valueRange.start.line - 1, valueRange.start.column - 1);
	const valueEnd = input.workingCopy.buffer.offsetAt(valueRange.end.line - 1, valueRange.end.column);
	const propertySource = source.slice(0, valueStart) + '2' + source.slice(valueEnd);
	await click(tree.layout.contentRight - 3, tree.layout.contentTop + (index - (tree.scroll | 0) + 0.5) * tree.layout.rowHeight);
	// Geometry-only transitions retain the same pending real value field. Accepting
	// after the round trip proves that its draft and keyboard client survived.
	await press('Enter'); await press('Digit2');
	t.command('gameView.closePanel'); await t.frames(3);
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
	await capture(`animation-${variant}-pending-property-wide-other-font`);
	t.command('gameView.togglePanel'); await t.frames(3);
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
	t.assert(input.workingCopy.buffer.getText() === source && input.trackIndex === 0 && input.keyIndex === 0,
		'resize or font change published a pending field or replaced its source subject');
	await press('Enter');
	t.assert(input.workingCopy.buffer.getText() === propertySource && input.document.tracks[0].keys[0].value.value === 2,
		'the original pending field did not retain its draft and focus through compact and font reflow');
	await press('ControlLeft', 'KeyZ');
	t.assert(input.workingCopy.buffer.getText() === source && !input.workingCopy.dirty, 'reflow introduced extra source history');
	await click(tree.layout.contentRight - 3, tree.layout.contentTop + (index - (tree.scroll | 0) + 0.5) * tree.layout.rowHeight);
	for (let theme = 0; theme < 2; theme++) {
		await press('Enter');
		for (const code of ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7']) await press(code);
		t.assert(input.workingCopy.buffer.getText() === source, 'a minimum-width value draft wrote canonical source');
		await capture(`animation-${variant}-${presentation}-value-editor-theme-${theme}`);
		await press('Escape');
		t.assert(input.workingCopy.buffer.getText() === source, 'Escape accepted a minimum-width value draft');
		await capture(`animation-${variant}-${presentation}-cancelled-value-editor-theme-${theme}`);
		const coordinate = input.document.tracks[0].keys[0].coordinate;
		const coordinateIndex = tree.rows.findIndex(row => row.element.field === coordinate.field);
		t.assert(coordinateIndex >= 0 && coordinateIndex !== index, 'the real key has no distinct coordinate property');
		await click(tree.layout.contentRight - 3, tree.layout.contentTop + (coordinateIndex - (tree.scroll | 0) + 0.5) * tree.layout.rowHeight);
		t.assert(tree.selectionIndex === coordinateIndex, 'ordinary primary input did not select the coordinate property');
		await secondaryClick(tree.layout.contentRight - 3, tree.layout.contentTop + (index - (tree.scroll | 0) + 0.5) * tree.layout.rowHeight);
		const selected = tree.rows[index].element, fieldRange = selected.source.file.chunk.locations.range(selected.field.span);
		const fieldStart = input.workingCopy.buffer.offsetAt(fieldRange.start.line - 1, fieldRange.start.column - 1);
		const fieldEnd = input.workingCopy.buffer.offsetAt(fieldRange.end.line - 1, fieldRange.end.column);
		t.assert(tree.selectionIndex === index && input.detailSelection.path === selected.source.file.file
			&& input.detailSelection.range.start === fieldStart && input.detailSelection.range.end === fieldEnd,
			'secondary input did not publish the actually clicked property as its command subject');
		await capture(`animation-${variant}-${presentation}-pointer-context-theme-${theme}`);
		await press('Home');
		t.assert(tree.selectionIndex === index && input.trackIndex === 0 && input.keyIndex === 0,
			'context-menu Home leaked to the underlying property or track list');
		await press('Escape'); await press('ArrowUp');
		t.assert(tree.selectionIndex === coordinateIndex && input.trackIndex === 0 && input.keyIndex === 0,
			'closing the pointer menu did not return keyboard focus to actual Details');
		await press('ArrowDown'); await press('ShiftLeft', 'F10'); await press('Home');
		t.assert(tree.selectionIndex === index && input.trackIndex === 0 && input.keyIndex === 0,
			'ShiftF10 did not open an owning Details menu that consumes Home');
		await capture(`animation-${variant}-${presentation}-keyboard-context-theme-${theme}`);
		await press('Escape'); await press('ArrowUp');
		t.assert(tree.selectionIndex === coordinateIndex, 'closing the keyboard menu did not restore the actual Details target');
		await press('ArrowDown');
		// Source opens the field; the following Producer Source opens its value expression.
			await press('ShiftLeft', 'F10');
			const menu = t.contextMenu(), actions = menu.model.rows.filter(row => row.command !== undefined && row.enabled);
			const sourceIndex = actions.findIndex(row => row.command === 'editor.source');
			t.assert(menu.visible && sourceIndex >= 0, 'the actual property menu has no eligible field Source action');
			await press('Home');
			for (let item = 0; item < sourceIndex; item++) await press('ArrowDown');
			await press('Enter'); await t.frames(2);
		const opened = t.activeWorkbenchTab();
		t.assert(opened.kind === 'code_editor' && opened.workingCopy === input.workingCopy
			&& opened.context.view.cursorRow === fieldRange.start.line - 1 && opened.context.view.cursorColumn === fieldRange.start.column - 1
			&& t.activeEditorDocument().focusTarget.hasFocus, 'context Source did not open the same canonical working copy at its selected field');
		t.assert(input.workingCopy.buffer.getText() === source && !input.workingCopy.dirty, 'context navigation edited canonical source');
		await press('AltLeft', 'ArrowLeft');
		t.assert(t.activeWorkbenchTab() === input && input.trackIndex === 0 && input.keyIndex === 0,
			'normal source Back did not return the retained animation subject');
		await click(tree.layout.contentRight - 3, tree.layout.contentTop + (index - (tree.scroll | 0) + 0.5) * tree.layout.rowHeight);
		t.command('theme-toggle'); await t.frames(2);
	}
	// Accept a fresh draft through the actual field to distinguish readable editing
	// from keys merely landing in the underlying list while source stays unchanged.
	await press('Enter'); await press('Digit2'); await press('Enter');
	t.assert(input.document.tracks[0].keys[0].value.value === 2 && input.workingCopy.buffer.getText() === propertySource,
		'the minimum-width field did not accept only its actual source value');
	t.log(JSON.stringify({ historyKeyboard: 'animation-details-after-field', variant, toolbarFocused: input.actionBar.hasFocus, track: input.trackIndex, key: input.keyIndex }));
	t.assert(!input.actionBar.hasFocus, 'the accepted minimum-width field did not return to its actual Details parent');
	await press('ControlLeft', 'KeyZ');
	t.assert(input.workingCopy.buffer.getText() === source && input.trackIndex === 0 && input.keyIndex === 0,
		'Details keyboard Undo did not recover exact source and its selected authored key');
	await press('ControlLeft', 'KeyY');
	t.assert(input.workingCopy.buffer.getText() === propertySource && input.trackIndex === 0 && input.keyIndex === 0
		&& input.document.tracks[0].keys[0].value.value === 2, 'Details keyboard Redo lost the exact source edit or selected key');
	await press('ControlLeft', 'KeyZ');
	t.assert(input.workingCopy.buffer.getText() === source && !input.workingCopy.dirty && input.trackIndex === 0 && input.keyIndex === 0,
		'Details keyboard Undo did not return to the pristine original animation subject');
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
t.command('gameView.closePanel'); await t.frames(2);
t.assert(t.runtime().machine.scheduler.nowCycles === cycles, 'authoring UI advanced the paused guest');
