import { SceneEditorPane } from '../../../ide/workbench/contrib/scene_editor/editor_pane';
import type { SceneEditorInput } from '../../../ide/workbench/contrib/scene_editor/editor_input';
import { openSceneEditor, selectMember, selectSceneRow } from './studio_scene_source';
import { check, type StudioFixture } from './studio_fixture';

async function clickTwistie(test: StudioFixture, input: SceneEditorInput, index: number, heldFrames = 1): Promise<void> {
	const { layout, scroll, rows } = input.outline;
	const left = layout.contentLeft + rows[index].depth * layout.indentWidth;
	const top = layout.contentTop + (index - scroll) * layout.rowHeight;
	await test.click({ left, right: left + layout.twistieWidth, top, bottom: top + layout.rowHeight }, heldFrames);
}

/** Actual source-outline topology, empty targets, focus and source correspondence. */
export async function testSceneSourceTree(test: StudioFixture): Promise<void> {
	const { harness, ide, frame, press, click, cycles, title } = test;
	harness.openLuaSource('scenes/root.lua');
	const model = harness.getActiveEditorDocument().model;
	const original = model.buffer.getText();
	const before = cycles();
	const actor = title();
	const media = ide.sources.currentBlua32Media;
	const scene = await openSceneEditor(test);
	const tree = scene.outline;
	const root = tree.roots[0];
	check(tree.roots.length === 1 && tree.rows.length === 5 && tree.selectionIndex === 0
		&& root.element.kind === 'scene' && root.children.length === 4, 'tree: initial selection is the actual definition, not an implicit member');
	const pane = ide.editor.editorPanes.activePane;
	if (!(pane instanceof SceneEditorPane)) throw new Error('tree: actual Scene Editor pane required');
	const x = pane.controls[0];
	check(pane.controls.every(control => control.field.readOnly), 'tree: a definition root has no editable member properties');
	await press('Tab');
	await press('Tab');
	check(scene.actionBar.hasFocus && !x.field.focusTarget.hasFocus, 'tree: Tab skips disabled fields and reaches the toolbar');
	await press('Escape');
	for (const command of ['sceneEditor.removeMember', 'sceneEditor.moveMemberUp', 'sceneEditor.moveMemberDown'] as const) {
		check(!ide.editor.commands.isEnabled(command), 'tree: roots never admit a member command');
	}
	const rows = tree.rows;
	const parsed = scene.parsed;
	for (let index = 0; index < 8; index += 1) await frame();
	check(tree.rows === rows && tree.roots[0] === root && tree.rows[3] === root.children[2] && scene.parsed === parsed,
		'tree: stable frames retain topology, visible rows and syntax');
	await selectSceneRow(test, scene, 0);
	check(!root.collapsed, 'tree: label clicks select without toggling expansion');
	await clickTwistie(test, scene, 0, 8);
	check(root.collapsed && tree.rows.length === 1 && tree.selectionIndex === 0 && scene.parsed === parsed,
		'tree: a held twistie press collapses once without rebuilding source topology');
	await press('ArrowRight');
	check(!root.collapsed && tree.selectionIndex === 0, 'tree: first Right expands the selected definition');
	await press('ArrowRight');
	check(tree.rows[tree.selectionIndex] === root.children[0] && !x.field.readOnly, 'tree: second Right selects the first actual member');
	await press('ArrowLeft');
	check(tree.rows[tree.selectionIndex] === root && x.field.readOnly, 'tree: Left from a leaf selects its actual parent');
	await press('End');
	check(tree.rows[tree.selectionIndex] === root.children[3], 'tree: End selects the last visible child');
	await press('Home');
	check(tree.rows[tree.selectionIndex] === root, 'tree: Home selects the first visible root');

	await selectMember(test, scene, 2);
	await click(scene.properties[0].bounds);
	await press('Digit8');
	await clickTwistie(test, scene, 0);
	check(tree.roots[0].collapsed && tree.selectionIndex === 0 && x.field.readOnly && !x.pending
		&& model.buffer.getText() !== original, 'tree: collapse accepts the departing property through ordinary blur and removes hidden edit focus');
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === original && tree.roots[0].collapsed && tree.selectionIndex === 0,
		'tree: one document Undo restores the property, not the view expansion');
	await click(scene.actionBar.items[0].bounds);
	const context = harness.getActiveEditorDocument();
	check(context.model === model && context.view.cursorRow === tree.roots[0].element.source.start.line - 1
		&& context.view.cursorColumn === tree.roots[0].element.source.start.column - 1,
		'tree: Source navigates to the selected definition in the same working copy');
	await openSceneEditor(test);
	check(tree.roots[0].collapsed && tree.selectionIndex === 0, 'tree: returning to the view retains the definition selection and expansion');

	// Additional hand-authored definitions, never installed or executed as a guest graph.
	const empty = 'scene_library.register(root_scene.id, { objects = {} })\n';
	const populated = "scene_library.register(root_scene.id, { objects = { { member_id = 'extra', definition_id = 'extra' } } })\n";
	const partial = "scene_library.register('partial', { objects = { [7] = make_member() } })\n";
	model.pushEditOperations([{ offset: original.indexOf('return root_scene'), deleteLength: 0, text: empty + populated + partial }]);
	await frame();
	check(tree.roots.length === 4 && tree.rows.length === 5 && tree.roots[0].collapsed,
		'tree: empty and keyed-only definitions remain actual roots alongside collapsed populated definitions');
	await selectSceneRow(test, scene, 1);
	check(tree.roots[1].element.kind === 'scene' && tree.roots[1].children.length === 0 && scene.detailsText.some(line => line.text === '0 MEMBERS')
		&& tree.roots[1].element.label === tree.roots[0].element.label && x.field.readOnly,
		'tree: an empty same-name scene is selectable without a fake member or editable position');
	await press('ArrowRight');
	check(tree.selectionIndex === 1 && !tree.roots[1].collapsed, 'tree: Right on an empty root never jumps to the following definition');
	await clickTwistie(test, scene, 1);
	check(tree.selectionIndex === 1 && !tree.roots[1].collapsed, 'tree: childless roots have no expansion hit target');
	await selectSceneRow(test, scene, 4);
	check(scene.detailsText.some(line => line.text === '0 MEMBERS (PARTIAL)') && tree.roots[3].element.displayLabel.startsWith('* '),
		'tree: a keyed-only definition reports its own partial projection instead of disappearing');
	await selectSceneRow(test, scene, 2);
	await clickTwistie(test, scene, 2);
	check(tree.roots[2].collapsed && tree.roots[0].collapsed && tree.rows.length === 4,
		'tree: equal labels retain independent expansion and exact source selection');
	await click(scene.actionBar.items[0].bounds);
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- hidden outline source shift\n' }]);
	const nameOffset = model.buffer.getText().indexOf(populated) + 'scene_library.register('.length;
	model.pushEditOperations([{ offset: nameOffset, deleteLength: 'root_scene.id'.length, text: "'renamed'" }]);
	await openSceneEditor(test);
	check(tree.roots[2].element.label === "'renamed'" && tree.roots[2].collapsed && tree.selectionIndex === 2 && tree.roots[0].collapsed,
		'tree: hidden source shifts and renaming preserve the actual definition, not a label identity');
	await press('ControlLeft', 'KeyZ');
	await press('ControlLeft', 'KeyZ');
	check(tree.roots[2].element.label === tree.roots[0].element.label && tree.roots[2].collapsed && tree.selectionIndex === 2,
		'tree: inverse source mapping preserves the independently collapsed namesake');
	const span = tree.roots[2].element.span;
	model.pushEditOperations([{ offset: span.start, deleteLength: span.end - span.start, text: '{ objects = {} }' }]);
	await frame();
	check(tree.selectionIndex === -1 && tree.roots[2].children.length === 0 && !tree.roots[2].collapsed && tree.roots[0].collapsed,
		'tree: replacing a complete definition drops its identity instead of borrowing its name or old collapse state');
	await press('ControlLeft', 'KeyZ');
	check(tree.selectionIndex === -1 && tree.roots[2].children.length === 1 && !tree.roots[2].collapsed && tree.roots[0].collapsed,
		'tree: Undo restores source without resurrecting a removed view identity');
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === original && !model.dirty && tree.roots.length === 1,
		'tree: fixtures restore the real cart source through the existing document history');
	await press('Home');
	await press('ArrowRight');
	check(!tree.roots[0].collapsed && tree.rows.length === 5 && cycles() === before && title() === actor && ide.sources.currentBlua32Media === media,
		'tree: source navigation and hierarchy never advance or mutate the paused machine');
	console.info('STUDIO: scene source tree, empty definitions and source correspondence passed');
}
