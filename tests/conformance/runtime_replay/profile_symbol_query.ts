import { TEST_CARTRIDGE_CONTEXT_IDS } from '../../helpers/runtime_sources';
import { ContextMenuController } from '../../../ide/workbench/services/context_menu/controller';
import { inputFocus } from '../../../ide/input/focus';
import { pointerCapture } from '../../../ide/input/pointer/capture';
import assert from 'node:assert/strict';
import type { EditorLuaSymbolEntry } from '../../../ide/editor/contrib/intellisense/engine';
import { resourceIdentityKey } from '../../../ide/common/resource';
import { buildSymbolQuickPickItems } from '../../../ide/workbench/contrib/code_editor/symbols/quick_access';
import { SymbolQuickPickProvider } from '../../../ide/workbench/contrib/code_editor/symbols/quick_pick_provider';
import { TextQuickPickProvider } from '../../../ide/workbench/services/quick_input/text_provider';
import { QuickInputController } from '../../../ide/workbench/services/quick_input/controller';
import { configureFontVariant } from '../../../ide/editor/ui/view/configuration';
import { editorViewState } from '../../../ide/editor/ui/view/state';
import { medianMilliseconds } from '../../helpers/performance';

configureFontVariant('tiny');
editorViewState.viewportWidth = 384; editorViewState.viewportHeight = 288;
const area = { left: 0, top: 0, right: 384, bottom: 288 };
const menu = new ContextMenuController(inputFocus, pointerCapture, area);
const picker = new QuickInputController(menu, undefined, undefined, { scope: inputFocus.workbenchScope, bounds: area, kind: 'workspace' });
const names = ['spawn_enemy', 'update_scene', 'before_enter', 'apply_effect', 'start_timeline', 'select_target', 'execute_task', 'dispatch_event'];
for (const count of [128, 1024, 8192]) {
	const symbols: EditorLuaSymbolEntry[] = Array.from({ length: count }, (_, index) => {
		const resource = { contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: `workspace/controller_${index % 16}/actor_${index}.lua` };
		return { name: names[index % names.length], resource,
		path: `actor_${index}.${names[index % names.length]}`, kind: 'function',
		location: { path: resourceIdentityKey(resource),
			range: { startLine: index + 1, startColumn: 1, endLine: index + 1, endColumn: 10 } } };
	});
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
picker.dispose(); menu.dispose();
