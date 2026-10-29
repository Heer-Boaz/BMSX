import assert from 'node:assert/strict';
import test from 'node:test';
import { inputFocus } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { pointerHover } from '../../ide/input/pointer/hover';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { measureText, measureTextRange } from '../../ide/editor/common/text/layout';
import { createWorkbenchActionBar } from '../../ide/workbench/ui/action_bar';
import { WorkbenchFloatingWindow, findWorkbenchWindow } from '../../ide/workbench/ui/window/control';
import { WorkbenchWindowModel } from '../../ide/workbench/ui/window/model';
import { createActualSourcePanes } from '../helpers/source_panes';

test('Main activity and its coverage header raise their owning family without changing the retained document family', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, main = f.editor.mainWorkspace, problems = f.editor.problems;
	main.regionLayout.activityHeight = 73; main.setActivityVisible(true); f.update();
	f.secondPart.window!.setPlacement('maximized'); f.update();
	const placement = { ...f.secondPart.window!.model.requestedBounds };
	const source = f.secondInput.workingCopy.buffer.getText();
	for (const header of [false, true]) {
		f.second.focus(); assert.ok(parts.activePart === f.secondPart);
		main.focusActivity();
		if (header) f.editor.commands.execute('problems.coverage', problems.focusTarget);
		assert.ok(parts.activePart === parts.main);
		assert.ok(inputFocus.admittedTarget !== null && problems.scope.contains(inputFocus.admittedTarget.scope));
		const bounds = problems.bounds, x = (bounds.left + bounds.right) / 2, y = (bounds.top + bounds.bottom) / 2;
		assert.equal(f.editor.surfaces.isInContext(f.editor.surfaces.hitTest(x, y)!.captureScope, problems.scope.surfaceScope), true,
			'explicit activity focus raises the actual Main family over the covering document');
		assert.ok(f.secondPart.activeGroup.model.activeTab === f.secondInput);
		assert.equal(f.secondPart.retired, false); assert.equal(f.secondPart.window!.model.placement, 'maximized');
		assert.deepEqual(f.secondPart.window!.model.requestedBounds, placement);
	}
	assert.equal(f.secondInput.workingCopy.buffer.getText(), source);
});

test('retired inner-window command origins cannot open, select or copy their surviving editor frontend', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts;
	const model = new WorkbenchWindowModel(f.secondPart.window!.model.requestedBounds, 100, 70); model.open = true;
	const window = new WorkbenchFloatingWindow(inputFocus, pointerCapture, pointerHover, f.editor.surfaces, f.editor.commands, f.editor.contextMenu, {
		model, actionBar: createWorkbenchActionBar('window.title'), lifetimeOwner: f.secondGroup.paneSurface,
		presentationParent: f.editor.surfaces.windowContext(f.secondGroup.paneSurface),
		focusScope: f.second.commandTarget.scope, focusReturn: f.second.commandTarget, workArea: f.secondGroup.workArea,
		content: { draw() {} }, layoutContent() {}, retireContentInput() {}, restoreContentInput() {},
		focusContent() { window.clientFocusTarget.focus(); },
	});
	window.attach(); window.layout(editorViewState.font.renderFont(), measureTextRange, measureText);
	const origin = window.clientFocusTarget;
	origin.focus(); assert.ok(findWorkbenchWindow(origin) === window);
	window.dispose(); assert.equal(findWorkbenchWindow(origin), null);
	assert.ok(parts.activePart === f.secondPart && f.secondGroup.model.activeTab === f.secondInput);
	const documents = [...parts.documents], mru = [...parts.mostRecentlyActive], focus = inputFocus.target;
	const copy = t.mock.method(f.secondInput, 'createView');
	for (const command of ['window.showAll', 'window.focusMain', 'window.newEditor', 'window.copyEditor'] as const) {
		assert.equal(f.editor.commands.isEnabled(command, origin), false);
		f.editor.commands.execute(command, origin);
		assert.ok(parts.activePart === f.secondPart && inputFocus.target === focus);
		assert.equal(parts.documents.length, documents.length);
		assert.ok(parts.documents.every((part, index) => part === documents[index]));
		assert.equal(parts.mostRecentlyActive.length, mru.length);
		assert.ok(parts.mostRecentlyActive.every((part, index) => part === mru[index]));
		assert.equal(f.editor.quickInput.visible, false);
	}
	assert.equal(copy.mock.callCount(), 0, 'a dead inspector cannot lend the surviving source editor as a replacement subject');
	assert.ok(f.secondGroup.model.activeTab === f.secondInput);
});
