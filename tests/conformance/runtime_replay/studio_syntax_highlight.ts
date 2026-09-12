import { COLOR_SYNTAX_HIGHLIGHTS } from '../../../ide/common/constants';
import { editorViewState } from '../../../ide/editor/ui/view/state';
import { check, type StudioFixture } from './studio_fixture';

/** Test actual semantic publication, retained paint data and document Undo together. */
export async function testStudioSyntaxHighlight(test: StudioFixture): Promise<void> {
	const { harness, press, until, frame, clipboard, cycles, ide } = test;
	const model = harness.getActiveEditorDocument().model;
	const original = model.buffer.getText();
	const position = cycles();
	const media = ide.sources.currentBlua32Media;
	const prefix = "do\n\tlocal states = { ['idle'] = {} }\n\tstates['idle'] = { note = 'stayHere' }\n\tstates.idle = states['idle']\nend\n\n";
	await press('ControlLeft', 'Home');
	clipboard.text = prefix;
	await press('ControlLeft', 'KeyV');
	check(model.buffer.getText() === prefix + original, 'syntax: physical paste authors the independent string-key fixture');
	const layout = editorViewState.layout;
	for (const [phase, key] of ["'idle'", "'walkBack'", "'idle'"].entries()) {
		if (phase === 1) model.pushEditOperations([{ offset: prefix.indexOf('idle'), deleteLength: 4, text: 'walkBack' }]);
		if (phase === 2) await press('ControlLeft', 'KeyZ');
		await until(() => layout.getSemanticFileData(model.buffer, model.version, model.identity) !== null,
			`syntax: semantic publication for phase ${phase}`);
		for (const row of [1, 2, 3]) {
			const expected = row === 1 ? key : "'idle'";
			const cached = layout.getCachedHighlight(model.buffer, row);
			const highlight = cached.hi;
			const start = highlight.text.indexOf(expected);
			check(start >= 0 && highlight.upperText.slice(start, start + expected.length) === expected,
				`syntax: phase ${phase}, row ${row} preserves every string character's casing`);
			check(highlight.colors.slice(start, start + expected.length).every(color => color === COLOR_SYNTAX_HIGHLIGHTS.COLOR_STRING),
				`syntax: phase ${phase}, row ${row} colors the full string, including both quotes`);
			await frame();
			check(layout.getCachedHighlight(model.buffer, row) === cached && cached.hi === highlight,
				'syntax: an idle editor frame retains its highlighting and layout');
		}
	}
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === original && !model.dirty, 'syntax: ordinary Undo removes the fixture without saving');
	check(cycles() === position && ide.sources.currentBlua32Media === media,
		'syntax: source rendering and Undo never execute or replace the paused guest');
}
