import assert from 'node:assert/strict';
import test from 'node:test';
import { inputFocus } from '../../ide/input/focus';
import { editorChromeState } from '../../ide/workbench/ui/chrome_state';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { createActualSourcePanes } from '../helpers/source_panes';

// Published shell/host bounds are the subject of this surface-ordering contract,
// not fixed screenshot coordinates or editor wording.
test('Main and maximized floating hosts exchange only editor client order; shell navigation remains reachable', t => {
	const f = createActualSourcePanes(t, true), parts = f.editor.editorParts;
	const main = parts.main, mainGroup = main.activeGroup, floating = f.firstPart;
	const mainInput = new CodeEditorInput(f.firstInput.workingCopy);
	mainGroup.openEditor(mainInput); f.update();
	floating.window!.setPlacement('maximized'); floating.focus(); f.update();
	const shell = main.surface.lifetimeOwner!;
	assert.equal(shell.role, 'content'); assert.ok(main.surface.presentationParent === null);
	const menu = editorChromeState.menuButtonBounds;
	const x = (menu.left + menu.right) / 2, y = (menu.top + menu.bottom) / 2;
	assert.ok(f.editor.surfaces.hitTest(x, y) === shell);
	const before = floating.activeGroup.model.activeTab, model = f.firstInput.workingCopy;
	const source = model.buffer.getText(), version = model.version;
	assert.equal(parts.revealEditor(mainInput, mainGroup), true); f.update();
	assert.ok(parts.activeGroup === mainGroup); assert.ok(inputFocus.target === mainGroup.panes.activePane!.commandTarget);
	assert.ok(f.editor.surfaces.hitTest(x, y) === shell);
	assert.ok(floating.activeGroup.model.activeTab === before);
	assert.equal(floating.window!.model.placement, 'maximized'); assert.equal(floating.window!.model.minimized, false);
	assert.equal(parts.revealEditor(f.firstInput, f.firstGroup), true); f.update();
	assert.ok(parts.activeGroup === f.firstGroup); assert.ok(f.firstGroup.model.activeTab === before);
	assert.ok(f.editor.surfaces.hitTest(x, y) === shell);
	assert.equal(model.buffer.getText(), source); assert.equal(model.version, version);
});

test('one workspace status projects the actual active group rather than a background Main or duplicate floating row', t => {
	const f = createActualSourcePanes(t, true), parts = f.editor.editorParts, main = parts.main.activeGroup;
	main.openEditor(new CodeEditorInput(f.firstInput.workingCopy)); f.update();
	const background = t.mock.method(main.panes.activePane!, 'drawStatusBar');
	const foreground = t.mock.method(f.first, 'drawStatusBar');
	f.firstPart.focus(); f.paint();
	assert.equal(background.mock.callCount(), 0); assert.equal(foreground.mock.callCount(), 1);
	parts.main.focus(); f.paint();
	assert.equal(background.mock.callCount(), 1); assert.equal(foreground.mock.callCount(), 1);
});

test('moving a retained Source into a sibling group changes control ownership without creating another document or floating host', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts;
	const first = parts.main.activeGroup;
	first.openEditor(new CodeEditorInput(f.firstInput.workingCopy)); f.update();
	const input = first.model.activeTab!, control = first.panes.activePane!;
	control.focus();
	const sibling = parts.splitGroup(first, 'right'); assert.ok(sibling);
	const windows = parts.documents.length, version = f.firstInput.workingCopy.version;
	assert.equal(parts.moveEditor(first, input, sibling, f.editor.editorClose), true); f.update();
	assert.equal(first.model.tabs.includes(input), false); assert.ok(sibling.model.activeTab === input);
	assert.ok(parts.activeGroup === sibling); assert.ok(parts.findGroup(input) === sibling);
	assert.equal(parts.documents.length, windows); assert.equal(f.firstInput.workingCopy.version, version);
	first.focus(); assert.ok(parts.activeGroup === first); assert.ok(first.model.activeTab === null);
	sibling.focus(); assert.ok(sibling.panes.activePane!.input === input);
	assert.equal(parts.main.groups.length, 2);
});


test('independently surfaced group sashes never replace host input admission membership', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, main = parts.main;
	const right = parts.splitGroup(main.activeGroup, 'right'); assert.ok(right);
	assert.ok(parts.splitGroup(right, 'down')); f.update();
	assert.ok(f.editor.surfaces.findByScope(main.scope.surfaceScope) === main.surface);
	main.arrangement.toggleMaximize(main.activeGroup); f.update();
	assert.ok(f.editor.surfaces.findByScope(main.scope.surfaceScope) === main.surface);
	main.clear();
	assert.ok(f.editor.surfaces.findByScope(main.scope.surfaceScope) === main.surface);
	assert.equal(main.groups.length, 1);
	main.activeGroup.focus(); assert.ok(parts.activeGroup === main.activeGroup);
});


test('host reveal preserves a newer sibling interaction published while a minimized host becomes visible', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts;
	parts.minimize(f.firstPart); f.secondGroup.focus();
	let redirected = false;
	t.after(parts.onDidChange(() => {
		if (redirected || f.firstPart.window!.model.minimized) return;
		redirected = true; f.secondGroup.focus();
	}));
	assert.equal(f.firstPart.focus(), false);
	assert.equal(redirected, true);
	assert.ok(parts.activePart === f.secondPart);
	assert.ok(inputFocus.target === f.second.commandTarget);
	assert.equal(f.firstPart.window!.model.minimized, false, 'the accepted visibility transition is not rolled back');
});

test('captured retired group destinations cannot admit a split or retained-input transfer', async t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts;
	const retired = f.firstGroup;
	assert.equal(await parts.close(f.firstPart), true);
	assert.equal(parts.canMoveEditor(f.secondGroup, f.secondInput, retired, f.editor.editorClose), false);
	assert.equal(parts.moveEditor(f.secondGroup, f.secondInput, retired, f.editor.editorClose), false);
	assert.equal(parts.splitGroup(retired, 'right'), undefined);
	assert.equal(retired.focus(), false); assert.equal(f.firstPart.focus(), false);
	assert.ok(f.secondGroup.model.activeTab === f.secondInput);
});

// Geometry publication is the contract here: a reveal may already have resolved
// arrangement overflow before the host projects it into real control surfaces.
test('revealing and maximizing real Source groups publishes every resolved arrangement generation to their controls', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, main = parts.main;
	const first = main.activeGroup;
	first.openEditor(new CodeEditorInput(f.firstInput.workingCopy));
	const second = parts.splitGroup(first, 'right'); assert.ok(second);
	second.openEditor(new CodeEditorInput(f.secondInput.workingCopy));
	for (const group of main.groups) t.mock.getter(group.panes.activePane!, 'minimumClientWidth', () => 500);
	f.update();
	const published = () => {
		for (const leaf of main.arrangement.leaves) if (leaf.visible) {
			assert.deepEqual(leaf.group.bounds, leaf.bounds, 'the actual group consumes the resolved leaf extent');
			assert.deepEqual(leaf.group.clip, leaf.clip, 'the actual group consumes the resolved presentation clip');
		}
	};
	first.focus(); published();
	const before = main.arrangement.scrollX;
	second.focus();
	assert.ok(main.arrangement.scrollX > before);
	published(); f.update(); published();
	main.arrangement.toggleMaximize(second); second.focus(); published();
	assert.equal(first.presented, false);
	main.arrangement.toggleMaximize(second); second.focus(); published();
	assert.equal(first.presented, true);
});

for (const operation of ['focus', 'reveal'] as const) test(`a newer group clear during activation supersedes the requested ${operation} without reviving its retired destination`, t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, main = parts.main, retained = main.activeGroup;
	retained.openEditor(new CodeEditorInput(f.firstInput.workingCopy));
	const requested = parts.splitGroup(retained, 'right'); assert.ok(requested);
	const input = new CodeEditorInput(f.secondInput.workingCopy);
	requested.openEditor(input, { preserveFocus: true }); f.update();
	let cleared = false;
	t.after(parts.onDidChange(() => {
		if (cleared || main.activeGroup !== requested) return;
		cleared = true; main.clear();
	}));
	assert.equal(operation === 'focus' ? requested.focus() : parts.revealEditor(input, requested), false);
	assert.equal(cleared, true); assert.equal(requested.openingAdmitted, false);
	assert.ok(main.activeGroup === retained); assert.equal(main.groups.length, 1); assert.ok(main.groups[0] === retained);
	assert.ok(retained.model.activeTab === null);
});
