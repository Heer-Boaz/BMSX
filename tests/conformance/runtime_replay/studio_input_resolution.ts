import { resourceIdentityKey } from '../../../ide/common/resource';
import { inputFocus } from '../../../ide/input/focus';
import { check, type StudioFixture } from './studio_fixture';

/** Actual contributions resolve without touching the live pane, preview, or focus. */
export async function testStudioInputResolution(test: StudioFixture): Promise<void> {
	const { editor } = test.ide;
	const original = editor.editorGroup.model.activeTab;
	const resource = test.ide.sources.luaResources.find(candidate => candidate.domain === 0
		&& editor.editorGroup.model.findById(`code:${resourceIdentityKey(candidate)}`) === undefined)!;
	const revision = editor.editorGroup.model.revision;
	const focus = inputFocus.target;
	const cycles = test.cycles();
	const [first, second] = await Promise.all([
		editor.resourceEditors.resolveEditorInput(resource),
		editor.resourceEditors.resolveEditorInput(resource),
	]);
	check(editor.editorGroup.model.revision === revision && editor.editorGroup.model.activeTab === original
		&& editor.editorGroup.panes.activePane.input === original && inputFocus.target === focus,
		'A07 admission: resolving editor inputs leaves the actual group, pane and focus unchanged');
	if (first.kind !== 'code_editor' || second.kind !== 'code_editor') throw new Error('A07 admission: text contribution');
	check(first.context !== second.context && first.workingCopy === second.workingCopy && !first.workingCopy.dirty,
		'A07 admission: simultaneous source candidates retain independent views of one clean document');
	editor.editorGroup.openEditor(first, { pinned: false }); await test.frame();
	check(editor.editorGroup.model.activeTab === first && editor.editorGroup.model.previewTab === first,
		'A07 admission: the explicit open, not resolution, creates the preview');
	let discarded = false;
	second.onWillDispose(() => { discarded = true; });
	editor.editorGroup.openEditor(second, { pinned: false }); await test.frame();
	check(editor.editorGroup.model.activeTab === first && editor.editorGroup.model.previewTab === first && discarded,
		'A07 admission: a concurrent candidate cannot duplicate or replace the admitted view');
	check(!first.workingCopy.dirty && test.cycles() === cycles,
		'A07 admission: opening source did not edit a document or advance the paused machine');
	editor.editorGroup.close(first.id);
	const aem = test.ide.sources.resources.find(item => item.domain === 0 && item.source.type === 'aem')!;
	const pendingAem = editor.navigation.openResource(aem);
	const opened = await editor.navigation.openResource(resource);
	check(opened === editor.editorGroup.panes.openGeneration && await pendingAem === undefined,
		'opening lifetime: real AEM source admission cannot replace the newer Lua navigation');
	check(editor.editorGroup.model.activeTab.kind === 'code_editor' && editor.editorGroup.model.activeTab.workingCopy.resource === resource
		&& editor.editorGroup.model.findById(`code:${resourceIdentityKey(aem)}`) === undefined,
		'opening lifetime: cancelled I/O has no tab or focus side effect');
	editor.editorGroup.close(editor.editorGroup.model.activeTab.id);
	editor.editorGroup.openEditor(original); await test.frame();
	const pendingSource = editor.navigation.openResource(resource);
	editor.deactivate();
	check(await pendingSource === undefined && editor.editorGroup.panes.activePane === null,
		'opening lifetime: leaving the IDE retires pending source activation');
	editor.activate(); await test.frame();
	check(editor.editorGroup.model.activeTab === original && test.cycles() === cycles,
		'opening lifetime: reopening the IDE preserves the chosen view and paused machine');
	console.info('STUDIO A07 input admission: PASS');
}
