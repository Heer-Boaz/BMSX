#include "host_on_screen_keyboard.h"
#include "hid_keys.h"
#include "input.h"
#include <iostream>
#include <stdexcept>

namespace {
using namespace bmsx;
void poll() {}
i16 state(unsigned, unsigned, unsigned, unsigned) { return 0; }
bool RETRO_CALLCONV supervisor() { return false; }
void require(bool condition, const char* message) { if (!condition) throw std::runtime_error(message); }
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
		std::cout << "HOST-ON-SCREEN-KEYBOARD:PASS\n";
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
