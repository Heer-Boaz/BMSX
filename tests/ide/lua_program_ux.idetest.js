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

// The actual outer Game Panel sash permits 20 font cells; the toolbar must
// keep all real commands reachable there instead of painting them offscreen.
const authoredSource = input.workingCopy.buffer.getText();
t.command('gameView.togglePanel');
await t.frames(3);
for (const variant of ['tiny', 'msx']) {
	const sashX = input.layout.right + 2;
	t.controlInput([{ type: 'pointer', x: sashX, y: 80 }, { type: 'button', button: 'primary', down: true }]);
	await t.frames(1);
	t.controlInput([{ type: 'pointer', x: 50, y: 80 }]);
	await t.frames(2);
	t.controlInput([{ type: 'button', button: 'primary', down: false }]);
	await t.frames(2);
	t.assert(input.layout.font.variant === variant && input.layout.right === (variant === 'tiny' ? 78 : 118), 'the real minimum sash geometry was not exercised');
	const bar = input.actionBar, more = bar.overflow.button;
	t.assert(more.visible && more.bounds.right - more.bounds.left >= 13, 'the actual minimum pane has no hittable More');
	t.assert(bar.items.every(item => !item.visible || item.overflowed || item.bounds.left >= input.layout.left + 4), 'a primary action paints outside its real pane');
	const commands = bar.overflow.items.filter(item => item.type === 'command').map(item => item.command);
	t.assert(commands.includes('luaProgram.source') && commands.includes('luaProgram.selectInstance') && new Set(commands).size === commands.length,
		'primary overflow and filtered secondary context are not one complete command set');
	t.assert(!commands.includes('luaProgram.more') && !commands.includes('luaProgram.testInput'), 'the popup contains nested More or an ineligible input-only command');
	await click(8, input.live.layout.contentTop + input.live.layout.rowHeight / 2);
	await click((more.bounds.left + more.bounds.right) / 2, (more.bounds.top + more.bounds.bottom) / 2);
	await capture(`program-more-pointer-${variant}-minimum`);
	await press('Escape');
	await press('Tab');
	await press('End');
	t.assert(bar.hasFocus && bar.focusedIndex === bar.items.length, 'Escape did not return to the actual content before keyboard More');
	await press('Enter');
	await capture(`program-more-keyboard-${variant}-minimum`);
	await press('Escape');
	t.assert(bar.hasFocus, 'keyboard More did not return to its actual toolbar');
	if (variant === 'tiny') await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
// Invoke the real source action through that same shared popup.
await press('Enter');
const eligible = input.actionBar.overflow.items.filter(entry => entry.type === 'command'
	&& !input.actionBar.items.some(item => item.command === entry.command && !item.enabled));
const sourceIndex = eligible.findIndex(item => item.command === 'luaProgram.source');
t.assert(sourceIndex >= 0, 'the actual Source action was not reachable');
await press('Home');
for (let row = 0; row < sourceIndex; row++) await press('ArrowDown');
await press('Enter');
await t.frames(3);
const source = t.activeWorkbenchTab();
t.assert(source.kind === 'code_editor' && source.workingCopy === input.workingCopy, 'minimum-toolbar Source lost its original authored working copy');
t.assert(input.workingCopy.buffer.getText() === authoredSource, 'presentation or popup navigation changed authored source');
