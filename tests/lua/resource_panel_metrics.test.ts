import { SceneSourceDocuments } from '../../ide/workbench/contrib/scene_editor/source_documents';
import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import type { CartEditor } from '../../ide/cart_editor';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { inputFocus } from '../../ide/input/focus';
import { refreshWorkbenchLayout } from '../../ide/workbench/common/layout';
import { ResourcePanelController } from '../../ide/workbench/contrib/resources/panel/controller';
import { ProjectContentIndex } from '../../ide/workbench/contrib/resources/panel/content_index';
import { BehaviorRegistrationIndex } from '../../ide/workbench/contrib/behavior_lens/registration_index';
import { WORKBENCH_ICON_SIZE } from '../../ide/workbench/ui/icon';
import { Scrollbar } from '../../ide/workbench/ui/scrollbar';
import type { FontVariant } from '../../machine/ts/render/shared/bmsx_font';
import { createTestEditorParts } from '../helpers/editor_panes';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from '../helpers/scenario_sources';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';

// The contract under test is the font-dependent measurement cache, not UI wording or pixel placement.
function fixture(t: TestContext, variant: FontVariant) {
	configureFontVariant(variant);
	editorViewState.viewportWidth = 384; editorViewState.viewportHeight = 288; refreshWorkbenchLayout();
	const path = `deep/tree/${'wide_name_'.repeat(12)}.lua`;
	const sources = createScenarioTestSourceState([createScenarioTestSourceRecord(path, 1), createScenarioTestSourceRecord('short.lua', 1)]);
	const parts = createTestEditorParts(t), editor = { editorParts: parts, isActive: true } as CartEditor;
	const panel = new ResourcePanelController(editor, sources.catalog, { resourceVertical: new Scrollbar('vertical'), resourceHorizontal: new Scrollbar('horizontal') }, 0.35,
		new ProjectContentIndex(editorTextModelService, sources.catalog, new BehaviorRegistrationIndex(editorTextModelService, sources.catalog), new SceneSourceDocuments(editorTextModelService, sources.catalog)), new VirtualHeadlessClock());
	panel.setFontMetrics(editorViewState.font); panel.queuePendingSelection({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path }); panel.show();
	const index = panel.files.tree.rows.findIndex(node => node.element.kind === 'file' && node.element.resource.path === path); assert.ok(index >= 0);
	const publish = (next: FontVariant) => {
		configureFontVariant(next);
		panel.setFontMetrics(editorViewState.font); refreshWorkbenchLayout();
	};
	t.after(() => { panel.dispose(); inputFocus.setTarget(null); });
	return { panel, index, publish };
}

for (const first of ['tiny', 'msx'] as const) {
	test(`${first} resource metrics and horizontal extent consume a changed font without rebuilding the item catalog`, t => {
		const f = fixture(t, first), catalog = f.panel.files.tree.rows, element = catalog[f.index].element;
		assert.ok(element.kind === 'file'); const resource = element.resource;
		f.panel.setSelectionIndex(f.index);
		const metric = f.panel.getItemMetrics(f.index), previous = [metric.indentWidth, metric.contentWidth];
		f.publish(first === 'tiny' ? 'msx' : 'tiny');
		const next = f.panel.getItemMetrics(f.index), item = catalog[f.index].element, font = editorViewState.font;
		assert.equal(next, metric, 'retain the existing metric slot');
		const indentWidth = Math.max(font.advance(' ') * 2, WORKBENCH_ICON_SIZE + 2);
		assert.deepEqual([next.indentWidth, next.contentWidth], [(catalog[f.index].depth + 1) * indentWidth, font.measure(item.label)]);
		assert.notDeepEqual([next.indentWidth, next.contentWidth], previous);
		const maximum = Math.max(...catalog.map(row => (row.depth + 1) * indentWidth + font.measure(row.element.label)));
		assert.equal(f.panel.maxLineWidth, maximum);
		const layout = f.panel.prepareLayout();
		assert.equal(layout.maxHorizontalScroll, Math.max(0, maximum - (layout.contentRight - layout.contentLeft)));
		assert.equal(f.panel.files.tree.rows, catalog); assert.equal(f.panel.selectionIndex, f.index);
		const current = f.panel.files.tree.rows[f.index].element; assert.ok(current.kind === 'file');
		assert.equal(current.resource, resource);
	});
}

for (const variant of ['tiny', 'msx'] as const) test(`${variant} Files disclosure has a full icon lane and uses its horizontally projected marker bounds`, t => {
	const f = fixture(t, variant), panel = f.panel;
	const index = panel.files.tree.rows.findIndex(node => node.element.kind === 'directory');
	const node = panel.files.tree.rows[index], metrics = panel.getItemMetrics(index);
	panel.prepareLayout();
	assert.ok(metrics.markerEndWidth - metrics.markerStartWidth >= WORKBENCH_ICON_SIZE + 2,
		'the displayed icon and its padding fit the actual disclosure lane');
	assert.equal(metrics.markerStartWidth, node.depth * panel.files.tree.layout.indentWidth);
	panel.setHScroll(panel.files.tree.layout.indentWidth / 2);
	assert.ok(panel.hscroll > 0);
	const origin = panel.prepareLayout().contentLeft - panel.hscroll;
	assert.equal(panel.isDisclosureHit(index, origin + (metrics.markerStartWidth + metrics.markerEndWidth) / 2), true);
	assert.equal(panel.isDisclosureHit(index, origin + metrics.markerEndWidth), false);
	assert.equal(panel.isDisclosureHit(index, origin + metrics.markerStartWidth - 1), false);
});

test('same-variant publication and warmed metric reads reuse measurements and slots', t => {
	const f = fixture(t, 'tiny'), slots = f.panel.files.tree.rows.map((_, index) => f.panel.getItemMetrics(index));
	const maximum = f.panel.maxLineWidth;
	configureFontVariant('tiny');
	const font = editorViewState.font, advance = font.advance; let measurements = 0;
	font.advance = character => { measurements++; return advance.call(font, character); };
	t.after(() => { font.advance = advance; });
	f.panel.setFontMetrics(font);
	for (let frame = 0; frame < 1000; frame++) for (let index = 0; index < slots.length; index++)
		assert.equal(f.panel.getItemMetrics(index), slots[index]);
	assert.equal(measurements, 0); assert.equal(f.panel.maxLineWidth, maximum);
});

for (const first of ['tiny', 'msx'] as const) {
	test(`${first} hidden Files measurements refresh on entry after a font change`, t => {
		const f = fixture(t, first), rows = f.panel.files.tree.rows, selected = f.panel.files.selectedNode;
		f.panel.hide();
		f.publish(first === 'tiny' ? 'msx' : 'tiny');
		f.panel.show(); f.panel.prepareLayout();
		assert.equal(f.panel.files.tree.rows, rows); assert.equal(f.panel.files.selectedNode, selected);
		const indentWidth = Math.max(editorViewState.font.advance(' ') * 2, WORKBENCH_ICON_SIZE + 2);
		assert.equal(f.panel.maxLineWidth, Math.max(...rows.map(node => (node.depth + 1) * indentWidth + editorViewState.font.measure(node.element.label))));
	});
}
