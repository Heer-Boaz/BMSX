import assert from 'node:assert/strict';
import test from 'node:test';
import type { RuntimeResource } from '../../ide/common/resource';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { createLuaSourceRegistry } from '../../ide/runtime/source_registry';
import { WorkspaceSourceCatalog } from '../../ide/workspace/source_catalog';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { captureCodeEditorView } from '../../ide/workbench/contrib/code_editor/view_snapshot';
import { CartMapInput, type CartMapKind } from '../../ide/workbench/contrib/cart_maps/editor_input';
import { projectCartMap, selectCartMapRow } from '../../ide/workbench/contrib/cart_maps/source_projection';
import { captureCartMapView } from '../../ide/workbench/contrib/cart_maps/view_snapshot';
import { AemEditorInput } from '../../ide/workbench/contrib/aem/editor_input';
import { projectAemSource } from '../../ide/workbench/contrib/aem/source';
import { ResourceViewerInput } from '../../ide/workbench/contrib/resources/editor_input';
import { captureWorkbenchTreeView, setWorkbenchTreeCollapsed } from '../../ide/workbench/ui/tree_view';
import { createTestToolingPackage, TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import { createTestEditorGroup } from '../helpers/editor_panes';

const RESOURCE = {
	contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], contextLabel: 'View fixture', sourceFilePath: 'view.lua', path: 'view.lua',
	location: { kind: 'workspace' as const, path: 'view.lua' }, source: { type: 'lua' as const, resid: 'view' },
};

test('fresh Source views share canonical history but independently retain plain reading state and bindings', t => {
	const source = Array.from({ length: 20 }, (_, row) => `local value_${row} = ${row}`).join('\n');
	const model = new EditorTextModel(RESOURCE, 'lua', source), input = new CodeEditorInput(model), group = createTestEditorGroup();
	t.after(() => { group.dispose(); input.dispose(); model.dispose(); });
	input.initializeViewState();
	Object.assign(input.context.view, { cursorRow: 7, cursorColumn: 6, selectionAnchor: { row: 3, column: 2 },
		scrollRow: 2.5, scrollLeft: 17.25, desiredColumn: 99, desiredDisplayOffset: 91 });
	input.context.runtimeErrorOverlay = { row: 7, column: 6, message: 'retained runtime fault', lines: [], messageLines: [],
		lineDescriptors: [], layout: null, details: null, expanded: true, hovered: true, hoverLine: 1, copyButtonHovered: true, hidden: false };
	input.context.executionStopRow = 7;
	const reading = captureCodeEditorView(input), copy = input.createView();
	group.openEditor(copy, { preserveFocus: true });
	assert.ok(copy !== input && copy.context !== input.context && copy.context.view !== input.context.view);
	assert.ok(copy.workingCopy === model && copy.resource === input.resource);
	assert.notEqual(copy.context.view.editSource, input.context.view.editSource);
	assert.ok(copy.context.view.selectionAnchor !== input.context.view.selectionAnchor);
	assert.deepEqual(captureCodeEditorView(copy), reading);
	assert.equal(copy.context.runtimeErrorOverlay, null); assert.equal(copy.context.executionStopRow, null);
	assert.equal(copy.context.view.desiredDisplayOffset, 0);
	copy.initializeViewState({ cursor: 0, anchor: null, scrollRow: 0, scrollLeft: 0 });
	assert.deepEqual(captureCodeEditorView(copy), reading, 'a fresh view is initialized before a destination can supply an old group memento');
	copy.context.view.cursorRow = 11; copy.context.view.scrollLeft = 29;
	assert.equal(input.context.view.cursorRow, 7); assert.equal(input.context.view.scrollLeft, 17.25);
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- shared\n' }]);
	assert.equal(input.context.view.cursorRow, 8); assert.equal(copy.context.view.cursorRow, 12);
	assert.equal(input.isDirty(), true); assert.equal(copy.isDirty(), true);
	model.undo(); assert.equal(model.buffer.getText(), source);
	assert.equal(input.context.view.cursorRow, 7); assert.equal(copy.context.view.cursorRow, 11);
	group.removeEditor(copy);
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- still attached\n' }]);
	assert.equal(input.context.view.cursorRow, 8); assert.equal(copy.context.view.cursorRow, 11, 'closing one view retires only its own model binding');
});

const MAPS: readonly { readonly kind: CartMapKind; readonly path: string; readonly source: string }[] = [
	{ kind: 'pietious', path: 'res/data/castle_map.yaml', source: "2:\n  map: ['....', '....']\n  objects:\n  - { type: rock, x: 1, y: 0 }\n  - { type: wall, x: 2, y: 1 }\n7:\n  map: ['..']\n" },
	{ kind: 'nemesis', path: 'res/data/nemesis_s_stage.yaml', source: "map_rows: ['m .m', '....']\n" },
];

for (const { kind, path, source } of MAPS) test(`fresh ${kind} Map views copy typed selection and viewport without sharing projection state`, t => {
	const resource: RuntimeResource = { ...RESOURCE, path, sourceFilePath: path, location: { kind: 'workspace', path }, source: { type: 'data', resid: 'map' } };
	const model = new EditorTextModel(resource, 'yaml', source), input = new CartMapInput(model, kind);
	t.after(() => { input.dispose(); model.dispose(); });
	projectCartMap(input); selectCartMapRow(input, 1);
	assert.ok(input.selected !== undefined);
	input.section = 'map'; input.tree.scroll = 1.25;
	input.grid.restoreView({ x: 0.5, y: 1.25, reveal: { x: 2, y: 1 } });
	const view = captureCartMapView(input), copy = input.createView();
	t.after(() => copy.dispose());
	assert.ok(copy !== input && copy.workingCopy === model && copy.mapKind === kind);
	assert.notEqual(copy.editSource, input.editSource);
	assert.ok(copy.tree !== input.tree && copy.grid !== input.grid && copy.selectionRange !== input.selectionRange);
	assert.ok(copy.tree.roots[0] !== input.tree.roots[0] && copy.selected !== input.selected);
	assert.deepEqual(captureCartMapView(copy), view);
	selectCartMapRow(copy, -1); copy.section = 'outline'; copy.grid.restoreView({ x: 2.5, y: 0 });
	assert.ok(input.selected !== undefined); assert.equal(input.section, 'map');
	assert.deepEqual(input.grid.captureView(), view.grid);
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '# shared\n' }]);
	projectCartMap(input); projectCartMap(copy);
	assert.equal(input.version, model.version); assert.equal(copy.version, model.version);
	assert.equal(input.isDirty(), true); assert.equal(copy.isDirty(), true);
	model.undo(); assert.equal(model.buffer.getText(), source);
});

for (const format of ['yaml', 'json'] as const) test(`fresh AEM ${format} views share authored source but isolate tree and execution status`, t => {
	const path = `res/audio/events.aem.${format}`;
	const source = format === 'yaml'
		? '# authored map\nevents:\n  story:\n    channel: music\n    rules: []\n  impact:\n    channel: sfx\n    rules: []\n'
		: '{"events":{"story":{"channel":"music","rules":[]},"impact":{"channel":"sfx","rules":[]}}}\n';
	const resource: RuntimeResource = { ...RESOURCE, path, sourceFilePath: path, location: { kind: 'workspace', path }, source: { type: 'aem', resid: 'events' } };
	const model = new EditorTextModel(resource, 'aem', source), input = new AemEditorInput(model);
	t.after(() => { input.dispose(); model.dispose(); });
	projectAemSource(input);
	input.tree.selectionIndex = input.tree.rows.findIndex(row => row.element.key === '["events","story","channel"]');
	setWorkbenchTreeCollapsed(input.tree, input.tree.rows.findIndex(row => row.element.key === '["events","impact"]'), true);
	input.tree.scroll = 1.5; input.status = 'origin status'; input.applyStatus = 'origin installation'; input.applying = true;
	const view = captureWorkbenchTreeView(input.tree, element => element.key), copy = input.createView();
	t.after(() => copy.dispose());
	assert.ok(copy !== input && copy.workingCopy === model && copy.tree !== input.tree);
	assert.ok(copy.document !== input.document && copy.tree.roots[0] !== input.tree.roots[0]);
	assert.deepEqual(captureWorkbenchTreeView(copy.tree, element => element.key), view);
	assert.equal(copy.status, ''); assert.equal(copy.applyStatus, ''); assert.equal(copy.applying, false);
	copy.tree.scroll = 0; copy.tree.selectionIndex = 0;
	assert.deepEqual(captureWorkbenchTreeView(input.tree, element => element.key), view);
	const at = source.indexOf('music'); model.pushEditOperations([{ offset: at, deleteLength: 'music'.length, text: 'audiofx' }]);
	projectAemSource(input); projectAemSource(copy);
	assert.equal(input.source, copy.source); assert.equal(input.source, source.replace('music', 'audiofx'));
	assert.equal(input.isDirty(), true); assert.equal(copy.isDirty(), true);
	model.undo(); assert.equal(model.buffer.getText(), source);
});

test('fresh Resource views share catalog/resource identity with independent reading and lazy content projections', t => {
	const catalog = new WorkspaceSourceCatalog(), previewPackage = createTestToolingPackage('carts/view');
	const context = catalog.admitContext({ admission: { id: TEST_CARTRIDGE_CONTEXT_IDS[0], projectRoot: 'carts/view' },
		programDomain: 'cart', systemContextId: null, luaSources: createLuaSourceRegistry('carts/view', ''), sourceRoots: [],
		dependencyContextIds: [], previewPackage, previewRom: null,
		assetSources: [{ type: 'data', resid: 'numbers', source_path: 'res/data/numbers.json' }] });
	t.after(() => catalog.dispose());
	const resource = catalog.resolveResource({ contextId: context.id, path: 'res/data/numbers.json' })!;
	previewPackage.data.numbers = { revision: 'before', rows: Array.from({ length: 120 }, (_, index) => index) };
	const input = new ResourceViewerInput(catalog, resource); t.after(() => input.dispose());
	input.view.scroll = 4.5;
	const content = input.view.content;
	previewPackage.data.numbers = { revision: 'after', rows: Array.from({ length: 120 }, (_, index) => index) };
	const copy = input.createView(); t.after(() => copy.dispose());
	assert.ok(copy !== input && copy.resource === resource && copy.view !== input.view);
	assert.equal(copy.view.scroll, 4.5);
	assert.ok(copy.view.content !== content && input.view.content === content);
	assert.match(copy.view.content.lines.join('\n'), /after/); assert.match(content.lines.join('\n'), /before/);
	copy.view.scroll = 0; assert.equal(input.view.scroll, 4.5);
});
