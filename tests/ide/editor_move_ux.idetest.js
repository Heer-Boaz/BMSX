// Real Workbench input on the dedicated Studio cart. No source/model injection.
// npm run ide:test -- studio_test tests/ide/editor_move_ux.idetest.js --ttl 180
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true }))); await t.frames(2);
	t.controlInput(codes.slice().reverse().map(code => ({ type: 'key', code, down: false }))); await t.frames(2);
};
const type = async text => {
	for (const character of text) await press(character === ' ' ? 'Space' : `Key${character.toUpperCase()}`);
};
const capture = async label => { await t.frames(3); t.log(`VISUAL ${label}`); t.capture(label); };
const menuAction = async command => {
	t.command('group.focusTabs'); await press('ContextMenu');
	const menu = t.contextMenu();
	t.assert(menu.visible && menu.model.rows.some(row => row.command === command && row.enabled), 'the actual tab menu did not admit its move action');
	await press('Home');
	for (let row = 0; row < menu.model.rows.length && menu.model.rows[menu.model.selectedIndex]?.command !== command; row++) await press('ArrowDown');
	t.assert(menu.model.rows[menu.model.selectedIndex]?.command === command, 'menu navigation did not reach the contextual operation');
	await press('Enter'); await t.frames(3);
};
const intoMain = async () => {
	await type('main workspace'); await press('Enter'); await type('into'); await press('Enter'); await t.frames(3);
};

await t.waitForCart(); await t.frames(90);
const documents = [];
for (const path of ['cart.lua', 'scenes/root.lua']) {
	t.openLuaSource(path); await t.frames(3);
	const input = t.activeWorkbenchTab(), model = input.workingCopy;
	documents.push({ input, model, source: model.buffer.getText(), version: model.version, history: model.history });
}
const main = t.activeEditorGroup(), original = documents[1].input, other = documents[0].input;
const members = [...main.model.tabs], cycles = t.runtime().machine.scheduler.nowCycles;
const media = t.sourceState().currentBlua32Media;
const unchanged = () => {
	for (const document of documents) t.assert(document.model.buffer.getText() === document.source && document.model.version === document.version
		&& document.model.history === document.history && !document.model.dirty, 'moving presentation altered canonical source, history or clean state');
	t.assert(t.runtime().machine.scheduler.nowCycles === cycles && t.sourceState().currentBlua32Media === media, 'moving editors executed or replaced the guest');
};
const returned = () => {
	t.assert(t.activeEditorGroup() === main && main.model.activeTab === original && main.model.tabs.length === members.length,
		'returning did not retain the original editor group and exact input count');
	t.assert(members.every(input => main.model.tabs.includes(input)) && main.model.tabs.filter(input => input.id === original.id).length === 1,
		'returning lost another editor or duplicated the source input');
	unchanged();
};

for (const font of ['tiny', 'msx']) {
	for (const theme of ['light', 'dark']) {
		const label = `editor-move-${font}-${theme}`;
		await menuAction('window.moveEditor'); await type('main workspace');
		await capture(`${label}-target`); await press('Enter');
		returned(); await capture(`${label}-placement`);
		await press('AltLeft', 'ArrowLeft'); returned(); await capture(`${label}-back`);
		await press('Escape'); returned();
		t.assert(!t.activeEditorDocument().focusTarget.hasFocus, 'cancelling a tab invocation incorrectly entered the editor body');

		await menuAction('window.moveEditor'); await type('new editor window'); await press('Enter'); await t.frames(3);
		const floating = t.activeEditorGroup();
		t.assert(floating !== main && floating.model.activeTab === original && !main.model.contains(original) && main.model.contains(other),
			'New Window did not transfer the exact source membership');
		await capture(`${label}-new-window`); unchanged();
		t.command('group.move'); await t.frames(3); await type('main workspace'); await press('Enter'); unchanged();
		t.assert(floating.model.activeTab === original && !main.model.contains(original), 'group target acceptance transferred membership before placement');
		await capture(`${label}-group-placement`); await type('merge'); await press('Enter'); await t.frames(3); returned();
		t.assert(floating.surface.retired, 'whole-group return did not retire its departed floating owner');

		await menuAction('window.moveEditor'); await type('main workspace'); await press('Enter');
		await type(font === 'tiny' ? 'right' : 'below'); await press('Enter'); await t.frames(3);
		const split = t.activeEditorGroup();
		t.assert(split !== main && split.model.activeTab === original && !main.model.contains(original) && main.model.contains(other),
			'the selected split did not transfer exactly one input');
		await capture(`${label}-split`); unchanged();
		await menuAction('window.moveEditor'); await type('main workspace group '); await press('Digit1'); await press('Enter');
		await type('into'); await press('Enter'); await t.frames(3); returned();

		t.command('window.copyEditor'); await t.frames(3);
		const copy = t.activeWorkbenchTab();
		t.assert(copy !== original && copy.workingCopy === original.workingCopy, 'New View did not share its canonical document');
		await menuAction('window.moveEditor'); await intoMain(); returned();
		t.assert(!main.model.tabs.includes(copy), 'merging an independent view left a redundant tab');
		await capture(`${label}-coalesced`);
		t.command('theme-toggle'); await t.frames(3);
	}
	await press('ControlLeft', 'ShiftLeft', 'KeyT'); await t.frames(3);
}
for (let index = 0; index < t.logMessageCount(); index++)
	t.assert(t.logMessage(index).level !== 3, `editor move workflow logged an error: ${t.logMessage(index).message}`);
t.log('Completed contextual move target/placement, Back/cancel, floating return, splitting and same-document coalescence in both fonts/themes.');
