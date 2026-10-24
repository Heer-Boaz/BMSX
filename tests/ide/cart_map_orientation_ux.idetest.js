// Real authored coordinate planes; run with each completed shipped cartridge:
// npm run ide:test -- nemesis_s tests/ide/cart_map_orientation_ux.idetest.js --ttl 120
// npm run ide:test -- pietious tests/ide/cart_map_orientation_ux.idetest.js --ttl 120
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true }))); await t.frames(2);
	t.controlInput(codes.map(code => ({ type: 'key', code, down: false }))); await t.frames(2);
};
const click = async bounds => {
	t.controlInput([{ type: 'pointer', x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 },
		{ type: 'button', button: 'primary', down: true }]); await t.frames(1);
	t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(2);
};
await t.waitForCart(); await t.frames(90); t.openLuaSource('cart.lua'); await t.frames(2);
t.command('cartMap'); await t.frames(2); await press('Enter'); await t.frames(3);
const input = t.activeWorkbenchTab();
t.assert(input.kind === 'cart_map' && (input.mapKind === 'nemesis' || input.mapKind === 'pietious'), 'the actual shipped map chooser did not open');
const model = input.workingCopy, source = model.buffer.getText(), version = model.version;
const cycles = t.runtime().machine.scheduler.nowCycles, initialRange = { ...input.selectionRange }, grid = input.grid;
let captures = 0;
const unchanged = () => {
	t.assert(t.activeWorkbenchTab() === input && model.buffer.getText() === source && !model.dirty && model.version === version,
		'coordinate orientation changed the canonical authored source or input');
	t.assert(t.runtime().machine.scheduler.nowCycles === cycles, 'coordinate orientation advanced paused gameplay');
};
const capture = async (label, keepPointer = false) => {
	t.assert(++captures <= 18, 'the orientation workflow exceeded its bounded capture budget');
	if (!keepPointer) t.controlInput([{ type: 'pointer', x: 382, y: 285 }]);
	await t.frames(2);
	t.log(JSON.stringify({ orientation: label, mode: input.layout.mode, width: input.layout.right - input.layout.left,
		selected: input.selected === undefined ? null : { x: input.selected.x, y: input.selected.y },
		sheet: { width: grid.content.width, height: grid.content.rows.length }, bounds: { ...grid.bounds },
		view: grid.captureView(), cells: { ...grid.visibleRange } }));
	t.log(`VISUAL ${label}`); t.capture(label); unchanged();
};
const action = async command => {
	const item = input.actionBar.items.find(item => item.command === command);
	t.assert(item.visible && !item.overflowed && item.enabled, `${command} is not a directly painted command`);
	await click(item.bounds);
};
const root = () => t.assert(input.selected === undefined && input.selectionRange.start === initialRange.start && input.selectionRange.end === initialRange.end,
	'orientation must not automatically replace the actual selected sheet with a marker');
for (const font of ['tiny', 'msx']) {
	for (const theme of ['light', 'dark']) {
		root(); t.assert(input.layout.mode === 'split' && input.layout.right - input.layout.left === 384, 'the initial sheet is not the full-width split');
		t.assert(grid.captureView().x === 0 && grid.captureView().y === 0, 'the initial sheet was silently panned to a marker');
		await capture(`orientation-${input.mapKind}-${font}-${theme}-wide-origin`);
		t.command('gameView.togglePanel'); await t.frames(3);
		t.controlInput([{ type: 'pointer', x: input.layout.right + 2, y: 80 }, { type: 'button', button: 'primary', down: true }]); await t.frames(1);
		t.controlInput([{ type: 'pointer', x: 50, y: 80 }]); await t.frames(2);
		t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(2);
		t.assert(input.layout.right - input.layout.left === (font === 'tiny' ? 78 : 118), 'the physical sash did not reach the supported font minimum');
		const tree = input.tree;
		await click({ left: tree.layout.contentLeft, right: tree.layout.contentRight, top: tree.layout.contentTop, bottom: tree.layout.contentTop + tree.layout.rowHeight });
		await press('Home'); await press('Enter'); root();
		t.assert(input.layout.mode === 'map' && grid.bounds.right - grid.bounds.left >= grid.cellSize * 8,
			'orientation consumed the eight-cell minimum or opened a hidden grid');
		await capture(`orientation-${input.mapKind}-${font}-${theme}-minimum-origin`);
		const x = grid.bounds.left + grid.cellSize * 2 + 1, y = grid.bounds.top + grid.cellSize + 1;
		t.controlInput([{ type: 'pointer', x, y }]); await t.frames(2);
		t.assert(grid.columnAt(x) === 2 && grid.rowAt(y) === 1, 'the actual pointer no longer addresses the authored cell plane');
		await capture(`orientation-${input.mapKind}-${font}-${theme}-hover-cell-2-1`, true);
		if (theme === 'light') {
			await press('ControlLeft', 'ShiftLeft', 'KeyP');
			await capture(`orientation-${input.mapKind}-${font}-palette-retires-hover`, true);
			await press('Escape'); unchanged();
		}
		await action('cartMap.outline'); await press('Home'); await press('ArrowDown');
		if (input.mapKind === 'pietious') {
			t.assert(tree.rows[tree.selectionIndex].element.sheet.key === '2' && tree.rows[tree.selectionIndex].collapsed,
				'ordinary navigation did not reach the closed authored ROOM 2 branch');
			await press('ArrowRight'); await press('ArrowDown');
		}
		const selected = input.selected;
		t.assert(selected !== undefined && selected.x === (input.mapKind === 'nemesis' ? 257 : 14) && selected.y === (input.mapKind === 'nemesis' ? 1 : 3),
			'ordinary Outline navigation did not select the actual authored marker');
		await press('Enter');
		const left = grid.bounds.left + selected.x * grid.cellSize - grid.horizontal.getScroll();
		const top = grid.bounds.top + selected.y * grid.cellSize - grid.vertical.getScroll();
		t.assert(left >= grid.bounds.left && left + grid.cellSize <= grid.bounds.right && top >= grid.bounds.top && top + grid.cellSize <= grid.bounds.bottom,
			'explicit Map navigation did not reveal its selected source identity');
		await capture(`orientation-${input.mapKind}-${font}-${theme}-explicit-selected-map`);
		await action('cartMap.outline'); await press('Home'); await press('Enter');
		t.controlInput([{ type: 'key', code: 'ShiftLeft', down: true }, { type: 'pointer', x: grid.bounds.left + 8, y: grid.bounds.top + 8 },
			{ type: 'wheel', deltaY: -1000 }, { type: 'key', code: 'ShiftLeft', down: false }, { type: 'wheel', deltaY: -1000 }]); await t.frames(2);
		await action('cartMap.outline');
		if (input.mapKind === 'pietious') {
			await press('ArrowDown');
			t.assert(tree.rows[tree.selectionIndex].element.sheet.key === '2' && !tree.rows[tree.selectionIndex].collapsed,
				'the selected room did not retain its real expanded branch');
			await press('ArrowLeft'); t.assert(tree.rows[tree.selectionIndex].collapsed, 'Left did not collapse the selected authored room');
			await press('Home');
		}
		root(); unchanged();
		t.command('gameView.closePanel'); await t.frames(3); t.command('theme-toggle'); await t.frames(2);
	}
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
unchanged(); root(); t.assert(captures === 18, 'the orientation matrix did not capture every declared state');
for (let index = 0; index < t.logMessageCount(); index++)
	t.assert(t.logMessage(index).level !== 3, `Cart Map orientation logged an error: ${t.logMessage(index).message}`);
