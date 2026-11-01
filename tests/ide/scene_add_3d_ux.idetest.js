// Dedicated Studio fixture; real commands and pointer/keyboard input, no source/model injection.
// npm run ide:test -- studio_test tests/ide/scene_add_3d_ux.idetest.js --ttl 240
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true }))); await t.frames(2);
	t.controlInput(codes.slice().reverse().map(code => ({ type: 'key', code, down: false }))); await t.frames(2);
};
const type = async text => {
	for (const character of text) await press(character === '_' ? 'ShiftLeft' : character === '.' ? 'Period' : `Key${character.toUpperCase()}`,
		...(character === '_' ? ['Minus'] : []));
};
const move = async point => { t.controlInput([{ type: 'pointer', ...point }]); await t.frames(3); };
const click = async point => {
	await move(point); t.controlInput([{ type: 'button', button: 'primary', down: true }]); await t.frames(2);
	t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(4);
};
const orbit = async delta => {
	const bounds = view.bounds, start = { x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 };
	await move(start); t.controlInput([{ type: 'key', code: 'AltLeft', down: true }, { type: 'button', button: 'primary', down: true }]); await t.frames(2);
	await move({ x: start.x, y: start.y + delta });
	t.controlInput([{ type: 'button', button: 'primary', down: false }, { type: 'key', code: 'AltLeft', down: false }]); await t.frames(3);
};
const capture = async label => { await t.frames(3); t.log(`VISUAL ${label}`); t.capture(label); };
const arm = async () => {
	t.command('sceneEditor.addMember'); await t.frames(3); await type('studio_test.mesh'); await press('Enter'); await t.frames(3);
	t.assert(view.placementPreview !== undefined && view.placementModels.scene.instances.length > 0, 'the prefab choice did not prepare its real model preview');
};

await t.waitForCart(); await t.frames(90);
await press('ControlRight', 'ShiftRight'); await t.frames(3);
t.command('sceneEditor'); await t.frames(3); await type('space.lua'); await press('Enter'); await t.frames(6);
const primary = t.mainWorkspace().primary, context = primary.consumer, view = primary.view.viewport, model = context.workingCopy;
t.assert(model.identity.path === 'scenes/space.lua' && !model.dirty && context.subject.objects.length === 0, 'the dedicated empty 3D scene was not admitted cleanly');
t.command('sceneViewport.view3d'); await t.frames(3);
t.assert(view.camera.mode === '3d', 'the native viewport mode command did not select 3D');
const source = model.buffer.getText(), cycles = t.runtime().machine.scheduler.nowCycles, media = t.sourceState().currentBlua32Media;
const retained = () => {
	t.assert(t.mainWorkspace().primary === primary && context.workingCopy === model && view.camera.mode === '3d', 'the authored viewport or canonical source owner was replaced');
	t.assert(t.runtime().machine.scheduler.nowCycles === cycles && t.sourceState().currentBlua32Media === media, 'construction preview executed or replaced the guest');
};
const fonts = new Set();
for (let font = 0; font < 2; font++) {
	const variant = primary.hierarchy.layoutState.font.variant; fonts.add(variant);
	for (let theme = 0; theme < 2; theme++) {
		const label = `scene-add-3d-${variant}-${theme}`, version = model.version;
		await arm();
		const bounds = view.bounds, point = { x: bounds.left + (bounds.right - bounds.left) * 0.6, y: bounds.top + (bounds.bottom - bounds.top) * 0.65 };
		await move(point);
		const preview = view.placementPreview, mesh = view.placementModels.scene.instances[0].mesh;
		t.assert(preview.world.family === '3d' && preview.world.oy === 0, 'the visible model preview was not placed on world XZ');
		t.assert(model.version === version && model.buffer.getText() === source && !model.canUndo, 'pointer preview wrote source or history');
		retained(); await capture(`${label}-preview`);
		t.controlInput([{ type: 'wheel', deltaY: -1 }]); await t.frames(4);
		t.assert(view.placementPreview === preview && preview.world.oy === 0 && model.version === version, 'camera zoom replaced or committed the pending placement');
		retained(); await capture(`${label}-zoomed-preview`);
		const expected = [preview.world.ox, preview.world.oy, preview.world.oz];
		await click(point);
		const local = context.selectedLocalTransform;
		t.assert(context.subject.objects.length === 1 && local.family === '3d' && local.ox === expected[0] && local.oy === expected[1] && local.oz === expected[2],
			'placement did not publish the same proposed world-unit position');
		t.assert(model.version === version + 1 && model.canUndo && view.placementPreview === undefined, 'placement did not commit exactly one canonical edit');
		t.assert(view.models.scene.instances.length > 0 && view.models.scene.instances[0].mesh === mesh, 'committed geometry did not retain its actual shared model asset');
		const written = model.buffer.getText(); retained(); await capture(`${label}-committed`);
		t.command('undo'); await t.frames(4);
		t.assert(model.buffer.getText() === source && !model.canUndo && !model.dirty, 'one Undo did not restore the complete clean source');
		t.command('redo'); await t.frames(4);
		t.assert(model.buffer.getText() === written && view.models.scene.instances.length > 0, 'Redo did not restore the same authored model');
		await capture(`${label}-redo`); t.command('undo'); await t.frames(4);

		await arm(); await move(point); await press('Escape'); retained();
		t.assert(view.placementPreview === undefined && model.buffer.getText() === source && !model.canUndo, 'Escape did not retire the uncommitted model');
		await capture(`${label}-cancelled`);
		// Ordinary orbit exposes rays above the ground horizon; those clicks must not invent a position.
		await orbit(-20); await arm();
		const current = view.bounds, above = { x: (current.left + current.right) / 2, y: current.top + (current.bottom - current.top) * 0.08 };
		await move(above); await capture(`${label}-above-ground-horizon`); await click(above);
		t.assert(view.placementPreview !== undefined && model.buffer.getText() === source && !model.canUndo, 'a ray that misses XZ published a fallback position');
		await press('Escape'); await orbit(20); retained();
		t.command('theme-toggle'); await t.frames(3);
	}
	await press('ControlLeft', 'ShiftLeft', 'KeyT'); await t.frames(3);
}
t.assert(fonts.size === 2, 'the visible placement workflow did not exercise both fonts');
for (let index = 0; index < t.logMessageCount(); index++)
	t.assert(t.logMessage(index).level !== 3, `3D placement logged an error: ${t.logMessage(index).message}`);
t.log('Completed real 3D prefab preview, camera reprojection, XZ placement, Undo/Redo, cancellation and no-hit input in both fonts/themes.');
