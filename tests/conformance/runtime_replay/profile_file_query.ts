import assert from 'node:assert/strict';
import type { RuntimeResource } from '../../../ide/common/resource';
import { buildResourceQuickPickItems } from '../../../ide/workbench/contrib/resources/quick_access';
import { FileQuickPickProvider } from '../../../ide/workbench/contrib/resources/quick_pick_provider';
import { TextQuickPickProvider } from '../../../ide/workbench/services/quick_input/text_provider';
import { QuickInputController } from '../../../ide/workbench/services/quick_input/controller';
import { configureFontVariant } from '../../../ide/editor/ui/view/view';
import { editorViewState } from '../../../ide/editor/ui/view/state';
import { VirtualHeadlessClock } from '../../../hosts/node/headless/clock';
import { medianMilliseconds } from '../../helpers/performance';

configureFontVariant(new VirtualHeadlessClock(), 'tiny', null);
editorViewState.viewportWidth = 384; editorViewState.viewportHeight = 288;
const picker = new QuickInputController({ text: '', isSupported: () => false, writeText: async () => {} });
const names = ['source_controller', 'workspace_query', 'state_machine', 'action_effect', 'source_index', 'code_editor', 'entry_point', 'sprite_view'];
for (const count of [128, 1024, 8192]) {
	const resources: RuntimeResource[] = Array.from({ length: count }, (_, index) => ({ domain: 0,
		path: `src/feature_${index % 32}/${names[index % names.length]}_${index}.lua`, source: { type: 'lua', resid: `resource_${index}` } }));
	const items = buildResourceQuickPickItems(resources);
	for (const mode of ['literal', 'file'] as const) {
		const provide = mode === 'file' ? () => new FileQuickPickProvider(items) : () => new TextQuickPickProvider(items);
		const openMilliseconds = medianMilliseconds(() => picker.pick('FILES', 'query', provide, () => assert.fail('profile accepted a file')));
		const provider = provide(), projection = provider.getPicks(''), rows = projection.matches, entries = [...rows];
		const queries = ['', 's', 'source', 'srct', 'feature_3 source', 'src/feature_3/sc', 'absent'];
		const queryMicroseconds = queries.map(query => {
			const iterations = 100;
			const elapsed = medianMilliseconds(() => { for (let index = 0; index < iterations; index += 1) provider.getPicks(query); });
			assert.equal(provider.getPicks(query), projection); assert.equal(projection.matches, rows);
			for (const match of rows) assert.equal(match, entries[match.itemIndex]);
			return { query, matches: rows.length, microseconds: elapsed * 1000 / iterations };
		});
		const warmMilliseconds = medianMilliseconds(() => { for (let frame = 0; frame < 100000; frame += 1) picker.update(); });
		console.log(JSON.stringify({ count, mode, openMilliseconds, queryMicroseconds,
			warmMicrosecondsPerFrame: warmMilliseconds / 100, presentedRows: picker.layout.renderRows.length }));
	}
}
picker.dispose();
