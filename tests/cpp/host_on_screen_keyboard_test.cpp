#include "host_on_screen_keyboard.h"
#include "hid_keys.h"
#include "input.h"
#include "common/rect.h"
#include "render/shared/bmsx_font.h"
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
	void setDisplaySize(i32, i32) override {}
};

void testFeedback() {
	constexpr u32 idleColor = 0xff252525u;
	constexpr u32 selectedColor = 0xff1e6a95u;
	constexpr u32 pressedColor = 0xffffca55u;
	constexpr u32 textColor = 0xffefefefu;
	constexpr u32 pressedTextColor = 0xff101010u;
	constexpr size_t q = 15u, w = 16u, backspace = 13u, shift = 41u, control = 53u;
	TestVideoOutput video;
	VideoPresenter presenter(video, std::make_unique<SoftwareBackend>(320, 240, PSX_MACHINE_SPEC.gxGpuVramBytes), 320, 240);
	Font font;
	presenter.default_font = &font;
	LibretroInput input(supervisor);
	input.setInputPollCallback(poll);
	input.setInputStateCallback(state);
	HostOnScreenKeyboard keyboard;
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
		keyboard.queueRenderCommands(presenter);
		return presenter.hostOverlayQueue.consumeHostMenuFrame();
	};
	const auto expectKey = [&](size_t key, u32 background, u32 foreground) {
		const HostMenuFrame commands = frame();
		require(commands.commandKinds[2u + key * 2u] == Host2DKind::Rect, "key publishes a real rectangle command");
		require(commands.commandKinds[3u + key * 2u] == Host2DKind::Glyphs, "key publishes a real glyph command");
		require(commands.commandRefs[2u + key * 2u].rect->color == background, "published key background matches forwarded input feedback");
		require(commands.commandRefs[3u + key * 2u].glyphs->color == foreground, "published key label remains legible against feedback");
	};
	const auto select = [&](size_t key) {
		const RectBounds& area = frame().commandRefs[2u + key * 2u].rect->area;
		const Vec2 center = middlepoint_area(area);
		require(keyboard.selectAt(static_cast<i32>(center.x), static_cast<i32>(center.y)) == static_cast<i32>(key), "selection comes from the published key geometry");
	};
	const auto expectHomeEndHelp = [&](u32 color) {
		const HostMenuFrame commands = frame();
		require(commands.commandRefs[2u + HostOnScreenKeyboard::KeyCount * 2u + 1u].glyphs->color == color, "Home/End forwarding highlights their existing binding help line");
	};

	keyboard.open();
	advance(1000);
	expectKey(q, selectedColor, textColor);
	select(w);
	sample();
	require(!pressed(hid_key_usage::W), "selection alone never forwards a key or shows pressed feedback");
	expectKey(w, selectedColor, textColor);
	expectKey(q, idleColor, textColor);
	select(q);
	keyboard.activate(input, 0);
	sample();
	require(pressed(hid_key_usage::Q), "held feedback accompanies the actual key down");
	expectKey(q, pressedColor, pressedTextColor);
	advance(5000);
	expectKey(q, pressedColor, pressedTextColor);
	keyboard.releaseSource(input, 0);
	sample();
	require(!pressed(hid_key_usage::Q), "afterglow does not stretch raw input lifetime");
	expectKey(q, pressedColor, pressedTextColor);
	advance(5119);
	expectKey(q, pressedColor, pressedTextColor);
	advance(5120);
	expectKey(q, selectedColor, textColor);

	advance(5200);
	keyboard.activate(input, HostOnScreenKeyboard::PointerSource);
	keyboard.releaseSource(input, HostOnScreenKeyboard::PointerSource);
	sample();
	require(!pressed(hid_key_usage::Q), "a completed short pointer tap is already released in the sampled input");
	expectKey(q, pressedColor, pressedTextColor);
	advance(5320);
	expectKey(q, selectedColor, textColor);

	advance(5400);
	keyboard.activate(input, 0);
	keyboard.activate(input, HostOnScreenKeyboard::PointerSource);
	keyboard.releaseSource(input, 0);
	advance(6000);
	sample();
	require(pressed(hid_key_usage::Q), "one independent contributor cannot end another contributor's feedback or key");
	expectKey(q, pressedColor, pressedTextColor);
	keyboard.releaseSource(input, HostOnScreenKeyboard::PointerSource);
	sample();
	require(!pressed(hid_key_usage::Q), "the final contributor emits key up immediately");
	advance(6120);
	expectKey(q, selectedColor, textColor);

	advance(6200);
	keyboard.activate(input, 0);
	select(w);
	keyboard.activate(input, HostOnScreenKeyboard::PointerSource);
	keyboard.releaseSource(input, 0);
	advance(6320);
	expectKey(q, idleColor, textColor);
	expectKey(w, pressedColor, pressedTextColor);
	sample();
	require(!pressed(hid_key_usage::Q) && pressed(hid_key_usage::W), "simultaneously held letters retain independent input and visual lifetimes");
	keyboard.releaseSource(input, HostOnScreenKeyboard::PointerSource);

	select(q);
	advance(6400);
	keyboard.activate(input, 0);
	keyboard.releaseSource(input, 0);
	advance(6450);
	keyboard.activate(input, 0);
	advance(6520);
	expectKey(q, pressedColor, pressedTextColor);
	advance(6700);
	keyboard.releaseSource(input, 0);
	advance(6819);
	expectKey(q, pressedColor, pressedTextColor);
	advance(6820);
	expectKey(q, selectedColor, textColor);

	advance(6900);
	keyboard.command(input, 1, OnScreenKeyboardCommand::Backspace);
	expectKey(backspace, pressedColor, pressedTextColor);
	expectKey(q, selectedColor, textColor);
	keyboard.releaseSource(input, 1);
	sample();
	require(!pressed(hid_key_usage::Backspace), "command-key feedback never delays Backspace key up");
	advance(7020);
	expectKey(backspace, idleColor, textColor);

	advance(7100);
	keyboard.command(input, 3, OnScreenKeyboardCommand::Shift);
	keyboard.activate(input, 0);
	keyboard.command(input, 3, OnScreenKeyboardCommand::Shift);
	select(shift);
	sample();
	require(pressed(hid_key_usage::ShiftLeft), "captured shift remains physically forwarded after sticky state ends");
	expectKey(shift, pressedColor, pressedTextColor);
	keyboard.releaseSource(input, 0);
	sample();
	require(!pressed(hid_key_usage::ShiftLeft), "captured shift final release does not wait for visual expiry");
	advance(7219);
	expectKey(shift, pressedColor, pressedTextColor);
	advance(7220);
	expectKey(shift, selectedColor, textColor);

	advance(7300);
	select(control);
	keyboard.activate(input, 3);
	expectKey(control, pressedColor, pressedTextColor);
	select(q);
	keyboard.activate(input, 0);
	select(control);
	keyboard.activate(input, 3);
	sample();
	require(pressed(hid_key_usage::ControlLeft), "captured sticky control remains down until its key source ends");
	expectKey(control, pressedColor, pressedTextColor);
	keyboard.releaseSource(input, 0);
	sample();
	require(!pressed(hid_key_usage::ControlLeft), "captured sticky modifier release is immediate");
	advance(7420);
	expectKey(control, selectedColor, textColor);

	for (const auto command : {OnScreenKeyboardCommand::Home, OnScreenKeyboardCommand::End}) {
		advance(time + 200);
		keyboard.command(input, 0, command);
		expectHomeEndHelp(pressedColor);
		keyboard.releaseSource(input, 0);
		sample();
		require(!pressed(hid_key_usage::Home) && !pressed(hid_key_usage::End), "hidden navigation-key feedback cannot keep navigation input held");
		expectHomeEndHelp(pressedColor);
		advance(time + 120);
		expectHomeEndHelp(0xffb2b2b2u);
	}

	select(q);
	keyboard.activate(input, 0);
	keyboard.releaseSource(input, 0);
	expectKey(q, pressedColor, pressedTextColor);
	keyboard.close(input);
	keyboard.open();
	expectKey(q, selectedColor, textColor);
	expectHomeEndHelp(0xffb2b2b2u);
}
}

int main() {
	try {
		LibretroInput input(supervisor);
		input.setInputPollCallback(poll);
		input.setInputStateCallback(state);
		HostOnScreenKeyboard keyboard;
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
			keyboard.activate(input, 0);
			for (int frame = 0; frame < hostHz / 10; ++frame) {
				sample(1000.0 / hostHz);
				require(pressed(hid_key_usage::Q), "100ms physical hold survives every host poll");
			}
			keyboard.releaseSource(input, 0);
			sample();
			require(!pressed(hid_key_usage::Q), "actual source release produces key up");
		}
		keyboard.activate(input, 0);
		keyboard.activate(input, HostOnScreenKeyboard::PointerSource);
		keyboard.releaseSource(input, 0);
		sample();
		require(pressed(hid_key_usage::Q), "pointer independently retains the shared key");
		keyboard.releaseSource(input, HostOnScreenKeyboard::PointerSource);
		sample();
		require(!pressed(hid_key_usage::Q), "final shared contributor releases the key");
		keyboard.activate(input, 0);
		keyboard.moveHorizontal(1);
		keyboard.activate(input, HostOnScreenKeyboard::PointerSource);
		keyboard.command(input, 2, OnScreenKeyboardCommand::Backspace);
		sample();
		require(pressed(hid_key_usage::Q) && pressed(hid_key_usage::W) && pressed(hid_key_usage::Backspace), "moving selection never retargets held keys");
		keyboard.releaseSource(input, 0);
		keyboard.releaseSource(input, 2);
		sample();
		require(!pressed(hid_key_usage::Q) && !pressed(hid_key_usage::Backspace) && pressed(hid_key_usage::W), "different source keys release independently");
		keyboard.releaseSource(input, HostOnScreenKeyboard::PointerSource);
		keyboard.open();
		keyboard.command(input, 3, OnScreenKeyboardCommand::Shift);
		keyboard.activate(input, 0);
		keyboard.moveHorizontal(1);
		keyboard.activate(input, 1);
		keyboard.releaseSource(input, 0);
		sample();
		require(pressed(hid_key_usage::W) && pressed(hid_key_usage::ShiftLeft), "shift belongs to every still-held shifted key");
		keyboard.releaseSource(input, 1);
		sample();
		require(!pressed(hid_key_usage::ShiftLeft), "one-shot shift ends with the final shifted source");
		keyboard.open();
		for (int row = 0; row < 3; ++row) keyboard.moveVertical(1);
		keyboard.moveHorizontal(-1);
		keyboard.activate(input, 3);
		keyboard.command(input, 0, OnScreenKeyboardCommand::Space);
		keyboard.activate(input, 3);
		sample();
		require(pressed(hid_key_usage::ControlLeft) && pressed(hid_key_usage::Space), "toggling a sticky modifier cannot alter an already-held key");
		keyboard.releaseSource(input, 0);
		sample();
		require(!pressed(hid_key_usage::ControlLeft) && !pressed(hid_key_usage::Space), "captured sticky modifier releases with its key");
		keyboard.command(input, 0, OnScreenKeyboardCommand::Backspace);
		for (int frame = 0; frame < 120; ++frame) {
			sample(1000.0 / 120);
			require(pressed(hid_key_usage::Backspace), "held special keys do not become host-generated repeat pulses");
		}
		keyboard.command(input, 1, OnScreenKeyboardCommand::Home);
		keyboard.command(input, 2, OnScreenKeyboardCommand::End);
		keyboard.close(input);
		sample();
		for (u32 word : snapshot.keyWords) require(word == 0u, "closing releases every held virtual key and modifier");
		keyboard.open();
		keyboard.activate(input, 0);
		input.postKeyboardEvent(RETROK_q, true);
		keyboard.releaseSource(input, 0);
		sample();
		require(pressed(hid_key_usage::Q), "physical keyboard ownership outlives the released overlay source");
		input.postKeyboardEvent(RETROK_q, false);
		sample();
		require(!pressed(hid_key_usage::Q), "final physical keyboard release clears the sampled bit");
		testFeedback();
		std::cout << "HOST-ON-SCREEN-KEYBOARD:PASS\n";
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
