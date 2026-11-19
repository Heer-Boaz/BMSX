import assert from 'node:assert/strict';
import test from 'node:test';
import { inputFocus } from '../../ide/input/focus';
import { INTEGER_INPUT_FORMAT } from '../../ide/editor/ui/inline/integer_input';
import { setFieldText } from '../../ide/editor/ui/inline/text_field';
import { ValueInput } from '../../ide/editor/ui/inline/value_input';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { HostErrorInput } from '../../ide/workbench/contrib/host_error/editor_input';
import { EditorGroupArrangement } from '../../ide/workbench/services/editor/group_arrangement';
import { createActualSourcePanes } from '../helpers/source_panes';

test('directional neighbors meet across the real sash and require positive overlap, independently of viewport clipping', () => {
	const arrangement = new EditorGroupArrangement('a');
	arrangement.split('a', 'b', 'right'); arrangement.split('b', 'c', 'down');
	arrangement.layout({ left: 0, top: 0, right: 408, bottom: 208 });
	assert.equal(arrangement.isNeighbor('a', 'b', 'right'), true);
	assert.equal(arrangement.isNeighbor('a', 'c', 'right'), true);
	assert.equal(arrangement.isNeighbor('b', 'a', 'left'), true);
	assert.equal(arrangement.isNeighbor('c', 'b', 'up'), true);
	assert.equal(arrangement.isNeighbor('b', 'c', 'down'), true);
	assert.equal(arrangement.isNeighbor('a', 'a', 'right'), false);
	arrangement.split('a', 'd', 'down'); arrangement.layout(arrangement.bounds);
	assert.equal(arrangement.isNeighbor('a', 'c', 'right'), false, 'diagonal leaves are not side destinations');
	const right = arrangement.root;
	assert.ok(right.kind === 'split' && right.second.kind === 'split');
	right.second.split.ratio = 96 / 208; arrangement.layout(arrangement.bounds);
	assert.equal(arrangement.isNeighbor('a', 'c', 'right'), false, 'a touching orthogonal edge has zero overlap');
	assert.equal(arrangement.isNeighbor('d', 'c', 'right'), true);
});

test('structural generation excludes minimum, sash, maximize and scroll presentation changes', () => {
	const arrangement = new EditorGroupArrangement('a');
	arrangement.split('a', 'b', 'right');
	const generation = arrangement.topologyRevision;
	arrangement.setMinimum('a', 300, 200); arrangement.setMinimum('b', 300, 200);
	arrangement.layout({ left: 0, top: 0, right: 200, bottom: 100 });
	arrangement.setScroll(100, 100); arrangement.layout(arrangement.bounds);
	arrangement.toggleMaximize('a'); arrangement.layout(arrangement.bounds);
	arrangement.toggleMaximize('a'); arrangement.layout(arrangement.bounds);
	assert.equal(arrangement.topologyRevision, generation);
	arrangement.move('a', 'b', 'down');
	assert.equal(arrangement.topologyRevision, generation + 1);
});

test('explicit side creates one same-part empty group, then reuses it without editor affinity or focus activation', t => {
	const f = createActualSourcePanes(t, true), parts = f.editor.editorParts, part = f.firstPart;
	f.editor.resourcePanel.show(); const origin = inputFocus.target;
	const side = parts.sideGroup(f.firstGroup);
	assert.ok(side !== undefined && side !== f.secondGroup && parts.partForGroup(side) === part);
	assert.equal(part.groups.length, 2); assert.equal(side.model.tabs.length, 0);
	assert.ok(parts.sideGroup(f.firstGroup) === side);
	assert.equal(part.groups.length, 2);
	assert.ok(inputFocus.target === origin);
	assert.ok(f.firstGroup.model.activeTab === f.firstInput && f.secondGroup.model.activeTab === f.secondInput);
});

test('nested directional neighbors use the actual part MRU and restore hidden maximized siblings before choosing', t => {
	const f = createActualSourcePanes(t), part = f.firstPart, parts = f.editor.editorParts;
	const top = part.splitGroup(f.firstGroup, 'right'), bottom = part.splitGroup(top, 'down');
	top.focus(); bottom.focus(); f.first.focus();
	part.arrangement.toggleMaximize(f.firstGroup); part.layout(part.clientBounds);
	f.editor.resourcePanel.show(); const origin = inputFocus.target, groups = part.groups.length;
	assert.ok(parts.sideGroup(f.firstGroup, 'right') === bottom);
	assert.equal(part.arrangement.maximized, undefined); assert.equal(part.groups.length, groups);
	assert.ok(inputFocus.target === origin);
	top.focus(); f.editor.resourcePanel.setFocused(true);
	assert.ok(parts.sideGroup(f.firstGroup, 'right') === top);
	assert.equal(part.groups.length, groups);
	assert.ok(parts.sideGroup(bottom, 'up') === top);
});

test('an edge does not wrap to another local group or an overlapping floating host', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, part = f.firstPart;
	const right = part.splitGroup(f.firstGroup, 'right');
	f.secondPart.window!.model.setRequestedBounds(f.firstPart.window!.model.requestedBounds);
	f.editor.resourcePanel.show();
	const left = parts.sideGroup(f.firstGroup, 'left');
	assert.ok(left !== undefined && left !== right && left !== f.secondGroup && parts.partForGroup(left) === part);
	assert.equal(part.groups.length, 3);
	assert.equal(part.arrangement.isNeighbor(f.firstGroup, left, 'left'), true);
});

for (const outcome of ['invalid', 'foreign', 'retired'] as const) test(`side admission respects an actual reference draft ${outcome} outcome`, t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts;
	f.first.focus();
	const control = new ValueInput(f.first.commandTarget, INTEGER_INPUT_FORMAT, () => {
		if (outcome === 'foreign') f.second.focus();
		else if (outcome === 'retired') f.firstPart.dispose();
	});
	t.after(() => control.dispose());
	control.setValue(1); control.layout(f.firstGroup.panes.contentBounds); control.field.focusTarget.focus();
	setFieldText(control.field, outcome === 'invalid' ? 'not a number' : '2', true);
	assert.ok(parts.sideGroup(f.firstGroup) === undefined);
	if (outcome === 'invalid') {
		assert.equal(control.pending, true); assert.equal(f.firstPart.groups.length, 1);
		assert.ok(inputFocus.target === control.field.focusTarget);
	} else if (outcome === 'foreign') {
		assert.equal(control.pending, false); assert.equal(f.firstPart.groups.length, 1);
		assert.ok(inputFocus.target === f.second.commandTarget && parts.activePart === f.secondPart);
	} else assert.equal(f.firstPart.retired, true);
});

test('a same-part relocation during split publication cancels the old side request without retry or rollback', t => {
	const f = createActualSourcePanes(t), part = f.firstPart, parts = f.editor.editorParts;
	f.editor.resourcePanel.show(); let moved = false;
	t.after(part.onDidChangeGroups(() => {
		if (moved) return;
		moved = true;
		const created = part.groups.find(group => group !== f.firstGroup)!;
		assert.equal(part.relocateGroup(f.firstGroup, created, 'down'), true);
	}));
	assert.ok(parts.sideGroup(f.firstGroup) === undefined);
	assert.equal(moved, true); assert.equal(part.groups.length, 2);
	const retained = part.groups.find(group => group !== f.firstGroup)!;
	assert.equal(part.arrangement.isNeighbor(retained, f.firstGroup, 'down'), true);
	assert.ok(f.firstGroup.model.activeTab === f.firstInput);
});

test('a newer receiver opening from actual pane layout during reveal is not overwritten by the older side request', t => {
	const f = createActualSourcePanes(t), part = f.firstPart, parts = f.editor.editorParts;
	const neighbor = part.splitGroup(f.firstGroup, 'right');
	neighbor.openEditor(new CodeEditorInput(f.secondInput.workingCopy));
	f.editor.resourcePanel.show();
	const pane = neighbor.panes.activePane!, layout = pane.layout.bind(pane), reveal = part.revealGroup.bind(part);
	const newer = new HostErrorInput('new receiver opening'); let replaced = false;
	t.mock.method(pane, 'layout', bounds => {
		layout(bounds);
		if (!replaced) { replaced = true; neighbor.openEditor(newer, { preserveFocus: true }); }
	});
	t.mock.method(part, 'revealGroup', group => {
		// Exercise the real retained pane's layout callback after destination selection.
		group.panes.layout(group.panes.contentBounds);
		return reveal(group);
	});
	const focus = inputFocus.target, topology = part.arrangement.topologyRevision;
	assert.ok(parts.sideGroup(f.firstGroup) === undefined);
	assert.equal(replaced, true); assert.ok(neighbor.model.activeTab === newer);
	assert.equal(part.arrangement.topologyRevision, topology); assert.ok(inputFocus.target === focus);
});

test('new receiver generation is retained before external split publication can install a newer editor', t => {
	const f = createActualSourcePanes(t), part = f.firstPart, parts = f.editor.editorParts;
	f.editor.resourcePanel.show();
	const newer = new HostErrorInput('new receiver publication');
	let installed = false;
	t.after(part.onDidChangeGroups(() => {
		if (installed) return;
		installed = true;
		part.groups.find(group => group !== f.firstGroup)!.openEditor(newer, { preserveFocus: true });
	}));
	const focus = inputFocus.target;
	assert.ok(parts.sideGroup(f.firstGroup) === undefined);
	assert.equal(installed, true); assert.equal(part.groups.length, 2);
	assert.ok(part.groups.find(group => group !== f.firstGroup)!.model.activeTab === newer);
	assert.ok(inputFocus.target === focus);
});

test('a layout callback restoring newer maximized intent cannot fabricate a duplicate hidden neighbor', t => {
	const f = createActualSourcePanes(t), part = f.firstPart, parts = f.editor.editorParts;
	part.splitGroup(f.firstGroup, 'right');
	part.arrangement.toggleMaximize(f.firstGroup); part.layout(part.clientBounds);
	f.editor.resourcePanel.show();
	const pane = f.firstGroup.panes.activePane!, layout = pane.layout.bind(pane);
	let maximized = false;
	t.mock.method(pane, 'layout', bounds => {
		layout(bounds);
		if (!maximized) { maximized = true; part.arrangement.toggleMaximize(f.firstGroup); part.layout(part.clientBounds); }
	});
	assert.ok(parts.sideGroup(f.firstGroup) === undefined);
	assert.equal(maximized, true); assert.equal(part.groups.length, 2);
	assert.ok(part.arrangement.maximized === f.firstGroup);
});

test('a newer foreign focus during real split publication survives while the accepted empty side remains', t => {
	const f = createActualSourcePanes(t), part = f.firstPart, parts = f.editor.editorParts;
	f.editor.resourcePanel.show();
	t.after(part.onDidChangeGroups(() => { f.second.focus(); }));
	assert.ok(parts.sideGroup(f.firstGroup) === undefined);
	assert.equal(part.groups.length, 2);
	assert.equal(part.groups.find(group => group !== f.firstGroup)!.model.tabs.length, 0);
	assert.ok(inputFocus.target === f.second.commandTarget && parts.activePart === f.secondPart);
});
