// Shipped source assets open through Go to File and retain real image interaction across views.
// Run: npm run ide:test -- nemesis_s tests/ide/resource_image_ux.idetest.js
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true }))); await t.frames(2);
	t.controlInput(codes.slice().reverse().map(code => ({ type: 'key', code, down: false }))); await t.frames(2);
};
const type = async text => { for (const letter of text) await press(letter === ' ' ? 'Space' : `Key${letter.toUpperCase()}`); };
const capture = async label => { await t.frames(2); t.log(`VISUAL ${label}`); t.capture(label); };
const menu = async () => {
	await press('ContextMenu');
	t.assert(t.contextMenu().visible, 'the focused resource client must expose its actual context actions');
};
const accept = async command => {
	const menu = t.contextMenu();
	t.assert(menu.visible && menu.model.rows.some(row => row.command === command && row.enabled), 'the resource context must admit its requested action');
	await press('Home');
	for (let step = 0; step < menu.model.rows.length && menu.model.rows[menu.model.selectedIndex]?.command !== command; step++) await press('ArrowDown');
	t.assert(menu.model.rows[menu.model.selectedIndex]?.command === command, 'ordinary menu navigation must reach the admitted resource action');
	await press('Enter'); await t.frames(3);
};
await t.waitForCart(); await t.frames(90); t.openLuaSource('cart.lua'); await t.frames(3);
const model = t.activeWorkbenchTab().workingCopy, source = model.buffer.getText(), version = model.version, history = model.history;
const cycles = t.runtime().machine.scheduler.nowCycles;
t.command('resourceSearch'); await t.frames(2); await type('konami'); await press('Enter'); await t.frames(3);
const input = t.activeWorkbenchTab(), group = t.activeEditorGroup();
t.assert(input.kind === 'resource_view' && input.resource.source.type === 'image' && input.resource.source.resid === 'intro_konami',
	'ordinary source-file search must open the exact shipped authored image in its default editor');
const bitmap = input.preview?.bitmap;
t.assert(bitmap !== undefined && input.view.contentView === 'preview', 'the real image editor must prepare visible pixels rather than a blank reserved rectangle');
const unchanged = () => {
	t.assert(input.preview.bitmap === bitmap && t.activeWorkbenchTab() === input, 'resource interaction replaced the actual image or retained input');
	t.assert(model.buffer.getText() === source && model.version === version && model.history === history && !model.dirty,
		'resource viewing changed canonical source or its history');
	t.assert(t.runtime().machine.scheduler.nowCycles === cycles, 'read-only resource interaction executed the paused guest');
};
for (const font of ['tiny', 'msx']) {
	for (const theme of ['light', 'dark']) {
		await capture(`resource-image-${font}-${theme}-fit`);
		await menu(); await accept('image.actualSize');
		for (let step = 0; step < 3; step++) await press('Equal');
		t.assert(input.preview.view.mode === 8, 'the local image commands and keyboard must share the retained viewport zoom');
		const view = input.preview.view, bounds = view.bounds, before = view.horizontal.getScroll();
		const x = (bounds.left + bounds.right) / 2, y = (bounds.top + bounds.bottom) / 2;
		t.controlInput([{ type: 'pointer', x, y }, { type: 'button', button: 'primary', down: true }]); await t.frames(1);
		t.controlInput([{ type: 'pointer', x: x - 20, y: y - 12 }]); await t.frames(2);
		t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(2);
		t.assert(view.horizontal.getScroll() !== before, 'ordinary dragging must pan the zoomed image'); unchanged();
		await capture(`resource-image-${font}-${theme}-panned`);
		// Pointer menus and keyboard menus address the same concrete image client.
		t.controlInput([{ type: 'pointer', x, y }, { type: 'button', button: 'secondary', down: true }]); await t.frames(1);
		t.controlInput([{ type: 'button', button: 'secondary', down: false }]); await t.frames(2);
		await capture(`resource-image-${font}-${theme}-context`); await accept('resourceViewer.info');
		t.assert(input.view.contentView === 'info' && input.preview.view.mode === 8, 'information reading discarded the image viewport');
		await press('End'); await capture(`resource-image-${font}-${theme}-info`); unchanged();
		await menu(); await accept('resourceViewer.preview');
		t.assert(input.preview.view.mode === 8, 'returning to the image must preserve zoom and pan rather than preparing another bitmap');
		await menu(); await accept('image.fit'); t.assert(input.preview.view.mode === 'fit', 'Fit must restore the real image viewport');
		unchanged(); t.command('theme-toggle'); await t.frames(2);
	}
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
t.command('window.copyEditor'); await t.frames(3);
const copy = t.activeWorkbenchTab();
t.assert(copy !== input && copy.resource === input.resource && copy.preview.bitmap !== bitmap && copy.preview.view !== input.preview.view,
	'a new resource window must retain an independent view over the same admitted source');
t.command('window.moveEditor'); await t.frames(2); await type('main workspace'); await press('Enter'); await t.frames(4);
t.assert(t.activeEditorGroup() === group && t.activeWorkbenchTab() === input, 'returning the resource window must reveal its retained matching editor');
unchanged();
for (let index = 0; index < t.logMessageCount(); index++)
	t.assert(t.logMessage(index).level !== 3, `Resource image workflow logged an error: ${t.logMessage(index).message}`);
