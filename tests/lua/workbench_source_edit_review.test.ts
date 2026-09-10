import { PointerButton } from '../../ide/input/pointer/buttons';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { HostOverlayQuadStream } from '../../machine/ts/render/host_overlay/quad_stream';
import { Font } from '../../machine/ts/render/shared/bmsx_font';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { PointerCaptureService } from '../../ide/input/pointer/capture';
import { InputFocusService } from '../../ide/input/focus';
import { WorkbenchSourceEditReview } from '../../ide/workbench/ui/source_edit_review/control';
import { createHostOverlayFixture } from '../helpers/host_overlay';
import { api } from '../../ide/runtime/overlay_api';
import { drawWorkbenchSourceEditReview } from '../../ide/workbench/render/source_edit_review';

function fixture(t: TestContext, count = 36) {
	const model = new EditorTextModel({ domain: 0, path: 'review.lua', source: { type: 'lua', resid: 'review' } }, 'lua', "return 'before'");
	const focus = new InputFocusService();
	const parent = focus.createTarget();
	const review = new WorkbenchSourceEditReview(focus, new PointerCaptureService(), parent);
	const font = new Font({ variant: 'tiny' });
	let measurements = 0;
	const measure = (text: string, start: number, end: number) => { measurements += 1; return font.measure(text.slice(start, end)); };
	const bounds = { left: 4, top: 26, right: 380, bottom: 268 };
	let applied = 0;
	let opened = -1;
	const show = () => review.show({ model, title: 'REVIEW SOURCE', summary: `${count} USES OF ONE SOURCE EDIT`,
		items: Array.from({ length: count }, (_, index) => ({ label: `CONSUMER ${index}`, value: 'before -> after', description: `CONSUMER ${index}: AUTHORED SOURCE ONLY.` })),
		apply() {
			assert.equal(review.visible, false, 'control is detached before the source edit');
			assert.equal(focus.target, parent, 'document owner regains focus before edit');
			applied += 1;
			model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: "return 'after'" }]);
		},
		openSource(index) { assert.equal(review.visible, false); opened = index; },
	});
	const layout = () => review.layout(font, measure, text => measure(text, 0, text.length), bounds);
	parent.focus(); show(); layout();
	t.after(() => { review.dispose(); model.dispose(); });
	const pointer = (x: number, y: number, pressed: boolean, time = 10) => review.handlePointer({ valid: true, insideViewport: true,
		viewportX: x, viewportY: y, pressedButtons: pressed ? PointerButton.Primary : 0, justPressedButtons: 0, justReleasedButtons: 0 }, pressed, time);
	return { model, focus, parent, review, font, show, layout, pointer, measurements: () => measurements, applied: () => applied, opened: () => opened };
}

test('review rows select impacts; only a separate Apply writes one normal source history element', t => {
	const f = fixture(t);
	const layout = f.review.tree.layout;
	f.pointer(25, layout.contentTop + layout.rowHeight * 2 + 2, true);
	assert.equal(f.review.tree.selectionIndex, 2);
	assert.equal(f.model.dirty, false);
	assert.equal(f.applied(), 0);
	f.focus.executeCommand('sourceEditReview.apply');
	assert.equal(f.applied(), 1);
	assert.equal(f.model.buffer.getText(), "return 'after'");
	f.focus.executeCommand('sourceEditReview.apply');
	assert.equal(f.applied(), 1, 'departed control has no active command route');
	f.model.undo(); assert.equal(f.model.dirty, false);
	assert.equal(f.model.canUndo, false);
	f.model.redo(); assert.equal(f.model.buffer.getText(), "return 'after'");
});

test('review Source and Discard detach without edits, and cleanup does not steal unrelated focus', t => {
	const f = fixture(t);
	const layout = f.review.tree.layout;
	f.pointer(25, layout.contentTop + layout.rowHeight * 3 + 2, true);
	f.pointer(25, layout.contentTop + layout.rowHeight * 3 + 2, true, 30);
	assert.equal(f.opened(), 3);
	assert.equal(f.model.version, 1);
	f.show(); f.focus.executeCommand('sourceEditReview.discard');
	assert.equal(f.review.visible, false); assert.equal(f.focus.target, f.parent);
	f.show(); const elsewhere = f.focus.createTarget(); elsewhere.focus();
	f.review.clear(); assert.equal(f.focus.target, elsewhere);
	assert.equal(f.model.canUndo, false);
});

test('palette focus can return to the review, but source changes and writability revoke acceptance', t => {
	const f = fixture(t);
	const palette = f.focus.createTarget(); palette.focus();
	assert.equal(f.review.visible, true, 'blur is not proposal disposal');
	f.review.focusTarget.focus();
	assert.equal(f.review.isEnabled('sourceEditReview.apply'), true);
	f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- changed\n' }]);
	assert.equal(f.review.visible, false, 'source notification cancels synchronously, not after a stale Apply');
	assert.equal(f.applied(), 0);
	f.show(); f.model.refreshResource({ ...f.model.resource, source: { ...f.model.resource.source, generated: true } });
	assert.equal(f.review.isEnabled('sourceEditReview.apply'), false);
	f.review.apply(); assert.equal(f.applied(), 0);
	f.review.update(); assert.equal(f.review.visible, false);
});

test('source review keeps tiny-font rows, toolbar and overlay storage retained on unchanged frames', t => {
	const f = fixture(t);
	const rows = f.review.tree.rows;
	const element = rows[0].element;
	const measured = f.measurements();
	for (let index = 0; index < 50; index += 1) {
		f.review.handleWheel(index % 2 === 0 ? 1 : -1); f.layout();
	}
	assert.equal(f.measurements(), measured);
	assert.equal(f.review.tree.rows, rows);
	assert.equal(rows[0].element, element);
	for (const item of f.review.actionBar.items) {
		assert.ok(item.bounds.left >= 4 && item.bounds.right <= 380);
		assert.ok(item.bounds.bottom < f.review.tree.layout.contentTop);
	}
	const overlay = createHostOverlayFixture(384, 288);
	const stream = new HostOverlayQuadStream();
	const draw = () => {
		overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer);
		drawWorkbenchSourceEditReview(f.review); overlay.renderer.endFrame();
		const frame = overlay.queue.consumeOverlayFrame(); stream.reset(384, 288);
		for (let index = 0; index < frame.commandCount; index += 1) stream.appendEntry(frame.commandKinds[index], frame.commandRefs[index]);
	};
	draw(); const quads = stream.floatData;
	for (let index = 0; index < 50; index += 1) draw();
	assert.equal(stream.floatData, quads);
	assert.equal(f.measurements(), measured, 'painting never formats source or text');
});
