#include "host_on_screen_keyboard.h"
#include "hid_keys.h"
#include "input.h"
#include "common/rect.h"
#include "render/shared/bmsx_font.h"
#include "render/host_overlay/software/renderer.h"
#include "render/host_overlay/atlas.h"
#include <algorithm>
#include <vector>
#include "render/video_presenter.h"
#include "spec/bmsx/model.h"
#include <iostream>
#include <stdexcept>

namespace {
using namespace bmsx;
void poll() {}
i16 state(unsigned, unsigned, unsigned, unsigned) { return 0; }
bool RETRO_CALLCONV supervisor() { return false; }
void require(bool condition, const char* message) { if (!condition) throw std::runtime_error(message); }

class TestVideoOutput final : public VideoOutput {
public:
	using VideoOutput::VideoOutput;
	void setDisplaySize(i32 w, i32 h) override { visibleViewportBounds = RectBounds{0, 0, static_cast<f32>(w), static_cast<f32>(h), 0}; }
};

void testVisibleViewport() {
	LibretroInput input(supervisor);
	input.setInputPollCallback(poll);
	input.setInputStateCallback(state);
	TestVideoOutput video(256, 192);
	VideoPresenter presenter(video, std::make_unique<SoftwareBackend>(256, 192, PSX_MACHINE_SPEC.gxGpuVramBytes), 256, 192);
	Font font;
	presenter.default_font = &font;
	OnScreenKeyboard keyboard(input, NATIVE_KEYBOARD_PAGES);
	HostOnScreenKeyboard view(keyboard);
	keyboard.open();
	const auto frame = [&]() {
		view.queueRenderCommands(presenter);
		return presenter.hostOverlayQueue.consumeHostMenuFrame();
	};
	const HostMenuFrame normal = frame();
	const auto* panel = normal.commandRefs[0].rect;
	const auto* q = normal.commandRefs[48].rect;
	require(panel->area.right - panel->area.left == 231, "full native keyboard retains its existing panel width");
	require(panel->area.top == video.visibleViewportBounds.top + 4, "actual native keyboard panel docks at the visible picture top");
	require(q->area.right - q->area.left == 13, "full native keyboard retains its existing key unit");
	video.visibleViewportBounds = RectBounds{12.8F, 9.6F, 243.2F, 182.4F, 0};
	const HostMenuFrame cropped = frame();
	require(&presenter.visibleViewportBounds == &video.visibleViewportBounds, "presenter borrows the retained actual output rectangle");
	require(cropped.commandRefs[0].rect == panel && cropped.commandRefs[48].rect == q, "visible layout retains existing commands");
	require(panel->area.right - panel->area.left == 215, "keyboard grid reduces its unit to fit the real cropped width");
	require(panel->area.top == video.visibleViewportBounds.top + 4, "cropped native keyboard retains its direct top anchor");
	require(q->area.right == q->area.left + 12, "cropped keys use the same integer grid as their glyph positions");
	const auto& bounds = presenter.visibleViewportBounds;
	for (size_t index = 0; index < cropped.commandCount; ++index) {
		if (cropped.commandKinds[index] == Host2DKind::Rect) {
			const auto& area = cropped.commandRefs[index].rect->area;
			require(area.left >= bounds.left && area.right <= bounds.right && area.top >= bounds.top && area.bottom <= bounds.bottom,
				"every keyboard panel/key rectangle stays inside the visible target");
		} else if (cropped.commandKinds[index] == Host2DKind::Img) {
			const auto& icon = *cropped.commandRefs[index].img; const auto& source = hostSystemAtlasImage(icon.imgid);
			require(icon.pos.x >= bounds.left && icon.pos.x + source.width <= bounds.right && icon.pos.y >= bounds.top && icon.pos.y + source.height <= bounds.bottom,
				"actual atlas-backed icons and shadows stay inside the visible target");
		} else if (cropped.commandKinds[index] == Host2DKind::Glyphs) {
			const auto& glyph = *cropped.commandRefs[index].glyphs;
			require(glyph.x >= bounds.left && glyph.x + font.measure(glyph.items[0]) <= bounds.right
				&& glyph.y >= bounds.top && glyph.y + font.lineHeight() <= bounds.bottom,
				"actual font key labels, title and help stay inside the visible target");
		}
	}
	for (size_t key = 0; key < HostOnScreenKeyboard::KeyCount + 1; ++key) {
		const auto center = middlepoint_area(cropped.commandRefs[3 + key * 3].rect->area);
		require(view.selectAt(static_cast<i32>(center.x), static_cast<i32>(center.y)) == static_cast<i32>(key == HostOnScreenKeyboard::KeyCount ? ON_SCREEN_KEYBOARD_POSITION_TARGET : key),
			"every painted cropped key remains directly selectable");
	}
	const f32 oldLeft = q->area.left, oldTop = q->area.top;
	video.visibleViewportBounds.bottom -= 10;
	require(frame().commandRefs[48].rect == q && q->area.left == oldLeft && q->area.top == oldTop,
		"a picture-bottom change retains the actual top-docked key paint geometry");
	const auto qCenter = middlepoint_area(q->area);
	require(view.selectAt(static_cast<i32>(qCenter.x), static_cast<i32>(qCenter.y)) == 15,
		"top-docked paint and hit testing continue sharing the same retained key rectangle");
	video.visibleViewportBounds = RectBounds{14.8F, 12.6F, 245.2F, 185.4F, 0};
	require(frame().commandRefs[48].rect == q, "origin-only relayout retains the key command");
	require(q->area.left == oldLeft + 2 && q->area.top == oldTop + 3, "origin-only visible changes invalidate layout cache");
	require(presenter.viewportSize.x == 256 && presenter.viewportSize.y == 192, "host UI layout never resizes the game target");
}

void testDocking() {
	LibretroInput input(supervisor);
	input.setInputPollCallback(poll); input.setInputStateCallback(state);
	TestVideoOutput video(256, 212);
	VideoPresenter presenter(video, std::make_unique<SoftwareBackend>(256, 212, PSX_MACHINE_SPEC.gxGpuVramBytes), 256, 212);
	Font font; presenter.default_font = &font;
	OnScreenKeyboard keyboard(input, NATIVE_KEYBOARD_PAGES); HostOnScreenKeyboard view(keyboard);
	keyboard.open();
	video.visibleViewportBounds = RectBounds{12.8F, 9.6F, 243.2F, 202.4F, 0};
	const auto frame = [&]() { view.queueRenderCommands(presenter); return presenter.hostOverlayQueue.consumeHostMenuFrame(); };
	const auto original = frame();
	const auto* panel = original.commandRefs[0].rect;
	const auto* q = original.commandRefs[48].rect;
	const auto* glyph = original.commandRefs[50].glyphs;
	// The unchanged five-row 8px-font layout has an exact 125px panel height.
	const f32 top = panel->area.top, height = 125, oldKeyY = q->area.top;
	keyboard.pressKey(0, 15);
	const u64 heldRevision = keyboard.revision();
	view.togglePosition();
	const auto bottom = frame();
	require(keyboard.revision() == heldRevision && keyboard.isKeyPressed(15), "docking cannot mutate held input, feedback or selection");
	require(bottom.commandRefs == original.commandRefs && bottom.commandKinds == original.commandKinds, "manual docking reuses command storage");
	require(bottom.commandRefs[0].rect == panel && bottom.commandRefs[48].rect == q, "manual docking reuses panel and key objects");
	require(panel->area.bottom == video.visibleViewportBounds.bottom - 4, "manual bottom position anchors inside the actual visible picture");
	require(panel->area.top == video.visibleViewportBounds.bottom - 4 - height && q->area.top != oldKeyY, "bottom docking moves the entire existing composition without scaling it");
	const f32 bottomKeyY = q->area.top;
	video.visibleViewportBounds.bottom -= 5;
	frame(); require(q->area.top == bottomKeyY - 5, "height-only target changes invalidate bottom-docked paint and hit layout");
	keyboard.command(1, OnScreenKeyboardCommand::Shift); frame();
	require(glyph->items[0] == "Q" && panel->area.bottom == video.visibleViewportBounds.bottom - 4, "Shift relayout retains the manual bottom anchor");
	keyboard.setPage(static_cast<size_t>(KeyboardPage::Functions)); const auto functions = frame();
	require(functions.commandRefs[2].glyphs->items[0] == "KEYBOARD: FN", "docked title follows actual page owner");
	require(panel->area.bottom == video.visibleViewportBounds.bottom - 4 && panel->area.bottom - panel->area.top < height,
		"shorter pages fit to the same bottom edge rather than retaining the old page top");
	require(keyboard.isKeyPressed(15), "page and docking leave hidden held sources unchanged");
	size_t command = 3;
	for (const auto& row : keyboard.rows()) for (i16 key : row.keys) {
		const auto center = middlepoint_area(functions.commandRefs[command].rect->area); command += 3;
		require(view.selectAt(static_cast<i32>(center.x), static_cast<i32>(center.y)) == key, "every docked page key uses its own painted hit rectangle");
	}
	keyboard.close(); keyboard.open(); frame();
	require(panel->area.bottom == video.visibleViewportBounds.bottom - 4 && !keyboard.isKeyPressed(15), "close releases the model while reopening retains manual presentation position");
	view.togglePosition(); frame();
	require(panel->area.top == top, "explicit second toggle returns to the original top inset");
	require(presenter.viewportSize.x == 256 && presenter.viewportSize.y == 212, "docking never changes guest target geometry");
}

void testTransparentPixels() {
	constexpr i32 width = 320, height = 240;
	LibretroInput input(supervisor); input.setInputPollCallback(poll); input.setInputStateCallback(state);
	TestVideoOutput video(width, height);
	auto software = std::make_unique<SoftwareBackend>(width, height, PSX_MACHINE_SPEC.gxGpuVramBytes);
	SoftwareBackend* backend = software.get(); backend->resizePresentationTarget(width, height);
	VideoPresenter presenter(video, std::move(software), width, height);
	Font font; presenter.default_font = &font;
	OnScreenKeyboard keyboard(input, NATIVE_KEYBOARD_PAGES); HostOnScreenKeyboard view(keyboard); keyboard.open();
	std::vector<u32> pattern(width * height), pixels(width * height), mask(width * height);
	for (size_t index = 0; index < pattern.size(); ++index) pattern[index] = 0xff000000u | static_cast<u32>((index * 137u + 0x35627bu) & 0xffffffu);
	const auto render = [&](const HostMenuFrame& commands, const std::vector<u32>& background, std::vector<u32>& result) {
		std::copy(background.begin(), background.end(), backend->framebuffer());
		Host2DPipelineState state;
		beginHostOverlaySoftware(*backend, state);
		for (size_t command = 0; command < commands.commandCount; ++command) renderHost2DEntrySoftware(*backend, commands.commandKinds[command], commands.commandRefs[command]);
		endHostOverlaySoftware(*backend);
		std::copy_n(backend->framebuffer(), result.size(), result.begin());
	};
	const std::vector<u32> empty(width * height);
	f64 time = 0;
	for (const bool bottom : {false, true}) {
		if (bottom) view.togglePosition();
		for (const auto page : {KeyboardPage::Text, KeyboardPage::Symbols, KeyboardPage::Functions}) {
			keyboard.setPage(static_cast<size_t>(page));
			for (const bool held : {false, true}) {
				keyboard.updateFeedback(time += 200);
				if (held) keyboard.activate(0);
				view.queueRenderCommands(presenter); const auto commands = presenter.hostOverlayQueue.consumeHostMenuFrame();
				size_t visibleKeys = 0;
				for (const auto& row : keyboard.rows()) visibleKeys += row.keys.size();
				require(commands.commandCount == 3 + visibleKeys * 3 + 8, "each page contains only its own outlines and shadow/foreground glyph pairs");
				for (size_t command = 0; command < commands.commandCount; ++command) {
					if (commands.commandKinds[command] == Host2DKind::Rect) {
						require(commands.commandRefs[command].rect->kind == RectRenderKind::Rect, "native keyboard never submits filled panel or key plates");
					} else if (commands.commandKinds[command] == Host2DKind::Img) {
						const auto& shadow = *commands.commandRefs[command++].img;
						require(commands.commandKinds[command] == Host2DKind::Img, "pictogram foreground follows its own image shadow");
						const auto& icon = *commands.commandRefs[command].img;
						require(shadow.imgid == icon.imgid && shadow.pos.x == icon.pos.x + 1 && shadow.pos.y == icon.pos.y + 1 && shadow.colorize == 0xff080c12u,
							"actual atlas pictograms retain the same one-pixel dark shadow as ordinary labels");
						require(icon.flip.flip_v == (icon.imgid == "keyboard_dock_bottom" && bottom) && shadow.flip.flip_v == icon.flip.flip_v,
							"only position pictogram flips toward the destination edge");
					} else {
						const auto& shadow = *commands.commandRefs[command++].glyphs;
						const auto& glyph = *commands.commandRefs[command].glyphs;
						require(shadow.items == glyph.items && shadow.x == glyph.x + 1 && shadow.y == glyph.y + 1 && shadow.color == 0xff080c12u,
							"title, key and help glyphs retain an exact one-pixel dark edge over the scene");
						require(!shadow.has_background_color && !glyph.has_background_color, "glyph commands cannot paint hidden background plates");
						require(glyph.items[0] != "MOVE", "semantic MOVE name is not visible native keyboard artwork");
					}
				}
				render(commands, empty, mask); render(commands, pattern, pixels);
				size_t painted = 0, preserved = 0;
				for (size_t offset = 0; offset < pixels.size(); ++offset) {
					if (mask[offset] == 0) { require(pixels[offset] == pattern[offset], "actual software keyboard preserves every uncovered scene pixel exactly"); ++preserved; }
					else painted += pixels[offset] != pattern[offset];
				}
				require(painted > 100 && preserved > pattern.size() * 3 / 4, "transparent bitmap keyboard remains visible without washing out the scene");
				for (size_t key = 0; key < visibleKeys; ++key) {
					const auto& area = commands.commandRefs[3 + key * 3].rect->area;
					const size_t offset = static_cast<size_t>((static_cast<i32>(area.top) + 1) * width + static_cast<i32>(area.left) + 1);
					require(pixels[offset] == pattern[offset], "every selected/idle/held key interior remains fully open to underlying scene pixels");
				}
				keyboard.releaseSource(0);
			}
		}
	}
}

void testPictogramGeometryAndFeedback() {
	LibretroInput input(supervisor); input.setInputPollCallback(poll); input.setInputStateCallback(state);
	TestVideoOutput output(256, 192);
	auto software = std::make_unique<SoftwareBackend>(256, 192, PSX_MACHINE_SPEC.gxGpuVramBytes);
	SoftwareBackend* backend = software.get(); backend->resizePresentationTarget(256, 192);
	VideoPresenter presenter(output, std::move(software), 256, 192);
	Font font; presenter.default_font = &font;
	OnScreenKeyboard keyboard(input, NATIVE_KEYBOARD_PAGES); HostOnScreenKeyboard view(keyboard); keyboard.open();
	constexpr std::array<std::pair<i16, const char*>, 11> icons{{{13, "keyboard_backspace"}, {14, "keyboard_tab"}, {28, "keyboard_caps_lock"},
		{40, "keyboard_enter"}, {41, "keyboard_shift"}, {55, "keyboard_space"}, {56, "keyboard_arrow_left"}, {57, "keyboard_arrow_down"},
		{58, "keyboard_arrow_up"}, {59, "keyboard_arrow_right"}, {75, "keyboard_dock_bottom"}}};
	f64 time = 0;
	const auto frame = [&]() { view.queueRenderCommands(presenter); return presenter.hostOverlayQueue.consumeHostMenuFrame(); };
	for (const bool bottom : {false, true}) {
		if (bottom) view.togglePosition();
		for (size_t page = 0; page < 3; ++page) {
			keyboard.setPage(page); const auto commands = frame(); size_t command = 3;
			for (const auto& row : keyboard.rows()) for (i16 target : row.keys) {
				const auto expected = std::find_if(icons.begin(), icons.end(), [target](const auto& icon) { return icon.first == target; });
				const auto& area = commands.commandRefs[command].rect->area;
				if (expected != icons.end()) {
					require(commands.commandKinds[command + 1] == Host2DKind::Img && commands.commandKinds[command + 2] == Host2DKind::Img, "special targets use actual retained atlas commands");
					const auto* icon = commands.commandRefs[command + 2].img; const auto& shadow = *commands.commandRefs[command + 1].img;
					require(icon->imgid == expected->second && shadow.imgid == icon->imgid, "every native pictogram belongs to its exact physical or host target");
					const auto& source = hostSystemAtlasImage(icon->imgid);
					require(source.width == 11 && source.height == 7, "pictogram owns the expected native canvas dimensions");
					require(icon->pos.x == area.left + static_cast<i32>((area.right - area.left - 11) / 2)
						&& icon->pos.y == area.top + static_cast<i32>((area.bottom - area.top - 7) / 2), "atlas artwork centers directly inside the unchanged painted key rectangle");
					require(icon->pos.x >= area.left && shadow.pos.x + 11 <= area.right && icon->pos.y >= area.top && shadow.pos.y + 7 <= area.bottom,
						"icon canvas and shadow retain their real cell margins");
					require(icon->scale.x == 1 && icon->scale.y == 1 && !icon->flip.flip_h && icon->flip.flip_v == (target == 75 && bottom)
						&& shadow.flip.flip_v == icon->flip.flip_v, "only docking destination changes the pictogram vertical orientation");
					require(icon->colorize == (target == keyboard.selectedKey() ? 0xff7eb4d9u : 0xffefefefu) && shadow.colorize == 0xff080c12u,
						"normal and selected atlas tints preserve existing feedback contrast");
					std::fill_n(backend->framebuffer(), 256 * 192, 0);
					Host2DPipelineState pipeline; beginHostOverlaySoftware(*backend, pipeline);
					renderHost2DEntrySoftware(*backend, Host2DKind::Img, {.img = icon}); endHostOverlaySoftware(*backend);
					size_t ink = 0;
					for (i32 y = 0; y < 7; ++y) for (i32 x = 0; x < 11; ++x) {
						const i32 sourceY = icon->flip.flip_v ? 6 - y : y;
						const size_t sourceOffset = ((source.v + sourceY) * HOST_SYSTEM_ATLAS.width + source.u + x) * 4 + 3;
						const bool sourceInk = HOST_SYSTEM_ATLAS.pixels[sourceOffset] != 0;
						const size_t destination = (static_cast<i32>(icon->pos.y) + y) * 256 + static_cast<i32>(icon->pos.x) + x;
						require((backend->framebuffer()[destination] != 0) == sourceInk, "actual software icon raster preserves the exact atlas alpha silhouette and destination flip");
						ink += sourceInk;
					}
					require(ink > 0 && ink < 77, "every native pictogram contains actual ink and transparent interior pixels, never an opaque image plate");
					keyboard.selectKey(target, page); frame(); require(icon->colorize == 0xff7eb4d9u, "controller focus highlights the actual pictogram");
					if (target != 75) {
						keyboard.pressKey(0, target); frame(); require(icon->colorize == 0xffffe09au, "physical key forwarding highlights its actual pictogram");
						keyboard.releaseSource(0); keyboard.updateFeedback(time += 200); frame();
					}
					require(commands.commandRefs[command + 2].img == icon, "focus and held-state changes reuse retained image commands");
				} else require(commands.commandKinds[command + 2] == Host2DKind::Glyphs, "letters and punctuation preserve their ordinary glyph artwork");
				command += 3;
			}
		}
	}
}

void testShiftReleasedBeforeFirstPaint() {
	LibretroInput input(supervisor); input.setInputPollCallback(poll); input.setInputStateCallback(state);
	TestVideoOutput output(256, 192);
	VideoPresenter presenter(output, std::make_unique<SoftwareBackend>(256, 192, PSX_MACHINE_SPEC.gxGpuVramBytes), 256, 192);
	Font font; presenter.default_font = &font;
	OnScreenKeyboard keyboard(input, NATIVE_KEYBOARD_PAGES); keyboard.open();
	keyboard.pressKey(0, 41); require(keyboard.shiftActive(), "actual Shift is held before view construction");
	HostOnScreenKeyboard view(keyboard);
	keyboard.releaseSource(0); require(!keyboard.shiftActive(), "Shift source has ended before the first paint");
	view.queueRenderCommands(presenter); const auto commands = presenter.hostOverlayQueue.consumeHostMenuFrame();
	require(commands.commandRefs[50].glyphs->items[0] == "q" && commands.commandRefs[49].glyphs->items[0] == "q",
		"first paint restores base foreground and shadow labels rather than retaining the constructor's shifted cache");
	require(commands.commandKinds[185] == Host2DKind::Img && commands.commandRefs[185].img->imgid == "keyboard_dock_bottom", "host action retains its atlas pictogram instead of shifted physical-key artwork");
}

void testFeedback() {
	constexpr u32 idleColor = 0x80bccbdbu;
	constexpr u32 selectedColor = 0xff7eb4d9u;
	constexpr u32 pressedColor = 0xffffe09au;
	constexpr u32 textColor = 0xffefefefu;
	constexpr u32 pressedTextColor = 0xffffe09au;
	constexpr size_t q = 15u, w = 16u, backspace = 13u, shift = 41u, control = 53u;
	TestVideoOutput video(320, 240);
	VideoPresenter presenter(video, std::make_unique<SoftwareBackend>(320, 240, PSX_MACHINE_SPEC.gxGpuVramBytes), 320, 240);
	Font font;
	presenter.default_font = &font;
	LibretroInput input(supervisor);
	input.setInputPollCallback(poll);
	input.setInputStateCallback(state);
	OnScreenKeyboard keyboard(input, NATIVE_KEYBOARD_PAGES);
	HostOnScreenKeyboard view(keyboard);
	InputControllerSnapshot snapshot;
	f64 time = 1000;
	const auto sample = [&]() {
		input.poll(320, 240, time);
		input.sampleInputControllerSnapshot(snapshot, InputControllerSampleContext::Normal);
	};
	const auto pressed = [&](u8 usage) {
		return (snapshot.keyWords[usage >> 5u] & (1u << (usage & 31u))) != 0u;
	};
	const auto advance = [&](f64 at) {
		time = at;
		keyboard.updateFeedback(time);
	};
	const auto frame = [&]() {
		view.queueRenderCommands(presenter);
		return presenter.hostOverlayQueue.consumeHostMenuFrame();
	};
	const auto expectKey = [&](size_t key, u32 edge, u32 foreground) {
		const HostMenuFrame commands = frame();
		require(commands.commandKinds[3u + key * 3u] == Host2DKind::Rect, "key publishes a real rectangle command");
		require(commands.commandKinds[5u + key * 3u] == Host2DKind::Glyphs || commands.commandKinds[5u + key * 3u] == Host2DKind::Img, "key publishes its real retained foreground artwork");
		require(commands.commandRefs[3u + key * 3u].rect->color == edge, "published key outline matches forwarded input feedback");
		require((commands.commandKinds[5u + key * 3u] == Host2DKind::Img ? commands.commandRefs[5u + key * 3u].img->colorize : commands.commandRefs[5u + key * 3u].glyphs->color) == foreground,
			"published glyph or pictogram matches forwarded feedback");
	};
	const auto select = [&](size_t key) {
		const RectBounds& area = frame().commandRefs[3u + key * 3u].rect->area;
		const Vec2 center = middlepoint_area(area);
		require(view.selectAt(static_cast<i32>(center.x), static_cast<i32>(center.y)) == static_cast<i32>(key), "selection comes from the published key geometry");
	};
	const auto expectHomeEndHelp = [&](u32 color) {
		const HostMenuFrame commands = frame();
		require(commands.commandRefs[3u + (HostOnScreenKeyboard::KeyCount + 1u) * 3u + 3u].glyphs->color == color, "Home/End forwarding highlights their existing binding help line");
	};

	keyboard.open();
	advance(1000);
	expectKey(q, selectedColor, selectedColor);
	select(w);
	sample();
	require(!pressed(hid_key_usage::W), "selection alone never forwards a key or shows pressed feedback");
	expectKey(w, selectedColor, selectedColor);
	expectKey(q, idleColor, textColor);
	select(q);
	keyboard.activate(0);
	sample();
	require(pressed(hid_key_usage::Q), "held feedback accompanies the actual key down");
	expectKey(q, pressedColor, pressedTextColor);
	advance(5000);
	expectKey(q, pressedColor, pressedTextColor);
	keyboard.releaseSource(0);
	sample();
	require(!pressed(hid_key_usage::Q), "afterglow does not stretch raw input lifetime");
	expectKey(q, pressedColor, pressedTextColor);
	advance(5119);
	expectKey(q, pressedColor, pressedTextColor);
	advance(5120);
	expectKey(q, selectedColor, selectedColor);

	advance(5200);
	keyboard.activate(OnScreenKeyboard::PointerSource);
	keyboard.releaseSource(OnScreenKeyboard::PointerSource);
	sample();
	require(!pressed(hid_key_usage::Q), "a completed short pointer tap is already released in the sampled input");
	expectKey(q, pressedColor, pressedTextColor);
	advance(5320);
	expectKey(q, selectedColor, selectedColor);

	advance(5400);
	keyboard.activate(0);
	keyboard.activate(OnScreenKeyboard::PointerSource);
	keyboard.releaseSource(0);
	advance(6000);
	sample();
	require(pressed(hid_key_usage::Q), "one independent contributor cannot end another contributor's feedback or key");
	expectKey(q, pressedColor, pressedTextColor);
	keyboard.releaseSource(OnScreenKeyboard::PointerSource);
	sample();
	require(!pressed(hid_key_usage::Q), "the final contributor emits key up immediately");
	advance(6120);
	expectKey(q, selectedColor, selectedColor);

	advance(6200);
	keyboard.activate(0);
	select(w);
	keyboard.activate(OnScreenKeyboard::PointerSource);
	keyboard.releaseSource(0);
	advance(6320);
	expectKey(q, idleColor, textColor);
	expectKey(w, pressedColor, pressedTextColor);
	sample();
	require(!pressed(hid_key_usage::Q) && pressed(hid_key_usage::W), "simultaneously held letters retain independent input and visual lifetimes");
	keyboard.releaseSource(OnScreenKeyboard::PointerSource);

	select(q);
	advance(6400);
	keyboard.activate(0);
	keyboard.releaseSource(0);
	advance(6450);
	keyboard.activate(0);
	advance(6520);
	expectKey(q, pressedColor, pressedTextColor);
	advance(6700);
	keyboard.releaseSource(0);
	advance(6819);
	expectKey(q, pressedColor, pressedTextColor);
	advance(6820);
	expectKey(q, selectedColor, selectedColor);

	advance(6900);
	keyboard.command(1, OnScreenKeyboardCommand::Backspace);
	expectKey(backspace, pressedColor, pressedTextColor);
	expectKey(q, selectedColor, selectedColor);
	keyboard.releaseSource(1);
	sample();
	require(!pressed(hid_key_usage::Backspace), "command-key feedback never delays Backspace key up");
	advance(7020);
	expectKey(backspace, idleColor, textColor);

	advance(7100);
	keyboard.command(3, OnScreenKeyboardCommand::Shift);
	keyboard.activate(0);
	keyboard.command(3, OnScreenKeyboardCommand::Shift);
	select(shift);
	sample();
	require(pressed(hid_key_usage::ShiftLeft), "captured shift remains physically forwarded after sticky state ends");
	expectKey(shift, pressedColor, pressedTextColor);
	keyboard.releaseSource(0);
	sample();
	require(!pressed(hid_key_usage::ShiftLeft), "captured shift final release does not wait for visual expiry");
	advance(7219);
	expectKey(shift, pressedColor, pressedTextColor);
	advance(7220);
	expectKey(shift, selectedColor, selectedColor);

	advance(7300);
	select(control);
	keyboard.activate(3);
	expectKey(control, pressedColor, pressedTextColor);
	select(q);
	keyboard.activate(0);
	select(control);
	keyboard.activate(3);
	sample();
	require(pressed(hid_key_usage::ControlLeft), "captured sticky control remains down until its key source ends");
	expectKey(control, pressedColor, pressedTextColor);
	keyboard.releaseSource(0);
	sample();
	require(!pressed(hid_key_usage::ControlLeft), "captured sticky modifier release is immediate");
	advance(7420);
	expectKey(control, selectedColor, selectedColor);

	for (const auto command : {OnScreenKeyboardCommand::Home, OnScreenKeyboardCommand::End}) {
		advance(time + 200);
		keyboard.command(0, command);
		expectHomeEndHelp(pressedColor);
		keyboard.releaseSource(0);
		sample();
		require(!pressed(hid_key_usage::Home) && !pressed(hid_key_usage::End), "hidden navigation-key feedback cannot keep navigation input held");
		expectHomeEndHelp(pressedColor);
		advance(time + 120);
		expectHomeEndHelp(0xffb2b2b2u);
	}

	select(q);
	keyboard.activate(0);
	keyboard.releaseSource(0);
	expectKey(q, pressedColor, pressedTextColor);
	keyboard.close();
	keyboard.open();
	expectKey(q, selectedColor, selectedColor);
	expectHomeEndHelp(0xffb2b2b2u);
}
}

int main() {
	try {
		LibretroInput input(supervisor);
		input.setInputPollCallback(poll);
		input.setInputStateCallback(state);
		OnScreenKeyboard keyboard(input, NATIVE_KEYBOARD_PAGES);
	HostOnScreenKeyboard view(keyboard);
		InputControllerSnapshot snapshot;
		f64 time = 0;
		const auto sample = [&](f64 delta = 20) {
			time += delta;
			input.poll(256, 212, time);
			input.sampleInputControllerSnapshot(snapshot, InputControllerSampleContext::Normal);
		};
		const auto pressed = [&](u8 usage) {
			return (snapshot.keyWords[usage >> 5u] & (1u << (usage & 31u))) != 0u;
		};
		for (int hostHz : {60, 120}) {
			keyboard.open();
			keyboard.activate(0);
			for (int frame = 0; frame < hostHz / 10; ++frame) {
				sample(1000.0 / hostHz);
				require(pressed(hid_key_usage::Q), "100ms physical hold survives every host poll");
			}
			keyboard.releaseSource(0);
			sample();
			require(!pressed(hid_key_usage::Q), "actual source release produces key up");
		}
		keyboard.activate(0);
		keyboard.activate(OnScreenKeyboard::PointerSource);
		keyboard.releaseSource(0);
		sample();
		require(pressed(hid_key_usage::Q), "pointer independently retains the shared key");
		keyboard.releaseSource(OnScreenKeyboard::PointerSource);
		sample();
		require(!pressed(hid_key_usage::Q), "final shared contributor releases the key");
		keyboard.activate(0);
		keyboard.moveHorizontal(1);
		keyboard.activate(OnScreenKeyboard::PointerSource);
		keyboard.command(2, OnScreenKeyboardCommand::Backspace);
		sample();
		require(pressed(hid_key_usage::Q) && pressed(hid_key_usage::W) && pressed(hid_key_usage::Backspace), "moving selection never retargets held keys");
		keyboard.releaseSource(0);
		keyboard.releaseSource(2);
		sample();
		require(!pressed(hid_key_usage::Q) && !pressed(hid_key_usage::Backspace) && pressed(hid_key_usage::W), "different source keys release independently");
		keyboard.releaseSource(OnScreenKeyboard::PointerSource);
		keyboard.open();
		keyboard.command(3, OnScreenKeyboardCommand::Shift);
		keyboard.activate(0);
		keyboard.moveHorizontal(1);
		keyboard.activate(1);
		keyboard.releaseSource(0);
		sample();
		require(pressed(hid_key_usage::W) && pressed(hid_key_usage::ShiftLeft), "shift belongs to every still-held shifted key");
		keyboard.releaseSource(1);
		sample();
		require(!pressed(hid_key_usage::ShiftLeft), "one-shot shift ends with the final shifted source");
		keyboard.open();
		for (int row = 0; row < 3; ++row) keyboard.moveVertical(1);
		keyboard.moveHorizontal(-1);
		keyboard.activate(3);
		keyboard.command(0, OnScreenKeyboardCommand::Space);
		keyboard.activate(3);
		sample();
		require(pressed(hid_key_usage::ControlLeft) && pressed(hid_key_usage::Space), "toggling a sticky modifier cannot alter an already-held key");
		keyboard.releaseSource(0);
		sample();
		require(!pressed(hid_key_usage::ControlLeft) && !pressed(hid_key_usage::Space), "captured sticky modifier releases with its key");
		keyboard.command(0, OnScreenKeyboardCommand::Backspace);
		for (int frame = 0; frame < 120; ++frame) {
			sample(1000.0 / 120);
			require(pressed(hid_key_usage::Backspace), "held special keys do not become host-generated repeat pulses");
		}
		keyboard.command(1, OnScreenKeyboardCommand::Home);
		keyboard.command(2, OnScreenKeyboardCommand::End);
		keyboard.close();
		sample();
		for (u32 word : snapshot.keyWords) require(word == 0u, "closing releases every held virtual key and modifier");
		keyboard.open();
		keyboard.activate(0);
		input.postKeyboardEvent(RETROK_q, true);
		keyboard.releaseSource(0);
		sample();
		require(pressed(hid_key_usage::Q), "physical keyboard ownership outlives the released overlay source");
		input.postKeyboardEvent(RETROK_q, false);
		sample();
		require(!pressed(hid_key_usage::Q), "final physical keyboard release clears the sampled bit");
		testFeedback();
		testVisibleViewport();
		testDocking();
		testTransparentPixels();
		testShiftReleasedBeforeFirstPaint();
		testPictogramGeometryAndFeedback();
		std::cout << "HOST-ON-SCREEN-KEYBOARD:PASS\n";
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
