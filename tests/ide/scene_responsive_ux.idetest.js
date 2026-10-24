// Shipped Scene source, real Game Panel resizing and explicit compact master/detail navigation.
// Run: npm run ide:test -- nemesis_s tests/ide/scene_responsive_ux.idetest.js
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true }))); await t.frames(2);
	t.controlInput(codes.map(code => ({ type: 'key', code, down: false }))); await t.frames(2);
};
const click = async bounds => {
	t.controlInput([{ type: 'pointer', x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 },
		{ type: 'button', button: 'primary', down: true }]); await t.frames(1);
	t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(2);
};
const capture = async label => { await t.frames(2); t.log(`VISUAL ${label}`); t.capture(label); };
await t.waitForCart(); await t.frames(90); t.openLuaSource('cart.lua'); await t.frames(2);
t.command('sceneEditor'); await t.frames(2); await press('Enter'); await t.frames(3);
const input = t.activeWorkbenchTab();
t.assert(input.kind === 'scene_editor' && input.workingCopy.resource.path === 'scenes/end_demo.lua', 'the actual shipped Scene source did not open');
const model = input.workingCopy, source = model.buffer.getText(), cycles = t.runtime().machine.scheduler.nowCycles;
const selected = () => input.outline.rows[input.outline.selectionIndex]?.element;
const unchanged = () => {
	t.assert(model.buffer.getText() === source, 'navigation, resizing or a cancelled draft changed canonical Scene source');
	t.assert(t.runtime().machine.scheduler.nowCycles === cycles, 'responsive Scene interaction advanced the paused guest');
};
const action = command => input.actionBar.items.find(item => item.command === command);
const clickAction = async command => {
	const item = action(command);
	t.assert(item.visible && !item.overflowed && item.enabled, `${command} is not directly reachable in its actual compact toolbar`);
	await click(item.bounds);
};
const selectCurtain = async () => {
	t.command('sceneEditor.outline'); await t.frames(2); await press('Home'); await press('End');
	t.assert(selected()?.label === "'curtain'", 'ordinary outline navigation did not select the actual curtain member');
};
const resize = async x => {
	t.controlInput([{ type: 'pointer', x: input.layout.right + 2, y: 80 }, { type: 'button', button: 'primary', down: true }]); await t.frames(1);
	t.controlInput([{ type: 'pointer', x, y: 80 }]); await t.frames(2);
	t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(2);
};
const outlineOnly = () => {
	t.assert(input.layout.mode === 'outline' && input.section === 'outline', 'compact layout did not publish the actual outline presentation');
	t.assert(action('sceneEditor.details').icon === 'info' && action('sceneEditor.details').visible && !action('sceneEditor.details').overflowed,
		'Details navigation is buried in overflow or replaced by text');
};
const detailsOnly = () => {
	t.assert(input.layout.mode === 'details' && input.section === 'details' && selected()?.label === "'curtain'", 'compact Details lost its actual selected member');
	t.assert(action('sceneEditor.outline').icon === 'back' && action('sceneEditor.outline').visible && !action('sceneEditor.outline').overflowed,
		'Back navigation is buried in overflow or has no actual icon');
};
const focusX = async () => {
	t.command('sceneEditor.details'); await t.frames(2); await press('Home');
	const bounds = input.properties[0].bounds;
	t.assert(bounds.bottom > bounds.top && bounds.top >= input.details.bounds.top && bounds.bottom <= input.details.bounds.bottom, 'the first editable position field is not actually visible');
	await click(bounds);
};
const sourceReturn = async () => {
	const expected = selected().source;
	t.command('sceneEditor.source'); await t.frames(3);
	const code = t.activeWorkbenchTab();
	t.assert(code.kind === 'code_editor' && code.workingCopy === model, 'Source did not open the canonical shared working copy');
	t.assert(code.context.view.cursorRow === expected.start.line - 1 && code.context.view.cursorColumn === expected.start.column - 1,
		'Source navigated to another member instead of its retained source range');
	t.command('sceneEditor'); await t.frames(3);
	t.assert(t.activeWorkbenchTab() === input && selected()?.label === "'curtain'", 'Source return replaced the retained Scene input or selected another member');
};
t.assert(input.layout.mode === 'split', 'the full viewport did not retain its ordinary wide presentation');
await selectCurtain(); await capture('scene-responsive-wide-split');

for (let font = 0; font < 2; font++) {
	const variant = input.layout.font.variant;
	t.command('gameView.togglePanel'); await t.frames(3); await resize(50);
	for (let theme = 0; theme < 2; theme++) {
		await selectCurtain(); outlineOnly();
		t.assert(t.activeWorkbenchTab() === input, 'opening and resizing the companion replaced the retained Scene input');
		if (theme === 0) {
			await press('Home');
			t.assert(selected().kind === 'scene' && selected().identity.includes('scenes/end_demo.lua') && selected().identity.includes('Scene end_demo_scene.id'),
				'the compact outline lost its actual containing-scene source identity');
			await capture(`scene-responsive-${variant}-scene-keyboard-${selected().labelClipped ? 'clipped' : 'fits'}`);
			const list = input.outline.layout;
			t.controlInput([{ type: 'pointer', x: list.contentRight - 8, y: list.contentTop + list.rowHeight / 2 }]);
			await capture(`scene-responsive-${variant}-scene-full-identity-hover`);
			await selectCurtain(); outlineOnly();
		}
		await capture(`scene-responsive-${variant}-theme-${theme}-outline`);
		if (theme === 0) await clickAction('sceneEditor.details'); else await press('Enter');
		detailsOnly(); await capture(`scene-responsive-${variant}-theme-${theme}-details`);
		const oldListPoint = { left: input.layout.left + 15, right: input.layout.left + 17,
			top: input.details.bounds.top + 3, bottom: input.details.bounds.top + 5 };
		await click(oldListPoint);
		t.assert(selected()?.label === "'curtain'", 'an old outline rectangle changed the subject while Details alone was visible');
		await focusX(); await press('Digit9'); unchanged();
		await press('Escape'); detailsOnly(); unchanged();
		await capture(`scene-responsive-${variant}-theme-${theme}-draft-cancelled-in-details`);
		await press('End'); unchanged();
		const caution = input.detailsText.find(line => line.warning && line.text === 'DEFINITION ONLY');
		t.assert(caution !== undefined && caution.top + input.details.offsetTop >= input.details.bounds.top
			&& caution.top + input.details.offsetTop + input.layout.font.lineHeight <= input.details.bounds.bottom,
			'the actual Scene definition warning is not visible after ordinary Details End');
		await capture(`scene-definition-warning-${variant}-theme-${theme}`);
		await press('Home'); unchanged();
		await press('Escape'); outlineOnly();
		// A hidden numeric target would accept 9 and publish on the next Tab/Source blur.
		for (let step = 0; step < 4; step++) { await press('Tab'); await press('Digit9'); unchanged(); }
		await sourceReturn(); outlineOnly(); unchanged();
		await press('Enter'); detailsOnly();
		const oldX = { ...input.properties[0].bounds };
		await clickAction('sceneEditor.outline'); outlineOnly();
		await click(oldX); await press('Digit9');
		await selectCurtain(); await sourceReturn(); outlineOnly(); unchanged();
		t.command('theme-toggle'); await t.frames(2);
	}

	// Resizing must preserve the same source-bound field and its local draft history.
	await selectCurtain(); await press('Enter'); detailsOnly();
	const range = input.document.analysis.chunk.locations.range(input.properties[0].field.value.span);
	const start = model.buffer.offsetAt(range.start.line - 1, range.start.column - 1);
	const end = model.buffer.offsetAt(range.end.line - 1, range.end.column);
	const edited = source.slice(0, start) + '1234' + source.slice(end);
	await focusX();
	for (const code of ['Digit1', 'Digit2', 'Digit3']) await press(code);
	await resize(300); unchanged();
	t.assert(t.activeWorkbenchTab() === input && input.section === 'details' && selected()?.label === "'curtain'",
		'physical resizing replaced the input or its pending field subject');
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
	t.assert(t.activeWorkbenchTab() === input && input.section === 'details' && selected()?.label === "'curtain'",
		'font reflow replaced the input or its pending field subject');
	unchanged(); await capture(`scene-responsive-${variant}-pending-draft-other-font`);
	await press('ControlLeft', 'ShiftLeft', 'KeyT'); unchanged();
	await capture(`scene-responsive-${variant}-resized-pending-draft`);
	await press('ControlLeft', 'KeyZ'); unchanged();
	await press('ControlLeft', 'ShiftLeft', 'KeyZ'); unchanged();
	await resize(50); detailsOnly(); unchanged();
	await press('Digit4'); await press('Enter');
	t.assert(model.buffer.getText() === edited && input.properties[0].value === 1234 && selected()?.label === "'curtain'",
		'resize/font change lost the concrete field, draft history, source generation or numeric suffix');
	await capture(`scene-responsive-${variant}-accepted-original-field`);
	const acceptedSelection = { ...input.selectionRange };
	t.log(JSON.stringify({ historyKeyboard: 'scene-details-after-field', variant, toolbarFocused: input.actionBar.hasFocus, section: input.section }));
	t.assert(!input.actionBar.hasFocus, 'accepted field input did not return to its actual Details parent');
	await press('ControlLeft', 'KeyZ'); detailsOnly(); unchanged();
	const issuingSelection = { ...input.selectionRange };
	await press('ControlLeft', 'KeyY'); detailsOnly();
	t.assert(model.buffer.getText() === edited && input.properties[0].value === 1234
		&& input.selectionRange.start === acceptedSelection.start && input.selectionRange.end === acceptedSelection.end,
		'Details keyboard Redo did not restore the exact source edit and selected member');
	await press('ControlLeft', 'KeyZ'); detailsOnly(); unchanged();
	t.assert(input.selectionRange.start === issuingSelection.start && input.selectionRange.end === issuingSelection.end,
		'Details keyboard Undo changed the issuing source selection');
	await focusX(); await press('Digit5');
	t.command('sceneEditor.outline'); await t.frames(3); outlineOnly();
	t.assert(model.buffer.getText() === source.slice(0, start) + '5' + source.slice(end),
		'the focused field lost its concrete section command or failed to accept its own draft before navigation');
	await capture(`scene-responsive-${variant}-field-command-accepted-outline`);
	await press('ControlLeft', 'KeyZ'); outlineOnly(); unchanged();
	await press('ControlLeft', 'KeyY'); outlineOnly();
	t.assert(model.buffer.getText() === source.slice(0, start) + '5' + source.slice(end) && selected()?.label === "'curtain'",
		'Outline keyboard Redo did not restore the accepted source field and actual selected member');
	await press('ControlLeft', 'KeyZ'); outlineOnly(); unchanged();
	await press('Enter'); detailsOnly();
	await sourceReturn(); detailsOnly(); unchanged();
	await capture(`scene-responsive-${variant}-details-source-return`);
	t.command('gameView.closePanel'); await t.frames(3);
	t.assert(input.layout.mode === 'split', 'closing Game Panel failed to restore the wide layout');

	// Source-consuming structural actions accept the field before resolving current member ranges.
	await focusX();
	for (const code of ['Digit7', 'Digit8', 'Digit9']) await press(code);
	const remove = action('sceneEditor.removeMember');
	t.assert(remove.visible && !remove.overflowed && remove.enabled, 'wide Remove is not physically reachable');
	await click(remove.bounds);
	t.assert(input.section === 'outline' && input.outline.selectionIndex === -1 && input.outline.rows.every(row => row.element.label !== "'curtain'"),
		'removing the actual member did not retire Details or selected a same-index replacement');
	t.assert(input.document !== undefined && model.buffer.getText() !== source, 'removal did not publish a valid canonical source change');
	await capture(`scene-responsive-${variant}-removed-member`);
	await press('ControlLeft', 'KeyZ');
	t.assert(model.buffer.getText() === source.slice(0, start) + '789' + source.slice(end), 'Undo did not separate removal from the accepted longer field draft');
	await press('ControlLeft', 'KeyZ'); unchanged();
	t.assert(input.section === 'outline' && selected()?.kind !== 'member', 'Undo silently replaced a retired Details subject by a restored namesake');
	await capture(`scene-responsive-${variant}-undo-restored-source-outline`);
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
unchanged();
for (let index = 0; index < t.logMessageCount(); index++)
	t.assert(t.logMessage(index).level !== 3, `Responsive Scene workflow logged an error: ${t.logMessage(index).message}`);
