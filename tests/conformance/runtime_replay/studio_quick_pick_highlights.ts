import type { OverlayRenderer } from '../../../ide/runtime/overlay_renderer';
import { editorViewState } from '../../../ide/editor/ui/view/state';
import { check, type StudioFixture } from './studio_fixture';

/** Observe the real overlay submissions; never replace painting or the backend. */
export async function checkQuickPickHighlightRuns(test: StudioFixture, label: string, expected: readonly (readonly [number, number])[]): Promise<void> {
	const renderer = test.ide.overlayRenderer;
	const draw = renderer.itemRun;
	const runs: { start: number; end: number; color: Parameters<OverlayRenderer['itemRun']>[7] }[] = [];
	renderer.itemRun = function(...args: Parameters<OverlayRenderer['itemRun']>): void {
		if (args[0] === label) runs.push({ start: args[1], end: args[2], color: args[7] });
		draw.apply(this, args);
	};
	try { await test.frame(); } finally { renderer.itemRun = draw; }
	for (const [start, end] of expected) {
		const match = runs.find(run => run.start === start && run.end === end);
		check(match !== undefined, `Quick Pick: actual overlay marks ${label}:${start}-${end}`);
		if (expected.length > 1) {
			check(runs.some(run => run.color !== match.color), `Quick Pick: ${label} matches differ from normal foreground`);
		}
	}
}

export async function testStudioQuickPickHighlights(test: StudioFixture): Promise<void> {
	const { ide, press, cycles } = test;
	const before = cycles(), picker = ide.editor.quickInput;
	const font = editorViewState.font.variant;
	for (const variant of ['tiny', 'msx'] as const) {
		ide.editor.setFontVariant(variant);
		await press('ControlLeft', 'ShiftLeft', 'KeyP'); await press('KeyH'); await press('KeyR');
		check(picker.model.list.rows.some(row => row.item.label === 'Run: Hot Resume'), 'Quick Pick: hr admits the actual Hot Resume command');
		await checkQuickPickHighlightRuns(test, 'Run: Hot Resume', [[5, 6], [9, 10]]);
		await press('ControlLeft', 'KeyA'); test.clipboard.text = 'hot res'; await press('ControlLeft', 'KeyV');
		await checkQuickPickHighlightRuns(test, 'Run: Hot Resume', [[5, 12]]);
		await press('ControlLeft', 'KeyZ');
		await press('Escape');
	}
	ide.editor.setFontVariant(font);
	check(cycles() === before, 'Quick Pick: query/Undo/font changes do not resume the paused machine');
	console.info('STUDIO: Quick Pick physical command match highlighting PASS');
}
