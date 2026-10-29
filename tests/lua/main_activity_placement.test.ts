import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { KeyModifier } from '../../hosts/common/input/text';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { inputFocus } from '../../ide/input/focus';
import { createActualSourcePanes } from '../helpers/source_panes';

function fixture(t: TestContext) {
	const f = createActualSourcePanes(t), main = f.editor.mainWorkspace;
	f.editor.setFontVariant('tiny');
	main.regionLayout.activityHeight = 80;
	main.openActivity('problems'); f.update();
	return { ...f, main, panel: f.editor.problems };
}

test('host placement retains the exact native focus and semantic context while freeing only the docked allocation', t => {
	const f = fixture(t), { main, panel } = f;
	const surface = main.activities.surface, target = inputFocus.admittedTarget, generation = panel.scope.contextGeneration;
	const dockedDocumentBottom = main.documentBounds.bottom, requestedHeight = main.regionLayout.activityHeight;
	assert.equal(main.setActivityPlacement('floatingWindow'), true);
	assert.ok(main.documentBounds.bottom > dockedDocumentBottom, 'floating releases the activity allocation to the document row');
	assert.equal(main.regionLayout.activityPresented, false);
	assert.ok(surface.presentationParent === main.activityWindow.clientSurface && surface.lifetimeOwner === main.surface);
	assert.ok(inputFocus.admittedTarget === target); assert.equal(panel.scope.contextGeneration, generation);
	assert.equal(main.setActivityPlacement('dockedMain'), true);
	assert.ok(main.activities.surface === surface && surface.presentationParent === main.surface);
	assert.ok(inputFocus.admittedTarget === target); assert.equal(panel.scope.contextGeneration, generation);
	assert.equal(main.regionLayout.activityHeight, requestedHeight);
	assert.equal(main.activityWindow.surface, undefined);
});

for (const variant of ['tiny', 'msx'] as const)
	test(`repeated ${variant} float and dock retains the physical native allocation when shell geometry is unchanged`, t => {
		const f = fixture(t), { main, panel } = f;
		f.editor.setFontVariant(variant); f.update();
		const target = panel.focusTarget, generation = panel.scope.contextGeneration;
		const native = f.editor.surfaces.findByScope(panel.scope.surfaceScope)!;
		const layout = t.mock.method(main.activities, 'layout');
		for (let cycle = 0; cycle < 3; cycle++) {
			assert.equal(main.setActivityPlacement('floatingWindow'), true); f.update();
			// The layout owner's allocation is the subject: native geometry must consume the actual shell client rectangle.
			assert.deepEqual(main.activities.bounds, main.activityWindow.model.client);
			assert.deepEqual(panel.bounds, main.activityWindow.model.client);
			assert.equal(f.editor.surfaces.isAdmitted(native), true);
			const x = (panel.bounds.left + panel.bounds.right) / 2;
			const y = (panel.layoutState.contentTop + panel.layoutState.contentBottom) / 2;
			assert.ok(f.editor.surfaces.hitTest(x, y) === native);
			f.editor.dispatchPointer({ x, y, buttons: 0, pressedButtons: PointerButton.Primary, releasedButtons: PointerButton.Primary,
				cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 1 });
			assert.ok(inputFocus.admittedTarget === target); assert.equal(panel.scope.contextGeneration, generation);
			if (cycle === 2) {
				layout.mock.resetCalls(); f.update();
				assert.equal(layout.mock.callCount(), 1, 'a warm Main pass arranges the native allocation once without redoing chrome layout');
			}
			assert.equal(main.setActivityPlacement('dockedMain'), true); f.update();
		}
	});

test('concrete draft refusal prevents any activity host publication or focus retirement', t => {
	const f = fixture(t), { main, panel } = f, target = panel.focusTarget;
	const generation = panel.scope.contextGeneration;
	// The concrete focus owner supplies draft admission; Main must not substitute a pane-wide success stub.
	target.edit = { pending: true, commit: () => false };
	assert.equal(main.setActivityPlacement('floatingWindow'), false);
	assert.equal(main.activityPlacement, 'dockedMain'); assert.equal(main.activityWindow.surface, undefined);
	assert.ok(inputFocus.admittedTarget === target); assert.equal(panel.scope.contextGeneration, generation);
	target.edit = undefined;
});

test('a newer concrete foreground during host publication wins without undoing the admitted placement', t => {
	const f = fixture(t), { main } = f;
	const release = main.onDidChange(() => {
		if (main.activityPlacement !== 'floatingWindow') return;
		release(); f.second.focus();
	});
	assert.equal(main.setActivityPlacement('floatingWindow'), false);
	assert.equal(main.activityPlacement, 'floatingWindow'); assert.equal(main.activityDisplayed, true);
	assert.ok(inputFocus.admittedTarget === f.second.code.focusTarget);
	assert.ok(f.editor.editorParts.activePart === f.secondPart);
});

test('the real selector context menu admits keyboard placement and dock-back actions', t => {
	const f = fixture(t), { main } = f, selector = main.activities.commandTarget;
	selector.focus(); f.key('ContextMenu');
	assert.equal(f.editor.contextMenu.visible, true);
	f.key('Enter');
	assert.equal(main.activityPlacement, 'floatingWindow'); assert.equal(main.activityDisplayed, true);
	selector.focus(); f.key('F10', KeyModifier.shift); f.key('Enter');
	assert.equal(main.activityPlacement, 'dockedMain'); assert.equal(main.activityDisplayed, true);
});

test('choosing Main or leaving floating chrome focuses the actual Main document boundary, not its logical activity', t => {
	const f = fixture(t), { main } = f;
	main.setActivityPlacement('floatingWindow');
	f.editor.commands.execute('window.showAll', f.panel.focusTarget);
	const picker = f.editor.quickInput;
	const index = picker.model.list.rows.findIndex(row => 'surface' in row.item && row.item.surface === main.surface);
	assert.ok(index >= 0); picker.model.list.selectionIndex = index; f.key('Enter');
	assert.equal(picker.visible, false);
	assert.ok(inputFocus.admittedTarget !== null && f.editor.editorParts.main.scope.contains(inputFocus.admittedTarget.scope));
	assert.equal(main.activityWindow.hasFocus, false); assert.equal(main.activityDisplayed, true);
	main.focusActivity(); main.activityWindow.focusTarget.focus(); f.key('Escape');
	assert.ok(inputFocus.admittedTarget !== null && f.editor.editorParts.main.scope.contains(inputFocus.admittedTarget.scope));
	assert.equal(main.activityWindow.hasFocus, false); assert.equal(main.activityDisplayed, true);
});

test('recovery preserves a minimized physical shell and later user activity placement supersedes pending recovery', async t => {
	const f = fixture(t), { main } = f;
	main.setActivityPlacement('floatingWindow');
	main.activityWindow.model.setRequestedBounds({ left: 120, top: 70, right: 410, bottom: 230 });
	main.activityWindow.setPlacement('right'); main.minimizeActivity();
	const snapshot = main.serialize(), surface = main.activities.surface;
	main.setActivityPlacement('dockedMain');
	const request = main.beginRestore();
	try {
		assert.equal(await request.restore(snapshot, () => assert.fail('there is no primary source to hydrate')), true);
		request.focusClient(); f.update();
		assert.equal(main.activityPlacement, 'floatingWindow'); assert.equal(main.activityDisplayed, false);
		assert.equal(main.activityWindow.model.minimized, true); assert.equal(main.activityWindow.model.placement, 'right');
		assert.deepEqual(main.activityWindow.model.requestedBounds, snapshot.activityWindow.requestedBounds);
		assert.ok(main.activities.surface === surface);
	} finally { request.dispose(); }
	const superseded = main.beginRestore();
	try {
		main.setActivityPlacement('dockedMain'); main.setActivityVisible(false); f.second.focus();
		assert.equal(await superseded.restore(snapshot, () => assert.fail('there is no primary source to hydrate')), true);
		superseded.focusClient(); f.update();
		assert.equal(main.activityPlacement, 'dockedMain'); assert.equal(main.regionLayout.activityVisible, false);
		assert.ok(inputFocus.admittedTarget === f.second.code.focusTarget);
	} finally { superseded.dispose(); }
});

test('Main suspension revokes floating native input without discarding its shell or retained activity', t => {
	const f = fixture(t), { main, panel } = f;
	main.setActivityPlacement('floatingWindow');
	const surface = main.activities.surface, window = main.activityWindow.surface;
	main.suspend();
	assert.equal(panel.attached, false); assert.equal(main.activityDisplayed, false);
	assert.equal(panel.focusTarget.focus(), false);
	assert.ok(main.activityWindow.surface === window && main.activities.surface === surface);
	main.resume(); f.update();
	assert.equal(panel.attached, true); assert.equal(main.activityDisplayed, true);
	assert.ok(main.activityWindow.surface === window && main.activities.surface === surface);
});

test('a newer docked sash request before source hydration supersedes saved activity geometry', async t => {
	const f = fixture(t), { main } = f, snapshot = main.serialize(), request = main.beginRestore();
	try {
		main.regionLayout.activityHeight = 140;
		assert.equal(await request.restore(snapshot, () => assert.fail('there is no primary source to hydrate')), true);
		assert.equal(main.regionLayout.activityHeight, 140);
	} finally { request.dispose(); }
});
