import assert from 'node:assert/strict';
import test from 'node:test';
import { Font } from '../../machine/ts/render/shared/bmsx_font';
import { createWorkbenchGraphModel, createWorkbenchGraphNode } from '../../ide/workbench/ui/graph/model';
import { WorkbenchGraphViewport } from '../../ide/workbench/ui/graph/viewport';

function fixture() {
	const font = new Font({ variant: 'tiny' });
	const nodes = [createWorkbenchGraphNode(font, 'near', -500, -500), createWorkbenchGraphNode(font, 'far', 2000, 2000)];
	const view = new WorkbenchGraphViewport(createWorkbenchGraphModel(font, nodes, []));
	view.layout(10, 20, 213, 123);
	view.selection = nodes[0];
	return view;
}

test('region reveal makes only the required scroll movement and never changes zoom or selection', () => {
	const view = fixture(), selected = view.selection;
	view.setZoom(2);
	view.scrollX = view.scrollY = 0;
	const bounds = { left: 100, top: 100, right: 150, bottom: 120 };
	view.revealBounds(bounds);
	assert.deepEqual([view.scrollX, view.scrollY], [106, 146]);
	for (let index = 0; index < 10; index++) view.revealBounds(bounds);
	assert.deepEqual([view.scrollX, view.scrollY], [106, 146]);
	assert.equal(view.zoom, 2);
	assert.equal(view.selection, selected);
	view.revealBounds({ left: 60, top: 80, right: 70, bottom: 90 });
	assert.deepEqual([view.scrollX, view.scrollY], [106, 146], 'already-visible content does not center');
	view.revealBounds({ left: 0, top: 0, right: 10, bottom: 10 });
	assert.deepEqual([view.scrollX, view.scrollY], [-6, -6]);
});

test('oversized concurrent regions retain overlap instead of oscillating between their first and last paths', () => {
	const view = fixture();
	const bounds = { left: 0, top: 0, right: 1000, bottom: 1000 };
	for (const position of [-100, 400, 950]) {
		view.scrollX = view.scrollY = position;
		view.revealBounds(bounds);
		assert.equal(view.scrollX, position);
		assert.equal(view.scrollY, position === -100 ? -6 : position);
	}
	view.scrollX = view.scrollY = -400;
	view.revealBounds(bounds);
	assert.deepEqual([view.scrollX, view.scrollY], [-6, -6]);
	view.scrollX = view.scrollY = 1500;
	view.revealBounds(bounds);
	assert.deepEqual([view.scrollX, view.scrollY], [806, 906]);
	view.revealBounds(bounds);
	assert.deepEqual([view.scrollX, view.scrollY], [806, 906]);
});
