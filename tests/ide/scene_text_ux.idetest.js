// Real Workbench + dedicated declared fonts; no source/model injection or guest queries.
// npm run ide:test -- studio_test tests/ide/scene_text_ux.idetest.js --ttl 180
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true }))); await t.frames(2);
	t.controlInput(codes.slice().reverse().map(code => ({ type: 'key', code, down: false }))); await t.frames(2);
};
const type = async text => {
	for (const character of text) {
		if (character === '_') await press('ShiftLeft', 'Minus');
		else await press(character === '.' ? 'Period' : `Key${character.toUpperCase()}`);
	}
};
const pointer = async (point, down) => {
	t.controlInput([{ type: 'pointer', ...point }, { type: 'button', button: 'primary', down }]); await t.frames(3);
};
const click = async point => { await pointer(point, true); await pointer(point, false); };
const capture = async label => { await t.frames(3); t.log(`VISUAL ${label}`); t.capture(label); };
// Actual nontransparent glyph texels target input; coordinates are not assertions.
const inkPoint = packet => {
	const image = packet.bitmap.image, left = Math.round(packet.u0 * image.width), top = Math.round(packet.v0 * image.height);
	for (let y = 0; y < packet.height; y++) for (let x = 0; x < packet.width; x++) {
		if (image.pixels[((top + y) * image.width + left + x) * 4 + 3] === 0) continue;
		const u = (x + 0.5) / packet.width, v = (y + 0.5) / packet.height;
		return { x: packet.x + packet.xx * u + packet.yx * v, y: packet.y + packet.xy * u + packet.yy * v };
	}
	throw new Error('the declared glyph fixture has no selectable ink');
};
await t.waitForCart(); await t.frames(90); await press('ControlRight', 'ShiftRight');
t.command('sceneEditor'); await t.frames(3); await type('text.lua'); await press('Enter'); await t.frames(5);
const primary = t.mainWorkspace().primary, context = primary.consumer, model = context.workingCopy, view = primary.view.viewport;
t.assert(model.identity.path === 'scenes/text.lua', 'the dedicated authored text Scene did not become the Main subject');
const source = model.buffer.getText(), cycles = t.runtime().machine.scheduler.nowCycles, media = t.sourceState().currentBlua32Media;
t.command('sceneEditor.outline'); await press('Home'); await press('ArrowDown');
const glyphs = () => view.canvas.items.filter(item => item.source.entry === context.selection.entry);
const initial = () => {
	t.assert(model.buffer.getText() === source && !model.dirty && !model.canUndo, 'source/Undo did not restore the complete declared text fixture');
	t.assert(context.selection.kind === 'member' && glyphs().length === 6 && glyphs().every(item => item.kind === 'sprite' && item.source.kind === 'text'),
		'the selected authored caption is still an origin helper rather than actual glyph packets');
	t.assert(t.runtime().machine.scheduler.nowCycles === cycles && t.sourceState().currentBlua32Media === media,
		'text authoring advanced or replaced the paused guest');
};
const add = async () => { t.command('sceneEditor.addMember'); await t.frames(3); await type('studio_test.caption'); await press('Enter'); await t.frames(4); };
const fonts = new Set();
for (let font = 0; font < 2; font++) {
	for (let theme = 0; theme < 2; theme++) {
		const variant = primary.view.hierarchy.layout.font.variant, label = `scene-text-${variant}-${theme}`; fonts.add(variant);
		initial();
		await click({ x: view.bounds.left + 2, y: view.bounds.top + 2 }); await press('ShiftLeft', 'KeyF');
		const caption = context.selection.entry, packets = glyphs(), bitmap = packets[0].bitmap;
		t.assert(packets.every(item => item.affine === packets[0].affine), 'glyph packets do not borrow their component pose');
		t.assert(view.canvas.outlines.filter(outline => outline.source.entry === caption).length === 1,
			'the selected text component is outlined as separate letters instead of one visual');
		await click(inkPoint(packets[packets.length - 1]));
		t.assert(context.selection.entry === caption, 'clicking actual glyph ink did not select its exact authored member');
		await capture(`${label}-custom-and-default-fonts`);
		await press('KeyF');
		const version = model.version, start = { x: view.gizmo.x, y: view.gizmo.y }, end = { x: start.x + 12, y: start.y + 8 };
		await pointer(start, true); t.controlInput([{ type: 'pointer', ...end }]); await t.frames(4);
		t.assert(model.version === version && model.buffer.getText() === source && glyphs().every((item, index) => item === packets[index] && item.bitmap === bitmap),
			'text translation preview wrote source or rebuilt its glyph layout/atlas binding');
		await capture(`${label}-retained-translation`); await pointer(end, false);
		t.assert(model.version === version + 1 && model.dirty, 'glyph translation did not publish one canonical source edit');
		t.command('undo'); await t.frames(4); initial();
		t.command('sceneEditor.details'); await press('Tab'); await press('Tab'); await press('Tab');
		await press('ControlLeft', 'KeyA'); await press('ShiftLeft', 'KeyS'); await press('ShiftLeft', 'KeyO'); await press('Enter'); await t.frames(4);
		t.assert(model.buffer.getText() === source.replace("options = { text = 'STUDIO' }", "options = { text = 'SO' }") && glyphs().length === 2,
			'ordinary text-property editing did not update its own real glyph membership and exact source token');
		await capture(`${label}-edited-text`); t.command('undo'); await t.frames(4); initial();
		await add(); const center = { x: (view.bounds.left + view.bounds.right) / 2, y: (view.bounds.top + view.bounds.bottom) / 2 };
		t.controlInput([{ type: 'pointer', ...center }]); await t.frames(4);
		t.assert(view.placementCanvas.items.length === 6 && view.placementCanvas.items.every(item => item.source.kind === 'text'),
			'Add did not preview the selected prefab with the same declared font and glyph pipeline');
		await capture(`${label}-add-preview`); await press('Escape'); initial();
		await add(); await click(center);
		t.assert(model.dirty && context.subject.objects.length === 3 && glyphs().length === 6,
			'placing a text prefab did not create/select its actual rendered source member');
		t.command('undo'); await t.frames(4);
		t.command('sceneEditor.outline'); await press('Home'); await press('ArrowDown'); initial();
		t.command('theme-toggle'); await t.frames(3);
	}
	await press('ControlLeft', 'ShiftLeft', 'KeyT'); await t.frames(4);
}
t.assert(fonts.size === 2, 'the actual text workflow did not exercise both UI fonts'); initial();
for (let index = 0; index < t.logMessageCount(); index++)
	t.assert(t.logMessage(index).level !== 3, `text workflow logged an error: ${t.logMessage(index).message}`);
