import assert from 'node:assert/strict';
import test from 'node:test';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyModifier } from '../../hosts/common/input/text';
import { selectSceneOutlineRow } from '../../ide/workbench/contrib/scene_editor/outline';
import { createSceneDocumentFixture } from '../helpers/scene_document_fixture';
import { SCENE_VIEWPORT_IMPORTS, SCENE_VIEWPORT_SOURCE } from '../fixtures/studio/scene_viewport';

for (const font of ['tiny', 'msx'] as const) test(`${font} hidden Details cannot handle input through a retired field binding`, async t => {
	const f = await createSceneDocumentFixture(t, SCENE_VIEWPORT_SOURCE, SCENE_VIEWPORT_IMPORTS);
	f.editor.setFontVariant(font); f.update();
	selectSceneOutlineRow(f.view.hierarchy, 1); f.update();
	const details = f.primary.details.control;
	assert.ok(f.context.selection?.kind === 'member');
	assert.ok(details.options.controls.length > 0);
	assert.equal(f.editor.mainWorkspace.setRegionVisible('details', false), true); f.update();
	assert.equal(details.hasView, false);
	const before = f.model.buffer.getText(), tree = f.view.hierarchy.outline, root = tree.rows[0], layout = tree.layout;
	// Production row layout locates the target; the contract is routing and source ownership.
	const x = layout.contentLeft + (root.depth + 1.5) * layout.indentWidth;
	const y = layout.contentTop + (0.5 - tree.scroll) * layout.rowHeight;
	for (const down of [true, false]) {
		f.host.clock.advance(10);
		f.editor.dispatchPointer({ x, y, buttons: down ? PointerButton.Primary : 0,
			pressedButtons: down ? PointerButton.Primary : 0, releasedButtons: down ? 0 : PointerButton.Primary,
			cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: f.host.clock.now() });
	}
	assert.equal(f.context.selection?.kind, 'scene');
	assert.equal(f.model.buffer.getText(), before); assert.equal(f.model.dirty, false);
	assert.equal(f.editor.mainWorkspace.setRegionVisible('details', true), true); f.update();
	assert.equal(details.hasView, true); assert.equal(details.options.controls.length, 0);
	selectSceneOutlineRow(f.view.hierarchy, 1); f.update();
	assert.ok(f.context.selection?.kind === 'member');
	assert.equal(details.options.controls.length, f.view.details.optionProperties.length);
});
