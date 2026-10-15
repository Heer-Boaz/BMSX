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

void testCodingPunctuationIdentitiesAndSources() {
	constexpr std::array<u8, 75> usages{
		41, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 45, 46, 42,
		43, 20, 26, 8, 21, 23, 28, 24, 12, 18, 19, 47, 48, 49,
		57, 4, 22, 7, 9, 10, 11, 13, 14, 15, 51, 52, 40,
		225, 29, 27, 6, 25, 5, 17, 16, 54, 55, 56, 76,
		224, 226, 44, 80, 81, 82, 79, 74, 77,
		58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 53,
	};
	require(ON_SCREEN_KEY_DEFINITIONS.size() == usages.size(), "Backquote appends to the key identity bank");
	for (size_t key = 0; key < usages.size(); ++key) {
		require(ON_SCREEN_KEY_DEFINITIONS[key].usage == usages[key], "all existing physical key indices remain stable");
		require(ON_SCREEN_KEY_INDEX_BY_USAGE[usages[key]] == static_cast<i16>(key), "usage lookup includes the appended key identity");
	}
	require(MAIN_KEY_COUNT == 60, "native Text page retains its existing sixty keys");
	i16 textKey = 0;
	for (const auto& row : NATIVE_KEYBOARD_PAGES[0].rows) for (i16 key : row.keys) require(key == textKey++, "native Text geometry remains in unchanged physical key order");
	require(textKey == 60, "new Symbols key does not alter the native Text page");
	struct Punctuation { i16 key; u8 usage; const char* base; const char* shifted; };
	constexpr std::array<Punctuation, 8> punctuation{{
		{74, 53, "`", "~"}, {11, 45, "-", "_"}, {12, 46, "=", "+"},
		{25, 47, "[", "{"}, {26, 48, "]", "}"}, {27, 49, "\\", "|"},
		{38, 51, ";", ":"}, {39, 52, "'", "\""},
	}};
	for (const auto& symbol : punctuation) {
		Fixture f;
		const size_t first = f.keyboard.allocateSource(), second = f.keyboard.allocateSource(), modifier = f.keyboard.allocateSource();
		require(ON_SCREEN_KEY_INDEX_BY_USAGE[symbol.usage] == symbol.key, "coding row uses canonical physical key indices");
		require(std::string_view(f.keyboard.label(symbol.key)) == symbol.base, "unshifted label belongs to the physical key");
		f.keyboard.pressKey(first, symbol.key); f.keyboard.pressKey(second, symbol.key); f.sample();
		require(f.memory.readIoU32(IO_INP_KEYS + (symbol.usage >> 5) * IO_WORD_SIZE) == (1u << (symbol.usage & 31)), "base punctuation forwards the exact raw HID word, not text");
		require(!f.pressed(hid_key_usage::ShiftLeft), "base punctuation never invents a modifier");
		f.keyboard.releaseSource(first); f.sample(); require(f.pressed(symbol.usage), "releasing one contact preserves its same-key peer");
		f.keyboard.releaseSource(second); f.sample(); require(!f.pressed(symbol.usage), "last contact releases the punctuation key");

		f.keyboard.pressKey(modifier, shift); f.keyboard.pressKey(first, symbol.key); f.sample();
		require(std::string_view(f.keyboard.label(symbol.key)) == symbol.shifted && f.pressed(symbol.usage) && f.pressed(hid_key_usage::ShiftLeft), "held Shift retains the ordinary HID identity and changes its label");
		f.keyboard.releaseSource(first); f.sample(); require(!f.pressed(symbol.usage) && f.pressed(hid_key_usage::ShiftLeft), "punctuation UP does not release the held modifier");
		f.keyboard.releaseSource(modifier, true); f.sample();
		require(!f.pressed(hid_key_usage::ShiftLeft) && std::string_view(f.keyboard.label(symbol.key)) == symbol.base, "used modifier UP cannot become a sticky tap");

		f.keyboard.activateKey(modifier, shift); f.keyboard.pressKey(first, symbol.key); f.keyboard.pressKey(second, symbol.key); f.sample();
		require(std::string_view(f.keyboard.label(symbol.key)) == symbol.shifted && f.pressed(symbol.usage) && f.pressed(hid_key_usage::ShiftLeft), "sticky Shift captures each real punctuation source");
		f.keyboard.releaseSource(first); f.sample(); require(f.pressed(symbol.usage) && f.pressed(hid_key_usage::ShiftLeft), "remaining punctuation source retains its one-shot modifier lease");
		f.keyboard.releaseSource(second); f.sample(); require(!f.pressed(symbol.usage) && !f.pressed(hid_key_usage::ShiftLeft), "last punctuation UP retires the one-shot Shift lease");

		f.input.postKeyboardEvent(RETROK_RSHIFT, true); f.keyboard.pressKey(first, symbol.key); f.sample(); f.keyboard.updateFeedback(f.time);
		require(std::string_view(f.keyboard.label(symbol.key)) == symbol.shifted && f.pressed(symbol.usage), "routed hardware Shift changes the same physical punctuation label");
		require(f.pressed(hid_key_usage::ShiftRight) && !f.pressed(hid_key_usage::ShiftLeft), "hardware Shift is never republished as virtual Shift");
		f.keyboard.releaseSource(first); f.sample(); require(!f.pressed(symbol.usage) && f.pressed(hid_key_usage::ShiftRight), "punctuation UP preserves hardware Shift");
		f.input.postKeyboardEvent(RETROK_RSHIFT, false); f.sample();
		require(std::string_view(f.keyboard.label(symbol.key)) == symbol.base, "hardware UP restores the base punctuation label");
	}
}

void testBackquoteNativeNavigationAndView() {
	Fixture f;
	constexpr i16 key = ON_SCREEN_KEY_INDEX_BY_USAGE[hid_key_usage::Backquote];
	f.keyboard.setPage(static_cast<size_t>(KeyboardPage::Symbols)); f.keyboard.moveVertical(1);
	require(f.keyboard.selectedKey() == key, "Symbols vertical navigation reaches appended Backquote");
	f.keyboard.moveHorizontal(-1); require(f.keyboard.selectedKey() == ON_SCREEN_KEY_INDEX_BY_USAGE[hid_key_usage::Slash], "row wrap follows the authored punctuation keys");
	f.keyboard.moveHorizontal(1); require(f.keyboard.selectedKey() == key, "horizontal navigation returns to appended Backquote");
	TestVideoOutput output(256, 192);
	VideoPresenter presenter(output, std::make_unique<SoftwareBackend>(256, 192, PSX_MACHINE_SPEC.gxGpuVramBytes), 256, 192);
	Font font; presenter.default_font = &font;
	HostOnScreenKeyboard view(f.keyboard); view.queueRenderCommands(presenter);
	auto frame = presenter.hostOverlayQueue.consumeHostMenuFrame();
	const size_t command = 3 + f.keyboard.rows()[0].keys.size() * 3;
	const auto* rect = frame.commandRefs[command].rect;
	require(frame.commandRefs[command + 2].glyphs->items[0] == "`", "appended key receives a retained real glyph command");
	const auto& area = rect->area;
	require(view.selectAt(static_cast<i32>((area.left + area.right) / 2), static_cast<i32>((area.top + area.bottom) / 2)) == key, "paint and hit testing share the appended key rectangle");
	f.keyboard.activate(0); f.sample(); require(f.pressed(hid_key_usage::Backquote), "native activation forwards raw Backquote");
	f.keyboard.releaseSource(0); f.keyboard.pressKey(1, shift); view.queueRenderCommands(presenter); frame = presenter.hostOverlayQueue.consumeHostMenuFrame();
	require(frame.commandRefs[command + 2].glyphs->items[0] == "~", "same retained key renders tilde with Shift");
	require(frame.commandRefs[command].rect == rect, "shifted rendering reuses the appended physical rectangle");
	f.keyboard.close(); f.sample(); require(!f.pressed(hid_key_usage::Backquote) && !f.pressed(hid_key_usage::ShiftLeft), "close retires appended-key and modifier sources");
}

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
	f.keyboard.pressKey(text, q); f.keyboard.setPage(static_cast<size_t>(KeyboardPage::Functions));
	require(f.keyboard.selectedKey() == 62, "function page owns its genuine F1 initial selection");
	f.keyboard.moveHorizontal(-1); require(f.keyboard.selectedKey() == 67, "horizontal wrap follows actual function row");
	f.keyboard.moveVertical(1); require(f.keyboard.selectedKey() == 73, "vertical navigation follows actual F12 painted column");
	f.keyboard.activate(fn); f.sample();
	require(f.pressed(static_cast<u8>(hid_key_usage::F1 + 11)) && f.pressed(hid_key_usage::Q), "function and hidden-page text sources retain independent real MMIO lifetimes");
	f.keyboard.setPage(static_cast<size_t>(KeyboardPage::Text)); f.sample(); require(f.pressed(static_cast<u8>(hid_key_usage::F1 + 11)), "page switch never fabricates native UP");
	f.keyboard.releaseSource(fn);
	for (u8 index = 0; index < 12; ++index) {
		const u8 usage = static_cast<u8>(hid_key_usage::F1 + index);
		f.keyboard.pressKey(fn, ON_SCREEN_KEY_INDEX_BY_USAGE[usage]); f.sample(); require(f.pressed(usage), "every function key identity reaches real guest words");
		f.keyboard.releaseSource(fn); f.sample(); require(!f.pressed(usage), "every function-key source retires through existing MMIO sampling");
	}
	f.keyboard.close(); f.sample(); require(!f.pressed(hid_key_usage::Q), "close clears hidden-page sources");
	f.keyboard.open(); f.keyboard.setPage(static_cast<size_t>(KeyboardPage::Functions));
	TestVideoOutput output(256, 192);
	VideoPresenter presenter(output, std::make_unique<SoftwareBackend>(256, 192, PSX_MACHINE_SPEC.gxGpuVramBytes), 256, 192);
	Font font; presenter.default_font = &font;
	HostOnScreenKeyboard view(f.keyboard); view.queueRenderCommands(presenter);
	const HostMenuFrame frame = presenter.hostOverlayQueue.consumeHostMenuFrame();
	require(frame.commandRefs[2].glyphs->items[0] == "KEYBOARD: FN", "bitmap title publishes the actual active function page");
	size_t command = 3;
	for (const auto& row : f.keyboard.rows()) for (i16 key : row.keys) {
		require(frame.commandKinds[command] == Host2DKind::Rect, "each function-page key publishes a retained real rectangle");
		const auto& area = frame.commandRefs[command++].rect->area;
		require(frame.commandKinds[command] == Host2DKind::Glyphs, "each function-page key publishes real glyphs");
		const auto& shadow = *frame.commandRefs[command++].glyphs;
		require(frame.commandKinds[command] == Host2DKind::Glyphs, "key foreground follows its retained shadow");
		const auto& glyph = *frame.commandRefs[command++].glyphs;
		require(shadow.items == glyph.items && shadow.x == glyph.x + 1 && shadow.y == glyph.y + 1, "retained label shadow follows the same physical key");
		require(glyph.items[0] == f.keyboard.label(key), "painted function label is the exact model identity");
		require(view.selectAt(static_cast<i32>((area.left + area.right) / 2), static_cast<i32>((area.top + area.bottom) / 2)) == key,
			"bitmap hit and paint select the same actual active-page key");
		require(f.keyboard.selectedKey() == key, "bitmap selection updates the injected owner, not an old main-row index");
	}
	require(frame.commandCount == command + HostOnScreenKeyboard::HelpLineCount * 2, "function page publishes only active keys and fixed help");
	require(frame.commandRefs[command + 5].glyphs->items[0] == "START ENTER  SEL+B DEL  SEL+Y PAGE", "native page transition binding is discoverable in the unchanged help row");
	f.keyboard.setPage(static_cast<size_t>(KeyboardPage::Symbols)); view.queueRenderCommands(presenter);
	require(presenter.hostOverlayQueue.consumeHostMenuFrame().commandRefs[2].glyphs->items[0] == "KEYBOARD: SYMBOLS", "retained title follows the active symbols page");
}

void testQueuedOriginPageTargets() {
	Fixture f;
	const size_t contact = f.keyboard.allocateSource();
	for (bool pageFirst : {true, false}) {
		f.keyboard.open();
		if (pageFirst) f.keyboard.setPage(static_cast<size_t>(KeyboardPage::Functions));
		f.keyboard.selectKey(w, static_cast<size_t>(KeyboardPage::Text)); f.keyboard.pressKey(contact, w);
		if (!pageFirst) f.keyboard.setPage(static_cast<size_t>(KeyboardPage::Functions));
		f.sample();
		require(f.keyboard.page() == static_cast<size_t>(KeyboardPage::Functions) && f.keyboard.selectedKey() == 62,
			"queued old Text target cannot replace active function selection in either native batch order");
		require(f.pressed(hid_key_usage::W), "queued original-page key still forwards its exact physical identity");
		f.keyboard.moveHorizontal(1); require(f.keyboard.selectedKey() == 63, "genuine active function navigation remains valid");
		f.keyboard.setPage(static_cast<size_t>(KeyboardPage::Text)); require(f.keyboard.selectedKey() == w, "queued target retains the selection of its real origin page");
		f.keyboard.releaseSource(contact); f.sample(); require(!f.pressed(hid_key_usage::W), "origin-page source UP retires normally");
	}
}

void testFractionalCenteredNavigation() {
	constexpr std::array<i16, 2> row0Keys{q, w};
	constexpr std::array<f32, 2> row0Starts{0, 1};
	constexpr std::array<f32, 2> row0Spans{1, 1};
	constexpr std::array<i16, 1> row1Keys{shift};
	constexpr std::array<f32, 1> row1Starts{0};
	constexpr std::array<f32, 1> row1Spans{1.5F};
	const std::array<OnScreenKeyboardRow, 2> textRows{{{row0Keys, row0Starts, row0Spans, 2}, {row1Keys, row1Starts, row1Spans, 1.5F}}};
	const std::array<OnScreenKeyboardPage, 3> pages{{{textRows, q}, NATIVE_KEYBOARD_PAGES[1], NATIVE_KEYBOARD_PAGES[2]}};
	Fixture f(pages);
	f.keyboard.moveHorizontal(1); require(f.keyboard.selectedKey() == w, "injected presentation owns horizontal ordering");
	f.keyboard.moveVertical(1); require(f.keyboard.selectedKey() == shift, "fractional centered row is directly navigable");
	f.keyboard.moveVertical(-1); require(f.keyboard.selectedKey() == q, "exact centered tie retains authored left-first order");
	f.keyboard.setPage(static_cast<size_t>(KeyboardPage::Functions)); f.keyboard.selectKey(73, f.keyboard.page()); f.keyboard.setPage(static_cast<size_t>(KeyboardPage::Text));
	require(f.keyboard.selectedKey() == q, "page switch restores real text selection");
	f.keyboard.setPage(static_cast<size_t>(KeyboardPage::Functions)); require(f.keyboard.selectedKey() == 73, "page switch restores real function selection");
	constexpr std::array<i16, 3> fractionalKeys0{q, w, 17};
	constexpr std::array<f32, 3> fractionalStarts0{0, 1.6F, 2.2F};
	constexpr std::array<f32, 3> fractionalSpans0{1.6F, 0.6F, 1.4F};
	constexpr std::array<i16, 4> fractionalKeys1{shift, control, alt, 55};
	constexpr std::array<f32, 4> fractionalStarts1{0, 1.35F, 1.75F, 2.25F};
	constexpr std::array<f32, 4> fractionalSpans1{1.35F, 0.4F, 0.5F, 1.35F};
	const std::array<OnScreenKeyboardRow, 2> fractionalRows{{{fractionalKeys0, fractionalStarts0, fractionalSpans0, 3.6F}, {fractionalKeys1, fractionalStarts1, fractionalSpans1, 3.6F}}};
	const std::array<OnScreenKeyboardPage, 3> fractionalPages{{{fractionalRows, w}, NATIVE_KEYBOARD_PAGES[1], NATIVE_KEYBOARD_PAGES[2]}};
	Fixture fractional(fractionalPages); fractional.keyboard.moveVertical(1);
	require(fractional.keyboard.selectedKey() == alt, "3.8-unit W is closer to 4.0-unit ALT than 3.1-unit CTRL; owner never truncates UI spans/centers");
}

void testExplicitRowStarts() {
	constexpr i16 up = ON_SCREEN_KEY_INDEX_BY_USAGE[hid_key_usage::ArrowUp];
	constexpr i16 down = ON_SCREEN_KEY_INDEX_BY_USAGE[hid_key_usage::ArrowDown];
	constexpr i16 left = ON_SCREEN_KEY_INDEX_BY_USAGE[hid_key_usage::ArrowLeft];
	constexpr i16 right = ON_SCREEN_KEY_INDEX_BY_USAGE[hid_key_usage::ArrowRight];
	constexpr std::array<i16, 3> topKeys{q, up, w};
	constexpr std::array<f32, 3> topStarts{0, 3, 5}, topSpans{1, 1, 1};
	constexpr std::array<i16, 5> bottomKeys{control, left, down, right, 55};
	constexpr std::array<f32, 5> bottomStarts{0, 2, 3, 4, 5}, bottomSpans{1, 1, 1, 1, 1};
	const std::array<OnScreenKeyboardRow, 2> rows{{{topKeys, topStarts, topSpans, 6}, {bottomKeys, bottomStarts, bottomSpans, 6}}};
	const std::array<OnScreenKeyboardPage, 3> pages{{{rows, up}, NATIVE_KEYBOARD_PAGES[1], NATIVE_KEYBOARD_PAGES[2]}};
	Fixture f(pages);
	f.keyboard.moveVertical(1); require(f.keyboard.selectedKey() == down, "Up aligns directly over Down, not compressed second-column Left");
	f.keyboard.moveVertical(-1); require(f.keyboard.selectedKey() == up, "vertical navigation follows the authored inverted T");
	f.keyboard.moveHorizontal(1); require(f.keyboard.selectedKey() == w, "horizontal navigation skips non-key holes");
	f.keyboard.moveHorizontal(1); require(f.keyboard.selectedKey() == q, "horizontal wrap follows only physical key identities");
	f.keyboard.moveHorizontal(-1); require(f.keyboard.selectedKey() == w, "reverse horizontal navigation preserves authored ordering");
	TestVideoOutput output(256, 192);
	VideoPresenter presenter(output, std::make_unique<SoftwareBackend>(256, 192, PSX_MACHINE_SPEC.gxGpuVramBytes), 256, 192);
	Font font; presenter.default_font = &font;
	HostOnScreenKeyboard view(f.keyboard); view.queueRenderCommands(presenter);
	const auto frame = presenter.hostOverlayQueue.consumeHostMenuFrame();
	const auto& qRect = frame.commandRefs[3].rect->area;
	const auto& upRect = frame.commandRefs[6].rect->area;
	const auto& downRect = frame.commandRefs[18].rect->area;
	require(upRect.left - qRect.left == 3 * (qRect.right - qRect.left + 1), "bitmap geometry retains the two-column authored gap");
	require(upRect.left == downRect.left, "bitmap Up and Down share the same authored column");
	require(view.selectAt(static_cast<i32>((upRect.left + upRect.right) / 2), static_cast<i32>((upRect.top + upRect.bottom) / 2)) == up, "authored Up rectangle owns Up input");
	require(view.selectAt(static_cast<i32>(qRect.right + (qRect.right - qRect.left) / 2), static_cast<i32>((qRect.top + qRect.bottom) / 2)) == -1, "reserved command space does not acquire a physical key");
	for (const auto& page : NATIVE_KEYBOARD_PAGES) for (const auto& row : page.rows) {
		f32 units = 0;
		require(row.keys.size() == row.starts.size() && row.keys.size() == row.spans.size(), "all native physical keys own explicit geometry");
		for (size_t column = 0; column < row.keys.size(); ++column) {
			require(row.starts[column] == units, "native row starts retain their original contiguous positions");
			units += row.spans[column];
		}
		require(units == row.units, "native row extents remain unchanged");
	}
}

void testTwoAuthoredPages() {
	const std::array<OnScreenKeyboardPage, 2> pages{NATIVE_KEYBOARD_PAGES[0], NATIVE_KEYBOARD_PAGES[2]};
	Fixture f(pages);
	const size_t textSource = f.keyboard.allocateSource(), functionSource = f.keyboard.allocateSource(), shiftSource = f.keyboard.allocateSource();
	f.keyboard.pressKey(shiftSource, shift); f.keyboard.pressKey(textSource, q); f.keyboard.selectKey(w, 0);
	f.keyboard.command(0, OnScreenKeyboardCommand::TogglePage);
	require(f.keyboard.page() == 1 && f.keyboard.selectedKey() == 62, "generic page index follows the authored second page, not native Symbols");
	f.keyboard.pressKey(functionSource, 62); f.keyboard.selectKey(63, 1);
	f.keyboard.command(0, OnScreenKeyboardCommand::TogglePage); f.sample();
	require(f.keyboard.page() == 0 && f.keyboard.selectedKey() == w, "two-page cycle restores the main page selection");
	require(f.pressed(hid_key_usage::Q) && f.pressed(hid_key_usage::F1) && f.pressed(hid_key_usage::ShiftLeft), "page cycling retains ordinary and modifier source lifetimes");
	f.keyboard.command(0, OnScreenKeyboardCommand::TogglePage);
	require(f.keyboard.page() == 1 && f.keyboard.selectedKey() == 63, "the auxiliary page retains its own selection");
	f.keyboard.releaseSource(textSource); f.sample();
	require(!f.pressed(hid_key_usage::Q) && f.pressed(hid_key_usage::F1) && f.pressed(hid_key_usage::ShiftLeft), "one hidden-page source UP cannot clear other sources");
	f.keyboard.releaseSource(functionSource); f.keyboard.releaseSource(shiftSource); f.sample();
	require(!f.pressed(hid_key_usage::F1) && !f.pressed(hid_key_usage::ShiftLeft), "actual final source releases reach guest input");
	f.keyboard.close(); f.keyboard.open();
	require(f.keyboard.page() == 0 && f.keyboard.selectedKey() == pages[0].initialKey, "open resets to the authored first page");
}
void testHardwareAndVirtualRouting() {
	Fixture f;
	const size_t modifier = f.keyboard.allocateSource(), letter = f.keyboard.allocateSource();
	f.input.postKeyboardEvent(RETROK_RCTRL, true);
	f.keyboard.pressKey(modifier, shift); f.keyboard.pressKey(letter, q); f.sample();
	require(!f.input.supervisorRequestLineHigh() && f.pressed(hid_key_usage::ShiftLeft) && f.pressed(hid_key_usage::Q), "virtual Shift is typing, not a physical host control chord");
	f.input.postKeyboardEvent(RETROK_LSHIFT, true); f.sample();
	require(f.input.supervisorRequestLineHigh() && f.pressed(hid_key_usage::ShiftLeft), "physical host chord still triggers without stealing same-key virtual Shift");
	f.input.postKeyboardEvent(RETROK_RCTRL, false); f.sample();
	require(!f.input.supervisorRequestLineHigh() && f.pressed(hid_key_usage::ShiftLeft), "physical modifier release preserves virtual Shift");
	f.keyboard.close(); f.sample();
	require(!f.pressed(hid_key_usage::ShiftLeft) && !f.pressed(hid_key_usage::Q), "virtual close preserves physical chord capture until the hardware releases");
	f.input.postKeyboardEvent(RETROK_LSHIFT, false); f.sample();
	f.input.postKeyboardEvent(RETROK_LSHIFT, true); f.input.postKeyboardEvent(RETROK_q, true);
	f.keyboard.open(); f.keyboard.pressKey(modifier, shift); f.keyboard.pressKey(letter, q); f.sample();
	f.keyboard.close(); f.sample();
	require(f.pressed(hid_key_usage::ShiftLeft) && f.pressed(hid_key_usage::Q), "virtual close cannot release ordinary or modifier hardware contributions");
	f.keyboard.open(); f.keyboard.pressKey(modifier, shift); f.keyboard.pressKey(letter, q);
	f.input.postKeyboardEvent(RETROK_LSHIFT, false); f.input.postKeyboardEvent(RETROK_q, false); f.sample();
	require(f.pressed(hid_key_usage::ShiftLeft) && f.pressed(hid_key_usage::Q), "hardware UP cannot release independent virtual contributors");
	f.keyboard.close(); f.input.reset(); f.sample();
	require(!f.pressed(hid_key_usage::ShiftLeft) && !f.pressed(hid_key_usage::Q), "close and host reset retire both sources");
}

void testHybridModifierOwnership() {
	for (const bool physicalFirst : {false, true}) {
		Fixture f; const size_t source = f.keyboard.allocateSource();
		if (physicalFirst) f.input.postKeyboardEvent(RETROK_q, true);
		f.keyboard.pressKey(source, shift);
		if (!physicalFirst) f.input.postKeyboardEvent(RETROK_q, true);
		f.sample();
		require(f.pressed(hid_key_usage::Q) && f.pressed(hid_key_usage::ShiftLeft), "hybrid chord reaches guest input");
		f.input.postKeyboardEvent(RETROK_q, false); f.keyboard.releaseSource(source, true); f.sample();
		require(!f.keyboard.shiftActive() && !f.pressed(hid_key_usage::ShiftLeft), "a touch modifier used by hardware cannot become an unused sticky tap");
	}
	Fixture f;
	constexpr i16 digit = ON_SCREEN_KEY_INDEX_BY_USAGE[hid_key_usage::Digit1];
	const u64 revision = f.keyboard.revision();
	f.input.postKeyboardEvent(RETROK_RSHIFT, true); f.sample(); f.keyboard.updateFeedback(f.time);
	require(std::string_view(f.keyboard.label(digit)) == "!" && f.keyboard.isKeyPressed(shift), "routed hardware modifiers update labels and modifier highlight");
	require(f.keyboard.revision() == revision + 1, "hardware modifier transition invalidates presentation once");
	const u64 stableRevision = f.keyboard.revision();
	f.sample(); f.keyboard.updateFeedback(f.time);
	require(f.keyboard.revision() == stableRevision, "unchanged hardware modifier has no per-frame revision churn");
	const size_t letter = f.keyboard.allocateSource(); f.keyboard.pressKey(letter, digit); f.sample();
	require(f.pressed(hid_key_usage::ShiftRight) && !f.pressed(hid_key_usage::ShiftLeft), "hardware modifier is never republished as virtual HID");
	f.keyboard.releaseSource(letter); f.input.postKeyboardEvent(RETROK_RSHIFT, false); f.sample(); f.keyboard.updateFeedback(f.time);
	require(std::string_view(f.keyboard.label(digit)) == "1", "hardware UP updates the symbol legend");
	f.input.postKeyboardEvent(RETROK_RCTRL, true); f.input.postKeyboardEvent(RETROK_LSHIFT, true);
	f.keyboard.pressKey(letter, digit); f.sample(); f.keyboard.updateFeedback(f.time);
	require(f.input.supervisorRequestLineHigh() && !f.pressed(hid_key_usage::ShiftLeft) && f.pressed(hid_key_usage::Digit1), "physical host chord consumes only hardware input");
	require(std::string_view(f.keyboard.label(digit)) == "1" && !f.keyboard.isKeyPressed(shift), "consumed hardware Shift cannot advertise shifted virtual typing");
	f.input.postKeyboardEvent(RETROK_q, true);
	const u64 generation = f.input.physicalOrdinaryPressGeneration();
	f.input.postKeyboardEvent(RETROK_q, true);
	require(f.input.physicalOrdinaryHeldCount() == 1 && f.input.physicalOrdinaryPressGeneration() == generation, "native repeats cannot change ordinary hardware generation");
	f.keyboard.close(); f.input.reset();
	require(f.input.physicalOrdinaryHeldCount() == 0 && f.input.physicalOrdinaryPressGeneration() == generation, "reset clears hardware holds without aliasing an old gesture generation");
}

} // namespace
int main() {
	try {
		testCodingPunctuationIdentitiesAndSources(); testBackquoteNativeNavigationAndView();
		testContactOwnership(); testHeldAndLatchedModifiers(); testModifierTapAcrossControllerSources();
		testFunctionPagesAndView(); testQueuedOriginPageTargets(); testFractionalCenteredNavigation(); testExplicitRowStarts(); testTwoAuthoredPages(); testHardwareAndVirtualRouting(); testHybridModifierOwnership();
		std::cout << "ON-SCREEN-KEYBOARD-MODEL:PASS 12 owner scenarios\n";
		return 0;
	} catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
