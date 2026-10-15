#include "host_overlay_menu.h"
#include "input.h"
#include "presentation_state.h"
#include "rewind.h"
#include "machine/runtime/runtime.h"
#include "render/shared/bmsx_font.h"
#include "render/video_presenter.h"
#include "spec/bmsx/model.h"
#include "support/cartridge_fixture.h"
#include <iostream>
#include <stdexcept>

namespace {
using namespace bmsx;
constexpr i32 width = 256, height = 128;
u16 buttons = 0, secondButtons = 0;
i16 pointerX = 0, pointerY = 0;
bool pointerPressed = false;
void poll() {}
i16 state(unsigned port, unsigned device, unsigned, unsigned id) {
	if (port == 0 && device == RETRO_DEVICE_POINTER) {
		if (id == RETRO_DEVICE_ID_POINTER_X) return pointerX;
		if (id == RETRO_DEVICE_ID_POINTER_Y) return pointerY;
		if (id == RETRO_DEVICE_ID_POINTER_PRESSED) return pointerPressed;
	}
	return port < 2 && device == RETRO_DEVICE_JOYPAD && ((port == 0 ? buttons : secondButtons) & (1u << id)) != 0 ? 1 : 0;
}
bool RETRO_CALLCONV supervisor() { return false; }
void require(bool condition, const char* message) { if (!condition) throw std::runtime_error(message); }
class TestVideoOutput final : public VideoOutput {
public:
	using VideoOutput::VideoOutput;
	void setDisplaySize(i32 w, i32 h) override { visibleViewportBounds = RectBounds{0, 0, static_cast<f32>(w), static_cast<f32>(h), 0}; }
};
void assertVisible(const HostMenuFrame& frame, const RectBounds& bounds, Font& font) {
	for (size_t index = 0; index < frame.commandCount; ++index) {
		if (frame.commandKinds[index] == Host2DKind::Rect) {
			const auto& area = frame.commandRefs[index].rect->area;
			require(area.left >= bounds.left && area.right <= bounds.right && area.top >= bounds.top && area.bottom <= bounds.bottom,
				"every visible-window menu rectangle remains inside the actual clipped picture");
		} else if (frame.commandKinds[index] == Host2DKind::Glyphs) {
			const auto& glyph = *frame.commandRefs[index].glyphs;
			require(glyph.x >= bounds.left && glyph.x + font.measure(glyph.items[0]) <= bounds.right
				&& glyph.y >= bounds.top && glyph.y + font.lineHeight() <= bounds.bottom,
				"actual font menu title and row glyphs remain inside the actual clipped picture");
		}
	}
}
void testNativeMoveTarget() {
	constexpr i32 w = 320, h = 240;
	constexpr u16 select = 1u << RETRO_DEVICE_ID_JOYPAD_SELECT, a = 1u << RETRO_DEVICE_ID_JOYPAD_A;
	buttons = secondButtons = 0; pointerPressed = false; pointerX = pointerY = 0;
	LibretroInput input(supervisor); input.setInputPollCallback(poll); input.setInputStateCallback(state);
	input.setControllerDevice(0, RETRO_DEVICE_JOYPAD); input.setControllerDevice(1, RETRO_DEVICE_JOYPAD);
	Runtime runtime({{}, test::cartridgeSlots(), PSX_MACHINE_SPEC}, input);
	TestVideoOutput output(w, h);
	VideoPresenter presenter(output, std::make_unique<SoftwareBackend>(w, h, PSX_MACHINE_SPEC.gxGpuVramBytes), w, h);
	Font font; presenter.default_font = &font; RenderPresentationState presentation;
	HostRewind rewind(runtime, presenter, presentation); HostOverlayMenu menu(input); f64 time = 0;
	InputControllerSnapshot snapshot{};
	const auto tick = [&]() { time += 20; input.poll(w, h, time); menu.tickInput(runtime, input, presenter, rewind, time); };
	const auto press = [&](u16 mask) { buttons = mask; tick(); buttons = 0; tick(); };
	const auto frame = [&]() { menu.queueRenderCommands(runtime, presenter, rewind); return presenter.hostOverlayQueue.consumeHostMenuFrame(); };
	const auto noKeys = [&]() {
		tick(); input.sampleInputControllerSnapshot(snapshot, InputControllerSampleContext::Normal);
		for (const auto word : snapshot.keyWords) require(word == 0, "MOVE cannot synthesize any guest key");
	};
	const auto held = [&](u8 usage) {
		tick(); input.sampleInputControllerSnapshot(snapshot, InputControllerSampleContext::Normal);
		return (snapshot.keyWords[usage >> 5] & (1u << (usage & 31))) != 0;
	};
	const auto moveRect = [&]() {
		const auto commands = frame(); const RectRenderSubmission* rect = nullptr;
		for (size_t command = 3; command < commands.commandCount - 8; command += 3) {
			if (commands.commandKinds[command + 2] == Host2DKind::Img && commands.commandRefs[command + 2].img->imgid == "keyboard_dock_bottom") rect = commands.commandRefs[command].rect;
		}
		require(rect != nullptr, "each native page paints MOVE as an actual interactive target"); return rect;
	};
	tick(); press(select | (1u << RETRO_DEVICE_ID_JOYPAD_X));
	const auto initial = frame(); const auto* panel = initial.commandRefs[0].rect;
	require(initial.commandRefs[2].glyphs->items[0] == "KEYBOARD: TEXT" && panel->area.top == 4, "ordinary native open retains text page and default top position");
	press(select | a); frame(); noKeys();
	require(panel->area.top == 4, "removed Select+A chord no longer docks the native view");
	for (size_t page = 0; page < 3; ++page) {
		for (int row = 0; row < 3; ++row) press(1u << RETRO_DEVICE_ID_JOYPAD_DOWN);
		for (int key = 0; key < 16 && moveRect()->color != 0xff7eb4d9u; ++key) press(1u << RETRO_DEVICE_ID_JOYPAD_RIGHT);
		require(moveRect()->color == 0xff7eb4d9u, "ordinary D-pad navigation reaches the visible MOVE target without directly mutating selection");
		buttons = a; tick(); frame(); noKeys();
		require(panel->area.bottom == h - 4, "actual gamepad A on MOVE dispatches bottom docking immediately");
		for (int repeat = 0; repeat < 60; ++repeat) { tick(); frame(); require(panel->area.bottom == h - 4, "held A never repeats the MOVE action through navigation typematic"); }
		buttons = 0; tick(); noKeys();
		secondButtons = a; tick(); frame(); secondButtons = 0; tick(); noKeys();
		require(panel->area.top == 4, "another controller independently activates the same focused host action");
		press(select | a); frame();
		require(panel->area.top == 4, "focused MOVE still requires ordinary activation, never the removed modifier chord");
		for (int pointerPress = 0; pointerPress < 2; ++pointerPress) {
			const auto center = middlepoint_area(moveRect()->area);
			pointerX = static_cast<i16>(static_cast<i32>(center.x) * 65534 / (w - 1) - 32767);
			pointerY = static_cast<i16>(static_cast<i32>(center.y) * 65534 / (h - 1) - 32767);
			pointerPressed = true; tick(); frame(); noKeys();
			require(pointerPress == 0 ? panel->area.bottom == h - 4 : panel->area.top == 4, "actual native pointer activation dispatches the visible MOVE target");
			const f32 top = panel->area.top;
			for (int hold = 0; hold < 5; ++hold) { tick(); frame(); require(panel->area.top == top, "moving the view underneath a held pointer cannot retrigger MOVE"); }
			pointerPressed = false; tick(); noKeys();
		}
		const auto commands = frame();
		require(commands.commandRefs[commands.commandCount - 1].glyphs->items[0] == "SEL+X CLOSE  SEL+L/R HOME/END", "help keeps physical host shortcuts while the visible action replaces the hidden docking chord");
		press(select | (1u << RETRO_DEVICE_ID_JOYPAD_Y));
	}
	for (const auto binding : {std::pair{RETRO_DEVICE_ID_JOYPAD_B, hid_key_usage::Space},
		std::pair{RETRO_DEVICE_ID_JOYPAD_X, hid_key_usage::Backspace}, std::pair{RETRO_DEVICE_ID_JOYPAD_L, hid_key_usage::ArrowLeft},
		std::pair{RETRO_DEVICE_ID_JOYPAD_R, hid_key_usage::ArrowRight}, std::pair{RETRO_DEVICE_ID_JOYPAD_L2, hid_key_usage::Home},
		std::pair{RETRO_DEVICE_ID_JOYPAD_R2, hid_key_usage::End}, std::pair{RETRO_DEVICE_ID_JOYPAD_START, hid_key_usage::Enter}}) {
		buttons = 1u << binding.first; tick(); require(held(binding.second), "visible MOVE preserves existing native controller keyboard bindings");
		buttons = 0; tick(); noKeys();
	}
	press(select | (1u << RETRO_DEVICE_ID_JOYPAD_X)); press(select | (1u << RETRO_DEVICE_ID_JOYPAD_X)); frame();
	require(panel->area.top == 4, "native reopen retains the manual presentation side");
	press(select | (1u << RETRO_DEVICE_ID_JOYPAD_X));
}

}
int main() {
	try {
		LibretroInput input(supervisor);
		input.setInputPollCallback(poll);
		input.setInputStateCallback(state);
		input.setControllerDevice(0, RETRO_DEVICE_JOYPAD);
		Runtime runtime({{}, test::cartridgeSlots(), PSX_MACHINE_SPEC}, input);
		TestVideoOutput output(width, height);
		VideoPresenter presenter(output, std::make_unique<SoftwareBackend>(width, height, PSX_MACHINE_SPEC.gxGpuVramBytes), width, height);
		Font font;
		presenter.default_font = &font;
		output.visibleViewportBounds = RectBounds{12.8F, 6.4F, 243.2F, 121.6F, 0};
		RenderPresentationState presentation;
		HostRewind rewind(runtime, presenter, presentation);
		HostOverlayMenu menu(input);
		f64 time = 0;
		const auto tick = [&]() {
			time += 20;
			input.poll(width, height, time);
			return menu.tickInput(runtime, input, presenter, rewind, time);
		};
		const auto press = [&](u16 mask) { buttons = mask; tick(); buttons = 0; tick(); };
		const auto frame = [&]() { menu.queueRenderCommands(runtime, presenter, rewind); return presenter.hostOverlayQueue.consumeHostMenuFrame(); };
		press((1u << RETRO_DEVICE_ID_JOYPAD_SELECT) | (1u << RETRO_DEVICE_ID_JOYPAD_START));
		require(menu.active(), "real native Select+Start opens the menu");
		const HostMenuFrame first = frame();
		assertVisible(first, presenter.visibleViewportBounds, font);
		require(first.commandRefs[1].glyphs->items[0] == "CORE OPTIONS [1-11/15]", "real clipped height budgets title, bezel, padding and eleven unchanged font rows");
		require(first.commandCount == 14, "only visible rows are published, including one selected highlight");
		press(1u << RETRO_DEVICE_ID_JOYPAD_UP);
		const HostMenuFrame last = frame();
		assertVisible(last, presenter.visibleViewportBounds, font);
		require(last.commandRefs[1].glyphs->items[0] == "CORE OPTIONS [5-15/15]", "wrap navigation scrolls the last selected row into the visible window");
		const auto& firstRow = *last.commandRefs[2].glyphs;
		require(firstRow.items[0] == "CRT Scanlines  ON", "last window begins with the correct global option four");
		const i32 x = static_cast<i32>(firstRow.x) + 3, y = static_cast<i32>(firstRow.y) + 3;
		pointerX = static_cast<i16>(x * 65534 / (width - 1) - 32767);
		pointerY = static_cast<i16>(y * 65534 / (height - 1) - 32767);
		pointerPressed = true; tick();
		pointerPressed = false; tick();
		require(!presenter.applyScanlines && !presenter.showResourceUsageGizmo,
			"native pointer click maps its painted window row to global option four, not option zero");
		assertVisible(frame(), presenter.visibleViewportBounds, font);
		output.visibleViewportBounds = RectBounds{14.8F, 9.4F, 245.2F, 124.6F, 0};
		assertVisible(frame(), presenter.visibleViewportBounds, font);
		press(1u << RETRO_DEVICE_ID_JOYPAD_UP);
		press(1u << RETRO_DEVICE_ID_JOYPAD_UP);
		press(1u << RETRO_DEVICE_ID_JOYPAD_UP);
		press(1u << RETRO_DEVICE_ID_JOYPAD_UP);
		const HostMenuFrame restored = frame();
		require(restored.commandRefs[1].glyphs->items[0] == "CORE OPTIONS [1-11/15]", "first selected row returns to the first visible window");
		assertVisible(restored, presenter.visibleViewportBounds, font);
		press(1u << RETRO_DEVICE_ID_JOYPAD_B);
		require(!menu.active(), "real native cancel closes the first-window menu");
		press((1u << RETRO_DEVICE_ID_JOYPAD_SELECT) | (1u << RETRO_DEVICE_ID_JOYPAD_START));
		const HostMenuFrame reopened = frame();
		require(reopened.commandRefs[1].glyphs->items[0] == "CORE OPTIONS [1-11/15]",
			"reopening at the same font, bounds and first window retains the visible range title");
		assertVisible(reopened, presenter.visibleViewportBounds, font);
		require(presenter.viewportSize.x == width && presenter.viewportSize.y == height, "menu lifecycle never changes the game's full presentation target");
		press((1u << RETRO_DEVICE_ID_JOYPAD_SELECT) | (1u << RETRO_DEVICE_ID_JOYPAD_X));
		require(frame().commandRefs[2].glyphs->items[0] == "KEYBOARD: TEXT", "actual native Select+X enters the model's text page");
		press((1u << RETRO_DEVICE_ID_JOYPAD_SELECT) | (1u << RETRO_DEVICE_ID_JOYPAD_Y));
		require(frame().commandRefs[2].glyphs->items[0] == "KEYBOARD: SYMBOLS", "actual native Select+Y changes the real logical and painted page");
		press((1u << RETRO_DEVICE_ID_JOYPAD_SELECT) | (1u << RETRO_DEVICE_ID_JOYPAD_Y));
		require(frame().commandRefs[2].glyphs->items[0] == "KEYBOARD: FN", "a second actual page chord reaches function keys");
		buttons = 1u << RETRO_DEVICE_ID_JOYPAD_A; tick();
		// The native input owner composes virtual-key routed words at its next physical poll.
		tick();
		InputControllerSnapshot keyboardSnapshot{};
		input.sampleInputControllerSnapshot(keyboardSnapshot, InputControllerSampleContext::Normal);
		require((keyboardSnapshot.keyWords[hid_key_usage::F1 >> 5] & (1u << (hid_key_usage::F1 & 31))) != 0,
			"native gamepad A forwards the selected actual F1 identity, never the old main-page Q");
		buttons = 0; tick(); tick();
		input.sampleInputControllerSnapshot(keyboardSnapshot, InputControllerSampleContext::Normal);
		require((keyboardSnapshot.keyWords[hid_key_usage::F1 >> 5] & (1u << (hid_key_usage::F1 & 31))) == 0, "actual native A UP releases function key");
		press((1u << RETRO_DEVICE_ID_JOYPAD_SELECT) | (1u << RETRO_DEVICE_ID_JOYPAD_X));
		require(!menu.active(), "actual native close chord retires function-page UI without guest presentation changes");
		testNativeMoveTarget();
		std::cout << "HOST-VISIBLE-MENU:PASS\n";
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n'; return 1;
	}
}
