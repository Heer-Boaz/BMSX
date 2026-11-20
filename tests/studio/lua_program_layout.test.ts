import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { resetSemanticProjects } from '../../ide/editor/contrib/intellisense/semantic/workspace/state';
import { createActualSourcePanes } from '../helpers/source_panes';

afterEach(() => { editorTextModelService.clear(); resetSemanticProjects(editorTextModelService); });

test('Progress layout arranges its current projection without ticking source or runtime observation', t => {
	const f = createActualSourcePanes(t, false, [
		['program.lua', "local p=require('cartlib/progression'); p.compile_program({rules={{id='first',on='hit'}},filters={},handlers={}})"],
		['cartlib/progression.lua', ''],
	]);
	const group = f.editor.editorParts.main.activeGroup;
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'program.lua' })!;
	f.editor.luaPrograms.openResource(group, resource, 'progression'); f.editor.update(0);
	const input = group.model.activeTab!; assert.ok(input.kind === 'lua_program');
	const pane = group.panes.activePane!, source = t.mock.method(f.editor.luaPrograms, 'refresh'), runtime = t.mock.method(f.editor.luaPrograms, 'refreshRuntime');
	const version = input.workingCopy.version, text = input.workingCopy.buffer.getText();
	// Geometry is the explicit subject: a container must arrange the supplied client rectangle synchronously.
	const bounds = { left: 11, top: 23, right: 311, bottom: 183 };
	pane.layout(bounds);
	assert.equal(input.layout.left, bounds.left); assert.equal(input.layout.right, bounds.right);
	assert.equal(input.layout.top, bounds.top); assert.equal(input.layout.bottom, bounds.bottom);
	assert.equal(source.mock.callCount(), 0); assert.equal(runtime.mock.callCount(), 0);
	pane.update(0);
	assert.equal(source.mock.callCount(), 1); assert.equal(runtime.mock.callCount(), 1);
	assert.equal(input.workingCopy.version, version); assert.equal(input.workingCopy.buffer.getText(), text);
});
