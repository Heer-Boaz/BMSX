// Dedicated Studio fixture; ordinary pointer/keyboard input, no source/model injection.
// npm run ide:test -- studio_test tests/ide/scene_hierarchy_ux.idetest.js --ttl 240
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
await t.waitForCart(); await t.frames(90); await press('ControlRight', 'ShiftRight'); await t.frames(3);
t.command('sceneEditor'); await t.frames(3); await type('root.lua'); await press('Enter'); await t.frames(5);
const main = t.mainWorkspace(), primary = main.primary, context = primary.consumer, model = context.workingCopy;
const initialSource = model.buffer.getText(), cycles = t.runtime().machine.scheduler.nowCycles, installed = t.sourceState().currentBlua32Media;
t.assert(model.identity.path === 'scenes/root.lua' && !model.dirty, 'the isolated authored Scene was not admitted cleanly');
t.command('sceneEditor.outline'); await press('ShiftLeft', 'Tab'); await press('Home');
const add = primary.hierarchy.actionBar.tooltipItem;
t.assert(add?.command === 'sceneEditor.addMember' && add.enabled, 'the real Add control was not reachable');
await down({ x: (add.bounds.left + add.bounds.right) / 2, y: (add.bounds.top + add.bounds.bottom) / 2 });
await up({ x: (add.bounds.left + add.bounds.right) / 2, y: (add.bounds.top + add.bounds.bottom) / 2 });
await type('studio_test.marker'); await press('Enter');
const canvas = primary.view.viewport.bounds, center = { x: Math.round((canvas.left + canvas.right) / 2), y: Math.round((canvas.top + canvas.bottom) / 2) };
await down(center); await up(center);
const addedSource = model.buffer.getText();
t.assert(addedSource !== initialSource && context.selection?.kind === 'member', 'the fixture sprite was not placed through the ordinary authoring flow');
const markerId = context.selection.entry.memberId.value;
const rowPoint = (id, placement = 'inside') => {
	const tree = primary.view.hierarchy.outline, index = tree.rows.findIndex(node => node.element.kind === 'member'
		&& node.element.entry.kind === 'object' && node.element.entry.memberId.value === id);
	t.assert(index >= 0, 'the source member is not a visible hierarchy occurrence');
	const row = tree.rows[index], layout = tree.layout;
	return { x: layout.contentLeft + (row.depth + 1) * layout.indentWidth + 2,
		y: layout.contentTop + (index - (tree.scroll | 0)) * layout.rowHeight
			+ (placement === 'before' ? 1 : placement === 'after' ? layout.rowHeight - 1 : layout.rowHeight / 2) };
};
const world = id => {
	const spatial = context.spatialScene, entry = spatial.entries.find(entry => entry.memberId.value === id);
	const pose = spatial.worlds.get(entry);
	return [pose.ox, pose.oy, pose.ox + pose.xx, pose.oy + pose.xy, pose.ox + pose.yx, pose.oy + pose.yy];
};
const originalWorld = world(markerId);
const retained = () => {
	t.assert(main.primary === primary && context.workingCopy === model, 'a hierarchy gesture replaced its Main/source owner');
	// These world points are authored keep-world data, not a screen-layout geometry oracle.
	t.assert(world(markerId).every((value, index) => value === originalWorld[index]), 'a hierarchy operation moved the sprite world pose');
	t.assert(t.runtime().machine.scheduler.nowCycles === cycles && t.sourceState().currentBlua32Media === installed,
		'a hierarchy operation executed or replaced the paused guest');
};
const selectedParent = () => context.getSpatialParents(context.selection.scene).get(context.selection.entry);
const fonts = new Set();
for (let font = 0; font < 2; font++) {
	for (let theme = 0; theme < 2; theme++) {
		t.command('sceneEditor.outline'); await t.frames(3);
		const variant = primary.view.hierarchy.layout.font.variant, label = `hierarchy-${variant}-${theme}`;
		fonts.add(variant); t.assert(model.buffer.getText() === addedSource, 'the preceding hierarchy cycle left a source mutation');
		let version = model.version;
		await down(rowPoint(markerId)); const beforeSecond = rowPoint('second', 'before'); await move(beforeSecond);
		t.assert(model.version === version && model.buffer.getText() === addedSource, 'a reorder preview wrote source before physical release');
		retained(); await capture(`${label}-reorder-preview`); await up(beforeSecond);
		t.assert(model.version === version + 1 && context.selection.index === 1 && selectedParent() === undefined,
			'the reorder did not publish its own exact root insertion once');
		const reordered = model.buffer.getText(); retained(); await capture(`${label}-reordered`);
		t.command('undo'); await t.frames(3); t.assert(model.buffer.getText() === addedSource, 'one Undo did not restore the exact reorder source');
		t.command('redo'); await t.frames(3); t.assert(model.buffer.getText() === reordered, 'Redo did not restore the same reordered source');
		t.command('undo'); await t.frames(3); retained();
		version = model.version;
		await down(rowPoint(markerId)); const insideFirst = rowPoint('first'); await move(insideFirst);
		t.assert(model.version === version, 'reparent preview wrote a parent or pose prematurely');
		await capture(`${label}-reparent-preview`); await up(insideFirst);
		t.assert(model.version === version + 1 && selectedParent()?.memberId.value === 'first', 'inside drop did not attach to the exact authored parent');
		const childSource = model.buffer.getText(); retained(); await capture(`${label}-reparented-sprite-stationary`);
		t.command('undo'); await t.frames(3); t.assert(model.buffer.getText() === addedSource, 'reparent needed more than one Undo');
		t.command('redo'); await t.frames(3); t.assert(model.buffer.getText() === childSource, 'reparent Redo changed the accepted source');
		version = model.version;
		await down(rowPoint('first')); const descendant = rowPoint(markerId); await move(descendant);
		await capture(`${label}-cycle-rejected`); await up(descendant);
		t.assert(model.version === version && model.buffer.getText() === childSource, 'a rejected descendant drop produced source/history');
		retained(); version = model.version;
		await down(rowPoint(markerId)); const beforeThird = rowPoint('third', 'before'); await move(beforeThird);
		await capture(`${label}-detach-and-order-preview`); await up(beforeThird);
		t.assert(model.version === version + 1 && selectedParent() === undefined && context.selection.index === 2,
			'combined parent/order drop did not publish one exact root placement');
		retained(); await capture(`${label}-detached-sprite-stationary`);
		t.command('undo'); await t.frames(3); t.assert(model.buffer.getText() === childSource, 'one Undo did not restore both parent and source order');
		t.command('undo'); await t.frames(3); t.assert(model.buffer.getText() === addedSource, 'the hierarchy cycle failed to restore its starting source');
		version = model.version;
		await down(rowPoint(markerId)); await move(rowPoint('second', 'before')); await press('Escape');
		await capture(`${label}-escape-cancelled`); await up(rowPoint('second', 'before'));
		t.assert(model.version === version && model.buffer.getText() === addedSource, 'cancelled drag reappeared as a drop on release');
		await down(rowPoint(markerId)); const stale = rowPoint('second', 'before'); await move(stale);
		await press('ControlLeft', 'ShiftLeft', 'KeyT'); await up(stale); await press('ControlLeft', 'ShiftLeft', 'KeyT');
		t.assert(model.version === version && model.buffer.getText() === addedSource, 'font reflow transferred a held drag to new row geometry');
		retained(); await press('ContextMenu');
		t.assert(t.contextMenu().visible && !t.contextMenu().model.rows.some(row => row.command === 'sceneEditor.moveMemberUp' || row.command === 'sceneEditor.moveMemberDown'),
			'the routine member menu still duplicates direct hierarchy reorder gestures');
		await capture(`${label}-compact-context-menu`); await press('Escape');
		t.command('theme-toggle'); await t.frames(3);
	}
	await press('ControlLeft', 'ShiftLeft', 'KeyT'); await t.frames(3);
}
t.assert(fonts.size === 2, 'the real hierarchy workflow did not cover both fonts');
t.command('undo'); await t.frames(4);
t.assert(model.buffer.getText() === initialSource && !model.dirty, 'ordinary Undo did not restore the complete isolated fixture source');
for (let index = 0; index < t.logMessageCount(); index++)
	t.assert(t.logMessage(index).level !== 3, `hierarchy workflow logged an error: ${t.logMessage(index).message}`);
t.log('Completed real hierarchy reorder/reparent/combined drops, stationary sprite world pose, history, rejected cycles, Escape/font retirement and contextual-menu cleanup in both fonts/themes.');
