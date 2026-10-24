// Real authored maps; run once with each completed cartridge:
// npm run ide:test -- nemesis_s tests/ide/cart_map_responsive_ux.idetest.js --ttl 120
// npm run ide:test -- pietious tests/ide/cart_map_responsive_ux.idetest.js --ttl 120
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true }))); await t.frames(2);
	t.controlInput(codes.map(code => ({ type: 'key', code, down: false }))); await t.frames(2);
};
const click = async bounds => {
	t.controlInput([{ type: 'pointer', x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 },
		{ type: 'button', button: 'primary', down: true }]); await t.frames(1);
	t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(2);
};
let captures = 0, panelOpen = false;
const capture = async label => {
	t.assert(++captures <= 24, 'the responsive map workflow exceeded its capture budget');
	t.controlInput([{ type: 'pointer', x: 2, y: 285 }]); await t.frames(2);
	t.log(`VISUAL ${label}`); t.capture(label);
};
await t.waitForCart(); await t.frames(90); t.openLuaSource('cart.lua'); await t.frames(2);
t.command('cartMap'); await t.frames(2); await press('Enter'); await t.frames(3);
const input = t.activeWorkbenchTab();
t.assert(input.kind === 'cart_map' && (input.mapKind === 'nemesis' || input.mapKind === 'pietious'), 'the actual cartridge map chooser did not open');
const model = input.workingCopy, source = model.buffer.getText(), cycles = t.runtime().machine.scheduler.nowCycles;
const path = input.mapKind === 'nemesis' ? 'res/data/nemesis_s_stage.yaml' : 'res/data/castle_map.yaml';
t.assert(model.resource.path === path && !model.dirty, 'the map lost its original canonical YAML resource');
const action = command => input.actionBar.items.find(item => item.command === command);
const clickAction = async command => {
	const item = action(command);
	t.assert(item.visible && !item.overflowed && item.enabled, `${command} is not a directly painted action`);
	await click(item.bounds);
};
const unchanged = () => {
	t.assert(model.buffer.getText() === source && !model.dirty, 'navigation or a cancelled map draft changed canonical YAML');
	t.assert(t.runtime().machine.scheduler.nowCycles === cycles, 'map authoring advanced the paused scheduler');
};
const resize = async right => {
	t.controlInput([{ type: 'pointer', x: input.layout.right + 2, y: 80 }, { type: 'button', button: 'primary', down: true }]); await t.frames(1);
	t.controlInput([{ type: 'pointer', x: right, y: 80 }]); await t.frames(2);
	t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(2);
};
const minimum = async variant => {
	if (!panelOpen) { t.command('gameView.togglePanel'); await t.frames(3); panelOpen = true; }
	await resize(50);
	t.assert(input.layout.right - input.layout.left === (variant === 'tiny' ? 78 : 118), 'the physical sash did not reach the font minimum');
};
const full = async () => {
	if (panelOpen) { t.command('gameView.closePanel'); await t.frames(3); panelOpen = false; }
	t.assert(input.layout.right - input.layout.left === 384 && input.layout.mode === 'split', 'the full map is not a readable split');
};
const outline = () => {
	t.assert(input.layout.mode === 'outline' && input.section === 'outline', 'compact Outline is not the actual active client');
	t.assert(input.tree.layout.contentRight - input.tree.layout.contentLeft >= input.layout.right - input.layout.left - 12,
		'the compact outline retained its unreadable split column');
	t.assert(input.grid.bounds.left === input.grid.bounds.right && input.grid.bounds.top === input.grid.bounds.bottom, 'the hidden grid retained a hit rectangle');
	for (const bounds of input.fieldBounds) t.assert(bounds.left === bounds.right && bounds.top === bounds.bottom, 'a hidden coordinate retained a hit rectangle');
	t.assert(action('cartMap.map').visible && !action('cartMap.map').overflowed && action('cartMap.map').icon === 'grid', 'compact Map is not an accessible native icon');
};
const visibleMember = () => {
	const grid = input.grid, item = input.selected, left = grid.bounds.left + item.x * grid.cellSize - grid.horizontal.getScroll();
	const top = grid.bounds.top + item.y * grid.cellSize - grid.vertical.getScroll();
	t.assert(left >= grid.bounds.left && left + grid.cellSize <= grid.bounds.right && top >= grid.bounds.top && top + grid.cellSize <= grid.bounds.bottom,
		'explicit Map navigation did not reveal the actual selected authored cell');
};
const map = () => {
	t.assert(input.layout.mode === 'map' && input.section === 'map', 'compact Map is not the actual active client');
	t.assert(input.tree.layout.visibleRowCount === 0 && input.tree.layout.contentTop === input.tree.layout.contentBottom, 'the hidden outline retained rows');
	t.assert(input.grid.bounds.right - input.grid.bounds.left >= input.grid.cellSize * 8, 'the compact grid cannot display eight authored cells');
	for (const bounds of input.fieldBounds) t.assert(bounds.right - bounds.left >= input.layout.fieldMinimumWidth, 'a visible coordinate field cannot display a full register-sized integer');
	t.assert(action('cartMap.outline').visible && !action('cartMap.outline').overflowed && action('cartMap.outline').icon === 'back', 'compact Back is not directly accessible');
	visibleMember();
};
const tree = input.tree;
await click({ left: tree.layout.contentLeft, right: tree.layout.contentRight, top: tree.layout.contentTop, bottom: tree.layout.contentTop + tree.layout.rowHeight });
await press('Home'); await press('ArrowDown');
if (input.mapKind === 'pietious') { await press('ArrowRight'); await press('ArrowDown'); }
const subject = input.selected, range = { ...input.selectionRange }, initialX = input.mapKind === 'nemesis' ? 257 : 14;
t.assert(subject !== undefined && subject.x === initialX && subject.y === (input.mapKind === 'nemesis' ? 1 : 3), 'ordinary tree navigation selected another authored member');
const sameSubject = () => t.assert(input.selected !== undefined && input.selected.x === subject.x && input.selected.y === subject.y
	&& input.selected.glyph === subject.glyph && input.selectionRange.start === range.start && input.selectionRange.end === range.end,
	'responsive navigation changed the selected authored source identity');
let edited;
if (input.mapKind === 'nemesis') {
	t.assert(source.slice(range.start, range.end + 1) === 'm ', 'the chosen authored marker has no empty right-hand cell');
	edited = source.slice(0, range.start) + ' m' + source.slice(range.end + 1);
} else {
	const [start, end] = subject.source.xNode.range;
	t.assert(source.slice(start, end) === '14', 'the chosen room object has another authored X token');
	edited = source.slice(0, start) + '15' + source.slice(end);
}
const typeDigits = async value => { for (const digit of String(value)) await press(`Digit${digit}`); };
for (const variant of ['tiny', 'msx']) {
	await full(); await capture(`map-${input.mapKind}-${variant}-wide-split`);
	await minimum(variant);
	// The Game Panel may own focus after opening; focus the actually visible tree.
	const selectedTop = tree.layout.contentTop + (tree.selectionIndex - (tree.scroll | 0)) * tree.layout.rowHeight;
	await click({ left: tree.layout.contentLeft, right: tree.layout.contentRight, top: selectedTop, bottom: selectedTop + tree.layout.rowHeight });
	for (let theme = 0; theme < 2; theme++) {
		outline(); sameSubject(); unchanged();
		await capture(`map-${input.mapKind}-${variant}-theme-${theme}-outline`);
		await press('Tab'); t.assert(input.actionBar.hasFocus, 'Outline Tab visited a hidden grid or coordinate field'); await press('Escape');
		await press('Enter'); map(); sameSubject(); unchanged();
		await capture(`map-${input.mapKind}-${variant}-theme-${theme}-selected-map`);
		await clickAction('cartMap.outline'); outline(); sameSubject(); unchanged();
		t.command('theme-toggle'); await t.frames(2);
	}
	await clickAction('cartMap.map'); map();
	await press('Tab'); await press('ControlLeft', 'KeyA'); await typeDigits(initialX + 1);
	unchanged(); await capture(`map-${input.mapKind}-${variant}-pending-x-compact`);
	await resize(300);
	t.assert(input.layout.mode === 'split' && input.section === 'map', 'physical widening lost the pending coordinate client');
	unchanged(); await capture(`map-${input.mapKind}-${variant}-pending-x-wide`);
	// The last digit is a separate local edit; its Undo must survive the sash reflow.
	await press('Digit9'); await press('ControlLeft', 'KeyZ'); await press('Enter');
	t.assert(model.buffer.getText() === edited && model.dirty && input.selected.x === initialX + 1,
		'resizing or local Undo lost the pending coordinate or changed unrelated YAML bytes');
	visibleMember(); await capture(`map-${input.mapKind}-${variant}-accepted-x`);
	await press('ControlLeft', 'KeyZ'); unchanged(); sameSubject();
	await press('ControlLeft', 'KeyY');
	t.assert(model.buffer.getText() === edited && input.selected.x === initialX + 1, 'document Redo did not restore the exact authored move');
	await press('ControlLeft', 'KeyZ'); unchanged(); sameSubject();
	await click(input.fieldBounds[0]); await press('ControlLeft', 'KeyA'); await press('Minus');
	await resize(50); await press('Enter');
	t.assert(input.layout.mode === 'map', 'an invalid pending coordinate lost its compact Map client');
	unchanged(); await capture(`map-${input.mapKind}-${variant}-invalid-x-resized`);
	await press('Escape'); t.assert(input.layout.mode === 'map', 'field Escape skipped its owning grid');
	await press('Escape'); outline(); unchanged(); sameSubject();
	await clickAction('cartMap.map'); await press('Tab'); await press('Tab');
	await press('ControlLeft', 'KeyA'); await typeDigits(subject.y + 1); unchanged();
	await capture(`map-${input.mapKind}-${variant}-pending-y-cancel`);
	await press('Escape'); await press('Escape'); outline(); unchanged(); sameSubject();
	const position = { row: 0, column: 0 }; model.buffer.positionAt(input.selectionRange.start, position);
	await clickAction('cartMap.source');
	const code = t.activeWorkbenchTab();
	t.assert(code.kind === 'code_editor' && code.workingCopy === model && code.context.view.cursorRow === position.row
		&& code.context.view.cursorColumn === position.column, 'Source lost the canonical YAML model or encoded source position');
	await capture(`map-${input.mapKind}-${variant}-canonical-source`);
	t.command('cartMap'); await t.frames(3);
	t.assert(t.activeWorkbenchTab() === input, 'returning from Source replaced the retained map input');
	unchanged(); sameSubject();
	await full(); await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
// Wheel pan owns its leading world cell; a font change must not substitute selection reveal.
const grid = input.grid;
const beforeWheel = grid.captureView();
t.controlInput([{ type: 'key', code: 'ShiftLeft', down: true }, { type: 'pointer', x: grid.bounds.left + 8, y: grid.bounds.top + 8 },
	{ type: 'wheel', deltaY: -0.0625 }, { type: 'key', code: 'ShiftLeft', down: false }]); await t.frames(2);
const leading = grid.captureView(), pixelScroll = grid.horizontal.getScroll();
t.assert(leading.x > 0 && leading.x !== beforeWheel.x && leading.reveal === undefined,
	'ordinary grid wheel input did not pan to an independent nonzero world-cell bookmark');
await capture(`map-${input.mapKind}-tiny-leading-world-cell`);
await press('ControlLeft', 'ShiftLeft', 'KeyT');
t.assert(grid.captureView().x === leading.x && grid.captureView().y === leading.y
	&& grid.horizontal.getScroll() !== pixelScroll, 'font reflow retained pixel scroll instead of the actual leading world cell');
await capture(`map-${input.mapKind}-msx-leading-world-cell`);
await press('ControlLeft', 'ShiftLeft', 'KeyT');
sameSubject(); unchanged();
t.assert(captures === 24, 'the responsive map workflow did not capture every bounded state');
unchanged();
for (let index = 0; index < t.logMessageCount(); index++)
	t.assert(t.logMessage(index).level !== 3, `Map workflow logged an error: ${t.logMessage(index).message}`);
