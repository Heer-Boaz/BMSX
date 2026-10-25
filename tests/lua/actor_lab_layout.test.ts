import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { configureFontVariant } from '../../ide/editor/ui/view/view';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { GAME_FRAME_MINIMUM_WIDTH, GAME_FRAME_MINIMUM_HEIGHT } from '../../ide/workbench/common/game_frame';
import { updateFullWidthWorkbenchLayout } from '../../ide/workbench/common/layout';
import { ActorLabInput } from '../../ide/workbench/contrib/actor_lab/editor_input';
import { layoutActorLab, measureActorLab } from '../../ide/workbench/contrib/actor_lab/layout';
import { ActorStateGraph } from '../../ide/workbench/contrib/actor_lab/state_graph';
import { GRAPH_NODE_PADDING } from '../../ide/workbench/ui/graph/model';

function fixture(t: TestContext, variant: 'tiny' | 'msx', presentation: 'outline' | 'graph' = 'outline') {
	configureFontVariant(new VirtualHeadlessClock(), variant, null);
	const input = new ActorLabInput(null!, 'actor-lab', 'Actor', false);
	input.presentation = presentation;
	if (presentation === 'graph') input.stateGraph = new ActorStateGraph({ domain: 0, worldHashId: 1, actorHashId: 2, path: [] }, editorViewState.font.renderFont());
	const bounds = { left: 23, top: 31, right: 923, bottom: 431 };
	const arrange = (width: number, height = 400) => {
		bounds.right = bounds.left + width; bounds.bottom = bounds.top + height;
		updateFullWidthWorkbenchLayout(input.layout, bounds);
		if (input.timeline.visible) input.timelineLayout.update(input.timeline, input.layout);
		layoutActorLab(input);
	};
	t.after(() => input.dispose());
	return { input, bounds, arrange };
}

// Exact dimensions here are the composition algorithm's contract: a complete
// primary reading budget, its padding, the 4px sash, and a useful padded frame.
for (const variant of ['tiny', 'msx'] as const) for (const presentation of ['outline', 'graph'] as const) {
	test(`Actor ${variant}/${presentation} admits the preview only when both measured clients fit on both axes`, t => {
		const { input, bounds, arrange } = fixture(t, variant, presentation), measured = measureActorLab(editorViewState.font);
		const primaryWidth = presentation === 'outline' ? measured.outlineMinimumWidth : measured.graphMinimumWidth;
		const primaryHeight = presentation === 'outline' ? measured.outlineMinimumHeight : measured.graphMinimumHeight;
		const width = primaryWidth + 4 + measured.previewMinimumWidth;
		const height = 2 + Math.max(primaryHeight, measured.previewMinimumHeight);
		arrange(width - 1, height);
		assert.equal(input.layout.previewVisible, false); assert.equal(input.layout.primaryRight, bounds.right);
		arrange(width, height - 1);
		assert.equal(input.layout.previewVisible, false); assert.equal(input.layout.primaryRight, bounds.right);
		arrange(width, height);
		assert.equal(input.layout.previewVisible, true);
		assert.equal(input.layout.primaryRight - bounds.left, primaryWidth);
		assert.ok(input.previewBounds.right - input.previewBounds.left >= GAME_FRAME_MINIMUM_WIDTH);
		assert.ok(input.previewBounds.bottom - input.previewBounds.top >= GAME_FRAME_MINIMUM_HEIGHT);
		if (presentation === 'outline') {
			const tree = input.outline.layout;
			assert.ok(tree.contentRight - tree.contentLeft - tree.indentWidth * 2 - 4 >= editorViewState.charAdvance * 32,
				'the actual root-row name retains its declared reading budget after disclosure, activity and scrollbar lanes');
		} else {
			const graph = input.stateGraph!.viewport.bounds;
			assert.ok(graph.right - graph.left >= editorViewState.charAdvance * 32 + GRAPH_NODE_PADDING * 2,
				'the graph content excludes its scrollbar before admitting the card/context reading budget');
		}
	});

	test(`Actor ${variant}/${presentation} preserves requested placement and owned identities through passive preview withholding`, t => {
		const { input, arrange } = fixture(t, variant, presentation), measured = measureActorLab(editorViewState.font);
		input.split.resize(0.6);
		const ratio = input.split.ratio, revision = input.split.revision;
		const selection = input.selectionPath = [], graph = input.stateGraph?.viewport.model;
		arrange(900);
		const primaryRight = input.layout.primaryRight, preview = { ...input.previewBounds };
		const primaryWidth = presentation === 'outline' ? measured.outlineMinimumWidth : measured.graphMinimumWidth;
		arrange(primaryWidth + 4 + measured.previewMinimumWidth - 1);
		assert.equal(input.layout.previewVisible, false);
		assert.deepEqual(input.previewBounds, preview, 'a hidden frame has no new geometry; admission, not stale rectangles, controls its consumers');
		arrange(900);
		assert.equal(input.layout.previewVisible, true); assert.equal(input.layout.primaryRight, primaryRight);
		assert.equal(input.split.ratio, ratio); assert.equal(input.split.revision, revision);
		assert.equal(input.selectionPath, selection); assert.equal(input.stateGraph?.viewport.model, graph);
		const readGuest = t.mock.method(input.runtime, 'update'), advance = t.mock.method(editorViewState.font, 'advance');
		for (let frame = 0; frame < 1000; frame++) layoutActorLab(input);
		assert.equal(readGuest.mock.callCount(), 0); assert.equal(advance.mock.callCount(), 0);
		assert.equal(measureActorLab(editorViewState.font), measured);
	});
}

test('Actor preview admission follows the current font and reserves the actual visible timeline height', t => {
	const { input, arrange } = fixture(t, 'tiny');
	const tiny = measureActorLab(editorViewState.font);
	const width = tiny.outlineMinimumWidth + 4 + tiny.previewMinimumWidth;
	arrange(width); assert.equal(input.layout.previewVisible, true);
	const ratio = input.split.ratio;
	configureFontVariant(new VirtualHeadlessClock(), 'msx', null);
	arrange(width); assert.equal(input.layout.previewVisible, false); assert.equal(input.split.ratio, ratio);
	configureFontVariant(new VirtualHeadlessClock(), 'tiny', null);
	arrange(width); assert.equal(input.layout.previewVisible, true); assert.equal(input.split.ratio, ratio);
	input.timeline.entryHashId = 1; input.timeline.positionLabel = '0 MS'; input.timeline.durationLabel = '100 MS';
	arrange(width);
	const height = 2 + input.timelineLayout.height + tiny.previewMinimumHeight;
	arrange(width, height - 1); assert.equal(input.layout.previewVisible, false);
	arrange(width, height); assert.equal(input.layout.previewVisible, true);
	assert.ok(input.previewBounds.bottom <= input.timelineLayout.top - 4);
});
