import assert from 'node:assert/strict';
import test from 'node:test';
import { SCROLLBAR_WIDTH } from '../../ide/common/constants';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { HomeInput } from '../../ide/workbench/contrib/home/editor_input';
import { GameViewInput } from '../../ide/workbench/contrib/game_view/editor_input';
import { createTestEditorParts } from '../helpers/editor_panes';

// The advertised minimum rectangle must contain the real chrome and one complete
// client row. Geometry is the constraint owner's contract, not screenshot layout.
for (const font of ['tiny', 'msx'] as const) test(`group minimum contains an overflowing tab strip and client row at ${font}`, t => {
	configureFontVariant(font);
	const parts = createTestEditorParts(t), part = parts.main, group = part.activeGroup;
	const first = new HomeInput(null), second = new GameViewInput();
	first.title = 'First editor'; second.title = 'Second editor';
	group.openEditor(first, { preserveFocus: true });
	group.openEditor(second, { preserveFocus: true });
	const width = group.minimumWidth, height = group.minimumHeight;
	part.layout({ left: 0, top: 0, right: width, bottom: height });
	assert.equal(group.tabStrip.scrollbar.isVisible(), true);
	assert.equal(group.tabStrip.layoutState.totalHeight, group.tabStrip.minimumHeight);
	assert.equal(group.panes.contentBounds.bottom - group.panes.contentBounds.top, editorViewState.lineHeight);
	assert.equal(part.arrangement.contentHeight, height);

	// Once the tabs fit, the optional scrollbar lane belongs to the client: it
	// is not reserved as blank tab chrome and does not require another measure.
	part.layout({ left: 0, top: 0, right: 1024, bottom: height });
	assert.equal(group.tabStrip.scrollbar.isVisible(), false);
	assert.equal(group.tabStrip.layoutState.totalHeight, editorViewState.tabBarHeight);
	assert.equal(group.minimumHeight, height);
	assert.equal(group.panes.contentBounds.bottom - group.panes.contentBounds.top, editorViewState.lineHeight + SCROLLBAR_WIDTH);
});
