import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const root = process.cwd();
const oldColorSnake = 'color' + '_word';
const oldPrioritySnake = 'priority' + '_word';
const streamFaultName = 'vdp' + 'Stream' + 'Fault';
const componentColorPackerName = 'packFrameBufferColor' + 'FromComponents';
const oldPaletteColorsName = 'sys' + '_palette' + '_colors';
const oldPaletteColorFnName = 'sys' + '_palette' + '_color';
const oldMachineIdePaletteName = 'Bmsx' + 'Colors';
const oldResolvePaletteIndexName = 'resolve' + 'Palette' + 'Index';
const oldInvertColorIndexName = 'invert' + 'Color' + 'Index';

function collectFiles(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		const stat = statSync(path);
		if (stat.isDirectory()) {
			collectFiles(path, out);
			continue;
		}
		if (stat.isFile()) {
			if (/\.(ts|tsx|js|mjs|cpp|cc|c|h|hpp|lua)$/.test(path)) {
				out.push(path);
			}
		}
	}
	return out;
}

function assertNoMatches(dirs: string[], patterns: readonly RegExp[]): void {
	const hits: string[] = [];
	for (const dir of dirs) {
		for (const file of collectFiles(join(root, dir))) {
			const text = readFileSync(file, 'utf8');
			for (const pattern of patterns) {
				if (pattern.test(text)) {
					hits.push(`${file.slice(root.length + 1)} matches ${pattern.source}`);
				}
			}
		}
	}
	assert.deepEqual(hits, []);
}

function assertNoMatchesOutsideVdpDevice(dirs: string[], patterns: readonly RegExp[]): void {
	const hits: string[] = [];
	for (const dir of dirs) {
		for (const file of collectFiles(join(root, dir))) {
			const relative = file.slice(root.length + 1);
			if (relative.includes('/machine/devices/vdp/')) {
				continue;
			}
			const text = readFileSync(file, 'utf8');
			for (const pattern of patterns) {
				if (pattern.test(text)) {
					hits.push(`${relative} matches ${pattern.source}`);
				}
			}
		}
	}
	assert.deepEqual(hits, []);
}

function assertFileDoesNotMatch(file: string, patterns: readonly RegExp[]): void {
	const text = readFileSync(join(root, file), 'utf8');
	const hits: string[] = [];
	for (const pattern of patterns) {
		if (pattern.test(text)) {
			hits.push(`${file} matches ${pattern.source}`);
		}
	}
	assert.deepEqual(hits, []);
}

test('only VDP device code calls private VDP ingress methods', () => {
	assertNoMatchesOutsideVdpDevice([
		'src/bmsx',
		'src/bmsx_cpp',
	], [
		/writeVdpRegister/,
		/consumeDirectVdpCommand/,
	]);
});

test('GameView does not route renderer submissions into VDP MMIO adapters', () => {
	assertFileDoesNotMatch('src/bmsx/render/gameview.ts', [
		/machine\/runtime\/vdp_submissions/,
		/vdpSubmissions/,
		/IO_VDP_REG_/,
		/IO_VDP_CMD/,
	]);
	assertFileDoesNotMatch('src/bmsx_cpp/render/gameview.cpp', [
		/machine\/runtime\/vdp_submissions/,
		/VdpSubmissions/,
		/IO_VDP_REG_/,
		/IO_VDP_CMD/,
	]);
});

test('old high-level VDP scene command ABI is gone', () => {
	assertNoMatches([
		'src/bmsx',
		'src/bmsx_cpp',
		'src/carts',
	], [
		/processVdpCommand/,
		/processVdpBufferedCommand/,
		/command_processor/,
		/packet_schema/,
		/IO_CMD_VDP_/,
		/sys_vdp_stream_packet_header_words/,
		/sys_vdp_stream_capacity_words/,
		/VDP_STREAM_PACKET_HEADER_WORDS/,
		/VDP_STREAM_PAYLOAD_CAPACITY_WORDS/,
		/sys_vdp_cmd_(clear|fill_rect|blit|draw_line|glyph_run|tile_run)/,
	]);
});

test('firmware palette API is removed and IDE colors are IDE-owned tokens', () => {
	assertNoMatches([
		'src/bmsx/machine',
		'src/bmsx/ide',
		'src/bmsx_cpp/machine',
		'src/bmsx/res/bios',
		'src/carts',
	], [
		new RegExp(oldPaletteColorsName),
		new RegExp(oldPaletteColorFnName),
		new RegExp(oldMachineIdePaletteName),
		new RegExp(oldResolvePaletteIndexName),
		new RegExp(oldInvertColorIndexName),
	]);
	assertNoMatches([
		'src/bmsx/machine/devices/vdp',
		'src/bmsx_cpp/machine/devices/vdp',
	], [
		/THEME_TOKEN_/,
	]);
	assertFileDoesNotMatch('src/bmsx/ide/theme/tokens.ts', [
		/MSX_COLOR_/,
		/BMSX_COLOR_/,
	]);
	const msxColors = readFileSync(join(root, 'src/bmsx/res/bios/msx_colors.lua'), 'utf8');
	assert.doesNotMatch(msxColors, /\{\s*\[/);
	assert.doesNotMatch(msxColors, /MSX_COLOR_/);
	assert.equal((msxColors.match(/msx_color_/g) ?? []).length, 16);
});

test('VDP stream helpers use raw split registers and raw colors', () => {
	assertNoMatches([
		'src/bmsx/res/bios',
		'src/carts',
	], [
		/vdp_\w*_rgba/,
		/write_\w*_rgba/,
		/blit_source_rgba/,
		/fill_rect_rgba/,
		/draw_line_rgba/,
		/clear_rgba/,
		/layer_priority/,
		/(?:sys_vdp_layer|vdp_layer)_\w+\s*&\s*0xff/,
		/color_byte/,
		new RegExp(`local\\s+${oldColorSnake}\\s*<const>\\s*=\\s*function`),
		new RegExp(oldPaletteColorsName),
		new RegExp(oldPaletteColorFnName + '\\s*\\('),
	]);
	assertNoMatches([
		'src/bmsx/machine',
		'src/bmsx/ide',
		'src/bmsx_cpp/machine',
	], [
		/VDP_REG_DRAW_LAYER_PRIO/,
		/IO_VDP_REG_DRAW_LAYER_PRIO/,
		/decodeVdpLayerPriority/,
		/encodeVdpLayerPriority/,
		/layerPriority/,
	]);
	assertFileDoesNotMatch('src/bmsx/res/bios/vdp_image.lua', [
		/write_glyph_line/,
		/string\.len\s*\(\s*line\s*\)/,
		/line:sub/,
	]);
	assertFileDoesNotMatch('src/bmsx/res/bios/font.lua', [
		/string\.len\s*\(\s*line\s*\)/,
		/line:sub/,
	]);
});

test('VDP color and priority APIs do not use word-postfixed names', () => {
	assertNoMatches([
		'src/bmsx',
		'src/bmsx_cpp',
		'src/carts',
	], [
		new RegExp(oldColorSnake),
		new RegExp('color' + 'Word'),
		new RegExp('Color' + 'Word'),
		new RegExp(oldPrioritySnake),
		new RegExp('priority' + 'Word'),
		new RegExp('Priority' + 'Word'),
		new RegExp('palette' + '_color' + '_words'),
		new RegExp('colorize' + '_word'),
		new RegExp(`_${oldColorSnake}`),
	]);
	assertFileDoesNotMatch('docs/architecture.md', [
		new RegExp('color ' + 'word'),
		new RegExp('color ' + 'words'),
		new RegExp('priority ' + 'word'),
		new RegExp('priority ' + 'words'),
	]);
});

test('VDP unit internals do not duplicate cart fault guards', () => {
	assertFileDoesNotMatch('src/bmsx/machine/devices/vdp/bbu.ts', [
		/throw/,
		/vdpFault/,
		/controlWord/,
		/size\s*<=/,
		/index\s*>=/,
	]);
	assertFileDoesNotMatch('src/bmsx_cpp/machine/devices/vdp/bbu.cpp', [
		/throw/,
		/vdpFault/,
		/controlWord/,
		/size\s*<=/,
		/target\.size\(\)\s*>=/,
	]);
	assertFileDoesNotMatch('src/bmsx/machine/devices/vdp/fault.ts', [
		new RegExp(streamFaultName),
	]);
	assertFileDoesNotMatch('src/bmsx_cpp/machine/devices/vdp/fault.h', [
		new RegExp(streamFaultName),
	]);
	assertFileDoesNotMatch('src/bmsx/machine/devices/vdp/blitter.ts', [
		new RegExp(componentColorPackerName),
	]);
	assertFileDoesNotMatch('src/bmsx_cpp/machine/devices/vdp/blitter.h', [
		/packFrameBufferColor\s*\(\s*f32/,
	]);
	assertFileDoesNotMatch('src/bmsx_cpp/machine/devices/vdp/blitter.cpp', [
		/packFrameBufferColor\s*\(\s*f32/,
	]);
	assertFileDoesNotMatch('src/bmsx_cpp/machine/devices/vdp/blitter.h', [
		/\bf32\s+z\s*=/,
	]);
	assertFileDoesNotMatch('src/bmsx_cpp/machine/devices/vdp/vdp.cpp', [
		new RegExp('VDP register .*out of ' + 'range'),
		/command\.z/,
	]);
});

test('machine runtime does not import render submission or font types for VDP emission', () => {
	assertNoMatches([
		'src/bmsx/machine/runtime',
		'src/bmsx_cpp/machine/runtime',
	], [
		/render\/shared\/submissions/,
		/render\/shared\/bitmap_font/,
		/core\/font/,
		/vdp_submissions/,
	]);
});

test('TS host 2D queue tags submissions without mutating or copying payloads', () => {
	assertFileDoesNotMatch('src/bmsx/render/shared/queues.ts', [
		/\.type\s*=/,
		/\{\s*\.\.\.item/,
		/Object\.assign/,
	]);
	const text = readFileSync(join(root, 'src/bmsx/render/shared/queues.ts'), 'utf8');
	assert.match(text, /host2dKindQueue/);
	assert.match(text, /host2dRefQueue/);
	assert.match(text, /type Host2DSubmission/);
	const overlayQueue = readFileSync(join(root, 'src/bmsx/render/host_overlay/overlay_queue.ts'), 'utf8');
	const overlayPipeline = readFileSync(join(root, 'src/bmsx/render/host_overlay/pipeline.ts'), 'utf8');
	const headlessHost2D = readFileSync(join(root, 'src/bmsx/render/headless/host_2d.ts'), 'utf8');
	assert.match(overlayQueue, /commands:\s*Host2DSubmission\[\]/);
	assert.doesNotMatch(overlayQueue, /RenderSubmission/);
	assert.doesNotMatch(overlayPipeline, /as Host2DKind|as Host2DRef/);
	assert.doesNotMatch(headlessHost2D, /as Host2DKind|as Host2DRef/);
});

test('host image submissions are separate from VDP slot image submissions', () => {
	const tsSubmissions = readFileSync(join(root, 'src/bmsx/render/shared/submissions.ts'), 'utf8');
	const tsImgSection = tsSubmissions.slice(tsSubmissions.indexOf('export type ImgRenderSubmission'), tsSubmissions.indexOf('export type HostImageRenderSubmission'));
	const tsHostImgSection = tsSubmissions.slice(tsSubmissions.indexOf('export type HostImageRenderSubmission'), tsSubmissions.indexOf('export type PolyRenderSubmission'));
	assert.doesNotMatch(tsImgSection, /imgid/);
	assert.match(tsImgSection, /\bslot:\s*number/);
	assert.match(tsImgSection, /\bu:\s*number/);
	assert.match(tsHostImgSection, /imgid:\s*string/);

	const cppSubmissions = readFileSync(join(root, 'src/bmsx_cpp/render/shared/submissions.h'), 'utf8');
	const cppImgSection = cppSubmissions.slice(cppSubmissions.indexOf('struct ImgRenderSubmission'), cppSubmissions.indexOf('struct HostImageRenderSubmission'));
	const cppHostImgSection = cppSubmissions.slice(cppSubmissions.indexOf('struct HostImageRenderSubmission'), cppSubmissions.indexOf('// Polygon render'));
	assert.doesNotMatch(cppImgSection, /imgid/);
	assert.match(cppImgSection, /slot/);
	assert.match(cppHostImgSection, /std::string imgid/);
});

test('native host 2D submissions mirror the TS sideband queue and render through host_overlay', () => {
	const header = readFileSync(join(root, 'src/bmsx_cpp/render/shared/queues.h'), 'utf8');
	const source = readFileSync(join(root, 'src/bmsx_cpp/render/shared/queues.cpp'), 'utf8');
	const softwarePipeline = readFileSync(join(root, 'src/bmsx_cpp/render/host_overlay/software/pipeline.cpp'), 'utf8');
	const gles2Pipeline = readFileSync(join(root, 'src/bmsx_cpp/render/host_overlay/gles2/pipeline.cpp'), 'utf8');
	assert.match(header, /Host2DKind/);
	assert.match(header, /Host2DEntry/);
	assert.match(header, /submitImage\(HostImageRenderSubmission item\)/);
	assert.match(header, /submitRectangle\(RectRenderSubmission item\)/);
	assert.match(header, /submitDrawPolygon\(PolyRenderSubmission item\)/);
	assert.match(header, /submitGlyphs\(GlyphRenderSubmission item\)/);
	assert.match(source, /m_kindQueue/);
	assert.match(source, /m_refQueue/);
	assert.doesNotMatch(source, /s_host2DQueue/);
	assert.doesNotMatch(source, /RenderSubmission\s+submission/);
	assert.match(softwarePipeline, /RenderQueues::host2DQueueEntry/);
	assert.match(gles2Pipeline, /RenderQueues::host2DQueueEntry/);
	assertFileDoesNotMatch('src/bmsx_cpp/render/shared/queues.cpp', [
		/Host2DQueueView/,
		/forEachHost2DQueue/,
	]);
	assertFileDoesNotMatch('src/bmsx_cpp/render/host_overlay/overlay_queue.h', [
		/const RenderQueues::Host2DEntry\* commands/,
	]);
	assertFileDoesNotMatch('src/bmsx_cpp/render/host_overlay/pipeline.h', [
		/Host2DEntry\* commands/,
	]);
	assertFileDoesNotMatch('src/bmsx_cpp/render/host_overlay/software/pipeline.cpp', [
		/state\.commands/,
	]);
	assertFileDoesNotMatch('src/bmsx_cpp/render/host_overlay/gles2/pipeline.cpp', [
		/state\.commands/,
	]);
	const overlayQueueSource = readFileSync(join(root, 'src/bmsx_cpp/render/host_overlay/overlay_queue.cpp'), 'utf8');
	assert.match(overlayQueueSource, /std::array<RenderQueues::Host2DEntry/);
	assert.match(overlayQueueSource, /std::array<HostImageRenderSubmission/);
	assert.match(overlayQueueSource, /std::array<RectRenderSubmission/);
	assert.match(overlayQueueSource, /std::array<PolyRenderSubmission/);
	assert.match(overlayQueueSource, /std::array<GlyphRenderSubmission/);
	assert.match(overlayQueueSource, /submitImage/);
	assert.match(overlayQueueSource, /commandAt/);
	const gles2OverlayRenderer = readFileSync(join(root, 'src/bmsx_cpp/render/host_overlay/gles2/renderer.cpp'), 'utf8');
	assert.match(gles2OverlayRenderer, /command\.thickness\.value\(\)/);
	assert.doesNotMatch(gles2OverlayRenderer, /thickness\.has_value\(\)\s*\?/);
	const gameview = readFileSync(join(root, 'src/bmsx_cpp/render/gameview.cpp'), 'utf8');
	assert.match(gameview, /RenderQueues::submitRectangle/);
	assert.match(gameview, /RenderQueues::submitDrawPolygon/);
	assertFileDoesNotMatch('src/bmsx_cpp/render/gameview.h', [
		/std::function/,
		/Renderer renderer/,
	]);
});

test('host menu reuses host text rendering assets instead of owning a private font', () => {
	assertNoMatches([
		'src/bmsx/render/host_menu',
		'src/bmsx_cpp/render/host_menu',
	], [
		/HostMenuFont/,
		/kMenuGlyphs/,
		/glyphRows/,
		/render\/host_menu\/font/,
		/render\\host_menu\\font/,
		/new Font\(/,
	]);
	assertFileDoesNotMatch('src/bmsx/core/host_overlay_menu.ts', [
		/new Font\(/,
	]);
	assertFileDoesNotMatch('src/bmsx_cpp/core/host_overlay_menu.cpp', [
		/HostMenuFont/,
		/kMenuGlyphs/,
		/glyphRows/,
	]);
	assertFileDoesNotMatch('src/bmsx_cpp/CMakeLists.txt', [
		/render\/host_menu\/font/,
	]);
});

test('C++ host overlay is backend-owned and not editor-owned', () => {
	readFileSync(join(root, 'src/bmsx_cpp/render/host_overlay/pipeline.cpp'), 'utf8');
	readFileSync(join(root, 'src/bmsx_cpp/render/host_overlay/overlay_queue.cpp'), 'utf8');
	readFileSync(join(root, 'src/bmsx_cpp/render/host_overlay/software/pipeline.cpp'), 'utf8');
	readFileSync(join(root, 'src/bmsx_cpp/render/host_overlay/gles2/pipeline.cpp'), 'utf8');
	assertFileDoesNotMatch('src/bmsx_cpp/CMakeLists.txt', [
		/render\/editor\/host_overlay_pipeline/,
		/render\/editor\/overlay_queue/,
	]);
	assertFileDoesNotMatch('src/bmsx_cpp/render/host_overlay/pipeline.cpp', [
		/backend\.type\(\)/,
		/static_cast<OpenGLES2Backend/,
		/\bgl[A-Z]/,
		/ConsoleCore::instance/,
		/forEachHost2DQueue/,
	]);
	assertFileDoesNotMatch('src/bmsx_cpp/render/host_overlay/gles2/renderer.cpp', [
		/const char\*\s+kHostOverlay.*Shader\s*=\s*R"/,
		/#include\s+"render\/host_overlay\/gles2\/shaders\/.*\.glsl"/,
		/void\*\s+context/,
		/\bstatic_cast<[^>]*void/,
	]);
	assertFileDoesNotMatch('src/bmsx_cpp/render/host_overlay/gles2/shaders/host_overlay.vert.glsl', [
		/R"\(/,
	]);
	assertFileDoesNotMatch('src/bmsx_cpp/render/host_overlay/gles2/shaders/host_overlay.frag.glsl', [
		/R"\(/,
	]);
	assertFileDoesNotMatch('src/bmsx_cpp/render/host_overlay/gles2/pipeline.cpp', [
		/registerHostMenuPassesGLES2[\s\S]*bootstrapHostOverlayGLES2/,
	]);
});

test('TS headless host overlays render through explicit host overlay passes', () => {
	const headlessPasses = readFileSync(join(root, 'src/bmsx/render/headless/passes.ts'), 'utf8');
	const hostOverlayPipeline = readFileSync(join(root, 'src/bmsx/render/host_overlay/pipeline.ts'), 'utf8');
	const hostMenuPipeline = readFileSync(join(root, 'src/bmsx/render/host_menu/pipeline.ts'), 'utf8');
	const passLibrary = readFileSync(join(root, 'src/bmsx/render/backend/pass/library.ts'), 'utf8');
	assert.match(headlessPasses, /registerHeadlessPresentPass/);
	assert.match(headlessPasses, /name:\s*'HeadlessFramebuffer2D'[\s\S]*graph:\s*\{\s*writes:\s*\['frame_color'\]\s*\}/);
	assert.match(hostOverlayPipeline, /drawHeadlessHost2DLayer/);
	assert.match(hostOverlayPipeline, /drawHeadlessHostOverlayFrame/);
	assert.match(hostMenuPipeline, /drawHeadlessHostMenuLayer/);
	assert.match(headlessPasses, /graph:\s*\{\s*reads:\s*\['frame_color'\]\s*\}/);
	assert.match(hostOverlayPipeline, /graph:\s*\{\s*writes:\s*\['frame_color'\]\s*\}/);
	assert.match(hostMenuPipeline, /graph:\s*\{\s*writes:\s*\['frame_color'\]\s*\}/);
	const headlessRegistration = passLibrary.slice(passLibrary.indexOf('private registerBuiltinPassesHeadless'));
	assert.ok(headlessRegistration.indexOf('registerHostOverlayPass_Headless') < headlessRegistration.indexOf('registerHeadlessPresentPass'));
	assert.ok(headlessRegistration.indexOf('registerHostMenuPass_Headless') < headlessRegistration.indexOf('registerHeadlessPresentPass'));
	const headlessMenuSection = hostMenuPipeline.slice(hostMenuPipeline.indexOf('registerHostMenuPass_Headless'));
	assert.doesNotMatch(headlessMenuSection, /shouldExecute:\s*\(\)\s*=>\s*false/);
	assert.doesNotMatch(headlessMenuSection, /graph:\s*\{\s*skip:\s*true\s*\}/);
	assert.doesNotMatch(headlessPasses, /forEachHostMenuQueue/);
	assert.doesNotMatch(headlessPasses, /forEachHost2DQueue/);
	assert.doesNotMatch(hostOverlayPipeline, /forEachHost2DQueue/);
});

test('glyph array commands keep full-line selection semantics', () => {
	const glyphRuns = readFileSync(join(root, 'src/bmsx/render/shared/glyph_runs.ts'), 'utf8');
	assert.match(glyphRuns, /const arrayLines = Array\.isArray\(command\.glyphs\)/);
	assert.match(glyphRuns, /const start = arrayLines \? 0 : command\.glyph_start!/);
	assert.match(glyphRuns, /const end = arrayLines \? line\.length : command\.glyph_end!/);
});

test('native platform shutdown contract is implemented by the libretro platform', () => {
	const platformHeader = readFileSync(join(root, 'src/bmsx_cpp/platform.h'), 'utf8');
	const libretroHeader = readFileSync(join(root, 'src/bmsx_cpp/platform/libretro/platform.h'), 'utf8');
	const libretroSource = readFileSync(join(root, 'src/bmsx_cpp/platform/libretro/platform.cpp'), 'utf8');
	assert.match(platformHeader, /virtual void requestShutdown\(\) = 0/);
	assert.match(libretroHeader, /void requestShutdown\(\) override/);
	assert.match(libretroSource, /void LibretroPlatform::requestShutdown\(\)/);
});

test('host overlay menu preserves the core options contract', () => {
	const tsMenu = readFileSync(join(root, 'src/bmsx/core/host_overlay_menu.ts'), 'utf8');
	const cppMenu = readFileSync(join(root, 'src/bmsx_cpp/core/host_overlay_menu.cpp'), 'utf8');
	for (const text of [tsMenu, cppMenu]) {
		assert.match(text, /CORE OPTIONS/);
		assert.match(text, /Show Usage Gizmo/);
		assert.match(text, /HOST: SHOW FPS/);
		assert.match(text, /REBOOT CART/);
		assert.match(text, /EXIT GAME/);
		assert.doesNotMatch(text, /D-PAD: NAV  L\/R: CHANGE  B: CLOSE/);
		assert.doesNotMatch(text, /A\/START: EXECUTE  B: CLOSE/);
		assert.doesNotMatch(text, /host options/);
		assert.doesNotMatch(text, /show stats/);
		assert.doesNotMatch(text, /d-pad: nav/);
	}
	assert.doesNotMatch(tsMenu, /view\.dither_type\s*=/);
	assert.doesNotMatch(cppMenu, /view\.dither_type\s*=/);
	const tsChangeSelected = tsMenu.slice(tsMenu.indexOf('private changeSelected'), tsMenu.indexOf('private activateSelected'));
	const cppChangeSelected = cppMenu.slice(cppMenu.indexOf('void HostOverlayMenu::changeSelected'), cppMenu.indexOf('void HostOverlayMenu::activateSelected'));
	assert.doesNotMatch(tsChangeSelected, /executeAction/);
	assert.doesNotMatch(cppChangeSelected, /activateSelected/);
	assert.doesNotMatch(tsMenu, /buttonJustPressed\(player, BUTTON_START\)[\s\S]{0,80}activateSelected/);
	assert.doesNotMatch(cppMenu, /buttonJustPressed\(player, kButtonStart\)[\s\S]{0,80}activateSelected/);
});

test('standalone libretro host handles all core option variables', () => {
	const host = readFileSync(join(root, 'src/bmsx_cpp/platform/libretro_host/main.c'), 'utf8');
	for (const key of [
		'bmsx_render_backend',
		'bmsx_crt_postprocessing',
		'bmsx_postprocess_detail',
		'bmsx_crt_noise',
		'bmsx_crt_color_bleed',
		'bmsx_crt_scanlines',
		'bmsx_crt_blur',
		'bmsx_crt_glow',
		'bmsx_crt_fringing',
		'bmsx_crt_aperture',
		'bmsx_dither',
		'bmsx_host_show_usage_gizmo',
	]) {
		assert.match(host, new RegExp(`"${key}"`));
	}
});

test('host usage gizmo preserves low nonzero meter activity', () => {
	const tsMenu = readFileSync(join(root, 'src/bmsx/core/host_overlay_menu.ts'), 'utf8');
	const cppMenu = readFileSync(join(root, 'src/bmsx_cpp/core/host_overlay_menu.cpp'), 'utf8');
	assert.match(tsMenu, /function usageFillWidth/);
	assert.match(tsMenu, /used > 0 && fillWidth === 0/);
	assert.match(tsMenu, /function usagePercentCode/);
	assert.match(tsMenu, /function usagePercentCodeText/);
	assert.match(tsMenu, /USAGE_PERCENT_TENTHS_FLAG/);
	assert.match(tsMenu, /tenths === 0/);
	assert.match(tsMenu, /fpsTextTenths/);
	assert.doesNotMatch(tsMenu, /toFixed\(1\)/);
	assert.match(tsMenu, /runtime\.cpuUsageCyclesUsed\(\)/);
	assert.match(tsMenu, /runtime\.vdpUsageWorkUnitsLast\(\)/);
	assert.doesNotMatch(tsMenu, /scheduler\.lastTickCpuUsedCycles/);
	assert.doesNotMatch(tsMenu, /scheduler\.lastTickVdpFrameCost/);
	assert.match(cppMenu, /i32 usageFillWidth/);
	assert.match(cppMenu, /used > 0\.0 && fillWidth == 0/);
	assert.match(cppMenu, /i32 usagePercentCode/);
	assert.match(cppMenu, /void formatUsagePercentCode/);
	assert.match(cppMenu, /kUsagePercentTenthsFlag/);
	assert.match(cppMenu, /tenths == 0/);
	assert.match(cppMenu, /m_fpsTextTenths/);
	assert.match(cppMenu, /runtime\.cpuUsageCyclesUsed\(\)/);
	assert.match(cppMenu, /runtime\.vdpUsageWorkUnitsLast\(\)/);
	assert.doesNotMatch(cppMenu, /scheduler\.lastTickCpuUsedCycles/);
	assert.doesNotMatch(cppMenu, /scheduler\.lastTickVdpFrameCost/);
});

test('host presentation does not contain hidden frame skip paths', () => {
	assertNoMatches([
		'src/bmsx',
		'src/bmsx_cpp',
	], [
		/HostFramePacing/,
		/hostFramePacing/,
		/consumeSkipRender/,
		/recordRenderSample/,
		/setFrameSkipOptions/,
		/bmsx_frameskip/,
		/Frame Skip/,
	]);
});

test('renderer-side code does not write VDP command registers', () => {
	assertNoMatches([
		'src/bmsx/render',
		'src/bmsx_cpp/render',
	], [
		/IO_VDP_REG_/,
		/IO_VDP_CMD/,
	]);
});

test('presentation helper does not receive the raw VDP device object', () => {
	assertNoMatches([
		'src/bmsx/render/vdp',
		'src/bmsx_cpp/render/vdp',
	], [
		/presentVdpFrameBufferPages\s*\([^)]*VDP/,
		/presentVdpFrameBufferPages\s*\([^)]*vdp/,
	]);
	assertFileDoesNotMatch('src/bmsx/machine/runtime/vblank.ts', [
		/presentVdpFrameBufferPages\s*\(\s*vdp\s*\)/,
	]);
	assertFileDoesNotMatch('src/bmsx_cpp/machine/runtime/vblank.cpp', [
		/presentVdpFrameBufferPages\s*\(\s*vdp\s*\)/,
	]);
});

test('TS and C++ VDP host bridge expose the same read and ack contract names', () => {
	assertFileDoesNotMatch('src/bmsx_cpp/machine/devices/vdp/vdp.h', [
		/hostOutput\s*\(/,
	]);
	assertFileDoesNotMatch('src/bmsx/machine/devices/vdp/vdp.ts', [
		/hostOutputState/,
	]);
	const tsText = readFileSync(join(root, 'src/bmsx/machine/devices/vdp/vdp.ts'), 'utf8');
	const cppText = readFileSync(join(root, 'src/bmsx_cpp/machine/devices/vdp/vdp.h'), 'utf8');
	assert.match(tsText, /readHostOutput\s*\(/);
	assert.match(tsText, /completeHostExecution\s*\(/);
	assert.match(cppText, /readHostOutput\s*\(/);
	assert.match(cppText, /completeHostExecution\s*\(/);
});

test('render/shared does not know or program VDP registers', () => {
	assertNoMatches([
		'src/bmsx/render/shared',
		'src/bmsx_cpp/render/shared',
	], [
		/writeVdpRegister/,
		/consumeDirectVdpCommand/,
		/VDP_REG_/,
		/machine\/devices\/vdp\/registers/,
	]);
});

test('VDP device code does not import host render modules', () => {
	assertNoMatches([
		'src/bmsx/machine/devices/vdp',
		'src/bmsx_cpp/machine/devices/vdp',
	], [
		/render\/vdp\/framebuffer/,
		/render\/vdp\//,
		/render\/backend/,
		/render\/shared\/queues/,
	]);
});

test('cart-facing firmware/runtime VDP submissions go through memory MMIO', () => {
	assertNoMatches([
		'src/bmsx/machine/firmware',
		'src/bmsx/machine/runtime',
		'src/bmsx_cpp/machine/firmware',
		'src/bmsx_cpp/machine/runtime',
	], [
		/writeVdpRegister/,
		/consumeDirectVdpCommand/,
	]);
});
