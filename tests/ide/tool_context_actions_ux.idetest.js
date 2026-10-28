// Actual shipped subjects, canonical source and ordinary context-menu gestures.
// Run: npm run ide:test -- nemesis_s tests/ide/tool_context_actions_ux.idetest.js --ttl 120
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true }))); await t.frames(2);
	t.controlInput(codes.slice().reverse().map(code => ({ type: 'key', code, down: false }))); await t.frames(2);
};
const secondary = async (x, y) => {
	t.controlInput([{ type: 'pointer', x, y }, { type: 'button', button: 'secondary', down: true }]); await t.frames(2);
	t.controlInput([{ type: 'button', button: 'secondary', down: false }]); await t.frames(2);
};
let captures = 0;
const capture = async label => {
	t.assert(++captures <= 32, 'the contextual-tool workflow exceeded its capture budget');
	await t.frames(2); t.log(`VISUAL ${label}`); t.capture(label);
};
const accept = async command => {
	const menu = t.contextMenu();
	t.assert(menu.visible && menu.model.rows.some(row => row.command === command && row.enabled),
		'the invoking subject did not admit the requested context action');
	await press('Home');
	for (let step = 0; step < menu.model.rows.length && menu.model.rows[menu.model.selectedIndex]?.command !== command; step++) await press('ArrowDown');
	t.assert(menu.model.rows[menu.model.selectedIndex]?.command === command, 'ordinary menu navigation did not reach the admitted action');
	await press('Enter'); await t.frames(3);
	t.assert(!menu.visible, 'accepting the context action left a stale menu');
};
const rowPoint = (tree, index) => ({ x: tree.layout.contentLeft + 2,
	y: tree.layout.contentTop + (index - (tree.scroll | 0) + 0.5) * tree.layout.rowHeight });
await t.waitForCart(); await t.frames(90); t.openLuaSource('cart.lua'); await t.frames(3);
t.command('sceneEditor'); await t.frames(2); await press('Enter'); await t.frames(3);
const scene = t.activeWorkbenchTab(), main = t.activeEditorGroup();
t.assert(scene.kind === 'scene_editor', 'the shipped authored Scene did not open');
const model = scene.workingCopy, source = model.buffer.getText(), cycles = t.runtime().machine.scheduler.nowCycles;
const selectedScene = () => scene.outline.rows[scene.outline.selectionIndex];
const unchanged = () => {
	t.assert(model.buffer.getText() === source && !model.dirty, 'context navigation changed canonical Scene source');
	t.assert(t.runtime().machine.scheduler.nowCycles === cycles, 'context navigation advanced the paused guest');
};
for (let font = 0; font < 2; font++) {
	for (let theme = 0; theme < 2; theme++) {
		const variant = scene.layout.font.variant, version = model.version;
		t.command('sceneEditor.outline'); await t.frames(2); await press('Home'); await press('ArrowDown');
		const member = selectedScene();
		t.assert(member.element.kind === 'member', 'the shipped Scene did not expose an authored member');
		await press('ContextMenu');
		t.assert(t.contextMenu().visible && t.contextMenu().invocationOrigin.hasFocus === false,
			'the authored member did not yield keyboard input to its context menu');
		await capture(`scene-${variant}-${theme}-member-keyboard-menu`); await press('Escape');
		t.assert(selectedScene() === member && !t.contextMenu().visible && model.version === version,
			'cancelling the member menu changed its selection or source generation');
		await press('Home'); const root = selectedScene(), collapsed = root.collapsed;
		const definition = { ...scene.selectionRange };
		await press('ArrowDown'); const point = rowPoint(scene.outline, scene.outline.rows.indexOf(root));
		await secondary(point.x, point.y);
		t.assert(t.contextMenu().visible && selectedScene() === root && root.collapsed === collapsed,
			'secondary disclosure-lane input toggled or activated the Scene instead of selecting its context');
		await capture(`scene-${variant}-${theme}-definition-pointer-menu`);
		await accept('editor.sourceToSide');
		const code = t.activeWorkbenchTab();
		t.assert(t.activeEditorGroup() !== main && code.kind === 'code_editor' && code.workingCopy === model
			&& t.activeEditorDocument().model === model && t.activeEditorDocument().focusTarget.hasFocus,
			'context Source to Side did not open the exact canonical Scene model in a neighboring group');
		await capture(`scene-${variant}-${theme}-source-to-side`); unchanged();
		// Closing the group is explicit; closing only its tab intentionally retains an empty client.
		t.command('group.close'); await t.frames(3);
		t.assert(t.activeEditorGroup() === main && t.activeWorkbenchTab() === scene
			&& scene.selectionRange.start === definition.start && scene.selectionRange.end === definition.end,
			'closing the source side view lost its original authored Scene context');
		await press('ShiftLeft', 'F10'); await accept('sceneEditor.details');
		t.assert(scene.section === 'details' && scene.selectionRange.start === definition.start && scene.selectionRange.end === definition.end,
			'the definition menu opened Details for another authored subject');
		await capture(`scene-${variant}-${theme}-definition-details`); await press('Escape');
		await press('End'); t.assert(selectedScene().element.kind === 'member', 'the final Scene member is not an editable occurrence');
		await press('ContextMenu'); await accept('sceneEditor.moveMemberUp');
		t.assert(model.buffer.getText() !== source && model.canUndo && t.activeWorkbenchTab() === scene,
			'the member context action did not edit its own canonical source through document history');
		await press('ControlLeft', 'KeyZ'); unchanged();
		t.command('theme-toggle'); await t.frames(2);
	}
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
unchanged();
t.command('actorLab'); await t.frames(2); await press('Enter'); await t.frames(3);
const actor = t.activeWorkbenchTab();
t.assert(actor.kind === 'actor_lab' && actor.actorPresent, 'the shipped runtime actor did not open');
for (let font = 0; font < 2; font++) {
	for (let theme = 0; theme < 2; theme++) {
		const variant = actor.layout.font.variant;
		await press('Home'); const root = actor.outline.rows[actor.outline.selectionIndex], collapsed = root.collapsed;
		await press('ArrowDown'); const point = rowPoint(actor.outline, actor.outline.rows.indexOf(root));
		await secondary(point.x, point.y);
		t.assert(t.contextMenu().visible && actor.outline.rows[actor.outline.selectionIndex] === root && root.collapsed === collapsed,
			'secondary Actor disclosure-lane input changed expansion instead of selecting the actual instance');
		t.assert(!t.contextMenu().model.rows.some(row => row.command === 'graph.zoomIn'), 'the Actor outline exposed inapplicable graph-only controls');
		await capture(`actor-${variant}-${theme}-outline-pointer-menu`); await accept('actorLab.details');
		t.assert(actor.detailsWindow.open && actor.details.available && actor.details.subject.actorHashId === actor.actorHashId
			&& actor.details.subject.domain === actor.domain && actor.details.subject.worldHashId === actor.worldHashId
			&& actor.details.subject.path.length === 1 && actor.details.subject.path[0].hashId === root.element.node.hashId
			&& actor.details.subject.path[0].kind === root.element.node.kind, 'the context action inspected a different physical instance');
		await capture(`actor-${variant}-${theme}-instance-details`); t.command('window.hide'); await t.frames(2);
		await press('ShiftLeft', 'F10'); t.assert(t.contextMenu().visible, 'the Actor outline has no keyboard context menu');
		await press('Escape');
		const index = actor.outline.rows.findIndex(row => row.element.node.kind === 'machine');
		t.assert(index >= 0, 'the shipped actor did not expose a live machine');
		await press('Home'); for (let row = 0; row < index; row++) await press('ArrowDown');
		const machine = actor.outline.rows[actor.outline.selectionIndex].element.node;
		t.command('actorLab.stateGraph'); await t.frames(3);
		const graph = actor.stateGraph, selected = graph.viewport.selection;
		t.command('graph.resetZoom'); await t.frames(2); const zoom = graph.viewport.zoom;
		await press('ContextMenu');
		t.assert(t.contextMenu().visible && t.contextMenu().model.rows.some(row => row.command === 'actorLab.outline' && row.enabled),
			'the live graph did not expose its own keyboard context and return action');
		await capture(`actor-${variant}-${theme}-graph-keyboard-menu`); await accept('graph.zoomIn');
		t.assert(actor.stateGraph === graph && graph.viewport.selection === selected && graph.viewport.zoom > zoom,
			'graph context zoom replaced its retained physical subject or failed to act');
		await press('ShiftLeft', 'F10'); await accept('actorLab.outline');
		t.assert(actor.presentation === 'outline' && actor.outline.rows[actor.outline.selectionIndex].element.node === machine,
			'graph context return did not restore its exact machine in the outline');
		unchanged(); t.command('theme-toggle'); await t.frames(2);
	}
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
unchanged();
for (let index = 0; index < t.logMessageCount(); index++)
	t.assert(t.logMessage(index).level !== 3, 'the contextual-tool workflow logged an error');
