// Real Starcatch progression, mounted context and authored rule identities.
// Run: npm run ide:test -- starcatch tests/ide/lua_program_ux.idetest.js
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true })));
	await t.frames(2);
	t.controlInput(codes.map(code => ({ type: 'key', code, down: false })));
	await t.frames(2);
};
const capture = async label => {
	await t.frames(2);
	t.log(`VISUAL ${label}`);
	t.capture(label);
};
const click = async (x, y) => {
	t.controlInput([{ type: 'pointer', x, y }, { type: 'button', button: 'primary', down: true }]);
	await t.frames(1);
	t.controlInput([{ type: 'button', button: 'primary', down: false }]);
	await t.frames(2);
};

await t.waitForCart();
await t.frames(90);
t.openLuaSource('entry.lua');
await t.frames(2);
t.command('progression');
await t.frames(2);
await press('Enter');
await t.frames(2);
const input = t.activeWorkbenchTab();
t.assert(input.kind === 'lua_program' && input.programKind === 'progression', 'the actual progression program did not open');
t.command('luaProgram.live');
await t.frames(2);
await capture('typed-mounted-context-picker');
await press('Enter');
await t.frames(2);
t.assert(input.liveVisible, 'the live context was not selected');
t.assert(input.instanceLabel === `Table #${input.instance.scalar}`, 'the context caption discarded its actual table identity');

for (let font = 0; font < 2; font++) {
	for (let theme = 0; theme < 2; theme++) {
		const labels = [];
		for (const id of ['dash', 'twin', 'complete']) {
			const row = input.live.roots.find(row => row.element.label === `${id} / starcatch.enemy_destroyed`);
			t.assert(row !== undefined, `the actual ${id} rule identity or event is missing`);
			t.assert(row.element.displayLabel.startsWith(id), `${id} is clipped behind its common event prefix`);
			labels.push(row.element.displayLabel);
		}
		t.assert(new Set(labels).size === 3, 'the three actual rules have indistinguishable displayed labels');
		await capture(`program-identities-${font === 0 ? 'tiny' : 'msx'}-${theme}`);
		t.command('theme-toggle');
		await t.frames(2);
	}
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}

// Request the optional companion without forcing a split that cannot fit the current font.
const authoredSource = input.workingCopy.buffer.getText();
for (const variant of ['tiny', 'msx']) {
	t.command('gameView.closePanel'); await t.frames(3);
	const fullRight = input.layout.right;
	t.command('gameView.togglePanel'); await t.frames(3);
	const companion = input.layout.right < fullRight;
	if (companion) {
		t.controlInput([{ type: 'pointer', x: input.layout.right + 2, y: 80 }, { type: 'button', button: 'primary', down: true }]); await t.frames(1);
		t.controlInput([{ type: 'pointer', x: 50, y: 80 }]); await t.frames(2);
		t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(2);
	}
	const phase = companion ? 'companion' : 'full-preview-unavailable';
	t.assert(t.activeWorkbenchTab() === input && input.layout.font.variant === variant, 'requesting the companion replaced the retained program or its current font');
	const bar = input.actionBar, more = bar.overflow.button;
	t.assert(more.visible, 'the actual program has no secondary-action menu');
	const commands = [...bar.items.filter(item => item.visible && !item.overflowed).map(item => item.command),
		...bar.overflow.items.filter(item => item.type === 'command').map(item => item.command)];
	t.assert(commands.includes('editor.source') && commands.includes('luaProgram.selectInstance') && new Set(commands).size === commands.length,
		'primary overflow and filtered secondary context are not one complete command set');
	t.assert(!commands.includes('luaProgram.more') && !commands.includes('luaProgram.testInput'), 'the popup contains nested More or an ineligible input-only command');
	await click(8, input.live.layout.contentTop + input.live.layout.rowHeight / 2);
	await click((more.bounds.left + more.bounds.right) / 2, (more.bounds.top + more.bounds.bottom) / 2);
	await capture(`program-more-pointer-${variant}-${phase}`);
	await press('Escape');
	await press('Tab');
	await press('End');
	t.assert(bar.hasFocus && bar.focusedIndex === bar.items.length, 'Escape did not return to the actual content before keyboard More');
	await press('Enter');
	await capture(`program-more-keyboard-${variant}-${phase}`);
	await press('Escape');
	t.assert(bar.hasFocus, 'keyboard More did not return to its actual toolbar');
	if (variant === 'tiny') await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
// Invoke Source from whichever actual action surface owns it at this width.
const sourceAction = input.actionBar.items.find(item => item.command === 'editor.source');
if (sourceAction.visible && !sourceAction.overflowed) {
	await click((sourceAction.bounds.left + sourceAction.bounds.right) / 2, (sourceAction.bounds.top + sourceAction.bounds.bottom) / 2);
} else {
	await press('Enter');
	const eligible = input.actionBar.overflow.items.filter(entry => entry.type === 'command'
		&& !input.actionBar.items.some(item => item.command === entry.command && !item.enabled));
	const sourceIndex = eligible.findIndex(item => item.command === 'editor.source');
	t.assert(sourceIndex >= 0, 'the actual Source action was not reachable');
	await press('Home');
	for (let row = 0; row < sourceIndex; row++) await press('ArrowDown');
	await press('Enter');
}
await t.frames(3);
const source = t.activeWorkbenchTab();
t.assert(source.kind === 'code_editor' && source.workingCopy === input.workingCopy, 'program Source lost its original authored working copy');
t.assert(input.workingCopy.buffer.getText() === authoredSource, 'presentation or popup navigation changed authored source');
