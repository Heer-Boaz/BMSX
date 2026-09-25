import { resourceIdentityKey } from '../../../ide/common/resource';
import { inputFocus } from '../../../ide/input/focus';
import { editorTabGroup } from '../../../ide/workbench/ui/tab/group_model';
import { closeTab, openEditorTab } from '../../../ide/workbench/ui/tabs';
import { check, type StudioFixture } from './studio_fixture';

/** Actual contributions resolve without touching the live pane, preview, or focus. */
export async function testStudioInputResolution(test: StudioFixture): Promise<void> {
	const { editor } = test.ide;
	const original = editorTabGroup.activeTab;
	const resource = test.ide.sources.luaResources.find(candidate => candidate.domain === 0
		&& editorTabGroup.findById(`code:${resourceIdentityKey(candidate)}`) === undefined)!;
	const revision = editorTabGroup.revision;
	const focus = inputFocus.target;
	const cycles = test.cycles();
	const [first, second] = await Promise.all([
		editor.resourceEditors.resolveEditorInput(resource),
		editor.resourceEditors.resolveEditorInput(resource),
	]);
	check(editorTabGroup.revision === revision && editorTabGroup.activeTab === original
		&& editor.editorPanes.activePane.input === original && inputFocus.target === focus,
		'A07 admission: resolving editor inputs leaves the actual group, pane and focus unchanged');
	if (first.kind !== 'code_editor' || second.kind !== 'code_editor') throw new Error('A07 admission: text contribution');
	check(first.context === second.context && !first.workingCopy.dirty,
		'A07 admission: simultaneous source views share one clean document and code view');
	openEditorTab(editor.editorPanes, first, { pinned: false }); await test.frame();
	check(editorTabGroup.activeTab === first && editorTabGroup.previewTab === first,
		'A07 admission: the explicit open, not resolution, creates the preview');
	let discarded = false;
	second.onWillDispose(() => { discarded = true; });
	openEditorTab(editor.editorPanes, second, { pinned: false }); await test.frame();
	check(editorTabGroup.activeTab === first && editorTabGroup.previewTab === first && discarded,
		'A07 admission: a concurrent candidate cannot duplicate or replace the admitted view');
	check(!first.workingCopy.dirty && test.cycles() === cycles,
		'A07 admission: opening source did not edit a document or advance the paused machine');
	closeTab(editor.editorPanes, first.id);
	const aem = test.ide.sources.cartridgeSlots[0]!.dataResources.find(item => item.source.type === 'aem')!;
	const pendingAem = editor.navigation.openResource(aem);
	const opened = await editor.navigation.openResource(resource);
	check(opened === editor.editorPanes.openGeneration && await pendingAem === undefined,
		'opening lifetime: real AEM source admission cannot replace the newer Lua navigation');
	check(editorTabGroup.activeTab.kind === 'code_editor' && editorTabGroup.activeTab.workingCopy.resource === resource
		&& editorTabGroup.findById(`code:${resourceIdentityKey(aem)}`) === undefined,
		'opening lifetime: cancelled I/O has no tab or focus side effect');
	closeTab(editor.editorPanes, editorTabGroup.activeTab.id);
	openEditorTab(editor.editorPanes, original); await test.frame();
	const pendingSource = editor.navigation.openResource(resource);
	editor.deactivate();
	check(await pendingSource === undefined && editor.editorPanes.activePane === null,
		'opening lifetime: leaving the IDE retires pending source activation');
	editor.activate(); await test.frame();
	check(editorTabGroup.activeTab === original && test.cycles() === cycles,
		'opening lifetime: reopening the IDE preserves the chosen view and paused machine');
	console.info('STUDIO A07 input admission: PASS');
}
