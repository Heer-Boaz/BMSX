import { activeCodeEditor } from '../../../ide/editor/ui/code_editor_state';
import { resolveRuntimeResource } from '../../../ide/runtime/sources';
import { check, type StudioFixture } from './studio_fixture';
import { checkQuickPickHighlightRuns } from './studio_quick_pick_highlights';

/** Real file transport and keyboard navigation; no game-authored symbol/line dependency. */
export async function testStudioFileChoices(test: StudioFixture): Promise<void> {
	const { ide, harness, press, until, cycles } = test;
	harness.openLuaSource('cart.lua');
	const origin = activeCodeEditor.model, version = origin.version, dirty = origin.dirty;
	const before = cycles(), media = ide.sources.currentBlua32Media;
	const target = resolveRuntimeResource(ide.sources, { domain: origin.resource.domain, path: 'title_screen.lua' })!;
	const picker = ide.editor.quickInput;
	await press('ControlLeft', 'Comma');
	for (const code of ['KeyT', 'KeyS', 'KeyC', 'KeyR']) await press(code);
	check(picker.model.list.rows.length !== 0 && picker.model.list.rows[0].item.label === target.path,
		'A06: a file abbreviation ranks the real basename, not a literal-only empty list');
	await checkQuickPickHighlightRuns(test, target.path, [[0, 1], [6, 9]]);
	await press('Enter');
	await until(() => activeCodeEditor.model.resource === target, 'A06: file acceptance reveals the original domain-qualified resource');
	check(!picker.visible, 'A06: accepting a file ends the query lifetime');
	await press('AltLeft', 'ArrowLeft');
	check(activeCodeEditor.model === origin, 'A06: file navigation Back restores the original working copy');
	await press('ControlLeft', 'Comma');
	test.clipboard.text = 'TITLE_SCREEN.LUA'; await press('ControlLeft', 'KeyV');
	check(picker.model.list.rows[0].item.label === target.path, 'A06: case-folded path identity preserves the original resource spelling');
	await press('ControlLeft', 'KeyZ');
	check(picker.field.text === '' && origin.version === version && origin.dirty === dirty,
		'A06: file query Undo does not enter source history');
	await press('Escape');
	check(cycles() === before && ide.sources.currentBlua32Media === media,
		'A06: file admission, matching, acceptance and Back neither run nor replace the paused machine');
	console.info('STUDIO A06: fuzzy file choices and original resource navigation PASS');
}
