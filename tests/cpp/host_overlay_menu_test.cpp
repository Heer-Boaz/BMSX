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
u16 buttons = 0;
i16 pointerX = 0, pointerY = 0;
bool pointerPressed = false;
void poll() {}
i16 state(unsigned port, unsigned device, unsigned, unsigned id) {
	if (port == 0 && device == RETRO_DEVICE_POINTER) {
		if (id == RETRO_DEVICE_ID_POINTER_X) return pointerX;
		if (id == RETRO_DEVICE_ID_POINTER_Y) return pointerY;
		if (id == RETRO_DEVICE_ID_POINTER_PRESSED) return pointerPressed;
	}
	return port == 0 && device == RETRO_DEVICE_JOYPAD && (buttons & (1u << id)) != 0 ? 1 : 0;
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
		std::cout << "HOST-VISIBLE-MENU:PASS\n";
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n'; return 1;
	}
}
