// Dedicated declared animation factories; actual Workbench input, no guest execution or source injection.
// npm run ide:test -- studio_test tests/ide/scene_animation_ux.idetest.js --ttl 180
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
// Discover real opaque texels for pointer input, not a layout assertion.
const inkPoint = packet => {
	const image = packet.bitmap.image, left = Math.round(packet.u0 * image.width), top = Math.round(packet.v0 * image.height);
	for (let y = 0; y < packet.height; y++) for (let x = 0; x < packet.width; x++) {
		if (image.pixels[((top + y) * image.width + left + x) * 4 + 3] === 0) continue;
		const u = (x + 0.5) / packet.width, v = (y + 0.5) / packet.height;
		return { x: packet.x + packet.xx * u + packet.yx * v, y: packet.y + packet.xy * u + packet.yy * v };
	}
	throw new Error('the dedicated animation frame has no selectable ink');
};
await t.waitForCart(); await t.frames(90); await press('ControlRight', 'ShiftRight');
t.command('sceneEditor'); await t.frames(3); await type('animated.lua'); await press('Enter'); await t.frames(5);
const primary = t.mainWorkspace().primary, context = primary.consumer, model = context.workingCopy, view = primary.view.viewport;
t.assert(model.identity.path === 'scenes/animated.lua', 'the declared animation Scene did not become the Main subject');
const source = model.buffer.getText(), cycles = t.runtime().machine.scheduler.nowCycles, media = t.sourceState().currentBlua32Media;
t.command('sceneEditor.outline'); await press('Home'); await press('ArrowDown');
const selected = () => view.canvas.items.find(item => item.source.entry === context.selection.entry);
const initial = () => {
	t.assert(model.buffer.getText() === source && !model.dirty && !model.canUndo, 'animation source/history did not restore exactly');
	t.assert(view.canvas.items.length === 3 && view.canvas.items.every(item => item.kind === 'sprite'),
		'the Scene did not render its declared initial frames or exposed a disabled secondary component');
	t.assert(context.selection.kind === 'member' && selected().source.image === 'studio_test_marker',
		'the original primary animation selection did not retain its constructor first frame');
	t.assert(t.runtime().machine.scheduler.nowCycles === cycles && t.sourceState().currentBlua32Media === media,
		'initial-frame authoring executed or replaced the paused guest');
};
const add = async () => { t.command('sceneEditor.addMember'); await t.frames(3); await type('studio_test.animated'); await press('Enter'); await t.frames(4); };
const fonts = new Set();
for (let font = 0; font < 2; font++) {
	for (let theme = 0; theme < 2; theme++) {
		const variant = primary.view.hierarchy.layout.font.variant, label = `scene-animation-${variant}-${theme}`; fonts.add(variant);
		initial();
		await click({ x: view.bounds.left + 2, y: view.bounds.top + 2 }); await press('ShiftLeft', 'KeyF');
		const entry = context.selection.entry, packet = selected();
		await click(inkPoint(packet));
		t.assert(context.selection.entry === entry, 'clicking the actual initial animation image did not select its authored member');
		await capture(`${label}-initial-frames`);
		t.command('sceneEditor.details'); await press('Tab'); await press('Tab'); await press('Tab');
		await press('ControlLeft', 'KeyA'); await type('alternate'); await press('Enter'); await t.frames(4);
		t.assert(model.buffer.getText() === source.replace("options = { animation = 'idle' }", "options = { animation = 'alternate' }")
			&& selected().source.image === 'tiny_3b_font_code_0x42', 'changing animation did not select its own declared first frame and exact source token');
		await capture(`${label}-alternate-frame`); t.command('undo'); await t.frames(4); initial();
		await click(inkPoint(selected())); await press('KeyF');
		const dragPacket = selected(), bitmap = dragPacket.bitmap;
		const version = model.version, start = { x: view.gizmo.x, y: view.gizmo.y }, end = { x: start.x + 12, y: start.y + 8 };
		await pointer(start, true); t.controlInput([{ type: 'pointer', ...end }]); await t.frames(4);
		t.assert(model.version === version && model.buffer.getText() === source && selected() === dragPacket && selected().bitmap === bitmap,
			'animation transform preview wrote source or rebound its immutable frame asset');
		await pointer(end, false);
		t.assert(model.version === version + 1 && model.dirty, 'moving the declared animation did not publish one canonical edit');
		t.command('undo'); await t.frames(4); initial();
		await add(); const center = { x: (view.bounds.left + view.bounds.right) / 2, y: (view.bounds.top + view.bounds.bottom) / 2 };
		t.controlInput([{ type: 'pointer', ...center }]); await t.frames(4);
		t.assert(view.placementCanvas.items.length === 1 && view.placementCanvas.items[0].source.image === 'studio_test_marker',
			'Add did not use the same captured initial frame as a constructed member');
		await capture(`${label}-add-preview`); await press('Escape'); initial();
		await add(); await click(center);
		t.assert(model.dirty && context.subject.objects.length === 4 && selected().source.image === 'studio_test_marker',
			'placing the animation prefab did not select its newly rendered source occurrence');
		t.command('undo'); await t.frames(4);
		t.command('sceneEditor.outline'); await press('Home'); await press('ArrowDown'); initial();
		t.command('theme-toggle'); await t.frames(3);
	}
	await press('ControlLeft', 'ShiftLeft', 'KeyT'); await t.frames(4);
}
t.assert(fonts.size === 2, 'the real initial-frame authoring workflow did not exercise both UI fonts'); initial();
for (let index = 0; index < t.logMessageCount(); index++)
	t.assert(t.logMessage(index).level !== 3, `animation workflow logged an error: ${t.logMessage(index).message}`);
