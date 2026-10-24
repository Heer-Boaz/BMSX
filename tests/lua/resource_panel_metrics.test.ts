import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import type { CartEditor } from '../../ide/cart_editor';
import { CallHierarchyModel } from '../../ide/editor/contrib/call_hierarchy/model';
import { configureFontVariant } from '../../ide/editor/ui/view/view';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { inputFocus } from '../../ide/input/focus';
import { refreshWorkbenchLayout } from '../../ide/workbench/common/layout';
import { ResourcePanelController } from '../../ide/workbench/contrib/resources/panel/controller';
import { Scrollbar } from '../../ide/workbench/ui/scrollbar';
import type { FontVariant } from '../../machine/ts/render/shared/bmsx_font';
import { buildLuaSemanticFrontend } from '../../toolchain/ts/lua/semantic/frontend';
import { createTestEditorPanes } from '../helpers/editor_panes';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from '../helpers/scenario_sources';

// The contract under test is the font-dependent measurement cache, not UI wording or pixel placement.
function fixture(t: TestContext, variant: FontVariant) {
	const clock = new VirtualHeadlessClock(); configureFontVariant(clock, variant, null);
	editorViewState.viewportWidth = 384; editorViewState.viewportHeight = 288; refreshWorkbenchLayout();
	const path = `deep/tree/${'wide_name_'.repeat(12)}.lua`;
	const sources = createScenarioTestSourceState([createScenarioTestSourceRecord(path, 1), createScenarioTestSourceRecord('short.lua', 1)]);
	const panes = createTestEditorPanes(), editor = { editorPanes: panes } as CartEditor;
	const panel = new ResourcePanelController(editor, sources, { resourceVertical: new Scrollbar('vertical'), resourceHorizontal: new Scrollbar('horizontal') }, 0.35);
	panel.setFontMetrics(editorViewState.font); panel.show();
	const index = panel.items.findIndex(item => item.resource?.path === path); assert.ok(index >= 0);
	const publish = (next: FontVariant) => {
		configureFontVariant(clock, next, null);
		panel.setFontMetrics(editorViewState.font); refreshWorkbenchLayout();
	};
	t.after(() => { panel.hide(); panes.dispose(); inputFocus.setTarget(null); });
	return { panel, index, publish, clock };
}

for (const first of ['tiny', 'msx'] as const) {
	test(`${first} resource metrics and horizontal extent consume a changed font without rebuilding the item catalog`, t => {
		const f = fixture(t, first), catalog = f.panel.items, resource = catalog[f.index].resource;
		f.panel.setSelectionIndex(f.index);
		const metric = f.panel.getItemMetrics(f.index), previous = [metric.indentWidth, metric.contentWidth];
		f.publish(first === 'tiny' ? 'msx' : 'tiny');
		const next = f.panel.getItemMetrics(f.index), item = catalog[f.index], font = editorViewState.font;
		assert.equal(next, metric, 'retain the existing metric slot');
		assert.deepEqual([next.indentWidth, next.contentWidth], [font.measure(item.line.slice(0, item.contentStartColumn)), font.measure(item.line.slice(item.contentStartColumn))]);
		assert.notDeepEqual([next.indentWidth, next.contentWidth], previous);
		const maximum = Math.max(...catalog.map(row => font.measure(row.line)));
		assert.equal(f.panel.maxLineWidth, maximum);
		const layout = f.panel.prepareLayout();
		assert.equal(layout.maxHorizontalScroll, Math.max(0, maximum - (layout.contentRight - layout.contentLeft)));
		assert.equal(f.panel.items, catalog); assert.equal(f.panel.selectionIndex, f.index);
		assert.equal(f.panel.items[f.index].resource, resource);
	});
}

test('same-variant publication and warmed metric reads reuse measurements and slots', t => {
	const f = fixture(t, 'tiny'), slots = f.panel.items.map((_, index) => f.panel.getItemMetrics(index));
	const maximum = f.panel.maxLineWidth;
	configureFontVariant(f.clock, 'tiny', null);
	const font = editorViewState.font, advance = font.advance; let measurements = 0;
	font.advance = character => { measurements++; return advance.call(font, character); };
	t.after(() => { font.advance = advance; });
	f.panel.setFontMetrics(font);
	for (let frame = 0; frame < 1000; frame++) for (let index = 0; index < slots.length; index++)
		assert.equal(f.panel.getItemMetrics(index), slots[index]);
	assert.equal(measurements, 0); assert.equal(f.panel.maxLineWidth, maximum);
});

test('call hierarchy disclosure hit ranges consume the same published font as row measurements', t => {
	const f = fixture(t, 'tiny');
	const frontend = buildLuaSemanticFrontend([{ path: 'calls.lua', source: 'local function target() end\nlocal function caller() target() end' }]);
	const target = frontend.findSymbolsByPosition('calls.lua', 1, 16)!;
	f.panel.showCallHierarchy(new CallHierarchyModel(frontend, [target.targets[0].id], 'target'));
	const index = f.panel.items.findIndex(item => item.callHierarchyExpandable); assert.ok(index >= 0);
	const metric = f.panel.getItemMetrics(index);
	f.publish('msx');
	const item = f.panel.items[index], next = f.panel.getItemMetrics(index), font = editorViewState.font;
	const start = font.measure(item.line.slice(0, item.contentStartColumn - 2)), end = font.measure(item.line.slice(0, item.contentStartColumn));
	assert.equal(next, metric); assert.equal(next.markerStartWidth, start); assert.equal(next.markerEndWidth, end);
	const origin = f.panel.prepareLayout().contentLeft - f.panel.hscroll;
	assert.equal(f.panel.isCallHierarchyMarkerHit(index, origin + (start + end) / 2), true);
	assert.equal(f.panel.isCallHierarchyMarkerHit(index, origin + end), false);
});
