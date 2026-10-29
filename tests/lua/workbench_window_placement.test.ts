import assert from 'node:assert/strict';
import test from 'node:test';
import { create_rect_bounds } from '../../machine/ts/common/rect';
import { WorkbenchWindowModel, WindowResizeEdge, type WindowPlacement } from '../../ide/workbench/ui/window/model';

test('restored placement publishes all window state together without replacing retained geometry', () => {
	const model = new WorkbenchWindowModel({ left: 0, top: 0, right: 200, bottom: 120 }, 100, 70);
	const requested = model.requestedBounds;
	const state = { requestedBounds: { left: 50, top: 60, right: 330, bottom: 240 }, placement: 'right' as const, minimized: true };
	let published = 0;
	model.onDidChangePlacement(() => {
		published++;
		assert.equal(model.requestedBounds, requested); assert.deepEqual(model.requestedBounds, state.requestedBounds);
		assert.equal(model.placement, state.placement); assert.equal(model.minimized, state.minimized);
	});
	model.setState(state); assert.equal(published, 1);
	const revision = model.revision;
	model.setState(state); assert.equal(published, 1); assert.equal(model.revision, revision);
});

test('chrome and content minima remain independent inputs to placement, resize and snap admission', () => {
	const model = new WorkbenchWindowModel({ left: 0, top: 0, right: 20, bottom: 100 }, 0, 70);
	const area = { left: 0, top: 0, right: 300, bottom: 200 };
	model.arrange(area, 16, undefined, 160);
	assert.equal(model.minimumWidth, 160); assert.equal(model.bounds.right - model.bounds.left, 160);
	assert.equal(model.canPlace('left', area), false);
	model.setMinimumSize(200, 70); model.arrange(area, 16);
	assert.equal(model.minimumWidth, 200); assert.equal(model.bounds.right - model.bounds.left, 200);
	model.setMinimumSize(0, 70); model.arrange(area, 16);
	assert.equal(model.minimumWidth, 160, 'content changes preserve the current shared chrome minimum');
	assert.equal(model.arrange(area, 16, undefined, 100), true);
	assert.equal(model.minimumWidth, 100); assert.equal(model.bounds.right - model.bounds.left, 100);
	assert.equal(model.canPlace('left', area), true);
	assert.equal(model.arrange(area, 16, undefined, 100), false);
});

// Exact rectangles here specify the placement algorithm, not incidental UI geometry.
test('half placements partition an odd live work area without gaps, overlap or changing normal intent', () => {
	const requested = { left: 70, top: 90, right: 370, bottom: 330 };
	const area = { left: 11, top: 23, right: 512, bottom: 383 };
	const model = new WorkbenchWindowModel(requested, 150, 100), preview = create_rect_bounds();
	const cases = [
		['left', { left: 11, top: 23, right: 261, bottom: 383 }],
		['right', { left: 261, top: 23, right: 512, bottom: 383 }],
		['maximized', area],
		['normal', requested],
	] as const;
	for (const [placement, expected] of cases) {
		assert.equal(model.canPlace(placement, area), true);
		model.writePlacementBounds(placement, area, preview);
		model.setPlacement(placement);
		assert.equal(model.arrange(area, 16), true);
		assert.deepEqual(preview, expected);
		assert.deepEqual(model.bounds, preview, 'a prospective rectangle is exactly the committed placement');
		assert.deepEqual(model.requestedBounds, requested);
		assert.equal(model.arrange(area, 16), false, 'unchanged layout reuses its arrangement');
	}
});

test('half admission uses its actual width and full chrome-inclusive minimum height', () => {
	const area = { left: 11, top: 23, right: 512, bottom: 383 };
	const model = new WorkbenchWindowModel(area, 251, 360);
	assert.equal(model.canPlace('left', area), false);
	assert.equal(model.canPlace('right', area), true, 'the right half owns the odd remainder');
	model.setMinimumSize(250, 361);
	assert.equal(model.canPlace('left', area), false);
	assert.equal(model.canPlace('right', area), false);
	model.setMinimumSize(250, 360);
	assert.equal(model.canPlace('left', area), true);
	assert.equal(model.canPlace('right', area), true);
	const smaller = { left: 0, top: 0, right: 200, bottom: 150 };
	assert.equal(model.canPlace('left', smaller), false);
	assert.equal(model.canPlace('right', smaller), false);
	assert.equal(model.canPlace('normal', smaller), true);
	assert.equal(model.canPlace('maximized', smaller), true);
});

test('retained snapped modes reflow against shrink and growth without enlarging over the other half', () => {
	const requested = { left: 70, top: 90, right: 370, bottom: 330 };
	const area = { left: 10, top: 20, right: 510, bottom: 380 };
	const smaller = { left: 30, top: 40, right: 231, bottom: 130 };
	const model = new WorkbenchWindowModel(requested, 150, 100);
	const bounds = model.bounds, header = model.header, client = model.client, normal = model.requestedBounds;
	for (const placement of ['left', 'right'] as const) {
		model.setPlacement(placement); model.arrange(area, 16);
		assert.equal(model.canPlace(placement, smaller), false, 'new admission is unavailable after shrink');
		model.arrange(smaller, 16);
		assert.equal(model.placement, placement, 'reflow does not invent a placement transition');
		assert.deepEqual(model.bounds, { left: placement === 'left' ? 30 : 130, top: 40,
			right: placement === 'left' ? 130 : 231, bottom: 130 });
		assert.deepEqual(model.requestedBounds, requested);
		model.arrange(area, 16);
		assert.deepEqual(model.bounds, { left: placement === 'left' ? 10 : 260, top: 20,
			right: placement === 'left' ? 260 : 510, bottom: 380 });
	}
	model.setPlacement('maximized'); model.arrange(smaller, 16);
	assert.deepEqual(model.bounds, smaller);
	model.setPlacement('normal'); model.arrange(area, 16);
	assert.deepEqual(model.bounds, requested, 'restore uses the normal request, not the previous half');
	assert.ok(model.bounds === bounds && model.header === header && model.client === client && model.requestedBounds === normal);
});

test('prospective placement writes do not mutate or publish the current mode or arranged client', () => {
	const requested = { left: 70, top: 90, right: 370, bottom: 330 };
	const area = { left: 10, top: 20, right: 510, bottom: 380 };
	const model = new WorkbenchWindowModel(requested, 150, 100), preview = create_rect_bounds();
	model.setPlacement('left'); model.arrange(area, 16);
	const bounds = { ...model.bounds }, client = { ...model.client }, revision = model.revision;
	let publications = 0;
	const unbind = model.onDidChangePlacement(() => publications++);
	for (const placement of ['normal', 'maximized', 'right'] as const) model.writePlacementBounds(placement, area, preview);
	assert.equal(model.placement, 'left'); assert.equal(model.revision, revision); assert.equal(publications, 0);
	assert.deepEqual(model.bounds, bounds); assert.deepEqual(model.client, client);
	assert.deepEqual(model.requestedBounds, requested); assert.equal(model.arrange(area, 16), false);
	unbind();
});

test('pending normal drag arrangement observes in-place edits and cancel or commit without publishing intermediate intent', () => {
	const requested = { left: 70, top: 90, right: 370, bottom: 330 };
	const area = { left: 10, top: 20, right: 510, bottom: 380 };
	const model = new WorkbenchWindowModel(requested, 150, 100), draft = { ...requested };
	model.setPlacement('maximized'); model.arrange(area, 16);
	const revision = model.revision;
	let publications = 0;
	const unbind = model.onDidChangePlacement(() => publications++);
	assert.equal(model.arrange(area, 16, draft), true);
	assert.equal(model.arrangedPlacement, 'normal'); assert.equal(model.placement, 'maximized');
	assert.deepEqual(model.bounds, draft);
	assert.equal(model.resizeEdgeAt(model.bounds.right - 1, model.bounds.bottom - 1), WindowResizeEdge.Right | WindowResizeEdge.Bottom);
	draft.left += 20; draft.right += 20;
	assert.equal(model.arrange(area, 16, draft), true, 'a retained mutable draft is compared by coordinates, not identity');
	assert.deepEqual(model.bounds, draft); assert.equal(model.arrange(area, 16, draft), false);
	assert.deepEqual(model.requestedBounds, requested); assert.equal(model.revision, revision); assert.equal(publications, 0);
	model.arrange(area, 16);
	assert.equal(model.arrangedPlacement, 'maximized'); assert.deepEqual(model.bounds, area);
	assert.deepEqual(model.requestedBounds, requested); assert.equal(publications, 0, 'discarding a draft has no durable write');
	model.arrange(area, 16, draft);
	model.setRequestedBounds(draft, 'normal'); model.arrange(area, 16);
	assert.equal(model.placement, 'normal'); assert.equal(model.arrangedPlacement, 'normal');
	assert.deepEqual(model.requestedBounds, draft); assert.deepEqual(model.bounds, draft);
	assert.equal(publications, 1, 'release publishes the final normal request and mode once');
	unbind();
});

test('a snapped move commits its normal request and placement atomically while minimizing stays orthogonal', () => {
	const requested = { left: 70, top: 90, right: 370, bottom: 330 };
	const moved = { left: 90, top: 100, right: 390, bottom: 340 };
	const model = new WorkbenchWindowModel(requested, 150, 100);
	model.setPlacement('right'); model.setMinimized(true);
	const changes: { placement: WindowPlacement; minimized: boolean; bounds: typeof requested }[] = [];
	const unbind = model.onDidChangePlacement(() => changes.push({ placement: model.placement,
		minimized: model.minimized, bounds: { ...model.requestedBounds } }));
	model.setRequestedBounds(moved, 'normal');
	assert.deepEqual(changes, [{ placement: 'normal', minimized: true, bounds: moved }]);
	model.setRequestedBounds(moved, 'normal');
	assert.equal(changes.length, 1);
	model.setPlacement('left'); model.setRequestedBounds(requested);
	assert.equal(model.placement, 'left', 'changing restore intent alone does not leave the current placement');
	model.setRequestedBounds(requested, 'normal');
	assert.equal(changes.length, 4, 'a mode-only normal transition still publishes exactly once');
	assert.deepEqual(changes[3], { placement: 'normal', minimized: true, bounds: requested });
	unbind();
});

test('snapped edges remain available to start a normal resize but maximized edges do not', () => {
	const area = { left: 10, top: 20, right: 510, bottom: 380 };
	const model = new WorkbenchWindowModel(area, 150, 100);
	for (const placement of ['left', 'right', 'normal'] as const) {
		model.setPlacement(placement); model.arrange(area, 16);
		assert.equal(model.resizeEdgeAt(model.bounds.right - 1, model.bounds.bottom - 1), WindowResizeEdge.Right | WindowResizeEdge.Bottom);
	}
	model.setPlacement('maximized'); model.arrange(area, 16);
	assert.equal(model.resizeEdgeAt(model.bounds.right - 1, model.bounds.bottom - 1), WindowResizeEdge.None);
});
