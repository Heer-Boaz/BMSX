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
	closeTab(editor.editorPanes, test.ide.sources, first.id);
	openEditorTab(editor.editorPanes, original); await test.frame();
	console.info('STUDIO A07 input admission: PASS');
}
