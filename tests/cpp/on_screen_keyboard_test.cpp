#include "on_screen_keyboard.h"
#include "host_on_screen_keyboard.h"
#include "input.h"
#include "machine/machine.h"
#include "machine/memory/memory.h"
#include "spec/bmsx/io.h"
#include "spec/bmsx/memory_map.h"
#include "spec/bmsx/model.h"
#include "support/cartridge_fixture.h"
#include "render/shared/bmsx_font.h"
#include "render/video_presenter.h"
#include <array>
#include <iostream>
#include <stdexcept>
#include <string_view>
#include <vector>

namespace {
using namespace bmsx;
void poll() {}
i16 state(unsigned, unsigned, unsigned, unsigned) { return 0; }
bool RETRO_CALLCONV supervisor() { return false; }
void require(bool condition, const char* message) { if (!condition) throw std::runtime_error(message); }
constexpr i16 q = ON_SCREEN_KEY_INDEX_BY_USAGE[hid_key_usage::Q];
constexpr i16 w = ON_SCREEN_KEY_INDEX_BY_USAGE[hid_key_usage::W];
constexpr i16 shift = MODIFIER_KEY_INDICES[kModifierShift];
constexpr i16 control = MODIFIER_KEY_INDICES[kModifierControl];
constexpr i16 alt = MODIFIER_KEY_INDICES[kModifierAlt];

struct Fixture {
	LibretroInput input;
	OnScreenKeyboard keyboard;
	Memory memory;
	Machine machine;
	i64 cycle = 0;
	f64 time = 0;
	explicit Fixture(std::span<const OnScreenKeyboardPage> pages = NATIVE_KEYBOARD_PAGES)
		: input(supervisor), keyboard(input, pages),
		  memory(MemoryInit{{}, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes),
		  machine(memory, input, PSX_MACHINE_SPEC) {
		input.setInputPollCallback(poll);
		input.setInputStateCallback(state);
		machine.resetDevices(); keyboard.open();
	}
	void sample() {
		time += 20; input.poll(256, 192, time);
		memory.writeMappedU32LE(IO_INP_CTRL, INP_CTRL_ARM);
		machine.inputController.onVblankEdge(++cycle);
	}
	bool pressed(u8 usage) const {
		return (memory.readIoU32(IO_INP_KEYS + (usage >> 5) * IO_WORD_SIZE) & (1u << (usage & 31))) != 0;
	}
};
class TestVideoOutput final : public VideoOutput {
public:
	using VideoOutput::VideoOutput;
	void setDisplaySize(i32 width, i32 height) override {
		visibleViewportBounds = RectBounds{0, 0, static_cast<f32>(width), static_cast<f32>(height), 0};
	}
};

void testContactOwnership() {
	Fixture f;
	const size_t a = f.keyboard.allocateSource(), b = f.keyboard.allocateSource(), c = f.keyboard.allocateSource();
	require(a == OnScreenKeyboard::InitialSourceCount && b == a + 1 && c == b + 1, "source slots extend the actual existing controller/native source bank");
	f.keyboard.pressKey(a, q); f.keyboard.pressKey(b, w); f.keyboard.pressKey(c, q); f.sample();
	require(f.pressed(hid_key_usage::Q) && f.pressed(hid_key_usage::W), "three independent contacts reach real guest MMIO");
	f.keyboard.releaseSource(a); f.sample();
	require(f.pressed(hid_key_usage::Q) && f.pressed(hid_key_usage::W), "one Q contact UP leaves the peer contact held");
	f.keyboard.releaseSource(b); f.sample();
	require(f.pressed(hid_key_usage::Q) && !f.pressed(hid_key_usage::W), "W UP changes only its own aggregate");
	f.keyboard.releaseSource(c); f.sample(); require(!f.pressed(hid_key_usage::Q), "last Q contributor publishes actual UP");
	std::vector<size_t> sources;
	for (size_t index = 0; index < 300; ++index) { sources.push_back(f.keyboard.allocateSource()); f.keyboard.pressKey(sources.back(), q); }
	f.sample(); require(f.pressed(hid_key_usage::Q), "rare high-water acquisition has no arbitrary browser contact cap");
	for (size_t index = 0; index + 1 < sources.size(); ++index) f.keyboard.releaseSource(sources[index]);
	f.sample(); require(f.pressed(hid_key_usage::Q), "300 aggregate contributors do not overflow the old byte count");
	f.keyboard.releaseSource(sources.back()); f.sample(); require(!f.pressed(hid_key_usage::Q), "high-water final source UP clears Q");
	f.keyboard.pressKey(a, q); f.keyboard.pressKey(a, q); f.keyboard.pressKey(a, w); f.sample();
	require(!f.pressed(hid_key_usage::Q) && f.pressed(hid_key_usage::W), "reused source retargets real old UP/new DOWN without duplicate holds");
	f.keyboard.releaseSource(a); f.sample(); require(!f.pressed(hid_key_usage::W), "retargeted source retires once");
}

void testHeldAndLatchedModifiers() {
	Fixture f;
	const size_t a = f.keyboard.allocateSource(), b = f.keyboard.allocateSource(), letter = f.keyboard.allocateSource();
	f.keyboard.pressKey(a, shift); f.keyboard.pressKey(b, shift); f.keyboard.pressKey(letter, q); f.sample();
	require(f.pressed(hid_key_usage::ShiftLeft) && f.pressed(hid_key_usage::Q), "physical modifier and ordinary sources aggregate");
	f.keyboard.releaseSource(a); f.sample(); require(f.pressed(hid_key_usage::ShiftLeft), "first direct Shift UP cannot retire another Shift source");
	f.keyboard.releaseSource(b); f.sample();
	require(!f.pressed(hid_key_usage::ShiftLeft) && f.pressed(hid_key_usage::Q), "direct Shift UP is immediate while Q remains held");
	f.keyboard.releaseSource(letter);
	f.keyboard.activateKey(0, control); f.keyboard.pressKey(a, control); f.keyboard.pressKey(letter, q);
	f.keyboard.activateKey(0, control); f.keyboard.releaseSource(a); f.sample();
	require(f.pressed(hid_key_usage::ControlLeft), "captured latch retains CTRL independently of direct UP and explicit latch toggle");
	f.keyboard.releaseSource(letter); f.sample(); require(!f.pressed(hid_key_usage::ControlLeft), "last captured latch retires CTRL");
	f.keyboard.activateKey(0, shift); f.keyboard.pressKey(a, shift); f.keyboard.pressKey(letter, w);
	f.keyboard.releaseSource(letter); f.sample(); require(f.pressed(hid_key_usage::ShiftLeft), "one-shot Shift completion cannot release a direct held source");
	f.keyboard.releaseSource(a); f.sample(); require(!f.pressed(hid_key_usage::ShiftLeft), "last direct UP clears completed one-shot latch");
}

void testModifierTapAcrossControllerSources() {
	Fixture f;
	const size_t touch = f.keyboard.allocateSource();
	f.keyboard.pressKey(touch, shift); f.keyboard.selectKey(q, f.keyboard.page()); f.keyboard.activate(0); f.sample();
	require(f.pressed(hid_key_usage::ShiftLeft) && f.pressed(hid_key_usage::Q), "direct touch Shift combines with actual gamepad keyboard activation");
	f.keyboard.releaseSource(0); f.keyboard.releaseSource(touch, true); f.sample();
	require(!f.pressed(hid_key_usage::ShiftLeft) && !f.pressed(hid_key_usage::Q), "controller chord use prevents direct modifier UP from latching on");
	f.keyboard.pressKey(0, w); f.keyboard.pressKey(touch, shift); f.keyboard.releaseSource(0);
	f.keyboard.releaseSource(touch, true); f.sample(); require(!f.pressed(hid_key_usage::ShiftLeft), "modifier begun during an ordinary hold cannot complete an unused tap");
	f.keyboard.pressKey(touch, shift); f.keyboard.releaseSource(touch, false); f.sample(); require(!f.pressed(hid_key_usage::ShiftLeft), "cancel does not complete modifier taps");
	f.keyboard.pressKey(touch, shift); f.keyboard.releaseSource(touch, true); f.sample(); require(f.pressed(hid_key_usage::ShiftLeft), "unused actual UP completes sticky tap");
	f.keyboard.pressKey(touch, shift); f.keyboard.releaseSource(touch, true); f.sample(); require(!f.pressed(hid_key_usage::ShiftLeft), "second unused tap toggles latch off");
	f.keyboard.pressKey(touch, shift); f.keyboard.close(); f.sample(); require(!f.pressed(hid_key_usage::ShiftLeft), "close is actual release, never unused-tap completion");
}

void testFunctionPagesAndView() {
	Fixture f;
	const size_t text = f.keyboard.allocateSource(), fn = f.keyboard.allocateSource();
	f.keyboard.pressKey(text, q); f.keyboard.setPage(KeyboardPage::Functions);
	require(f.keyboard.selectedKey() == 62, "function page owns its genuine F1 initial selection");
	f.keyboard.moveHorizontal(-1); require(f.keyboard.selectedKey() == 67, "horizontal wrap follows actual function row");
	f.keyboard.moveVertical(1); require(f.keyboard.selectedKey() == 73, "vertical navigation follows actual F12 painted column");
	f.keyboard.activate(fn); f.sample();
	require(f.pressed(static_cast<u8>(hid_key_usage::F1 + 11)) && f.pressed(hid_key_usage::Q), "function and hidden-page text sources retain independent real MMIO lifetimes");
	f.keyboard.setPage(KeyboardPage::Text); f.sample(); require(f.pressed(static_cast<u8>(hid_key_usage::F1 + 11)), "page switch never fabricates native UP");
	f.keyboard.releaseSource(fn);
	for (u8 index = 0; index < 12; ++index) {
		const u8 usage = static_cast<u8>(hid_key_usage::F1 + index);
		f.keyboard.pressKey(fn, ON_SCREEN_KEY_INDEX_BY_USAGE[usage]); f.sample(); require(f.pressed(usage), "every function key identity reaches real guest words");
		f.keyboard.releaseSource(fn); f.sample(); require(!f.pressed(usage), "every function-key source retires through existing MMIO sampling");
	}
	f.keyboard.close(); f.sample(); require(!f.pressed(hid_key_usage::Q), "close clears hidden-page sources");
	f.keyboard.open(); f.keyboard.setPage(KeyboardPage::Functions);
	TestVideoOutput output(256, 192);
	VideoPresenter presenter(output, std::make_unique<SoftwareBackend>(256, 192, PSX_MACHINE_SPEC.gxGpuVramBytes), 256, 192);
	Font font; presenter.default_font = &font;
	HostOnScreenKeyboard view(f.keyboard); view.queueRenderCommands(presenter);
	const HostMenuFrame frame = presenter.hostOverlayQueue.consumeHostMenuFrame();
	require(frame.commandRefs[1].glyphs->items[0] == "KEYBOARD: FN", "bitmap title publishes the actual active function page");
	size_t command = 2;
	for (const auto& row : f.keyboard.rows()) for (i16 key : row.keys) {
		require(frame.commandKinds[command] == Host2DKind::Rect, "each function-page key publishes a retained real rectangle");
		const auto& area = frame.commandRefs[command++].rect->area;
		require(frame.commandKinds[command] == Host2DKind::Glyphs, "each function-page key publishes real glyphs");
		const auto& glyph = *frame.commandRefs[command++].glyphs;
		require(glyph.items[0] == f.keyboard.label(key), "painted function label is the exact model identity");
		require(view.selectAt(static_cast<i32>((area.left + area.right) / 2), static_cast<i32>((area.top + area.bottom) / 2)) == key,
			"bitmap hit and paint select the same actual active-page key");
		require(f.keyboard.selectedKey() == key, "bitmap selection updates the injected owner, not an old main-row index");
	}
	require(frame.commandCount == command + HostOnScreenKeyboard::HelpLineCount, "function page publishes only active keys and fixed help");
	require(frame.commandRefs[command + 2].glyphs->items[0] == "START ENTER  SEL+B DEL  SEL+Y PAGE", "native page transition binding is discoverable in the unchanged help row");
	f.keyboard.setPage(KeyboardPage::Symbols); view.queueRenderCommands(presenter);
	require(presenter.hostOverlayQueue.consumeHostMenuFrame().commandRefs[1].glyphs->items[0] == "KEYBOARD: SYMBOLS", "retained title follows the active symbols page");
}

void testQueuedOriginPageTargets() {
	Fixture f;
	const size_t contact = f.keyboard.allocateSource();
	for (bool pageFirst : {true, false}) {
		f.keyboard.open();
		if (pageFirst) f.keyboard.setPage(KeyboardPage::Functions);
		f.keyboard.selectKey(w, KeyboardPage::Text); f.keyboard.pressKey(contact, w);
		if (!pageFirst) f.keyboard.setPage(KeyboardPage::Functions);
		f.sample();
		require(f.keyboard.page() == KeyboardPage::Functions && f.keyboard.selectedKey() == 62,
			"queued old Text target cannot replace active function selection in either native batch order");
		require(f.pressed(hid_key_usage::W), "queued original-page key still forwards its exact physical identity");
		f.keyboard.moveHorizontal(1); require(f.keyboard.selectedKey() == 63, "genuine active function navigation remains valid");
		f.keyboard.setPage(KeyboardPage::Text); require(f.keyboard.selectedKey() == w, "queued target retains the selection of its real origin page");
		f.keyboard.releaseSource(contact); f.sample(); require(!f.pressed(hid_key_usage::W), "origin-page source UP retires normally");
	}
}

void testFractionalCenteredNavigation() {
	constexpr std::array<i16, 2> row0Keys{q, w};
	constexpr std::array<f32, 2> row0Spans{1, 1};
	constexpr std::array<i16, 1> row1Keys{shift};
	constexpr std::array<f32, 1> row1Spans{1.5F};
	const std::array<OnScreenKeyboardRow, 2> textRows{{{row0Keys, row0Spans, 2}, {row1Keys, row1Spans, 1.5F}}};
	const std::array<OnScreenKeyboardPage, 3> pages{{{textRows, q}, NATIVE_KEYBOARD_PAGES[1], NATIVE_KEYBOARD_PAGES[2]}};
	Fixture f(pages);
	f.keyboard.moveHorizontal(1); require(f.keyboard.selectedKey() == w, "injected presentation owns horizontal ordering");
	f.keyboard.moveVertical(1); require(f.keyboard.selectedKey() == shift, "fractional centered row is directly navigable");
	f.keyboard.moveVertical(-1); require(f.keyboard.selectedKey() == q, "exact centered tie retains authored left-first order");
	f.keyboard.setPage(KeyboardPage::Functions); f.keyboard.selectKey(73, f.keyboard.page()); f.keyboard.setPage(KeyboardPage::Text);
	require(f.keyboard.selectedKey() == q, "page switch restores real text selection");
	f.keyboard.setPage(KeyboardPage::Functions); require(f.keyboard.selectedKey() == 73, "page switch restores real function selection");
	constexpr std::array<i16, 3> fractionalKeys0{q, w, 17};
	constexpr std::array<f32, 3> fractionalSpans0{1.6F, 0.6F, 1.4F};
	constexpr std::array<i16, 4> fractionalKeys1{shift, control, alt, 55};
	constexpr std::array<f32, 4> fractionalSpans1{1.35F, 0.4F, 0.5F, 1.35F};
	const std::array<OnScreenKeyboardRow, 2> fractionalRows{{{fractionalKeys0, fractionalSpans0, 3.6F}, {fractionalKeys1, fractionalSpans1, 3.6F}}};
	const std::array<OnScreenKeyboardPage, 3> fractionalPages{{{fractionalRows, w}, NATIVE_KEYBOARD_PAGES[1], NATIVE_KEYBOARD_PAGES[2]}};
	Fixture fractional(fractionalPages); fractional.keyboard.moveVertical(1);
	require(fractional.keyboard.selectedKey() == alt, "3.8-unit W is closer to 4.0-unit ALT than 3.1-unit CTRL; owner never truncates UI spans/centers");
}
} // namespace
int main() {
	try {
		testContactOwnership(); testHeldAndLatchedModifiers(); testModifierTapAcrossControllerSources();
		testFunctionPagesAndView(); testQueuedOriginPageTargets(); testFractionalCenteredNavigation();
		std::cout << "ON-SCREEN-KEYBOARD-MODEL:PASS 6 owner scenarios\n";
		return 0;
	} catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
