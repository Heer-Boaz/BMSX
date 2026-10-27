import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { FrameBitmap } from '../../hosts/common/frame_bitmap';
import { point_in_rect, type RectBounds } from '../../machine/ts/common/rect';
import type { FontVariant } from '../../machine/ts/render/shared/bmsx_font';
import * as colors from '../../ide/common/constants';
import { editorFeedbackState, showEditorMessage, updateEditorMessage } from '../../ide/common/feedback_state';
import { SYSTEM_RESOURCE_DOMAIN } from '../../ide/common/resource';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { inputFocus, InputFocusScope } from '../../ide/input/focus';
import { RuntimeTransport } from '../../ide/runtime/transport';
import { RuntimeFrameNavigation } from '../../ide/runtime/frame_navigation';
import { createRuntimeDebuggerState } from '../../ide/runtime/debugger_state';
import { createRuntimeFaultState } from '../../ide/runtime/fault_state';
import { LuaEvaluation, RuntimeLuaEvaluation } from '../../ide/runtime/lua_evaluation';
import { api } from '../../ide/runtime/overlay_api';
import { SuspendedGuestSession } from '../../ide/runtime/suspended_guest';
import {
	getStatusMessageLines, getWorkbenchConnectionBounds, getWorkbenchStatusBounds, getWorkbenchStatusLayout,
	getWorkbenchWorkArea, HOST_FAILURE_STATUS, refreshWorkbenchLayout, STATUS_BAR_CONNECTION_WIDTH,
} from '../../ide/workbench/common/layout';
import { GameInputControl } from '../../ide/workbench/contrib/game_view/game_input';
import { renderStatusBar } from '../../ide/workbench/render/status_bar';
import type { StudioServerConnectionState } from '../../ide/workbench/common/server_connection';
import { WorkbenchSurfaceService } from '../../ide/workbench/services/windows/service';
import { createHostFrameFixture } from '../helpers/host_frame';
import { createHostOverlayFixture } from '../helpers/host_overlay';
import { createTestRuntimeSourceState } from '../helpers/runtime_sources';

function fixture(t: TestContext, variant: FontVariant, width = 384) {
	const host = createHostFrameFixture();
	configureFontVariant(variant);
	editorViewState.viewportWidth = width; editorViewState.viewportHeight = 288;
	editorFeedbackState.message.visible = false;
	const previousTheme = colors.getActiveIdeThemeVariant();
	const overlay = createHostOverlayFixture(width, 288), fault = createRuntimeFaultState();
	const sources = createTestRuntimeSourceState({ records: [], path2lua: {}, module2lua: {}, entrySourcePath: '',
		projectRootPath: '', can_boot_from_source: false, revision: 0 }, [null, null], SYSTEM_RESOURCE_DOMAIN);
	const debuggerState = createRuntimeDebuggerState(host.runtime, sources);
	const suspended = new SuspendedGuestSession(host.runtime);
	const navigation = new RuntimeFrameNavigation(host.runtime, host.execution, host.rewind, host.tasks, debuggerState, fault, suspended);
	t.after(() => navigation.dispose());
	const transport = new RuntimeTransport(host.runtime, host.execution, host.rewind, navigation, () => true);
	const evaluation = new RuntimeLuaEvaluation(host.runtime, sources, suspended,
		debuggerState, fault, host.tasks, host.execution, host.rewind);
	const bounds = { left: 0, top: 24, right: width, bottom: 274 }, surfaces = new WorkbenchSurfaceService();
	const scope = new InputFocusScope(Symbol('status guest'));
	let visible = true;
	const surface = surfaces.attach({ role: 'content', captureScope: scope.surfaceScope,
		getBounds: () => bounds, getClip: () => bounds, isVisible: () => visible, draw() {} });
	const parent = inputFocus.createTarget(null, scope); parent.bindKeyboard(() => {});
	const frames = new FrameBitmap(); frames.publish(new Uint8Array(4), 1, 1, { presentationSequence: 0, cycles: 0, videoTick: 0 });
	const guest = new GameInputControl(parent, host.input, { kind: 'offscreen', frames }, transport); guest.setInput(bounds);
	const unbind = inputFocus.bindScopeAdmission(focusScope => {
		const attached = surfaces.findByScope(focusScope.surfaceScope);
		return attached !== undefined && surfaces.isAdmitted(attached);
	});
	const resourceState = { visible: false, mode: 'resources' as 'resources' | 'command', filter: 'all' as 'all' | 'lua_only' };
	const resources: Parameters<typeof renderStatusBar>[0] = {
		focusTarget: inputFocus.createTarget(parent),
		isVisible: () => resourceState.visible, getMode: () => resourceState.mode, getFilterMode: () => resourceState.filter,
	};
	const glyphs: Array<{ text: string; x: number; y: number; color: number }> = [], clips: RectBounds[] = [];
	const markers: Array<{ x: number; y: number; color: number }> = [];
	const fills: Array<RectBounds & { color: number }> = [];
	const text = api.blit_text_inline_with_font.bind(api), clip = api.pushClipRect.bind(api), polyline = api.polyline.bind(api);
	const fill = api.fill_rect.bind(api);
	t.mock.method(api, 'blit_text_inline_with_font', (...args: Parameters<typeof api.blit_text_inline_with_font>) => {
		glyphs.push({ text: args[0], x: args[1], y: args[2], color: args[4] }); text(...args);
	});
	t.mock.method(api, 'pushClipRect', (...args: Parameters<typeof api.pushClipRect>) => {
		clips.push({ left: args[0], top: args[1], right: args[2], bottom: args[3] }); clip(...args);
	});
	t.mock.method(api, 'polyline', (...args: Parameters<typeof api.polyline>) => { markers.push({ x: args[1], y: args[2], color: args[5] }); polyline(...args); });
	t.mock.method(api, 'fill_rect', (...args: Parameters<typeof api.fill_rect>) => {
		fills.push({ left: args[0], top: args[1], right: args[2], bottom: args[3], color: args[5] }); fill(...args);
	});
	const paint = (connection: StudioServerConnectionState = 'connected') => {
		glyphs.length = clips.length = markers.length = fills.length = 0; refreshWorkbenchLayout();
		overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer);
		const target = inputFocus.target;
		renderStatusBar(resources, fault, null, evaluation, connection, target === null ? null : target.commandContext);
		overlay.renderer.endFrame(); overlay.queue.consumeOverlayFrame();
	};
	parent.focus(); refreshWorkbenchLayout();
	t.after(async () => {
		inputFocus.setTarget(null); guest.dispose(); surface.dispose(); unbind(); frames.dispose();
		evaluation.active = undefined; await evaluation.shutdown(); host.audio.dispose(); host.input.dispose();
		editorFeedbackState.message.visible = false; colors.setIdeThemeVariant(previousTheme); refreshWorkbenchLayout();
	});
	return { host, fault, evaluation, debuggerState, bounds, surfaces, surface, parent, frames, guest, resourceState,
		paint, glyphs, clips, markers, fills, hideSurface() { visible = false; surfaces.changed(); }, showSurface() { visible = true; surfaces.changed(); } };
}

for (const variant of ['tiny', 'msx'] as const) {
	test(`${variant} guest guidance shares the existing bottom row without changing full status or connection hit bounds`, t => {
		fixture(t, variant);
		const retained = getWorkbenchStatusLayout(false, false), areas = [retained.bounds, retained.message, retained.context,
			retained.hostFault, retained.guestHint, retained.connection];
		for (const width of [384, 256]) for (const hostFailed of [false, true]) {
			editorViewState.viewportWidth = width; refreshWorkbenchLayout();
			const full = getWorkbenchStatusBounds(), areaBottom = getWorkbenchWorkArea().bottom;
			const layout = getWorkbenchStatusLayout(true, hostFailed);
			assert.equal(layout, retained); assert.equal(layout.bounds, full);
			for (const [index, area] of [layout.bounds, layout.message, layout.context, layout.hostFault, layout.guestHint, layout.connection].entries())
				assert.equal(area, areas[index], 'each slot remains the same borrowed rectangle, not an equal replacement');
			assert.equal(layout.connection, getWorkbenchConnectionBounds());
			assert.deepEqual(layout.connection, { left: 0, top: 288 - editorViewState.baseBottomMargin, right: 14, bottom: 288 });
			assert.equal(layout.bounds.left, STATUS_BAR_CONNECTION_WIDTH); assert.equal(layout.bounds.right, width);
			assert.equal(layout.message.top, layout.message.bottom, 'without feedback no extra message row is allocated');
			assert.equal(layout.context.top, layout.connection.top); assert.equal(layout.context.bottom, 288);
			assert.equal(layout.hostFault.right - layout.hostFault.left,
				hostFailed ? editorViewState.font.measure(HOST_FAILURE_STATUS) + 8 : 0);
			assert.equal(layout.context.left, layout.hostFault.right); assert.equal(layout.context.right, layout.guestHint.left);
			assert.equal(layout.guestHint.right, width);
			assert.equal(layout.guestHintText, variant === 'msx' && width === 256 && hostFailed ? 'SHIFT+F1: STUDIO' : 'SHIFT+F1: RELEASE INPUT');
			assert.equal(layout.guestHint.right - layout.guestHint.left, editorViewState.font.measure(layout.guestHintText) + 8);
			assert.ok(layout.context.right - layout.context.left >= editorViewState.charAdvance * 8 + 8);
			assert.equal(getWorkbenchWorkArea().bottom, areaBottom, 'guidance has no independent body-height tax');
			const plain = getWorkbenchStatusLayout(false, hostFailed);
			assert.equal(plain.guestHintText, ''); assert.equal(plain.guestHint.left, plain.guestHint.right);
			assert.equal(plain.context.right, width);
		}
	});

	test(`${variant} narrow guidance uses only complete captions and never creates a negative context`, t => {
		fixture(t, variant);
		for (const width of [170, 118, 78, 35]) for (const hostFailed of [false, true]) {
			editorViewState.viewportWidth = width;
			const layout = getWorkbenchStatusLayout(true, hostFailed);
			assert.ok(['SHIFT+F1: RELEASE INPUT', 'SHIFT+F1: STUDIO', 'SHIFT+F1', ''].includes(layout.guestHintText));
			assert.ok(layout.context.left <= layout.context.right && layout.context.right <= width);
			assert.ok(layout.hostFault.right <= width); assert.ok(layout.guestHint.left >= layout.context.left);
			if (layout.guestHintText !== '') assert.equal(layout.guestHint.right - layout.guestHint.left,
				editorViewState.font.measure(layout.guestHintText) + 8, 'no partial or ellipsized release chord');
			if (width === 35) assert.equal(layout.guestHintText, '', 'an incomplete chord is not advertised');
		}
	});

	test(`${variant} wrapped feedback owns separate full-width rows while the connection stays on its real click row`, t => {
		fixture(t, variant, 256);
		const connection = getWorkbenchConnectionBounds();
		const connectionTop = connection.top;
		showEditorMessage('AUTHORED FEEDBACK HAS ENOUGH WORDS TO WRAP ACROSS THE STATUS WIDTH\r\nSECOND LINE', 'warning', 1);
		refreshWorkbenchLayout();
		const lines = getStatusMessageLines(), layout = getWorkbenchStatusLayout(true, true);
		assert.ok(lines.length > 1); assert.equal(layout.connection, connection); assert.equal(connection.top, connectionTop);
		assert.equal(layout.message.left, STATUS_BAR_CONNECTION_WIDTH); assert.equal(layout.message.right, 256);
		assert.equal(layout.message.bottom, connection.top);
		assert.equal(layout.message.bottom - layout.message.top, lines.length * editorViewState.lineHeight + 4);
		for (const line of lines) assert.ok(editorViewState.font.measure(line) <= layout.message.right - layout.message.left - 8);
		assert.equal(point_in_rect(3, connection.top + 3, connection), true);
		assert.equal(point_in_rect(3, layout.message.top + 3, connection), false, 'feedback gutter is not the server connection button');
		const top = layout.bounds.top; getWorkbenchStatusLayout(false, false); assert.equal(layout.bounds.top, top);
		updateEditorMessage(1); refreshWorkbenchLayout();
		assert.deepEqual(getStatusMessageLines(), []); assert.equal(getWorkbenchStatusLayout(true, true).bounds.top, connectionTop);
	});

	test(`${variant} status layout caches measured captions and wrapped feedback across 1000 idle queries`, t => {
		fixture(t, variant, 256);
		showEditorMessage('A RETAINED FEEDBACK DOCUMENT WRAPS WITHOUT REPEATED GLYPH MEASUREMENTS.', 'info', 4);
		refreshWorkbenchLayout();
		const layout = getWorkbenchStatusLayout(true, true), lines = getStatusMessageLines();
		const font = editorViewState.font, bitmap = font.renderFont();
		const advance = t.mock.method(font, 'advance'), measure = t.mock.method(font, 'measure');
		const bitmapAdvance = t.mock.method(bitmap, 'advance'), bitmapMeasure = t.mock.method(bitmap, 'measure');
		for (let frame = 0; frame < 1000; frame++) {
			assert.equal(getWorkbenchStatusLayout(true, true), layout);
			assert.equal(getStatusMessageLines(), lines);
		}
		assert.equal(advance.mock.callCount(), 0); assert.equal(measure.mock.callCount(), 0);
		assert.equal(bitmapAdvance.mock.callCount(), 0); assert.equal(bitmapMeasure.mock.callCount(), 0);
	});

	for (const theme of ['light', 'dark']) test(`${variant}/${theme} actual status paint keeps feedback, host failure and guest guidance in independent strips`, t => {
		const f = fixture(t, variant, 256); colors.setIdeThemeVariant(theme);
		f.guest.focusTarget.focus(); f.resourceState.visible = true;
		showEditorMessage('FEEDBACK REMAINS VISIBLE WHILE A LUA CALL IS RUNNING.', 'warning', 4);
		f.evaluation.active = new LuaEvaluation('return 1', 'cart', 1, 0);
		f.paint();
		let layout = getWorkbenchStatusLayout(true, false);
		for (const line of getStatusMessageLines()) {
			const glyph = f.glyphs.find(item => item.text === line)!;
			assert.ok(glyph); assert.equal(glyph.x, layout.message.left + 4); assert.ok(glyph.y < layout.context.top);
			assert.equal(glyph.color, colors.STATUS_MESSAGE_TEXT_COLORS.warning);
		}
		assert.ok(f.glyphs.some(item => item.text === 'LUA CALL RUNNING' && item.y === layout.context.top + 2));
		assert.ok(f.glyphs.some(item => item.text === layout.guestHintText && item.x === layout.guestHint.left + 4));
		assert.ok(!f.glyphs.some(item => item.text.startsWith('FILES ')), 'evaluation owns the normal context, not feedback');
		f.fault.hostFrameFailure = 'ACTUAL HOST FAILURE STATE'; f.paint();
		layout = getWorkbenchStatusLayout(true, true);
		const prefix = f.glyphs.find(item => item.text === HOST_FAILURE_STATUS)!;
		assert.ok(prefix); assert.equal(prefix.x, layout.hostFault.left + 4); assert.equal(prefix.y, layout.hostFault.top + 2);
		assert.equal(prefix.color, colors.STATUS_MESSAGE_TEXT_COLORS.error);
		assert.ok(f.glyphs.some(item => item.text === layout.guestHintText));
		assert.ok(!f.glyphs.some(item => item.text === 'LUA CALL RUNNING'), 'a host fault supersedes the evaluation caption');
		assert.ok(!f.glyphs.some(item => item.text === 'CTRL+SHIFT+L TOGGLE FILTER'), 'Files cannot overlap the reserved guest guidance');
		assert.ok(f.clips.some(bounds => bounds.left === layout.context.left && bounds.right === layout.context.right));
		assert.ok(f.clips.some(bounds => bounds.left === layout.guestHint.left && bounds.top === layout.guestHint.top));
			const accent = f.fills.find(area => area.color === colors.COLOR_STATUS_FAULT_MARKER)!;
			assert.ok(accent); assert.equal(accent.left, 0); assert.equal(accent.right, 256);
			assert.equal(accent.top, layout.bounds.top);
			assert.ok(accent.bottom > accent.top && accent.bottom <= layout.message.bottom, 'the real fault accent stays inside the status surface');
		assert.deepEqual(f.markers, [{ x: 3, y: layout.connection.top + 3, color: colors.COLOR_SERVER_CONNECTED }]);
	});

	test(`${variant} only the actual admitted guest target paints release guidance through modal, hidden and detached states`, t => {
		const f = fixture(t, variant);
		const hasHint = () => f.glyphs.some(glyph => glyph.text.startsWith('SHIFT+F1'));
		f.guest.focusTarget.focus(); f.paint(); assert.equal(hasHint(), true);
		const modal = f.surfaces.attach({ role: 'modal', blockedScope: null, captureScope: Symbol('status modal'),
			getBounds: () => f.bounds, getClip: () => f.bounds, isVisible: () => true, draw() {} });
		assert.equal(inputFocus.target, f.guest.focusTarget); assert.equal(inputFocus.admittedTarget, null);
		f.paint(); assert.equal(hasHint(), false, 'retained focus does not bypass the real modal boundary');
		modal.dispose(); f.paint(); assert.equal(hasHint(), true);
		f.hideSurface(); f.paint(); assert.equal(hasHint(), false);
		f.showSurface(); f.paint(); assert.equal(hasHint(), true);
		const editor = inputFocus.createTarget(f.guest.focusTarget); editor.bindKeyboard(() => {});
		editor.commandContext = f.guest.focusTarget; editor.focus();
		f.paint(); assert.equal(hasHint(), false, 'scope ancestry and commandContext aliases are not guest-input ownership');
		f.guest.focusTarget.focus(); f.guest.clearInput(); f.paint(); assert.equal(hasHint(), false);
		f.guest.setInput(f.bounds); f.guest.focusTarget.focus(); f.paint(); assert.equal(hasHint(), true);
		f.surface.dispose(); assert.equal(inputFocus.target, f.guest.focusTarget);
		f.paint(); assert.equal(hasHint(), false, 'detached surface membership cannot keep an admitted guest caption');
	});
}
