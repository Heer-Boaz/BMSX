// Dedicated Studio fixture: real Add toolbar, prefab picker and authored canvas.
// Run after building tooling, BIOS and studio_test:
// npm run ide:test -- studio_test tests/ide/scene_add_ux.idetest.js --ttl 180
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true })));
	await t.frames(2);
	t.controlInput(codes.slice().reverse().map(code => ({ type: 'key', code, down: false })));
	await t.frames(2);
};
const type = async text => {
	for (const character of text) {
		if (character === '_') await press('ShiftLeft', 'Minus');
		else await press(character === '.' ? 'Period' : character === '/' ? 'Slash' : character >= '0' && character <= '9' ? `Digit${character}` : `Key${character.toUpperCase()}`);
	}
};
const point = async (x, y) => {
	t.controlInput([{ type: 'pointer', x, y }]); await t.frames(2);
};
const click = async (x, y, button = 'primary') => {
	t.controlInput([{ type: 'pointer', x, y }, { type: 'button', button, down: true }]);
	await t.frames(1);
	t.controlInput([{ type: 'button', button, down: false }]); await t.frames(3);
};
const capture = async label => {
	await t.frames(3); t.log(`VISUAL ${label}`); t.capture(label);
};
const save = async (model, expected) => {
	// Exercise the same command route as Ctrl+S, from the active authored canvas.
	await press('ControlLeft', 'KeyS');
	for (let frame = 0; frame < 120 && model.dirty; frame++) await t.frames(1);
	t.assert(!model.dirty && model.lastSavedSource === expected && model.persistedBaseline === expected,
		'ordinary Save did not acknowledge the current canonical source revision');
};

await t.waitForCart(); await t.frames(90);
await press('ControlRight', 'ShiftRight'); await t.frames(3);
t.assert(t.workbenchActive(), 'the ordinary host shortcut did not enter the real Workbench');
t.command('sceneEditor'); await t.frames(3);
await type('root.lua'); await press('Enter'); await t.frames(6);
const main = t.mainWorkspace(), primary = main.primary;
t.assert(primary !== undefined && primary.consumer.workingCopy.identity.path === 'scenes/root.lua',
	'the ordinary Scene picker did not install the dedicated Studio root scene as the Main subject');
const authoring = primary.consumer, model = authoring.workingCopy, view = primary.view.viewport;
const source = model.buffer.getText(), count = authoring.subject.objects.length;
const cycles = t.runtime().machine.scheduler.nowCycles, installed = t.sourceState().currentBlua32Media;
t.assert(!model.dirty && primary.viewport.attached && primary.hierarchy.attached,
	'the authored Scene did not begin with an attached, saved working copy');
const idle = (version = model.version) => {
	t.assert(model.buffer.getText() === source && model.version === version && !model.dirty,
		'choosing, hovering or cancelling Add changed the canonical source or history');
};
const paused = () => {
	t.assert(t.runtime().machine.scheduler.nowCycles === cycles && t.sourceState().currentBlua32Media === installed,
		'authored Add/history/Save executed or replaced the paused guest');
	t.assert(main.primary === primary && primary.consumer.workingCopy === model,
		'the workflow replaced the admitted Main subject or canonical working copy');
};
const openAdd = async () => {
	// Discover an existing public action, not a label or a fixed toolbar coordinate.
	await point(view.bounds.left + 8, view.bounds.top + 8);
	t.command('sceneEditor.outline'); await t.frames(2);
	await press('ShiftLeft', 'Tab'); await press('Home');
	const toolbar = primary.hierarchy.actionBar, action = toolbar.tooltipItem;
	t.assert(toolbar.focusTarget.hasFocus && action !== undefined && action.command === 'sceneEditor.addMember' && action.enabled,
		'the hierarchy toolbar did not expose the admitted Add action');
	await click((action.bounds.left + action.bounds.right) / 2, (action.bounds.top + action.bounds.bottom) / 2);
	await type('studio_test.marker');
};
const represented = () => view.sprites.items.filter(item => item.source.image === 'studio_test_marker');
const fonts = new Set();
for (let font = 0; font < 2; font++) {
	for (let theme = 0; theme < 2; theme++) {
		const variant = primary.view.hierarchy.layout.font.variant;
		fonts.add(variant);
		const label = `studio-add-${variant}-theme-${theme}`, version = model.version;
		idle(version); paused();
		await openAdd(); idle(version); paused();
		await capture(`${label}-prefab-picker`);
		await press('Enter');
		const bounds = view.bounds;
		const x = Math.round(bounds.left + (bounds.right - bounds.left) * 0.58);
		const y = Math.round(bounds.top + (bounds.bottom - bounds.top) * 0.46);
		await point(x, y); idle(version); paused();
		t.assert(view.placementSprites.items.length === 1 && represented().length === 0,
			'the selected prefab had no visible pre-insertion sprite preview');
		await capture(`${label}-armed-no-source-edit`);
		const hierarchyBounds = primary.hierarchy.layoutState.client;
		await point(hierarchyBounds.left + 8, hierarchyBounds.top + 8);
		idle(version); paused(); await capture(`${label}-armed-pointer-outside`);
		await point(x, y); idle(version); paused(); await capture(`${label}-armed-pointer-returned`);
		await press('Escape'); idle(version); paused();
		t.assert(view.placementSprites.items.length === 0 && view.placementPreview === undefined,
			'cancelling Add retained its visual preview');
		await openAdd(); await press('Enter'); await point(x, y);
		const ghost = view.placementSprites.items[0], previewBitmap = ghost.bitmap;
		const footprint = [ghost.x, ghost.y, ghost.xx, ghost.xy, ghost.yx, ghost.yy, ghost.u0, ghost.v0, ghost.u1, ghost.v1];
		// The requested placement pixel is a data-integrity contract, not a UI layout oracle.
		const pixel = { x: 0, y: 0 };
		view.camera.unproject2d(x - (bounds.left + bounds.right) / 2, y - (bounds.top + bounds.bottom) / 2, pixel);
		pixel.x = Math.round(pixel.x); pixel.y = Math.round(pixel.y);
		idle(version);
		await click(x, y);
		const added = model.buffer.getText(), selected = authoring.selection;
		t.assert(added !== source && model.version === version + 1 && model.dirty && model.canUndo,
			'placing Add did not create exactly one canonical source edit');
		t.assert(authoring.subject.objects.length === count + 1 && selected?.kind === 'member'
			&& selected.entry.definitionId.value === 'studio_test.marker',
			'placement did not select its newly authored prefab occurrence');
		const sprites = represented(), sprite = sprites.find(item => item.source.entry === selected.entry);
		t.assert(sprite !== undefined,
			'the authored placement did not reach the existing packed-sprite viewport consumer');
		t.assert(sprite.bitmap === previewBitmap && [sprite.x, sprite.y, sprite.xx, sprite.xy, sprite.yx, sprite.yy,
			sprite.u0, sprite.v0, sprite.u1, sprite.v1].every((value, index) => value === footprint[index]),
			'the committed sprite did not match the exact preview footprint and retained atlas');
		t.assert(sprite.source.world.ox === pixel.x && sprite.source.world.oy === pixel.y,
			'placement did not write the chosen integer scene pixel');
		paused(); await capture(`${label}-placed-selected-sprite`);
		// Leave the auto-selection, then pick the new visible sprite and edit it as an author would.
		t.command('sceneEditor.outline'); await press('Home'); await press('ArrowDown');
		await click(sprite.x + (sprite.xx + sprite.yx) * 0.7, sprite.y + (sprite.xy + sprite.yy) * 0.7);
		t.assert(authoring.selection?.kind === 'member' && authoring.selection.entry === selected.entry,
			'clicking the new sprite did not restore its authored selection');
		const positionField = primary.view.details.properties[0].bounds, enteredX = Math.abs(pixel.x) + 7;
		await click((positionField.left + positionField.right) / 2, (positionField.top + positionField.bottom) / 2);
		await press('ControlLeft', 'KeyA'); await type(String(enteredX)); await press('Enter');
		t.assert(model.version === version + 2 && authoring.selectedLocalTransform.ox === enteredX && authoring.selectedLocalTransform.oy === pixel.y,
			'editing the new sprite did not publish its own local position');
		await capture(`${label}-new-sprite-edited`);
		t.command('undo'); await t.frames(3);
		t.assert(model.buffer.getText() === added && authoring.selectedLocalTransform.ox === pixel.x,
			'Undo did not restore the newly placed sprite before undoing its insertion');
		t.command('undo'); await t.frames(4);
		t.assert(model.buffer.getText() === source && authoring.subject.objects.length === count && represented().length === 0
			&& !model.dirty && model.canRedo,
			'one ordinary Undo did not remove the complete authored insertion and its viewport sprite');
		paused(); await capture(`${label}-undo-removed`);
		t.command('redo'); await t.frames(4);
		t.assert(model.buffer.getText() === added && authoring.subject.objects.length === count + 1 && represented().length === 1,
			'ordinary Redo did not restore the exact insertion and viewport sprite');
		await save(model, added); paused(); await capture(`${label}-redo-ordinary-save`);
		// Restore this isolated acceptance workspace through the same visible history/Save route.
		t.command('undo'); await t.frames(4);
		t.assert(model.buffer.getText() === source && model.dirty && represented().length === 0,
			'Undo after Save did not retain ordinary working-copy history');
		await save(model, source); paused();
		t.command('theme-toggle'); await t.frames(3);
	}
	await press('ControlLeft', 'ShiftLeft', 'KeyT'); await t.frames(3);
}

// Inspect the shared menu indicator and pixel editing through actual UI input.
await click((view.bounds.left + view.bounds.right) / 2, (view.bounds.top + view.bounds.bottom) / 2, 'secondary');
const modeRows = t.contextMenu().model.rows;
t.assert(modeRows.find(row => row.command === 'sceneViewport.view2d').active
 && !modeRows.find(row => row.command === 'sceneViewport.view3d').active,
 'the context menu did not consume mutually exclusive camera command state');
await capture('scene-mode-menu-2d-checked'); await press('Escape');
for (let font = 0; font < 2; font++) {
	t.command('sceneEditor.outline'); await press('Home'); await press('ArrowDown');
	t.assert(authoring.selection?.kind === 'member' && authoring.selection.entry.memberId.value === 'first', 'pixel editing targeted another member');
	for (const [axis, text] of [[0, '0.7761194029850746'], [1, '8.6567164179104']]) {
		t.command('sceneEditor.details'); await t.frames(2);
		const bounds = primary.view.details.properties[axis].bounds;
		await click((bounds.left + bounds.right) / 2, (bounds.top + bounds.bottom) / 2);
		await press('ControlLeft', 'KeyA'); await type(text); await press('Enter');
	}
	t.command('sceneEditor.outline'); await t.frames(3);
	const fractional = model.buffer.getText(), version = model.version;
	t.assert(authoring.selectedLocalTransform.ox === 0.7761194029850746 && authoring.selectedLocalTransform.oy === 8.6567164179104,
		'idle display rounding changed explicitly authored fractional coordinates');
	await capture(`scene-pixel-idle-${font}-compact`);
	const field = primary.view.details.properties[0].bounds;
	await click((field.left + field.right) / 2, (field.top + field.bottom) / 2); await capture(`scene-pixel-focused-${font}-exact`);
	await press('Escape');
	t.assert(model.buffer.getText() === fractional && model.version === version, 'focus or Escape rounded the canonical source');
	// Recenter after the numeric move; an offscreen origin is not a physical drag target.
	await click((view.bounds.left + view.bounds.right) / 2, (view.bounds.top + view.bounds.bottom) / 2, 'secondary');
	await press('Home'); await press('ArrowDown'); await press('ArrowDown'); await press('Enter');
	const x = Math.round(view.gizmo.x), y = Math.round(view.gizmo.y);
	t.controlInput([{ type: 'pointer', x, y }, { type: 'button', button: 'primary', down: true }]); await t.frames(2);
	t.controlInput([{ type: 'pointer', x: Math.round(x + 7.4 * view.camera.scale), y: Math.round(y + 4.6 * view.camera.scale) }]); await t.frames(2);
	t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(3);
	const placed = authoring.selectedLocalTransform;
	t.assert(model.version === version + 1 && placed.ox === Math.round(placed.ox) && placed.oy === Math.round(placed.oy),
		'2D drag did not publish one pixel-snapped source edit');
	await capture(`scene-pixel-drag-${font}-integer`);
	for (let undo = 0; undo < 3; undo++) { t.command('undo'); await t.frames(3); }
	t.assert(model.buffer.getText() === source, 'pixel workflow did not restore canonical source through Undo');
	await save(model, source); paused();
	await press('ControlLeft', 'ShiftLeft', 'KeyT'); await t.frames(3);
}

t.assert(fonts.size === 2, 'the acceptance captures did not exercise both existing font variants');
idle(); paused();
for (let index = 0; index < t.logMessageCount(); index++)
	t.assert(t.logMessage(index).level !== 3, `Add acceptance logged an error: ${t.logMessage(index).message}`);
t.log('Completed four real Add/pick/new-object-edit/Undo/Redo/Save workflows and both-font pixel drags; no authored source retained.');
