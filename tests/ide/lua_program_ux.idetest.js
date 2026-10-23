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
