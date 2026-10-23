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
const physical = inspection.sections.map(section => ({ section, kind: section.kind, buffer: section.buffer,
	start: section.start, end: section.end, asset: section.asset }));
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
	t.assert(selected.start === section.start && selected.end === section.end && selected.type === section.kind,
		'the painted section click selected a different physical section');
	t.assert(range.start === section.start && range.end === section.end && range.kind === (section.buffer ?? section.kind),
		'the selected byte range no longer corresponds to the clicked original section');
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
		t.command('theme-toggle'); await t.frames(2);
		unchanged();
	}
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
t.assert(fonts.size === 2, 'the actual font command did not exercise both native font layouts');
t.openLuaSource('cart.lua'); await t.frames(2);
t.assert(t.activeWorkbenchTab().context.model === model, 'returning to source replaced the canonical source owner');
t.assert(await openCartridge() === rom, 'the ordinary chooser replaced the original installed snapshot input');
unchanged();
for (let index = 0; index < t.logMessageCount(); index++)
	t.assert(t.logMessage(index).level !== 3, `ROM workflow logged an error: ${t.logMessage(index).message}`);
