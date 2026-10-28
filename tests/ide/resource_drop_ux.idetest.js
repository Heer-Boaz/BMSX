// Real Files gestures into groups, a split and a floating host over shipped source.
// Run: npm run ide:test -- nemesis_s tests/ide/resource_drop_ux.idetest.js --ttl 120
// Read existing owners for input coordinates and identity; never write their state.
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true }))); await t.frames(2);
	t.controlInput(codes.slice().reverse().map(code => ({ type: 'key', code, down: false }))); await t.frames(2);
};
const type = async text => {
	for (const character of text) await press(character === '/' ? 'Slash' : character === '.' ? 'Period' : `Key${character.toUpperCase()}`);
};
const point = async position => { t.controlInput([{ type: 'pointer', ...position }]); await t.frames(2); };
const down = async position => {
	t.controlInput([{ type: 'pointer', ...position }, { type: 'button', button: 'primary', down: true }]); await t.frames(2);
};
const up = async () => { t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(6); };
const bodyPoint = (group, edge = false) => {
	const body = group.panes.contentBounds, clip = group.clip;
	const left = Math.max(body.left, clip.left), right = Math.min(body.right, clip.right);
	const top = Math.max(body.top, clip.top), bottom = Math.min(body.bottom, clip.bottom);
	return { x: edge ? right - 3 : (left + right) / 2, y: (top + bottom) / 2 };
};
const filePoint = () => {
	const panel = t.resourcePanel(), node = panel.files.selectedNode, layout = panel.layout;
	return { x: layout.contentLeft - panel.hscroll + (node.depth + 1) * panel.files.tree.layout.indentWidth + 2,
		y: layout.contentTop + (panel.selectionIndex - Math.trunc(panel.scroll) + 0.5) * panel.lineHeight };
};
let captures = 0;
const capture = async label => {
	t.assert(++captures <= 32, 'Files drag inspection exceeded its capture budget');
	await t.frames(3); t.log(`VISUAL ${label}`); t.capture(label);
};
await t.waitForCart(); await t.frames(90); t.openLuaSource('cart.lua'); await t.frames(3);
const main = t.activeEditorGroup(), original = t.activeWorkbenchTab(), models = new Map();
const remember = input => {
	const model = input.workingCopy;
	if (!models.has(model)) models.set(model, { text: model.buffer.getText(), version: model.version, undo: model.canUndo, redo: model.canRedo });
};
remember(original);
const cycles = t.runtime().machine.scheduler.nowCycles, media = t.sourceState().currentBlua32Media;
const unchanged = () => {
	for (const [model, saved] of models) t.assert(model.buffer.getText() === saved.text && model.version === saved.version
		&& model.canUndo === saved.undo && model.canRedo === saved.redo && !model.dirty,
		'Files placement changed canonical source, history or dirty state');
	t.assert(t.runtime().machine.scheduler.nowCycles === cycles && t.sourceState().currentBlua32Media === media,
		'Files placement executed or replaced the paused program');
};
const prepareUnopenedFile = async () => {
	t.command('resourceSearch'); await t.frames(2); await type('scenes/title.lua'); await press('Enter'); await t.frames(3);
	const source = t.activeWorkbenchTab();
	t.assert(source.kind === 'code_editor' && source.workingCopy.resource.path === 'scenes/title.lua', 'source setup opened another authored resource');
	remember(source); t.command('tabs.close'); await t.frames(3);
	t.assert(t.activeEditorGroup() === main && t.activeWorkbenchTab() === original, 'closing the setup view changed the retained main group');
	t.command('resources.focus'); await t.frames(3);
	const selected = t.resourcePanel().files.selectedNode;
	t.assert(selected.element.kind === 'file' && selected.element.resource === source.workingCopy.resource,
		'Files did not retain the exact unopened resource after its Source view closed');
	return source.workingCopy;
};
for (const font of ['tiny', 'msx']) {
	for (const theme of ['light', 'dark']) {
		const model = await prepareUnopenedFile(), originalTabs = [...main.model.tabs];
		t.assert(t.activeEditorDocument().font.variant === font, 'the actual Source font differs from the inspection case');
		await capture(`files-drop-${font}-${theme}-ready`);
		await down(filePoint());
		t.assert(t.activeWorkbenchTab() === original && main.model.tabs.length === originalTabs.length,
			'Files opened a prospective drag source on press');
		await point(bodyPoint(main, true)); await capture(`files-drop-${font}-${theme}-split-preview`);
		t.assert(t.activeEditorGroup() === main && main.model.tabs.length === originalTabs.length,
			'hover feedback materialized a group or editor');
		await up();
		const sibling = t.activeEditorGroup(), splitSource = t.activeWorkbenchTab();
		t.assert(sibling !== main && sibling.surface.presentationParent === main.surface.presentationParent
			&& splitSource.kind === 'code_editor' && splitSource.workingCopy === model,
			'Files edge drop did not open its exact resource in a real neighboring group');
		t.assert(main.model.activeTab === original && originalTabs.every(input => main.model.contains(input)),
			'opening a split moved or replaced retained source inputs');
		await capture(`files-drop-${font}-${theme}-split`);

		t.command('resources.focus'); await t.frames(2); await down(filePoint()); await point(bodyPoint(main)); await up();
		const mainSource = t.activeWorkbenchTab();
		t.assert(t.activeEditorGroup() === main && mainSource !== splitSource && mainSource.kind === 'code_editor'
			&& mainSource.workingCopy === model && sibling.model.activeTab === splitSource,
			'explicit Files placement borrowed another group affinity or moved its retained view');
		await capture(`files-drop-${font}-${theme}-independent-source`);

		t.command('resources.focus'); await t.frames(2);
		if (t.resourcePanel().files.selectedNode.collapsed) await press('ArrowRight');
		await press('ArrowRight');
		const row = t.resourcePanel().files.selectedNode;
		t.assert(row.element.kind === 'definition' && row.element.content.kind === 'scene', 'Files did not expose a real Scene declaration');
		const declaration = row.element.content;
		t.controlInput([{ type: 'key', code: 'AltLeft', down: true }]); await t.frames(1);
		await down(filePoint()); await point(bodyPoint(main)); await capture(`files-drop-${font}-${theme}-floating-preview`);
		await up(); t.controlInput([{ type: 'key', code: 'AltLeft', down: false }]); await t.frames(3);
		const floating = t.activeEditorGroup(), scene = t.activeWorkbenchTab();
		t.assert(floating !== main && floating !== sibling && floating.surface.presentationParent !== main.surface.presentationParent
			&& scene.kind === 'scene_editor' && scene.workingCopy === model,
			'Alt-drag did not open the authored declaration in an independent floating host');
		const selectedScene = scene.outline.rows[scene.outline.selectionIndex].element;
		t.assert(selectedScene.span.start === declaration.range.start && selectedScene.span.end === declaration.range.end,
			'declaration drop selected another occurrence from the same source document');
		await capture(`files-drop-${font}-${theme}-floating-scene`); unchanged();
		t.command('window.hide'); await t.frames(4);

		// Close only the clean views created by this case, through ordinary commands.
		const tab = sibling.tabStrip.layoutState.items.peek(sibling.model.indexOf(splitSource)).bounds;
		await down({ x: (Math.max(tab.left, sibling.clip.left) + Math.min(tab.right, sibling.clip.right)) / 2,
			y: (tab.top + tab.bottom) / 2 }); await up();
		t.assert(t.activeEditorGroup() === sibling && t.activeWorkbenchTab() === splitSource, 'ordinary tab activation lost the split receiver');
		t.command('group.close'); await t.frames(4);
		t.assert(t.activeEditorGroup() === main && t.activeWorkbenchTab() === mainSource, 'closing the split lost the retained main source');
		t.command('tabs.close'); await t.frames(3);
		t.assert(t.activeWorkbenchTab() === original, 'closing the additional Source view retired the original input');

		await prepareUnopenedFile(); await down(filePoint()); await point(bodyPoint(main)); await press('Escape'); await up();
		t.assert(t.activeEditorGroup() === main && t.activeWorkbenchTab() === original && main.model.tabs.length === originalTabs.length,
			'cancelling the drag completed an opening on its later physical release');
		await capture(`files-drop-${font}-${theme}-cancelled`);
		await down(filePoint()); await up();
		const clicked = t.activeWorkbenchTab();
		t.assert(t.activeEditorGroup() === main && clicked.kind === 'code_editor' && clicked.workingCopy === model,
			'deferring drag admission broke the ordinary Files click');
		await capture(`files-drop-${font}-${theme}-click`); unchanged();
		t.command('tabs.close'); await t.frames(3);
		t.command('theme-toggle'); await t.frames(2);
	}
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
for (let index = 0; index < t.logMessageCount(); index++)
	t.assert(t.logMessage(index).level !== 3, `Files drag workflow logged an error: ${t.logMessage(index).message}`);
