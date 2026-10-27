import assert from 'node:assert/strict';
import test from 'node:test';
import { KeyModifier } from '../../hosts/common/input/text';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { inputFocus } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { pointerHover } from '../../ide/input/pointer/hover';
import { measureText, measureTextRange } from '../../ide/editor/common/text/layout';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { createWorkbenchActionBar } from '../../ide/workbench/ui/action_bar';
import { WorkbenchFloatingWindow } from '../../ide/workbench/ui/window/control';
import { WorkbenchWindowModel } from '../../ide/workbench/ui/window/model';
import { createActualSourcePanes } from '../helpers/source_panes';

for (const coalesced of [false, true]) for (const phase of ['title focus', 'departing Source blur', 'raise publication'] as const)
	test(`later minimize from ${phase} revokes an incoming document title ${coalesced ? 'coalesced click' : 'press'}`, t => {
		const f = createActualSourcePanes(t), part = f.firstPart, window = part.window!;
		f.second.focus();
		let unbind: () => void;
		const minimize = () => { unbind(); f.editor.editorParts.minimize(part); };
		if (phase === 'title focus') unbind = window.focusTarget.onDidFocus(minimize);
		else if (phase === 'departing Source blur') unbind = f.second.commandTarget.onDidBlur(minimize);
		else unbind = inputFocus.onDidChangeTarget(() => {
			if (pointerCapture.routeScope === part.scope.surfaceScope) minimize();
		});
		t.after(() => unbind());
		const header = window.model.header, x = header.left + 16, y = (header.top + header.bottom) / 2;
		f.editor.dispatchPointer({ x, y, buttons: coalesced ? 0 : PointerButton.Primary, pressedButtons: PointerButton.Primary,
			releasedButtons: coalesced ? PointerButton.Primary : 0, cancelledButtons: 0,
			modifiers: KeyModifier.none, spaceDown: false, timestamp: 1 });
		assert.equal(window.model.minimized, true); assert.equal(window.visible, false);
		assert.equal(pointerCapture.active, false, 'a later minimize cannot be followed by a hidden-window capture');
		assert.equal(pointerCapture.draining, !coalesced); assert.notStrictEqual(f.editor.editorParts.activePart, part);
		if (phase !== 'departing Source blur') assert.ok(inputFocus.target === f.second.commandTarget,
			'a later minimize leaves or returns focus to the visible sibling, not the hidden title fallback');
		assert.ok(part.group.model.activeTab === f.firstInput && part.group.panes.activePane === f.first);
		if (!coalesced) f.editor.dispatchPointer({ x, y, buttons: 0, pressedButtons: 0, releasedButtons: PointerButton.Primary,
			cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 2 });
		assert.equal(pointerCapture.draining, false); assert.equal(window.model.minimized, true);
	});

for (const coalesced of [false, true]) for (const phase of ['departing Source blur', 'surface publication'] as const)
	test(`utility retirement from ${phase} revokes its title-action ${coalesced ? 'coalesced click' : 'press'}`, t => {
		const f = createActualSourcePanes(t), model = new WorkbenchWindowModel({ left: 40, top: 80, right: 300, bottom: 250 }, 120, 80);
		const actionBar = createWorkbenchActionBar('window.title');
		const window = new WorkbenchFloatingWindow(inputFocus, pointerCapture, pointerHover, f.editor.surfaces, f.editor.commands, {
			model, actionBar, lifetimeOwner: f.firstGroup.paneSurface,
			presentationParent: f.editor.surfaces.windowContext(f.firstGroup.paneSurface),
			focusScope: f.firstPart.scope, focusReturn: f.first.commandTarget, workArea: f.firstPart.surface.getClip(),
			content: { draw() {} }, layoutContent() {}, retireContentInput() {}, restoreContentInput() {},
			focusContent: () => window.clientFocusTarget.focus(),
		});
		t.after(() => window.dispose());
		window.show(false); window.layout(editorViewState.font.renderFont(), measureTextRange, measureText); window.update();
		f.second.focus();
		let unbind: () => void;
		const hide = () => { unbind(); window.hide(); };
		if (phase === 'departing Source blur') unbind = f.second.commandTarget.onDidBlur(hide);
		else unbind = inputFocus.onDidChangeTarget(() => {
			if (pointerCapture.routeScope === window.scope.surfaceScope) hide();
		});
		t.after(() => unbind());
		const action = actionBar.items.find(item => item.command === 'window.maximize')!;
		const x = (action.bounds.left + action.bounds.right) / 2, y = (action.bounds.top + action.bounds.bottom) / 2;
		f.editor.dispatchPointer({ x, y, buttons: coalesced ? 0 : PointerButton.Primary, pressedButtons: PointerButton.Primary,
			releasedButtons: coalesced ? PointerButton.Primary : 0, cancelledButtons: 0,
			modifiers: KeyModifier.none, spaceDown: false, timestamp: 1 });
		assert.equal(model.open, false); assert.equal(window.surface, undefined);
		assert.equal(pointerCapture.active, false); assert.equal(pointerCapture.draining, !coalesced);
		assert.equal(model.placement, 'normal', 'the retired action never executes or arms against a cleared input');
		assert.equal(actionBar.pressedCommand, null);
		if (!coalesced) f.editor.dispatchPointer({ x, y, buttons: 0, pressedButtons: 0, releasedButtons: PointerButton.Primary,
			cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 2 });
		assert.equal(pointerCapture.draining, false);
		assert.ok(f.firstGroup.model.activeTab === f.firstInput && f.firstGroup.panes.activePane === f.first);
	});
