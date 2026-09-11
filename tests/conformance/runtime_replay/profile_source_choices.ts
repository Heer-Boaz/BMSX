import assert from 'node:assert/strict';
import { LuaSemanticWorkspace } from '../../../toolchain/ts/lua/semantic/model';
import { buildLuaSemanticFrontendFromSnapshot } from '../../../toolchain/ts/lua/semantic/frontend';
import { buildReferenceSources } from '../../../ide/editor/contrib/references/sources';
import { createReferenceQuickPickProvider } from '../../../ide/workbench/contrib/code_editor/references/quick_access';
import { QuickInputController } from '../../../ide/workbench/services/quick_input/controller';
import { configureFontVariant } from '../../../ide/editor/ui/view/view';
import { editorViewState } from '../../../ide/editor/ui/view/state';
import { VirtualHeadlessClock } from '../../../hosts/node/headless/clock';
import { medianMilliseconds } from '../../helpers/performance';

configureFontVariant(new VirtualHeadlessClock(), 'tiny', null);
editorViewState.viewportWidth = 384; editorViewState.viewportHeight = 288;
const picker = new QuickInputController({ text: '', isSupported: () => false, writeText: async () => {} });
const accept = () => assert.fail('profiling must not accept a source choice');
for (const fileCount of [1, 16, 128]) {
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('declaration.lua', 'navigation_beacon = 1\n');
	for (let file = 0; file < fileCount; file += 1) {
		workspace.updateFile(`file_${file}.lua`, Array.from({ length: 8 }, (_, line) => `local value_${line} = navigation_beacon`).join('\n'));
	}
	const snapshot = workspace.getSnapshot();
	const query = buildLuaSemanticFrontendFromSnapshot(snapshot).findReferencesByPosition('file_0.lua', 1, 20)!;
	assert.ok(query);
	const info = { snapshot, query, expression: query.label, matches: [] };
	const sources = buildReferenceSources(info);
	assert.equal(sources.length, fileCount * 8 + 1);
	// Semantic snapshot/query construction is outside these projection measurements.
	const sourceMilliseconds = medianMilliseconds(() => { buildReferenceSources(info); });
	const openMilliseconds = medianMilliseconds(() => picker.pick('REFERENCES', 'Filter',
		() => createReferenceQuickPickProvider(buildReferenceSources(info), 'file_0.lua', 1, 20), accept));
	const provider = createReferenceQuickPickProvider(sources, 'file_0.lua', 1, 20);
	const queries = ['', 'navigation', 'file_0', 'value_7 file_0', 'absent'];
	const queryMicroseconds = queries.map(query => ({ query, microseconds: medianMilliseconds(() => {
		for (let index = 0; index < 1000; index += 1) provider.getPicks(query);
	}) })); // 1000 iterations: milliseconds numerically equal microseconds/query.
	const rows = picker.model.list.rows;
	const warmMilliseconds = medianMilliseconds(() => { for (let frame = 0; frame < 100000; frame += 1) picker.update(); });
	assert.equal(picker.model.list.rows, rows);
	console.log(JSON.stringify({ fileCount: fileCount + 1, choiceCount: sources.length, sourceMilliseconds,
		openMilliseconds, queryMicroseconds, warmMicrosecondsPerFrame: warmMilliseconds / 100,
		presentedRows: picker.layout.renderRows.length }));
}
picker.dispose();
