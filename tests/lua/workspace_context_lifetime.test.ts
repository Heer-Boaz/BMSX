import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EditorTextModelService } from '../../ide/editor/model/model_service';
import { EditorWorkspaceEditConflict } from '../../ide/editor/model/undo_redo_service';
import { WorkspaceEditProposal } from '../../ide/workbench/services/working_copy/workspace_edit';
import { WorkspaceSourceContext } from '../../ide/workbench/services/working_copy/source_context';
import { createScenarioTestSourceState, createScenarioTestSourceRecord } from '../helpers/scenario_sources';

const resource = { sourceFilePath: 'proposal.lua', location: { kind: 'workspace' as const, path: 'proposal.lua' }, domain: 0 as const, path: 'proposal.lua', source: { type: 'lua' as const, resid: 'proposal' } };
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

test('a review retains captured evidence but permanently loses authority when its canonical workspace is retired', t => {
	const models = new EditorTextModelService(), sources = createScenarioTestSourceState([createScenarioTestSourceRecord('proposal.lua', 0, 'x')]);
	const model = models.retain(sources.luaResources[0], 'lua', 'x');
	const proposal = new WorkspaceEditProposal('Replace authored source', new WorkspaceSourceContext(models, sources),
		{ kind: 'edit', edits: new Map([[model, edit]]) });
	t.after(() => { proposal.dispose(); models.clear(); });
	const files = proposal.files;
	models.clear();
	const reopened = models.retain(sources.luaResources[0], 'lua', 'x');
	assert.equal(reopened.version, model.version);
	assert.equal(proposal.state, 'stale'); assert.equal(proposal.lifetime.isDisposed, true);
	assert.equal(proposal.files, files); assert.equal(files[0].kind, 'edit');
	assert.throws(() => proposal.apply(), /stale/);
	assert.equal(reopened.buffer.getText(), 'x'); assert.equal(reopened.canUndo, false);
});
