import assert from 'node:assert/strict';
import test from 'node:test';
import type { StudioBuildJob } from '../../hosts/common/studio_builds';
import { HeadlessClipboard } from '../../hosts/node/headless/clipboard';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { inputFocus } from '../../ide/input/focus';
import { api } from '../../ide/runtime/overlay_api';
import { mainWorkspaceActivityHeaderHeight } from '../../ide/workbench/common/main_workspace_activity';
import { BuildLogControl } from '../../ide/workbench/contrib/builds/control';
import { BuildOutputs } from '../../ide/workbench/contrib/builds/output';
import { BuildLogViewModel } from '../../ide/workbench/contrib/builds/view_model';
import type { WorkspaceBuilds } from '../../ide/workbench/services/builds';
import { ContextMenuController } from '../../ide/workbench/services/context_menu/controller';
import { WorkbenchSurfaceService } from '../../ide/workbench/services/windows/service';
import { pointerCapture } from '../../ide/input/pointer/capture';

for (const variant of ['tiny', 'msx'] as const) for (const allocation of ['document', 'activity'] as const) {
	test(`${variant} build reader fits toolbar glyphs and centers its heading within the ${allocation} header allocation`, t => {
		configureFontVariant(variant);
		const font = editorViewState.font, bounds = { left: 17, top: 23, right: 1041, bottom: 223 };
		const header = allocation === 'activity'
			? { left: bounds.left + 90, top: bounds.top, right: bounds.right - 20,
				bottom: bounds.top + mainWorkspaceActivityHeaderHeight(font) }
			: undefined;
		const job: StudioBuildJob = { request: { requestId: 'header-typography', target: 'fixture', debug: true, optLevel: 0 },
			state: 'failed', phase: 'compile', acceptedAt: 0, updatedAt: 1, version: { generation: 1, sequence: 1 }, error: 'diagnostic' };
		const builds: WorkspaceBuilds = { jobs: [job], pending: [], get: async () => job, log: async () => '', targets: async () => [],
			submit: async () => assert.fail('layout does not admit builds'), cancel: async () => assert.fail('layout does not cancel builds'),
			forget: () => assert.fail('layout does not discard receipts') };
		const outputs = new BuildOutputs(builds), view = new BuildLogViewModel(outputs.get(job));
		const surfaces = new WorkbenchSurfaceService(), menu = new ContextMenuController(inputFocus, pointerCapture, bounds);
		const owner = surfaces.attach({ role: 'content', captureScope: Symbol('header layout owner'), getBounds: () => bounds,
			getClip: () => bounds, isVisible: () => true, draw() {} });
		const control = new BuildLogControl(new HeadlessClipboard(), menu, surfaces, owner, bounds, inputFocus.workbenchScope);
		t.after(() => { control.dispose(); view.dispose(); outputs.dispose(); menu.dispose(); surfaces.dispose(); });
		control.attach(view, bounds, header);
		const row = header === undefined ? { ...bounds, bottom: view.document.viewport.bounds.top } : header;
		const items = view.actions.items.filter(item => item.visible && !item.overflowed);
		assert.ok(items.some(item => item.icon === undefined || item.showLabel));
		// Typography is the layout contract: border-inset text ink must fit its actual row, not be cropped by its toolbar clip.
		for (const item of items) {
			assert.ok(item.bounds.top >= row.top && item.bounds.bottom <= row.bottom);
			assert.ok(item.bounds.bottom - item.bounds.top >= font.lineHeight + 2);
			if (item.icon === undefined || item.showLabel) assert.ok(item.bounds.top + 1 + font.lineHeight <= item.bounds.bottom - 1);
		}
		if (header !== undefined) assert.equal(view.document.viewport.bounds.top, header.bottom, 'the supplied header owns the sole row above the body');
		const headings: Parameters<typeof api.blit_text_inline_with_font>[] = [];
		for (const method of ['fill_rect', 'blit_rect', 'pushClipRect', 'popClipRect', 'blit_text_inline_span_with_font'] as const)
			t.mock.method(api, method, () => {});
		t.mock.method(api, 'blit_text_inline_with_font', (...args: Parameters<typeof api.blit_text_inline_with_font>) => { headings.push(args); });
		control.draw();
		assert.equal(headings.length, 1);
		const headingTop = headings[0][2], headingHeight = headings[0][5].lineHeight;
		assert.ok(headingTop >= row.top && headingTop + headingHeight <= row.bottom);
		assert.ok(Math.abs((headingTop - row.top) - (row.bottom - headingTop - headingHeight)) <= 1,
			'the heading is vertically centered using the allocated height and the actual font');
	});
}
