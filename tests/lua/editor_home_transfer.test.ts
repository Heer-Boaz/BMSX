import assert from 'node:assert/strict';
import test from 'node:test';
import { HomeInput } from '../../ide/workbench/contrib/home/editor_input';
import { HomeEditorPane } from '../../ide/workbench/contrib/home/editor_pane';
import { createActualSourcePanes } from '../helpers/source_panes';

test('Home portability follows its admitted namespace, not metadata object identity or a group-kind exception', () => {
	const home = new HomeInput({ id: 'workspace-admission', projectRoot: 'carts/project' });
	const matching = new HomeInput({ id: 'workspace-admission', projectRoot: 'carts/project' });
	const foreign = new HomeInput({ id: 'other-admission', projectRoot: 'carts/project' });
	assert.equal(home.canMove(), true); assert.equal(home.canMove(matching), true); assert.equal(home.canMove(foreign), false);
	assert.equal(new HomeInput(null).canMove(new HomeInput(null)), true);
});

test('Home and Source transfer together with retained view models and fresh control authority', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, source = f.firstGroup;
	const home = new HomeInput({ id: f.sources.systemContextId, projectRoot: 'machine/bios' });
	source.openEditor(home); f.editor.update(0);
	const pane = source.panes.activePane!; assert.ok(pane instanceof HomeEditorPane);
	const viewport = home.viewport, sections = home.sections;
	const code = f.firstInput.workingCopy;
	code.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- retained beside Home\n' }]);
	const text = code.buffer.getText(), version = code.version;
	let retired = 0; home.onWillDispose(() => { retired++; }); f.firstInput.onWillDispose(() => { retired++; });
	assert.equal(parts.moveGroup(source, { kind: 'window' }), true);
	const target = parts.findGroup(home)!;
	assert.ok(target !== source && target.model.tabs[0] === f.firstInput && target.model.tabs[1] === home);
	assert.ok(target.model.activeTab === home && target.panes.activePane instanceof HomeEditorPane && target.panes.activePane.input === home);
	assert.ok(target.panes.activePane !== pane && home.viewport === viewport && home.sections === sections);
	assert.equal(source.surface.retired, true); assert.equal(f.firstPart.retired, true); assert.equal(retired, 0);
	assert.equal(code.buffer.getText(), text); assert.equal(code.version, version); assert.equal(code.canUndo, true);
});

test('matching Home views coalesce without replacing the receiving workspace binding', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, source = f.firstGroup, target = f.secondGroup;
	const context = { id: f.sources.systemContextId, projectRoot: 'machine/bios' };
	const offered = new HomeInput(context), retained = new HomeInput({ ...context });
	source.openEditor(offered); target.openEditor(retained); f.editor.update(0);
	let disposed = 0; offered.onWillDispose(() => { disposed++; });
	assert.equal(parts.moveGroup(source, { kind: 'group', group: target }), true);
	assert.equal(disposed, 1); assert.ok(target.model.activeTab === retained && target.panes.activePane?.input === retained);
	assert.ok(target.model.tabs.includes(f.firstInput) && !target.model.tabs.includes(offered));
	assert.ok(retained.workspaceContext !== context && retained.workspaceContext?.id === context.id);
});
