import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EditorTextModelService } from '../../ide/editor/model/model_service';
import { EditorWorkspaceEditConflict } from '../../ide/editor/model/undo_redo_service';
import { InputFocusService } from '../../ide/input/focus';
import { PointerCaptureService } from '../../ide/input/pointer/capture';
import { PointerHoverService } from '../../ide/input/pointer/hover';
import { WorkbenchSourceEditReview } from '../../ide/workbench/ui/source_edit_review/control';
import { ContextMenuController } from '../../ide/workbench/services/context_menu/controller';
import { WorkbenchSurfaceService } from '../../ide/workbench/services/windows/service';
import type { DisposableStore } from '../../ide/common/lifecycle';

const resource = { domain: 0 as const, path: 'proposal.lua', source: { type: 'lua' as const, resid: 'proposal' } };
const edit = { version: 1, edits: [{ offset: 0, deleteLength: 1, text: 'new' }] };

test('reopening the same resource/version cannot revive edit rights from a retired workspace', t => {
	const models = new EditorTextModelService();
	t.after(() => models.clear());
	const retired = models.retain(resource, 'lua', 'x');
	models.clear();
	const current = models.retain(resource, 'lua', 'x');
	assert.equal(current.version, retired.version, 'version equality alone cannot identify a document lifetime');
	let notifications = 0;
	current.onWillChangeContent(() => notifications++);
	assert.throws(() => models.history.applyEdits(new Map([[current, edit], [retired, edit]])), EditorWorkspaceEditConflict);
	assert.equal(notifications, 0, 'all lifetimes are admitted before invalidating any source projection');
	assert.equal(current.canUndo, false);
	assert.equal(current.buffer.getText(), 'x');
	assert.equal(retired.buffer.getText(), 'x');
});

test('a multi-file proposal cannot mix models belonging to different workspace history owners', t => {
	const first = new EditorTextModelService(), second = new EditorTextModelService();
	t.after(() => { first.clear(); second.clear(); });
	const a = first.retain(resource, 'lua', 'x'), b = second.retain(resource, 'lua', 'x');
	let notifications = 0;
	a.onWillChangeContent(() => notifications++);
	assert.throws(() => first.history.applyEdits(new Map([[a, edit], [b, edit]])), EditorWorkspaceEditConflict);
	assert.equal(notifications, 0);
	assert.equal(a.canUndo, false);
	assert.equal(b.canUndo, false);
});

test('source review retires synchronously with its document, without transferring focus or edit rights to a reopened file', t => {
	const models = new EditorTextModelService();
	const model = models.retain(resource, 'lua', 'x');
	const focus = new InputFocusService(), parent = focus.createTarget(), elsewhere = focus.createTarget();
	const capture = new PointerCaptureService(), menu = new ContextMenuController(focus, capture), surfaces = new WorkbenchSurfaceService();
	const area = { left: 0, top: 0, right: 384, bottom: 288 };
	const owner = surfaces.attach({ role: 'content', captureScope: parent.scope.surfaceScope,
		getBounds: () => area, getClip: () => area, isVisible: () => true, draw() {} });
	const review = new WorkbenchSourceEditReview(focus, capture, new PointerHoverService(), parent, menu, surfaces, owner, area);
	t.after(() => { review.dispose(); menu.dispose(); surfaces.dispose(); models.clear(); });
	let applied = 0;
	let lifetime!: DisposableStore;
	review.show({ model, title: 'REVIEW', summary: 'ONE EDIT', items: [], onWillShow: owner => { lifetime = owner; },
		apply: () => { applied++; }, openSource() {} });
	elsewhere.focus();
	models.clear();
	models.retain(resource, 'lua', 'x');
	assert.equal(review.visible, false);
	assert.equal(lifetime.isDisposed, true);
	assert.equal(focus.target, elsewhere);
	review.apply();
	assert.equal(applied, 0);
});
