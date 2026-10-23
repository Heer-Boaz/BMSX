// Real installed Nemesis ROM: semantic map colours without changing physical byte attribution.
// Run: npm run ide:test -- nemesis_s tests/ide/rom_inspector_colors.idetest.js
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true }))); await t.frames(2);
	t.controlInput(codes.map(code => ({ type: 'key', code, down: false }))); await t.frames(2);
};
const click = async (x, y) => {
	t.controlInput([{ type: 'pointer', x, y }, { type: 'button', button: 'primary', down: true }]); await t.frames(1);
	t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(2);
};
const capture = async label => { await t.frames(2); t.log(`VISUAL ${label}`); t.capture(label); };
const openCartridge = async () => {
	t.command('romInspector'); await t.frames(2);
	await press('ArrowDown'); await press('Enter'); await t.frames(3);
	const input = t.activeWorkbenchTab();
	t.assert(input.kind === 'rom_inspector' && input.snapshot.domain === 0, 'the ordinary ROM chooser did not open the installed cartridge');
	return input;
};

await t.waitForCart(); await t.frames(90);
t.openLuaSource('cart.lua'); await t.frames(2);
const authored = t.activeWorkbenchTab(), model = authored.context.model;
const source = model.buffer.getText(), sourceVersion = model.version;
const rom = await openCartridge(), snapshot = rom.snapshot, inspection = rom.model.inspection;
const cycles = t.runtime().machine.scheduler.nowCycles;
const physical = inspection.sections.map((section, index) => ({ section, row: rom.model.sections[index],
	category: rom.model.sections[index].category, kind: section.kind, buffer: section.buffer,
	start: section.start, end: section.end, asset: section.asset }));
const keyEntries = rom.model.keyEntries;
const keyFacts = keyEntries.map(entry => ({ entry, category: entry.category, color: entry.category.color,
	byteLength: entry.byteLength, sizeText: entry.sizeText }));
t.assert(!rom.keyWindow.open, 'a new ROM input opened a permanent key overlay without a request');
t.assert(keyEntries.reduce((sum, entry) => sum + entry.byteLength, 0) === snapshot.rom.byteLength,
	'the map key Total counts logical asset attribution instead of disjoint physical bytes');
for (const entry of keyEntries) t.assert(entry.byteLength === rom.model.sections.reduce((sum, row) =>
	sum + (row.category === entry.category ? row.byteLength : 0), 0), 'a key category does not match its actual physical sections');
t.assert(physical.length > 0 && physical[0].start === 0, 'physical inspection does not start at the installed ROM header');
for (let index = 0; index < physical.length; index++) {
	const section = physical[index];
	t.assert(section.end > section.start && section.end <= snapshot.rom.byteLength, 'a physical section has invented or out-of-ROM bytes');
	if (index > 0) t.assert(physical[index - 1].end === section.start, 'physical sections overlap or omit bytes');
}
t.assert(physical.at(-1).end === snapshot.rom.byteLength, 'physical inspection does not cover the actual installed image');
t.assert(physical.some(section => section.kind === 'blua32'), 'the installed compiled cartridge has no physical program image');
const atlasImages = rom.model.assets.filter(row => row.type === 'image' && row.asset.start === undefined
	&& row.ranges.some(range => range.kind === 'metadata'));
t.assert(atlasImages.length > 0, 'the shipped atlas image entries did not exercise images without their own pixel payload');
t.assert(atlasImages.some(row => row.ranges.some(range => range.kind === 'collision')),
	'the shipped atlas images did not exercise a real auxiliary collision buffer');
for (const row of atlasImages) {
	t.assert(!physical.some(section => section.asset === row.asset && section.buffer === 'data'),
		'an atlas image without stored pixels acquired an invented primary data span');
	for (const range of row.ranges) if (range.kind === 'collision')
		t.assert(physical.some(section => section.asset === row.asset && section.buffer === 'collision'
			&& section.start === range.start && section.end === range.end),
			'the absence of an image pixel payload removed or resized its actual collision span');
}

const unchanged = () => {
	t.assert(t.activeWorkbenchTab() === rom && rom.snapshot === snapshot && rom.model.inspection === inspection,
		'presentation replaced the retained installed-ROM input or its immutable inspection');
	t.assert(inspection.sections.length === physical.length, 'filter, order, selection or theme changed the physical section count');
	for (let index = 0; index < physical.length; index++) {
		const before = physical[index], after = inspection.sections[index];
		t.assert(after === before.section && after.kind === before.kind && after.buffer === before.buffer
			&& after.start === before.start && after.end === before.end && after.asset === before.asset,
			'presentation reclassified, reordered or resized the physical ROM map');
	}
	t.assert(rom.model.keyEntries === keyEntries && keyEntries.length === keyFacts.length, 'presentation rebuilt snapshot key accounting');
	for (let index = 0; index < keyFacts.length; index++) {
		const before = keyFacts[index], entry = keyEntries[index];
		t.assert(entry === before.entry && entry.category === before.category && entry.category.color === before.color
			&& entry.byteLength === before.byteLength && entry.sizeText === before.sizeText,
			'theme, font, filter or selection changed a category identity, colour or physical byte count');
	}
	t.assert(model.buffer.getText() === source && model.version === sourceVersion, 'ROM inspection changed canonical authored source');
	t.assert(t.runtime().machine.scheduler.nowCycles === cycles, 'ROM presentation advanced the paused guest');
};
const filterAssets = async () => {
	t.command('romInspector.assets'); await t.frames(2);
	const bounds = rom.filterBounds;
	await click((bounds.left + bounds.right) / 2, (bounds.top + bounds.bottom) / 2);
	await press('ControlLeft', 'KeyA');
	for (const character of 'KONAMI') await press(`Key${character}`);
	await press('Enter');
	t.assert(rom.model.filter.toLowerCase() === 'konami' && rom.model.rows.length > 0
		&& rom.model.rows.length < rom.model.assets.length, 'the real filter field did not project the installed assets');
	unchanged();
	t.command('romInspector.sort'); await t.frames(2);
	await press('Home'); await press('ArrowDown'); await press('ArrowDown'); await press('Enter'); await t.frames(2);
	t.assert(rom.model.sort === 'size' && rom.model.descending, 'the actual Sort chooser did not select largest-first order');
	unchanged();
	// Mode changes deliberately retain the user's filter. Only a map click below
	// clears it, then selects from the complete physical Layout projection.
	t.command('romInspector.structure'); await t.frames(2);
	t.assert(rom.model.filter.toLowerCase() === 'konami', 'switching table mode discarded the actual filter text');
	unchanged();
};
const selectMapSection = async section => {
	const map = rom.mapBounds, width = map.right - map.left;
	const left = map.left + Math.trunc(section.start / snapshot.rom.byteLength * width);
	const right = map.left + Math.trunc(section.end / snapshot.rom.byteLength * width);
	t.assert(right - left >= 2 && left >= map.left && right <= map.right, 'the chosen actual section has no safely hittable projected interior');
	const x = (left + right) / 2, offset = (x - map.left) / width * snapshot.rom.byteLength;
	t.assert(offset >= section.start && offset < section.end, 'the pointer would not hit the original physical byte range');
	await click(x, (map.top + map.bottom) / 2);
	const selected = rom.model.selection, range = rom.model.selectedRange;
	t.assert(rom.model.mode === 'structure' && rom.model.filter === '', 'a physical map click retained an asset-list filter or another table mode');
	t.assert(selected === section.row && selected.start === section.start && selected.end === section.end
		&& selected.category === section.category && selected.type === section.category.id,
		'the painted section click selected a different physical section');
	t.assert(range.start === section.start && range.end === section.end && range.kind === (section.buffer ?? section.kind),
		'the selected byte range no longer corresponds to the clicked original section');
	unchanged();
};

const keyPalette = async () => {
	await press('ControlLeft', 'ShiftLeft', 'KeyP');
	for (const character of 'ROM Inspector Show Map Key') await press(character === ' ' ? 'Space' : `Key${character.toUpperCase()}`);
	await press('Enter'); await t.frames(2);
	t.assert(rom.keyWindow.open, 'the actual command palette did not open the snapshot map key');
};
const keyActions = command => rom.keyActions.items.find(item => item.command === command);
const keyWorkflow = async (variant, theme) => {
	const map = { ...rom.mapBounds }, list = { ...rom.list.bounds };
	if (theme === 0) {
		const action = rom.actions.items.find(item => item.command === 'romInspector.key');
		t.assert(action.visible && !action.overflowed && action.icon === 'info', 'Map Key is not a directly reachable native title icon');
		await click((action.bounds.left + action.bounds.right) / 2, (action.bounds.top + action.bounds.bottom) / 2);
	} else await keyPalette();
	t.assert(rom.keyWindow.open && !rom.keyWindow.collapsed, 'opening the requested key did not attach its expanded modeless window');
	t.assert(rom.mapBounds.left === map.left && rom.mapBounds.right === map.right && rom.mapBounds.top === map.top && rom.mapBounds.bottom === map.bottom
		&& rom.list.bounds.left === list.left && rom.list.bounds.right === list.right && rom.list.bounds.top === list.top && rom.list.bounds.bottom === list.bottom,
		'the on-demand key reserved another permanent header or reduced the ROM workspace');
	await capture(`rom-key-${variant}-theme-${theme}`);
	await press('Tab'); await press('Tab');
	t.assert(rom.keyActions.hasFocus, 'the key client/header/actions are not in the actual local Tab ring');
	await press('Escape');
	t.assert(rom.keyWindow.open, 'Escape hid the modeless map key');
	await press('End');
	t.assert(rom.model.selected === rom.model.rows.length - 1, 'Escape from the key did not return keyboard input to the ROM list');
	await press('Home');
	if (theme === 1) {
		const collapse = keyActions('window.collapse');
		await click((collapse.bounds.left + collapse.bounds.right) / 2, (collapse.bounds.top + collapse.bounds.bottom) / 2);
		t.assert(rom.keyWindow.collapsed && rom.keyWindow.bounds.bottom === rom.keyWindow.header.bottom, 'the key did not collapse to its actual titlebar');
		await capture(`rom-key-collapsed-${variant}`);
		const requested = { ...rom.keyWindow.requestedBounds };
		t.openLuaSource('cart.lua'); await t.frames(2);
		t.assert(t.activeWorkbenchTab().context.model === model && rom.keyWindow.open && rom.keyWindow.collapsed,
			'switching editors lost the original source or cleared the retained key intent');
		await capture(`rom-key-detached-${variant}`);
		t.assert(await openCartridge() === rom && rom.keyWindow.open && rom.keyWindow.collapsed,
			'reactivating the snapshot did not restore its exact collapsed key');
		t.assert(rom.keyWindow.requestedBounds.left === requested.left && rom.keyWindow.requestedBounds.top === requested.top
			&& rom.keyWindow.requestedBounds.right === requested.right && rom.keyWindow.requestedBounds.bottom === requested.bottom,
			'editor detachment replaced the retained key placement');
		await click((collapse.bounds.left + collapse.bounds.right) / 2, (collapse.bounds.top + collapse.bounds.bottom) / 2);
		t.assert(!rom.keyWindow.collapsed, 'the retained key could not expand after editor reactivation');
	}
	const close = keyActions('window.hide');
	await click((close.bounds.left + close.bounds.right) / 2, (close.bounds.top + close.bounds.bottom) / 2);
	t.assert(!rom.keyWindow.open, 'the actual window close action did not clear the key open intent');
	await keyPalette();
	t.assert(!rom.keyWindow.collapsed, 'ordinary key reopening changed its retained expanded presentation');
	await click((close.bounds.left + close.bounds.right) / 2, (close.bounds.top + close.bounds.bottom) / 2);
	t.assert(!rom.keyWindow.open, 'the reopened key did not close through its actual chrome');
	unchanged();
};

const fonts = new Set();
for (let font = 0; font < 2; font++) {
	const variant = rom.layout.font.variant; fonts.add(variant);
	for (let theme = 0; theme < 2; theme++) {
		t.command('romInspector.assets'); await t.frames(2);
		t.assert(rom.model.rows.length === rom.model.assets.length, 'the unfiltered Assets view omitted installed TOC entries');
		await capture(`rom-assets-${variant}-theme-${theme}`);
		t.command('romInspector.structure'); await t.frames(2);
		t.assert(rom.model.rows.length === physical.length, 'Layout fabricated logical asset spans or omitted physical sections');
		await capture(`rom-layout-${variant}-theme-${theme}`);
		unchanged();
		await filterAssets();
		if (theme === 0) await capture(`rom-filtered-layout-${variant}`);
		const map = rom.mapBounds, width = map.right - map.left, classes = new Set();
		const representatives = [];
		for (const section of physical) {
			const span = Math.trunc(section.end / snapshot.rom.byteLength * width) - Math.trunc(section.start / snapshot.rom.byteLength * width);
			const classification = `${section.kind}/${section.buffer ?? ''}/${section.asset?.type ?? ''}`;
			if (span < 2 || classes.has(classification)) continue;
			classes.add(classification); representatives.push(section);
			if (representatives.length === 4) break;
		}
		t.assert(representatives.length > 0, 'the actual proportional ROM map has no visible representative section');
		for (const section of representatives) await selectMapSection(section);
		if (theme === 1) await capture(`rom-map-selected-${variant}`);
		await keyWorkflow(variant, theme);
		t.command('theme-toggle'); await t.frames(2);
		unchanged();
	}
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
t.assert(fonts.size === 2, 'the actual font command did not exercise both native font layouts');
// The same real controls remain explained and reachable beside the Game Panel.
for (let font = 0; font < 2; font++) {
	const variant = rom.layout.font.variant;
	t.command('romInspector.assets'); await t.frames(2);
	const filter = rom.filterBounds;
	await click((filter.left + filter.right) / 2, (filter.top + filter.bottom) / 2);
	await press('ControlLeft', 'KeyA');
	for (const character of 'KONAMI') await press(`Key${character}`);
	await press('Enter'); await press('Home');
	t.assert(rom.model.selection.label === 'intro_konami' && rom.showingImage,
		'the actual image preview did not supply the content-toolbar minimum-width case');
	const keyAction = rom.actions.items.find(item => item.command === 'romInspector.key');
	t.controlInput([{ type: 'pointer', x: (keyAction.bounds.left + keyAction.bounds.right) / 2,
		y: (keyAction.bounds.top + keyAction.bounds.bottom) / 2 }]); await t.frames(2);
	t.assert(rom.actions.hoveredCommand === 'romInspector.key', 'the actual key icon did not receive hover');
	await capture(`rom-key-info-hint-${variant}`);
	if (font === 0) {
		t.command('gameView.togglePanel'); await t.frames(3);
		const sash = rom.actions.bounds.right + 6;
		t.controlInput([{ type: 'pointer', x: sash, y: 80 }, { type: 'button', button: 'primary', down: true }]); await t.frames(1);
		t.controlInput([{ type: 'pointer', x: 50, y: 80 }]); await t.frames(2);
		t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(2);
	}
	t.assert(rom.layout.right === (variant === 'tiny' ? 78 : 118), 'the real ROM sash did not reach the supported font minimum');
	for (const [bar, left] of [[rom.actions, rom.layout.left + 4], [rom.contentActions, rom.bytes.bounds.left + 4]]) {
		for (const item of bar.items) if (item.visible && !item.overflowed)
			t.assert(item.bounds.left >= left && item.bounds.right <= rom.layout.right - 4, 'a painted ROM action escaped its actual content region');
		if (bar.overflow.button.visible) t.assert(bar.overflow.button.bounds.left >= left
			&& bar.overflow.button.bounds.right <= rom.layout.right - 4, 'a ROM More icon escaped its actual content region');
		const commands = [...bar.items.filter(item => item.visible && !item.overflowed).map(item => item.command),
			...bar.overflow.items.filter(item => item.type === 'command').map(item => item.command)];
		t.assert(new Set(commands).size === commands.length, 'ROM overflow duplicated a still-painted primary action');
		if (bar === rom.actions) t.assert(commands.filter(command => command === 'romInspector.key').length === 1,
			'the key must be reachable exactly once, not forced into More as well as its primary icon');
	}
	const more = rom.actions.overflow.button;
	t.assert(more.visible, 'the supported ROM minimum did not expose its overflow actions');
	t.controlInput([{ type: 'pointer', x: (more.bounds.left + more.bounds.right) / 2,
		y: (more.bounds.top + more.bounds.bottom) / 2 }]); await t.frames(2);
	t.assert(rom.actions.hoveredCommand === more.command, 'the actual More control did not receive hover');
	await capture(`rom-more-hint-${variant}`);
	await click((more.bounds.left + more.bounds.right) / 2, (more.bounds.top + more.bounds.bottom) / 2);
	await capture(`rom-minimum-more-${variant}`); await press('Escape');
	await click((keyAction.bounds.left + keyAction.bounds.right) / 2, (keyAction.bounds.top + keyAction.bounds.bottom) / 2);
	t.assert(rom.keyWindow.open && rom.keyWindow.bounds.right > rom.layout.right,
		'the readable key was closed or incorrectly constrained to the narrow owning pane');
	await capture(`rom-minimum-root-key-${variant}`);
	// This selected palette action must resolve through the actual key client context.
	await press('ControlLeft', 'ShiftLeft', 'KeyP');
	for (const character of 'Window Close Window') await press(character === ' ' ? 'Space' : `Key${character.toUpperCase()}`);
	await press('Enter');
	t.assert(t.activeWorkbenchTab() === rom && !rom.keyWindow.open,
		'Window Close from the key client did not reach the actual window owner or closed the ROM editor instead');
	unchanged(); await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
t.command('gameView.closePanel'); await t.frames(3);
t.openLuaSource('cart.lua'); await t.frames(2);
t.assert(t.activeWorkbenchTab().context.model === model, 'returning to source replaced the canonical source owner');
t.assert(await openCartridge() === rom, 'the ordinary chooser replaced the original installed snapshot input');
unchanged();
for (let index = 0; index < t.logMessageCount(); index++)
	t.assert(t.logMessage(index).level !== 3, `ROM workflow logged an error: ${t.logMessage(index).message}`);
