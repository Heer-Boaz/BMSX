import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import test from 'node:test';
import { inputFocus } from '../../ide/input/focus';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import type { SerializedEditorGroupLayout, SerializedEditorParts } from '../../ide/workbench/services/editor/editor_parts_serialization';
import { createActualSourcePanes } from '../helpers/source_panes';

test('native editor sash drag, reset and keyboard sizing publish their current serializable preference at the part owner', t => {
	const f = createActualSourcePanes(t), { editor } = f, parts = editor.editorParts, part = parts.main;
	editor.setFontVariant('tiny');
	const group = part.activeGroup; group.openEditor(new CodeEditorInput(f.firstInput.workingCopy));
	const added = part.splitGroup(group, 'right'); f.update();
	const split = part.arrangement.splits[0].split, observations: SerializedEditorParts[] = [];
	t.after(parts.onDidChange(() => observations.push(parts.serialize(editor.editorInputSerializers))));
	const published = () => observations.some(state => state.main.layout.kind === 'split' && state.main.layout.ratio === split.ratio);
	// The ratio is actual session data; the test does not freeze the rendered sash position.
	split.moveTo(split.start + (split.end - split.start) * 0.625);
	assert.notEqual(split.ratio, split.defaultRatio); assert.equal(published(), true);
	observations.length = 0; split.reset();
	assert.equal(split.ratio, split.defaultRatio); assert.equal(published(), true);
	observations.length = 0; group.panes.activePane!.focus();
	const before = split.ratio;
	editor.commands.execute('workspace.increaseViewWidth', group.panes.activePane!.commandTarget);
	assert.notEqual(split.ratio, before); assert.equal(published(), true);
	assert.ok(inputFocus.admittedTarget === group.panes.activePane!.commandTarget);
	assert.equal(part.removeGroup(added), true);
	observations.length = 0;
	const removedRatio = split.ratio; split.moveTo(split.position + 10);
	assert.notEqual(split.ratio, removedRatio);
	assert.deepEqual(observations, [], 'a removed branch has no remaining session-publication authority');
	assert.equal(parts.serialize(editor.editorInputSerializers).main.layout.kind, 'group');
});

test('editor sizing observation survives maximize and minimize but ends with disposal of that exact document part', async t => {
	const f = createActualSourcePanes(t), { editor } = f, parts = editor.editorParts;
	editor.setFontVariant('tiny');
	const part = parts.createDocument({ requestedBounds: { left: 0, top: 30, right: 760, bottom: 290 } });
	const group = part.activeGroup; group.openEditor(new CodeEditorInput(f.firstInput.workingCopy));
	part.splitGroup(group, 'right'); f.update();
	const split = part.arrangement.splits[0].split, observations: SerializedEditorParts[] = [];
	t.after(parts.onDidChange(() => observations.push(parts.serialize(editor.editorInputSerializers))));
	const published = () => observations.some(state => {
		const document = state.documents[parts.documents.indexOf(part)];
		return document?.layout.kind === 'split' && document.layout.ratio === split.ratio;
	});
	part.arrangement.toggleMaximize(group); part.relayout(); observations.length = 0;
	split.moveTo(split.start + (split.end - split.start) * 0.625);
	assert.equal(published(), true); assert.ok(part.arrangement.maximized === group);
	part.arrangement.toggleMaximize(group); part.relayout(); parts.minimize(part); observations.length = 0;
	const before = split.ratio; split.moveTo(split.position - 20);
	assert.notEqual(split.ratio, before); assert.equal(published(), true); assert.equal(part.window!.model.minimized, true);
	part.focus(); observations.length = 0;
	editor.commands.execute('workspace.decreaseViewWidth', group.panes.activePane!.commandTarget);
	assert.equal(published(), true); assert.equal(part.window!.model.minimized, false);
	assert.equal(await parts.close(part), true); assert.equal(part.retired, true);
	observations.length = 0;
	const disposedRatio = split.ratio; split.moveTo(split.position + 10);
	assert.notEqual(split.ratio, disposedRatio);
	assert.deepEqual(observations, [], 'a disposed part cannot publish session changes through a retained stale sash');
	assert.ok(!parts.documents.includes(part));
});

test('a sibling relocation publishes a serialized active-group index consistent with its newly ordered layout', t => {
	const f = createActualSourcePanes(t), { editor } = f, parts = editor.editorParts, part = parts.main;
	editor.setFontVariant('tiny');
	const first = part.activeGroup; first.openEditor(new CodeEditorInput(f.firstInput.workingCopy));
	const second = part.splitGroup(first, 'right'); second.openEditor(new CodeEditorInput(f.secondInput.workingCopy)); f.update();
	const split = part.arrangement.splits[0].split;
	split.ratio = 0.625; first.panes.activePane!.focus();
	const observations: boolean[] = [];
	const release = parts.onDidChange(() => {
		const state = parts.serialize(editor.editorInputSerializers).main;
		const leaves: SerializedEditorGroupLayout[] = [state.layout];
		for (let index = 0; index < leaves.length; index++) {
			const node = leaves[index];
			if (node.kind === 'split') { leaves.splice(index, 1, node.first, node.second); index--; }
		}
		const active = leaves[state.active];
		assert.ok(active.kind === 'group');
		const actual = part.activeGroup.model.serialize(editor.editorInputSerializers);
		observations.push(isDeepStrictEqual(active.group, actual));
	});
	t.after(release);
	assert.equal(part.relocateGroup(second, first, 'left'), true);
	release();
	assert.ok(observations.length > 0);
	assert.ok(observations.every(Boolean), 'autosave observers must not serialize the new tree with the previous active-group index');
	assert.ok(part.activeGroup === first && part.groups[0] === second && part.groups[1] === first);
});
