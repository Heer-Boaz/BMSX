// Real Workbench input and source-authored artwork; no model/source injection or guest execution.
// npm run ide:test -- studio_test tests/ide/scene_artwork_ux.idetest.js --ttl 240
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
const move = async point => { t.controlInput([{ type: 'pointer', ...point }]); await t.frames(4); };
const click = async point => { await pointer(point, true); await pointer(point, false); };
const capture = async label => { await t.frames(3); t.log(`VISUAL ${label}`); t.capture(label); };
// Real glyph coverage supplies pointer targets; coordinates are not layout assertions.
const inkPoint = packet => {
	const image = packet.bitmap.image, left = Math.round(packet.u0 * image.width), top = Math.round(packet.v0 * image.height);
	for (let y = packet.height - 1; y >= 0; y--) for (let x = packet.width - 1; x >= 0; x--) {
		if (image.pixels[((top + y) * image.width + left + x) * 4 + 3] === 0) continue;
		const u = (x + 0.5) / packet.width, v = (y + 0.5) / packet.height;
		if (view.camera.mode === '3d') {
			const a = packet.affine, lx = packet.offsetX + x + 0.5, ly = packet.offsetY + y + 0.5;
			const wx = a.xx * lx + a.yx * ly, wy = -(a.xy * lx + a.yy * ly);
			return { x: (view.bounds.left + view.bounds.right) / 2 + view.camera.projectX(wx, wy, 0, a.ox, -a.oy, 0),
				y: (view.bounds.top + view.bounds.bottom) / 2 + view.camera.projectY(wx, wy, 0, a.ox, -a.oy, 0) };
		}
		return { x: packet.x + packet.xx * u + packet.yx * v, y: packet.y + packet.xy * u + packet.yy * v };
	}
	throw new Error('the dedicated artwork glyph has no selectable ink');
};

await t.waitForCart(); await t.frames(90); await press('ControlRight', 'ShiftRight');
t.command('sceneEditor'); await t.frames(3); await type('artwork.lua'); await press('Enter'); await t.frames(5);
const primary = t.mainWorkspace().primary, context = primary.authoring, model = context.workingCopy, view = primary.view.viewport;
t.assert(model.identity.path === 'scenes/artwork.lua', 'the dedicated authored artwork Scene did not become the Main subject');
const source = model.buffer.getText(), cycles = t.runtime().machine.scheduler.nowCycles, media = t.sourceState().currentBlua32Media;
const clean = () => {
	t.assert(t.mainWorkspace().primary === primary && context.workingCopy === model, 'artwork presentation replaced its canonical source owner');
	t.assert(model.buffer.getText() === source && !model.dirty && !model.canUndo, 'artwork source/history did not restore exactly');
	t.assert(t.runtime().machine.scheduler.nowCycles === cycles && t.sourceState().currentBlua32Media === media,
		'artwork presentation advanced or replaced the paused guest');
};
const artwork = () => {
	const packets = view.canvas.items, rectangles = packets.filter(item => item.source.kind === 'rectangle');
	const sprite = packets.find(item => item.source.kind === 'sprite');
	const whiteText = packets.filter(item => item.source.kind === 'text' && item.color === 0xffffffff);
	const blackText = packets.filter(item => item.source.kind === 'text' && item.color === 0xff000000);
	t.assert(rectangles.length === 2 && rectangles[0].color === 0xff000000 && rectangles[1].color === 0xffffffff,
		'authored black/white rectangle colors changed with the presentation');
	t.assert(whiteText.length === 5 && blackText.length === 5 && [...whiteText, ...blackText].every(item => item.kind === 'sprite'),
		'authored black/white default-font text did not retain its actual glyphs and colors');
	t.assert(sprite?.kind === 'sprite' && sprite.source.image === 'tiny_3b_font_code_0x41' && sprite.color === 0xffffffff,
		'the transparent authored sprite lost its image identity or tint');
	return { rectangles, sprite };
};
const resources = () => view.canvas.items.filter(item => item.kind === 'sprite').map(item => ({
	packet: item, bitmap: item.bitmap, pixels: item.bitmap.image.pixels, source: item.source, color: item.color,
}));
const retainedResources = before => {
	const after = resources();
	t.assert(after.length === before.length && after.every((item, index) => item.packet === before[index].packet
		&& item.bitmap === before[index].bitmap && item.pixels === before[index].pixels
		&& item.source === before[index].source && item.color === before[index].color),
		'presentation-only changes rebuilt/rebound or recolored authored image resources');
};
const add = async () => {
	t.command('sceneEditor.addMember'); await t.frames(3); await type('studio_test.artwork_glyph'); await press('Enter'); await t.frames(4);
};

const initialSprite = artwork().sprite, image = initialSprite.bitmap.image;
const imageLeft = Math.round(initialSprite.u0 * image.width), imageTop = Math.round(initialSprite.v0 * image.height);
let transparent = false, opaque = false;
for (let y = 0; y < initialSprite.height; y++) for (let x = 0; x < initialSprite.width; x++) {
	const alpha = image.pixels[((imageTop + y) * image.width + imageLeft + x) * 4 + 3];
	if (alpha === 0) transparent = true;
	if (alpha === 255) opaque = true;
}
t.assert(transparent && opaque, 'the artwork fixture is not an actual sprite with opaque ink and transparent texels');
const fonts = new Set();
for (let font = 0; font < 2; font++) {
	for (let theme = 0; theme < 2; theme++) {
		const variant = primary.view.hierarchy.layout.font.variant, label = `scene-artwork-${variant}-${theme}`; fonts.add(variant);
		await click({ x: view.bounds.left + 2, y: view.bounds.top + 2 });
		t.command('sceneViewport.view2d'); await t.frames(3);
		await press('ShiftLeft', 'KeyF');
		t.assert(view.camera.mode === '2d', 'the native camera command did not select 2D artwork');
		clean(); const { rectangles, sprite } = artwork();
		const rectangle = rectangles[0];
		await click({ x: rectangle.x + (rectangle.xx + rectangle.yx) / 2, y: rectangle.y + (rectangle.xy + rectangle.yy) / 2 });
		t.assert(context.selection.kind === 'member' && context.selection.entry === rectangle.source.entry,
			'clicking authored black fill did not select its own source member');
		await capture(`${label}-black-white-transparent`);
		await click(inkPoint(sprite));
		t.assert(context.selection.kind === 'member' && context.selection.entry === sprite.source.entry,
			'clicking real sprite ink did not select its exact authored member');
		await press('KeyF'); await capture(`${label}-selected-framed-sprite`);
		const version = model.version, bindings = resources();
		const start = { x: view.gizmo.x, y: view.gizmo.y }, end = { x: start.x + 12, y: start.y + 8 };
		await pointer(start, true); await move(end);
		t.assert(view.transformPreview !== undefined && model.version === version && model.buffer.getText() === source && !model.canUndo,
			'the one-gesture translation preview published source/history before release');
		retainedResources(bindings); await capture(`${label}-gizmo-preview`); await pointer(end, false);
		t.assert(model.version === version + 1 && model.dirty && model.canUndo, 'the drag release did not publish exactly one authored edit');
		t.command('undo'); await t.frames(4); clean(); artwork();
		await press('ShiftLeft', 'KeyF'); await add();
		const center = { x: (view.bounds.left + view.bounds.right) / 2, y: (view.bounds.top + view.bounds.bottom) / 2 };
		await move(center);
		const ghost = view.placementCanvas.items[0];
		t.assert(view.placementPreview !== undefined && view.placementCanvas.items.length === 1 && ghost.kind === 'sprite'
			&& ghost.source.image === 'tiny_3b_font_code_0x41' && ghost.bitmap === artwork().sprite.bitmap,
			'Add did not preview the actual selected transparent sprite with its shared authored image');
		clean(); await capture(`${label}-sprite-add-ghost`); await press('Escape');
		t.assert(view.placementPreview === undefined && view.placementCanvas.items.length === 0, 'cancel retained the uncommitted sprite ghost');
		clean();
		t.command('sceneViewport.view3d'); await t.frames(4); t.command('sceneViewport.frameAll'); await t.frames(4);
		t.assert(view.camera.mode === '3d' && context.subject.objects.every(entry => view.geometry.represented.has(entry)),
			'the orbit view did not retain all authored canvas visuals alongside its model');
		await capture(`${label}-mixed-orbit`);
		await click(inkPoint(artwork().sprite));
		t.assert(context.selection.kind === 'member' && context.selection.entry === artwork().sprite.source.entry,
			'clicking visible sprite ink in orbit did not select its authored member');
		await press('KeyF');
		t.assert(view.camera.mode === '3d', 'framing a canvas member replaced the orbit camera');
		const orbitVersion = model.version, orbitStart = { x: view.gizmo.x, y: view.gizmo.y };
		const orbitEnd = { x: orbitStart.x + 12, y: orbitStart.y + 8 };
		await pointer(orbitStart, true); await move(orbitEnd);
		t.assert(view.transformPreview !== undefined && model.version === orbitVersion, 'orbit drag did not retain its uncommitted source proposal');
		await capture(`${label}-sprite-orbit-drag`); await pointer(orbitEnd, false);
		t.assert(model.version === orbitVersion + 1 && context.selectedLocalTransform.family === '2d', 'orbit drag did not commit one 2D member-position edit');
		t.command('undo'); await t.frames(4); clean();
		// The existing outline owns member selection; End selects the dedicated final model occurrence.
		t.command('sceneEditor.outline'); await press('End');
		t.assert(context.selection.kind === 'member' && view.geometry.represented.has(context.selection.entry),
			'the authored model selection did not belong to the displayed geometry');
		await click({ x: view.gizmo.x, y: view.gizmo.y });
		t.command('sceneViewport.frameSelection'); await t.frames(4);
		clean(); artwork(); await capture(`${label}-3d-model-selected-framed`);
		await click({ x: view.bounds.left + 2, y: view.bounds.top + 2 });
		t.command('sceneViewport.view2d'); await t.frames(4); t.command('sceneViewport.frameAll'); await t.frames(4);
		const themeVersion = model.version, canRedo = model.canRedo, themeResources = resources();
		const mesh = view.geometry.scene.instances[0].mesh, meshRevision = view.geometry.scene.revision;
		t.command('theme-toggle'); await t.frames(4);
		clean(); artwork(); retainedResources(themeResources);
		t.assert(model.version === themeVersion && model.canRedo === canRedo && view.geometry.scene.instances[0].mesh === mesh
			&& view.geometry.scene.revision === meshRevision,
			'theme switching changed canonical source/history, rebound its model asset or rebaked the 3D scene');
	}
	const fontResources = resources(), fontVersion = model.version, canRedo = model.canRedo;
	await press('ControlLeft', 'ShiftLeft', 'KeyT'); await t.frames(4);
	clean(); artwork(); retainedResources(fontResources);
	t.assert(model.version === fontVersion && model.canRedo === canRedo, 'UI font switching mutated the authored artwork or source history');
}
t.assert(fonts.size === 2, 'the actual artwork workflow did not exercise both UI fonts'); clean();
for (let index = 0; index < t.logMessageCount(); index++)
	t.assert(t.logMessage(index).level !== 3, `artwork workflow logged an error: ${t.logMessage(index).message}`);
t.log('Captured real black/white rectangles and text, transparent sprite, selection, Frame, drag preview/Undo, sprite Add/cancel and 2D/3D in both UI fonts/themes.');
