import assert from 'node:assert/strict';
import type { LuaSymbolEntry } from '../../../toolchain/ts/lua/semantic_contracts';
import { buildSymbolQuickPickItems } from '../../../ide/workbench/contrib/code_editor/symbols/quick_access';
import { SymbolQuickPickProvider } from '../../../ide/workbench/contrib/code_editor/symbols/quick_pick_provider';
import { TextQuickPickProvider } from '../../../ide/workbench/services/quick_input/text_provider';
import { QuickInputController } from '../../../ide/workbench/services/quick_input/controller';
import { configureFontVariant } from '../../../ide/editor/ui/view/view';
import { editorViewState } from '../../../ide/editor/ui/view/state';
import { VirtualHeadlessClock } from '../../../hosts/node/headless/clock';
import { medianMilliseconds } from '../../helpers/performance';

configureFontVariant(new VirtualHeadlessClock(), 'tiny', null);
editorViewState.viewportWidth = 384; editorViewState.viewportHeight = 288;
const picker = new QuickInputController({ text: '', isSupported: () => false, writeText: async () => {} });
const names = ['spawn_enemy', 'update_scene', 'before_enter', 'apply_effect', 'start_timeline', 'select_target', 'execute_task', 'dispatch_event'];
for (const count of [128, 1024, 8192]) {
	const symbols: LuaSymbolEntry[] = Array.from({ length: count }, (_, index) => ({ name: names[index % names.length],
		path: `actor_${index}.${names[index % names.length]}`, kind: 'function',
		location: { path: `workspace/controller_${index % 16}/actor_${index}.lua`,
			range: { startLine: index + 1, startColumn: 1, endLine: index + 1, endColumn: 10 } } }));
	for (const scope of ['file', 'workspace'] as const) {
		const items = buildSymbolQuickPickItems(symbols, scope);
		for (const mode of ['literal', 'symbol'] as const) {
			const provide = mode === 'symbol' ? () => new SymbolQuickPickProvider(items, scope) : () => new TextQuickPickProvider(items);
			const openMilliseconds = medianMilliseconds(() => picker.pick('SYMBOLS', 'query', provide, () => assert.fail('profile accepted a symbol')));
			const provider = provide(), projection = provider.getPicks(''), rows = projection.matches, entries = [...rows];
			const queryMicroseconds = ['', 'ae', 'spawn', 'spwn', 'upd scn', 'spwn cntr', 'absent'].map(query => {
				const elapsed = medianMilliseconds(() => { for (let index = 0; index < 20; index += 1) provider.getPicks(query); });
				assert.equal(provider.getPicks(query), projection); assert.equal(projection.matches, rows);
				for (const match of rows) assert.equal(match, entries[match.itemIndex]);
				return { query, matches: rows.length, microseconds: elapsed * 50 };
			});
			const warmMilliseconds = medianMilliseconds(() => { for (let frame = 0; frame < 100000; frame += 1) picker.update(); });
			console.log(JSON.stringify({ count, scope, mode, openMilliseconds, queryMicroseconds,
				warmMicrosecondsPerFrame: warmMilliseconds / 100, presentedRows: picker.layout.renderRows.length }));
		}
	}
}
picker.dispose();
