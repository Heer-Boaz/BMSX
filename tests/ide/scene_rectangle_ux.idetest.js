// Dedicated Studio cart: real source-backed rectangles, ordinary UI input, no source/model injection.
// npm run ide:test -- studio_test tests/ide/scene_rectangle_ux.idetest.js --ttl 240
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
const move = async point => { t.controlInput([{ type: 'pointer', ...point }]); await t.frames(3); };
const down = async point => { await move(point); t.controlInput([{ type: 'button', button: 'primary', down: true }]); await t.frames(2); };
const up = async point => { await move(point); t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(4); };
const capture = async label => { await t.frames(2); t.log(`VISUAL ${label}`); t.capture(label); };

await t.waitForCart(); await t.frames(90); await press('ControlRight', 'ShiftRight');
t.command('sceneEditor'); await t.frames(3); await type('root.lua'); await press('Enter'); await t.frames(5);
const primary = t.mainWorkspace().primary, view = primary.view.viewport, context = primary.consumer, model = context.workingCopy;
const source = model.buffer.getText(), cycles = t.runtime().machine.scheduler.nowCycles, media = t.sourceState().currentBlua32Media;
t.assert(model.identity.path === 'scenes/root.lua' && !model.dirty, 'the dedicated Scene source is not initially clean');
const invariant = () => {
	t.assert(t.mainWorkspace().primary === primary && context.workingCopy === model, 'canvas input replaced its source owner');
	t.assert(t.runtime().machine.scheduler.nowCycles === cycles && t.sourceState().currentBlua32Media === media,
		'authored rectangle presentation executed or replaced the paused guest');
};
const add = async () => {
	t.command('sceneEditor.addMember'); await t.frames(3); await type('studio_test.actor'); await press('Enter'); await t.frames(3);
};
const fonts = new Set();
for (let font = 0; font < 2; font++) {
	for (let theme = 0; theme < 2; theme++) {
		const variant = primary.view.hierarchy.layout.font.variant, label = `rectangle-${variant}-${theme}`; fonts.add(variant);
		const corner = { x: view.bounds.left + 2, y: view.bounds.top + 2 };
		await down(corner); await up(corner); await press('ShiftLeft', 'KeyF');
		t.assert(view.canvas.items.length === 3 && view.canvas.items.every(item => item.kind === 'rectangle'),
			'written builtin rectangles are still helpers instead of admitted solid visuals');
		t.assert(model.buffer.getText() === source && !model.dirty, 'a preceding canvas cycle changed source');
		await capture(`${label}-authored`); invariant();
		const first = view.canvas.items[0], point = { x: first.x + (first.xx + first.yx) / 2, y: first.y + (first.xy + first.yy) / 2 };
		await down(point); await up(point);
		t.assert(context.selection?.kind === 'member' && context.selection.entry === first.source.entry,
			'clicking the rendered fill did not select its exact authored occurrence');
		await press('KeyF'); await capture(`${label}-selected-and-framed`);
		const version = model.version, record = view.canvas.items[0], gizmo = view.gizmo;
		const start = { x: gizmo.x, y: gizmo.y }, end = { x: gizmo.x + 12, y: gizmo.y + 8 };
		await down(start); await move(end);
		t.assert(model.version === version && model.buffer.getText() === source, 'solid translation preview wrote source prematurely');
		t.assert(view.canvas.items[0] === record, 'solid translation recreated its visual record');
		await capture(`${label}-translation-preview`); await up(end);
		t.assert(model.version === version + 1 && model.buffer.getText() !== source, 'solid translation did not publish once');
		invariant(); t.command('undo'); await t.frames(4);
		t.assert(model.buffer.getText() === source && !model.dirty, 'one Undo failed to restore exact pre-translation source');
		await add();
		const canvas = view.bounds, center = { x: Math.round((canvas.left + canvas.right) / 2), y: Math.round((canvas.top + canvas.bottom) / 2) };
		await move(center);
		t.assert(view.placementCanvas.items.length === 1 && view.placementCanvas.items[0].kind === 'rectangle',
			'Add did not use the same real solid primitive for its prefab preview');
		await capture(`${label}-add-preview`); await press('Escape');
		t.assert(model.buffer.getText() === source && view.placementCanvas.items.length === 0, 'cancelled solid placement mutated source or retained its preview');
		await add(); await down(center); await up(center);
		t.assert(view.canvas.items.length === 4 && context.selection?.kind === 'member' && model.dirty,
			'ordinary placement did not create and select a rendered solid member');
		await capture(`${label}-added`); invariant();
		const placedSource = model.buffer.getText(), placedVersion = model.version;
		t.command('sceneEditor.details'); await press('Tab'); await press('ControlLeft', 'KeyA'); await press('Digit4'); await press('Digit2'); await press('Enter');
		t.assert(model.version === placedVersion + 1 && context.selectedLocalTransform.ox === 42,
			'Details did not edit the inserted solid through the canonical working copy');
		t.command('undo'); await t.frames(3); t.assert(model.buffer.getText() === placedSource, 'Details edit did not have its own exact Undo');
		t.command('undo'); await t.frames(3);
		t.assert(model.buffer.getText() === source && !model.dirty, 'solid edit/placement Undo did not restore exact original fixture source');
		invariant(); t.command('theme-toggle'); await t.frames(3);
	}
	await press('ControlLeft', 'ShiftLeft', 'KeyT'); await t.frames(3);
}
t.assert(fonts.size === 2, 'solid canvas workflow did not cover both fonts');
for (let index = 0; index < t.logMessageCount(); index++)
	t.assert(t.logMessage(index).level !== 3, `solid canvas workflow logged an error: ${t.logMessage(index).message}`);
t.log('Completed real solid rectangle rendering, picking, framing, retained translation preview, Add/cancel/placement and exact Undo in both fonts/themes.');
