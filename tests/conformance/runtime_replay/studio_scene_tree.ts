import { SceneEditorPane } from '../../../ide/workbench/contrib/scene_editor/editor_pane';
import type { SceneEditorInput } from '../../../ide/workbench/contrib/scene_editor/editor_input';
import { openSceneEditor, openSceneFixture, selectMember, selectSceneRow } from './studio_scene_source';
import { check, type StudioFixture } from './studio_fixture';

async function clickTwistie(test: StudioFixture, input: SceneEditorInput, index: number, heldFrames = 1): Promise<void> {
	const { layout, scroll, rows } = input.view.outline;
	const left = layout.contentLeft + rows[index].depth * layout.indentWidth;
	const top = layout.contentTop + (index - scroll) * layout.rowHeight;
	await test.click({ left, right: left + layout.twistieWidth, top, bottom: top + layout.rowHeight }, heldFrames);
}

/** Source hierarchy and selection identity over a test-owned declaration, never a game assembly. */
export async function testSceneSourceTree(test: StudioFixture): Promise<void> {
	const { ide, frame, press, click, cycles } = test;
	const { model, scene, close } = await openSceneFixture(test, 'tree');
	const original = model.buffer.getText(), before = cycles(), media = ide.sources.currentBlua32Media;
	const tree = scene.view.outline, root = tree.roots[0];
	check(root.element.kind === 'scene' && root.children.length === 4 && tree.rows[tree.selectionIndex] === root,
		'tree: a document selects its actual declaration, not an implicit member');
	const pane = ide.editor.editorParts.activeGroup.panes.activePane;
	if (!(pane instanceof SceneEditorPane)) throw new Error('tree: actual Scene controls required');
	const x = pane.control.controls[0], parsed = scene.view.authoring.document!.analysis.chunk;
	check(pane.control.controls.every(control => control.field.readOnly), 'tree: a definition root has no member field authority');
	for (let frameIndex = 0; frameIndex < 8; frameIndex++) await frame();
	check(tree.roots[0] === root && scene.view.authoring.document!.analysis.chunk === parsed, 'tree: unchanged frames retain source and hierarchy identity');
	await selectSceneRow(test, scene, 0); await clickTwistie(test, scene, 0, 8);
	check(root.collapsed && tree.rows.length === 1 && tree.rows[tree.selectionIndex] === root, 'tree: a held twistie gesture collapses once');
	await press('ArrowRight');
	check(!root.collapsed && tree.rows[tree.selectionIndex] === root, 'tree: the first Right expands the declaration');
	await press('ArrowRight');
	check(tree.rows[tree.selectionIndex] === root.children[0] && !x.field.readOnly, 'tree: the next Right selects the first source member');
	await press('ArrowLeft');
	check(tree.rows[tree.selectionIndex] === root && x.field.readOnly, 'tree: Left returns to the actual parent');
	await press('End');
	check(tree.rows[tree.selectionIndex] === root.children.at(-1), 'tree: End follows visible topology');
	await selectMember(test, scene, 2); await click(scene.view.properties[0].bounds); await press('Digit8');
	await clickTwistie(test, scene, 0);
	check(tree.roots[0].collapsed && tree.selectionIndex === 0 && x.field.readOnly && !x.pending
		&& model.buffer.getText() !== original, 'tree: collapse settles the departing member draft and retires hidden field focus');
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === original && tree.roots[0].collapsed, 'tree: document Undo changes source, not expansion');
	await click(scene.view.actionBar.items.find(item => item.command === 'editor.source')!.bounds);
	check(test.harness.getActiveEditorDocument().model === model, 'tree: Source follows the exact selected declaration resource');
	check(await openSceneEditor(test) === scene && scene.view.outline.roots[0].collapsed, 'tree: document navigation retains local expansion');
	const additional = "scenes.register('fixture.room', { objects = {} })\nscenes.register('fixture.room', { objects = { {member_id='same',definition_id='same'} } })\n";
	model.pushEditOperations([{ offset: original.indexOf('return {}'), deleteLength: 0, text: additional }]);
	await frame();
	const separate = tree.roots[2];
	check(tree.roots.length === 3 && separate !== tree.roots[0], 'tree: equal declaration names remain independent source occurrences');
	await selectSceneRow(test, scene, tree.rows.indexOf(separate));
	const span = separate.element.span;
	model.pushEditOperations([{ offset: span.start, deleteLength: span.end - span.start, text: '{ objects = {} }' }]);
	await frame();
	check(scene.view.authoring.selection === undefined && tree.roots[2].children.length === 0, 'tree: complete replacement retires selection rather than selecting a namesake');
	await press('ControlLeft', 'KeyZ');
	check(scene.view.authoring.selection === undefined && tree.roots[2].children.length === 1, 'tree: Undo restores source, not retired selection authority');
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === original && !model.dirty, 'tree: all fixture edits restore exact source');
	check(cycles() === before && ide.sources.currentBlua32Media === media, 'tree: source navigation never advances or installs the machine');
	await close();
}
