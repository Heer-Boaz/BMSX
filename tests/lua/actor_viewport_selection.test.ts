import assert from 'node:assert/strict';
import test from 'node:test';
import { api } from '../../ide/runtime/overlay_api';
import { ActorRenderFrame } from '../../ide/workbench/contrib/actor_lab/render_geometry';
import { ActorViewportSelection } from '../../ide/workbench/contrib/actor_lab/viewport_selection';

// Geometry is the contract here: selected visual outlines must follow the same
// published affine pose and scanout placement, not hover/focus or a later heap.
test('Game selection projects every selected visual and retains geometry until image, identity or allocation changes', t => {
	const frame = new ActorRenderFrame(); frame.sequence = 1; frame.width = 100; frame.height = 100; frame.offsetX = 2; frame.offsetY = 3;
	Object.assign(frame.quads.get(0), { domain: 0, hashId: 7, ox: 10, oy: 20, ax: 8, ay: 2, bx: -4, by: 6 });
	Object.assign(frame.quads.get(1), { domain: 0, hashId: 7, ox: 30, oy: 40, ax: 4, ay: 0, bx: 0, by: 5 });
	Object.assign(frame.quads.get(2), { domain: 1, hashId: 7, ox: 0, oy: 0, ax: 4, ay: 0, bx: 0, by: 5 });
	const bounds = { left: 10, top: 20, right: 210, bottom: 320 }, selection = new ActorViewportSelection();
	const peek = t.mock.method(frame.quads, 'peek'), outlines: number[][] = [];
	t.mock.method(api, 'pushClipRect', () => {}); t.mock.method(api, 'popClipRect', () => {});
	t.mock.method(api, 'outlinedPolyline', points => { outlines.push(points.slice()); });
	selection.update(frame, 1, 0, 7, bounds); selection.draw(bounds);
	assert.equal(outlines.length, 2);
	assert.deepEqual(outlines[0], [34, 89, 50, 95, 42, 113, 26, 107, 34, 89]);
	assert.deepEqual(outlines[1], [74, 149, 82, 149, 82, 164, 74, 164, 74, 149]);
	const reads = peek.mock.callCount();
	frame.sequence++;
	selection.update(frame, 1, 0, 7, bounds);
	assert.equal(peek.mock.callCount(), reads, 're-presenting the same image does not rescan its geometry');
	frame.quads.peek(0).ox += 10;
	selection.update(frame, 2, 0, 7, bounds); outlines.length = 0; selection.draw(bounds);
	assert.equal(outlines[0][0], 54);
	bounds.right += 100;
	selection.update(frame, 2, 0, 7, bounds); outlines.length = 0; selection.draw(bounds);
	assert.equal(outlines[0][0], 76, 'resize reprojects the retained visual');
	selection.update(frame, 2, 1, 7, bounds); outlines.length = 0; selection.draw(bounds);
	assert.equal(outlines.length, 1, 'the same hash in another cartridge is not the selected instance');
	const selectedReads = peek.mock.callCount();
	selection.update(frame, 2, 1, 0, bounds); outlines.length = 0; selection.draw(bounds);
	assert.equal(outlines.length, 0);
	assert.equal(peek.mock.callCount(), selectedReads, 'an empty selection never scans draw geometry');
	selection.update(frame, 2, 1, 7, bounds);
	frame.sequence = undefined;
	selection.update(frame, 3, 1, 7, bounds); outlines.length = 0; selection.draw(bounds);
	assert.equal(outlines.length, 0, 'retired presentation cannot keep a stale outline');
});
