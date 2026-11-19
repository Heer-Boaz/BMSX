import { selectCartMapRow } from '../../ide/workbench/contrib/cart_maps/source_projection';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { beforeEach } from 'node:test';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import assert from 'node:assert/strict';
import test from 'node:test';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { CartMapController } from '../../ide/workbench/contrib/cart_maps/controller';
import { CartMapInput } from '../../ide/workbench/contrib/cart_maps/editor_input';
import { createTestEditorGroup } from '../helpers/editor_panes';
import { createScenarioTestSourceState } from '../helpers/scenario_sources';
import { ContextMenuController } from '../../ide/workbench/services/context_menu/controller';
import { QuickInputController } from '../../ide/workbench/services/quick_input/controller';
import { inputFocus } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';

beforeEach(() => configureFontVariant('tiny'));

test('a map picker retains only its explicit destination group lifetime', t => {
	const sources = createScenarioTestSourceState([]), destination = createTestEditorGroup(), sibling = createTestEditorGroup();
	const menuArea = { left: 0, top: 0, right: editorViewState.viewportWidth, bottom: editorViewState.viewportHeight };
	const menu = new ContextMenuController(inputFocus, pointerCapture, menuArea), picker = new QuickInputController(menu, undefined, undefined, { scope: inputFocus.workbenchScope, bounds: menuArea, kind: 'workspace' });
	const controller = new CartMapController(sources.catalog);
	t.after(() => { picker.dispose(); menu.dispose(); destination.dispose(); sibling.dispose(); inputFocus.setTarget(null); });
	controller.open(destination, picker);
	assert.equal(picker.visible, true);
	sibling.dispose();
	assert.equal(picker.visible, true, 'retiring another group does not revoke this opening');
	destination.dispose();
	assert.equal(picker.visible, false, 'a pending choice cannot later open into its retired destination');
});

test('a map choice cannot reopen its destination when chrome return focus retires that group', async t => {
	const sources = createScenarioTestSourceState([]), destination = createTestEditorGroup();
	sources.catalog.registerTextSources(TEST_CARTRIDGE_CONTEXT_IDS[0], [{ type: 'data', resid: 'stage',
		source_path: 'res/data/nemesis_s_stage.yaml', sourcemeta: { text: 'map_rows: ["m "]\n' } }]);
	const menuArea = { left: 0, top: 0, right: editorViewState.viewportWidth, bottom: editorViewState.viewportHeight };
	const menu = new ContextMenuController(inputFocus, pointerCapture, menuArea), picker = new QuickInputController(menu, undefined, undefined, { scope: inputFocus.workbenchScope, bounds: menuArea, kind: 'workspace' });
	const controller = new CartMapController(sources.catalog), chrome = inputFocus.createTarget();
	const unbindKeyboard = chrome.bindKeyboard(() => {});
	const open = t.mock.method(controller, 'openResource');
	t.after(() => {
		picker.dispose(); menu.dispose(); destination.dispose(); unbindKeyboard();
		editorTextModelService.clear(); inputFocus.setTarget(null);
	});
	chrome.focus();
	controller.open(destination, picker);
	assert.equal(picker.invocationOrigin, chrome);
	assert.equal(picker.model.items.length, 1);
	picker.model.list.selectionIndex = 0;
	let returned = 0;
	const unbindFocus = chrome.onDidFocus(() => { unbindFocus(); returned++; destination.dispose(); });
	t.after(unbindFocus);
	picker.accept();
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.equal(returned, 1);
	assert.equal(open.mock.callCount(), 0, 'retirement during focus return revokes the selected map callback');
	assert.equal(destination.panes.activePane, null);
	assert.equal(destination.model.tabs.length, 0);
	assert.equal(picker.visible, false);
});

test('map source locations retain the canonical model and refreshed tracked member', t => {
	const sources = createScenarioTestSourceState([]);
	const resource = { contextLabel: 'Fixture project', sourceFilePath: 'res/data/nemesis_s_stage.yaml', location: { kind: 'workspace' as const, path: 'res/data/nemesis_s_stage.yaml' },
		contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'res/data/nemesis_s_stage.yaml', source: { resid: 'stage', type: 'data' } } as const;
	const model = editorTextModelService.retain(resource, 'yaml', 'map_rows: ["m m "]\n');
	const input = new CartMapInput(model, 'nemesis'), controller = new CartMapController(sources.catalog);
	t.after(() => { input.dispose(); editorTextModelService.clear(); });
	controller.getSourceLocation(input);
	selectCartMapRow(input, 2);
	const before = controller.getSourceLocation(input);
	assert.ok(before.model === model);
	assert.equal(before.modelVersion, model.version);
	const offset = input.selectionRange.start;
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '# authored prefix\n' }]);
	const after = controller.getSourceLocation(input), position = { row: 0, column: 0 };
	model.buffer.positionAt(offset + '# authored prefix\n'.length, position);
	assert.ok(after.model === model);
	assert.equal(after.modelVersion, model.version);
	assert.deepEqual(after.selection, { row: position.row, startColumn: position.column, endColumn: position.column },
		'source coordinates are the selected authored range, not stale projection coordinates');
});
