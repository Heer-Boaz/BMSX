import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import type { RectBounds } from '../../machine/ts/common/rect';
import { Font, type FontVariant } from '../../machine/ts/render/shared/bmsx_font';
import { Host2DKind } from '../../machine/ts/render/host_overlay/commands';
import type { GlyphRenderSubmission } from '../../machine/ts/render/shared/submissions';
import { EditorTextModelService } from '../../ide/editor/model/model_service';
import type { DisposableStore } from '../../ide/common/lifecycle';
import { InputFocusService } from '../../ide/input/focus';
import { PointerCaptureService } from '../../ide/input/pointer/capture';
import { PointerHoverService } from '../../ide/input/pointer/hover';
import { api } from '../../ide/runtime/overlay_api';
import { ContextMenuController } from '../../ide/workbench/services/context_menu/controller';
import { WorkbenchSurfaceService } from '../../ide/workbench/services/windows/service';
import { drawWorkbenchSourceEditReview } from '../../ide/workbench/render/source_edit_review';
import { WorkbenchSourceEditReview } from '../../ide/workbench/ui/source_edit_review/control';
import { createHostOverlayFixture } from '../helpers/host_overlay';

const PRIMARY = PointerButton.Primary;
const TITLE = 'MOVE SHARED BEHAVIOR SOURCE';
const SUMMARY = '6 RECOGNIZED USES: ORIGINAL BRANCH -> DESTINATION BRANCH POSITION 2';

function fixture(t: TestContext, variant: FontVariant = 'tiny') {
	const focus = new InputFocusService(), capture = new PointerCaptureService(), hover = new PointerHoverService();
	const surfaces = new WorkbenchSurfaceService(), area = { left: 0, top: 24, right: 384, bottom: 274 };
	const bounds = { ...area, right: variant === 'tiny' ? 78 : 118 };
	const parent = focus.createTarget(); parent.bindKeyboard(() => {}); parent.focus();
	const owner = surfaces.attach({ role: 'content', captureScope: parent.scope.surfaceScope,
		getBounds: () => bounds, getClip: () => bounds, isVisible: () => true, draw: () => { if (review.visible) drawWorkbenchSourceEditReview(review); } });
	const menu = new ContextMenuController(focus, capture, lifetime => {
		if (lifetime === undefined) return;
		lifetime.add(surfaces.attach({ role: 'transient', outsidePress: 'consume', lifetimeOwner: owner, captureScope: menu.pointerScope,
			getBounds: () => menu.model.bounds, getClip: () => area, isVisible: () => menu.visible, draw() {},
			onRetire: () => { if (!lifetime.isDisposed) { capture.cancelScope(menu.pointerScope); menu.hide(); } } }));
	});
	const review = new WorkbenchSourceEditReview(focus, capture, hover, parent, menu, surfaces, owner, area);
	const models = new EditorTextModelService();
	const model = models.retain({ domain: 0, path: 'shared_review.lua', source: { type: 'lua', resid: 'shared_review' } }, 'lua', "return 'before'");
	let font = new Font({ variant }), measurements = 0, applied = 0, opened = -1, time = 0;
	const measure = (text: string, start: number, end: number) => { measurements++; return font.measure(text.slice(start, end)); };
	const measureText = (text: string) => measure(text, 0, text.length);
	const layout = (width = bounds.right) => {
		bounds.right = width; review.layout(font, measure, measureText, bounds); review.update();
	};
	const show = (onWillShow?: (lifetime: DisposableStore) => void) => review.show({ model, title: TITLE, summary: SUMMARY, onWillShow,
		items: Array.from({ length: 6 }, (_, index) => ({ label: `Consumer ${index}`, value: 'before -> after', description: `Exact source use ${index}` })),
		apply() {
			assert.equal(review.visible, false); assert.equal(menu.visible, false);
			assert.equal(focus.target, parent, 'the review retires before its canonical source write');
			applied++; model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: "return 'after'" }]);
		},
		openSource(index) { assert.equal(review.visible, false); assert.equal(menu.visible, false); opened = index; },
	});
	const key = (code: string, down: boolean) => focus.handleKeyboard(new KeyInputEvent(code, KeyModifier.none, false, down));
	const press = (code: string) => { key(code, true); key(code, false); };
	const pointer = (rect: Readonly<RectBounds>, held = 0, down = 0, up = 0) => {
		const snapshot = { valid: true, insideViewport: true, viewportX: rect.left + 1, viewportY: rect.top + 1,
			pressedButtons: held, justPressedButtons: down, justReleasedButtons: up };
		if (!capture.dispatch(snapshot, false, ++time) && review.visible) review.handlePointer(snapshot, down !== 0, time);
	};
	const open = (keyboard = false) => {
		assert.ok(review.actionBar.overflow, 'source reviews use the existing responsive action bar');
		assert.equal(review.actionBar.overflow.button.visible, true);
		if (keyboard) { assert.equal(focus.moveFocus(false), true); press('End'); press('Enter'); }
		else pointer(review.actionBar.overflow.button.bounds, PRIMARY, PRIMARY, PRIMARY);
		assert.equal(menu.visible, true); menu.model.layout(384, 288, 8, font, measureText); menu.update();
		assert.equal(surfaces.findByScope(menu.pointerScope)!.lifetimeOwner, owner);
	};
	show(); layout();
	t.after(() => { review.dispose(); menu.dispose(); surfaces.dispose(); focus.setTarget(null); capture.cancel(); models.clear(); });
	return { focus, capture, surfaces, owner, parent, review, menu, models, model, area, bounds, show, layout, key, press, pointer, open,
		get font() { return font; }, changeFont(next: FontVariant) { font = new Font({ variant: next }); layout(); },
		measurements: () => measurements, applied: () => applied, opened: () => opened };
}

for (const variant of ['tiny', 'msx'] as const) test(`${variant} review keeps Apply explicit at its real minimum and all three labels at full width`, t => {
	const f = fixture(t, variant), bar = f.review.actionBar;
	assert.ok(bar.overflow, 'the review toolbar has a bounded overflow owner');
	assert.deepEqual(bar.items.map(item => item.command), ['sourceEditReview.apply', 'sourceEditReview.source', 'sourceEditReview.discard']);
	for (const width of [384, variant === 'tiny' ? 78 : 118, 384]) {
		f.layout(width);
		const primary = bar.items.filter(item => item.visible && !item.overflowed);
		assert.equal(primary[0].command, 'sourceEditReview.apply');
		assert.equal(primary[0].icon, undefined, 'Apply remains an explicit semantic label, not a guessed icon');
		for (const item of [...primary, ...(bar.overflow.button.visible ? [bar.overflow.button] : [])]) {
			assert.ok(item.bounds.left >= f.bounds.left + 4 && item.bounds.right <= f.bounds.right - 4, `${item.label} stays hittable inside the pane`);
		}
		assert.ok(f.font.measure(f.review.title) <= bar.bounds.left - f.bounds.left - 8, 'measured title cannot paint over the actual action bar');
		assert.ok(f.font.measure(f.review.summary) <= width - 8);
		if (width === 384) { assert.equal(primary.length, 3); assert.equal(bar.overflow.button.visible, false); }
		else {
			assert.deepEqual(primary.map(item => item.command), ['sourceEditReview.apply']);
			assert.deepEqual(bar.overflow.items.filter(item => item.type === 'command').map(item => item.command), ['sourceEditReview.source', 'sourceEditReview.discard']);
		}
	}
});

test('physical and keyboard More retain their exact focus origins and impact Source never applies a proposal', t => {
	const f = fixture(t);
	f.open(); f.press('Escape'); assert.equal(f.focus.target, f.review.focusTarget);
	f.open(true); const toolbar = f.menu.invocationOrigin; f.press('Escape'); assert.equal(f.focus.target, toolbar);
	f.press('Escape'); assert.equal(f.focus.target, f.review.focusTarget);
	f.key('ArrowDown', true); f.key('ArrowDown', false); assert.equal(f.review.tree.selectionIndex, 1);
	f.open(); assert.equal(f.menu.model.rows[0].command, 'sourceEditReview.source'); f.press('Home'); f.press('Enter');
	assert.equal(f.opened(), 1); assert.equal(f.applied(), 0); assert.equal(f.model.version, 1); assert.equal(f.focus.target, f.parent);
});

test('Apply and overflow Discard preserve one canonical history edit versus no edits', t => {
	const f = fixture(t);
	f.open(); f.press('End'); assert.equal(f.menu.model.rows[f.menu.model.selectedIndex].command, 'sourceEditReview.discard'); f.press('Enter');
	assert.equal(f.review.visible, false); assert.equal(f.applied(), 0); assert.equal(f.model.canUndo, false); assert.equal(f.focus.target, f.parent);
	f.show(); f.layout(); const apply = f.review.actionBar.items.find(item => item.command === 'sourceEditReview.apply')!;
	f.pointer(apply.bounds, PRIMARY, PRIMARY); assert.equal(f.applied(), 0); f.pointer(apply.bounds, 0, 0, PRIMARY);
	assert.equal(f.applied(), 1); assert.equal(f.model.buffer.getText(), "return 'after'");
	f.model.undo(); assert.equal(f.model.buffer.getText(), "return 'before'"); assert.equal(f.model.canUndo, false);
});

test('source publication retires an owned popup and its held Enter before a replacement proposal exists', t => {
	const f = fixture(t); f.open(true); f.press('End'); f.key('Enter', true);
	f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- new generation\n' }]);
	assert.equal(f.review.visible, false); assert.equal(f.menu.visible, false); assert.equal(f.surfaces.findByScope(f.menu.pointerScope), undefined);
	assert.equal(f.focus.target, f.parent); f.show(); f.layout(); f.key('Enter', false);
	assert.equal(f.review.visible, true, 'the retired popup release cannot discard the new review'); assert.equal(f.applied(), 0); assert.equal(f.opened(), -1);
});

test('resize and font reflow cancel paired Apply attempts and dismiss only their own popup', t => {
	const f = fixture(t), apply = f.review.actionBar.items.find(item => item.command === 'sourceEditReview.apply')!;
	f.pointer(apply.bounds, PRIMARY, PRIMARY); assert.equal(f.capture.active, true); f.layout(384);
	assert.equal(f.capture.active, false); f.pointer(apply.bounds, 0, 0, PRIMARY); assert.equal(f.applied(), 0);
	f.layout(78); f.focus.moveFocus(false); f.press('Home'); f.key('Enter', true); f.changeFont('msx'); f.key('Enter', false);
	assert.equal(f.applied(), 0); f.press('Escape'); assert.equal(f.focus.target, f.review.focusTarget);
	f.layout(118); f.open(); f.layout(384); assert.equal(f.menu.visible, false); assert.equal(f.review.visible, true);
	f.layout(118); f.open(); f.menu.hide();
	f.menu.show(4, 50, [{ type: 'command', command: 'save' }], { isEnabled: () => true, execute() {} });
	f.review.clear(); assert.equal(f.menu.visible, true, 'review teardown cannot dismiss a newer unrelated popup'); assert.equal(f.focus.target, f.menu.focusTarget);
});

test('replacement, external dependency publication and model teardown retire their own attempts without committing', t => {
	const f = fixture(t), apply = f.review.actionBar.items.find(item => item.command === 'sourceEditReview.apply')!;
	f.pointer(apply.bounds, PRIMARY, PRIMARY); f.show(); f.layout();
	f.pointer(apply.bounds, 0, 0, PRIMARY); assert.equal(f.applied(), 0);
	const dependency = f.models.retain({ domain: 0, path: 'dependency.lua', source: { type: 'lua', resid: 'dependency' } }, 'lua', 'return true');
	f.show(lifetime => lifetime.add({ dispose: dependency.onDidChangeContent(() => f.review.clear()) })); f.layout();
	f.pointer(apply.bounds, PRIMARY, PRIMARY); dependency.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- changed dependency\n' }]);
	assert.equal(f.review.visible, false); assert.equal(f.capture.active, false); f.pointer(apply.bounds, 0, 0, PRIMARY); assert.equal(f.applied(), 0);
	f.show(); f.layout(); f.open(); f.models.clear();
	assert.equal(f.menu.visible, false); assert.equal(f.review.visible, false); assert.equal(f.focus.target, f.parent);
});

test('read-only source revokes a held popup action, and keyboard ContextMenu uses the review owner', t => {
	const f = fixture(t); f.focus.executeCommand('contextMenu');
	assert.equal(f.menu.visible, true); assert.equal(f.menu.invocationOrigin.commandContext, f.review.focusTarget);
	assert.equal(f.menu.focusTarget.commandContext, f.review.focusTarget);
	f.press('Escape'); assert.equal(f.focus.target, f.review.focusTarget); f.focus.executeCommand('contextMenu');
	f.key('Enter', true);
	f.model.refreshResource({ ...f.model.resource, source: { ...f.model.resource.source, generated: true } }); f.review.update();
	assert.equal(f.review.visible, false); assert.equal(f.menu.visible, false); f.key('Enter', false);
	assert.equal(f.opened(), -1); assert.equal(f.applied(), 0); assert.equal(f.focus.target, f.parent);
});

test('source listeners precede departing-focus publication when a real source owner creates a review', t => {
	const f = fixture(t); f.review.clear();
	const departing = f.focus.createTarget(f.parent); departing.bindKeyboard(() => {}); departing.focus();
	const unbind = departing.onDidBlur(() => f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- committed draft\n' }]));
	f.show(); unbind();
	assert.equal(f.review.visible, false); assert.equal(f.applied(), 0); assert.equal(f.menu.visible, false);
	assert.equal(f.focus.target, f.parent); assert.equal(f.focus.admittedTarget, f.parent);
});

test('dependency attachments exist before blur can retire a new review and have no disposed-return continuation', t => {
	const f = fixture(t); f.review.clear();
	const dependency = f.models.retain({ domain: 0, path: 'review_dependency.lua', source: { type: 'lua', resid: 'review_dependency' } }, 'lua', 'return true');
	const departing = f.focus.createTarget(f.parent); departing.bindKeyboard(() => {}); departing.focus();
	let subscribed = false, disposed = 0;
	const unbind = departing.onDidBlur(() => {
		assert.equal(subscribed, true, 'the producer installs dependency ownership before focus can publish a source edit');
		f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- accepted draft\n' }]);
	});
	const result = f.show(lifetime => {
		lifetime.add({ dispose: dependency.onDidChangeContent(() => f.review.clear()) });
		lifetime.add({ dispose: () => { disposed++; } }); subscribed = true;
	});
	unbind(); assert.equal(result, undefined, 'show exposes no post-focus lifetime attachment boundary');
	assert.equal(disposed, 1); assert.equal(f.review.visible, false); assert.equal(f.focus.target, f.parent); assert.equal(f.focus.admittedTarget, f.parent);
	f.show(); f.layout(); dependency.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- old dependency changed\n' }]);
	assert.equal(f.review.visible, true, 'a departed proposal releases its dependency callback rather than clearing its replacement');
});

for (const variant of ['tiny', 'msx'] as const) test(`${variant} clean layouts retain measurements and menus while full clipped summary remains available in feedback`, t => {
	const f = fixture(t, variant), rows = f.review.tree.rows, overflow = f.review.actionBar.overflow;
	assert.ok(overflow, 'the retained overflow bucket exists');
	const items = overflow.items, measured = f.measurements();
	for (let frame = 0; frame < 50; frame++) f.layout();
	assert.equal(f.measurements(), measured); assert.equal(f.review.tree.rows, rows); assert.equal(overflow.items, items);
	const overlay = createHostOverlayFixture(384, 288);
	for (const [title, top] of [[TITLE, f.bounds.top + 2], [SUMMARY, f.bounds.top + f.font.lineHeight + 7]] as const) {
		f.pointer({ left: f.bounds.left + 3, top, right: f.bounds.right, bottom: top + f.font.lineHeight });
		f.review.update();
		overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer); f.surfaces.draw(api); overlay.renderer.endFrame();
		const frame = overlay.queue.consumeOverlayFrame(), text: string[] = [];
		for (let index = 0; index < frame.commandCount; index++) if (frame.commandKinds[index] === Host2DKind.Glyphs) {
			const run = frame.commandRefs[index] as GlyphRenderSubmission;
			if (typeof run.items === 'string') text.push(run.items);
		}
		assert.ok(text.join('').replace(/\s/g, '').includes(title.replace(/\s/g, '')), 'an actual attached feedback surface paints the entire proposal text, not its clipped label');
	}
});
