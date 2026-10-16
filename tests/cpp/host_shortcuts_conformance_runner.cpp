#include "input.h"

#include <array>
#include <fstream>
#include <iostream>
#include <memory>
#include <stdexcept>
#include <string>

namespace {
using namespace bmsx;

// Vector words use the machine's positional ABI. The callback still exercises
// the real RetroPad producer conversion rather than feeding internal state.
constexpr std::array kRetroButtons{
	InputControllerGamepadButtonBit::A, InputControllerGamepadButtonBit::X,
	InputControllerGamepadButtonBit::Select, InputControllerGamepadButtonBit::Start,
	InputControllerGamepadButtonBit::Up, InputControllerGamepadButtonBit::Down,
	InputControllerGamepadButtonBit::Left, InputControllerGamepadButtonBit::Right,
	InputControllerGamepadButtonBit::B, InputControllerGamepadButtonBit::Y,
	InputControllerGamepadButtonBit::LeftBumper, InputControllerGamepadButtonBit::RightBumper,
	InputControllerGamepadButtonBit::LeftTrigger, InputControllerGamepadButtonBit::RightTrigger,
	InputControllerGamepadButtonBit::LeftStick, InputControllerGamepadButtonBit::RightStick,
};
struct PhysicalKey { InputControllerGamepadButtonBit bit; unsigned retro; u8 hid; };
constexpr std::array kPhysicalKeys{
	PhysicalKey{InputControllerGamepadButtonBit::Select, RETROK_RCTRL, hid_key_usage::ControlRight},
	PhysicalKey{InputControllerGamepadButtonBit::Start, RETROK_RALT, hid_key_usage::AltRight},
	PhysicalKey{InputControllerGamepadButtonBit::LeftBumper, RETROK_LSHIFT, hid_key_usage::ShiftLeft},
	PhysicalKey{InputControllerGamepadButtonBit::A, RETROK_x, hid_key_usage::X},
	PhysicalKey{InputControllerGamepadButtonBit::X, RETROK_z, hid_key_usage::Z},
};
std::array<u32, INPUT_CONTROLLER_PAD_COUNT> pads{};
void poll() {}
bool RETRO_CALLCONV supervisor() { return false; }
i16 inputState(unsigned port, unsigned device, unsigned, unsigned id) {
	return device == RETRO_DEVICE_JOYPAD
		&& (pads[port] & (1u << static_cast<u32>(kRetroButtons[id]))) != 0u;
}

struct Fixture {
	LibretroInput input{supervisor};
	u32 keyboard = 0u;
	u32 virtualKeys = 0u;
	Fixture() {
		pads.fill(0u);
		input.setInputPollCallback(poll);
		input.setInputStateCallback(inputState);
	}
	void setVirtual(u32 word) {
		for (const auto& key : kPhysicalKeys) {
			const u32 mask = 1u << static_cast<u32>(key.bit);
			if (((virtualKeys ^ word) & mask) != 0u) input.setVirtualKeyboardKey(key.hid, (word & mask) != 0u);
		}
		virtualKeys = word;
	}
	void frame(f64 time, u32 physicalKeys) {
		for (const auto& key : kPhysicalKeys) {
			const u32 mask = 1u << static_cast<u32>(key.bit);
			if (((keyboard ^ physicalKeys) & mask) != 0u) input.postKeyboardEvent(key.retro, (physicalKeys & mask) != 0u);
		}
		keyboard = physicalKeys;
		input.poll(320, 240, time);
		InputControllerSnapshot snapshot{};
		input.sampleInputControllerSnapshot(snapshot, InputControllerSampleContext::Normal);
		std::cout << "{\"action\":" << static_cast<unsigned>(input.hostMenuShortcutAction())
			<< ",\"keyboard\":" << (input.hostShortcutJustPressed(InputControllerGamepadButtonBit::X) ? "true" : "false")
			<< ",\"pads\":[";
		for (size_t index = 0; index < snapshot.pads.size(); ++index) {
			if (index != 0) std::cout << ',';
			std::cout << snapshot.pads[index].buttons;
		}
		std::cout << "],\"keys\":[";
		for (size_t index = 0; index < snapshot.keyWords.size(); ++index) {
			if (index != 0) std::cout << ',';
			std::cout << snapshot.keyWords[index];
		}
		std::cout << "]}\n";
	}
};
}

int main(int argc, char** argv) {
	try {
		if (argc != 2) throw std::runtime_error("Expected host shortcut vectors path");
		std::ifstream file(argv[1]);
		if (!file) throw std::runtime_error("Unable to open host shortcut vectors");
		std::unique_ptr<Fixture> fixture;
		std::string op;
		while (file >> op) {
			if (op == "RESET") fixture = std::make_unique<Fixture>();
			else if (op == "FRAME") {
				f64 time; u32 keyboard;
				file >> time >> keyboard;
				for (auto& pad : pads) file >> pad;
				fixture->frame(time, keyboard);
			} else if (op == "CANCEL") fixture->input.cancelControlShortcutGestures();
			else if (op == "MASK") { u32 mask; file >> mask; fixture->input.setGamepadHostShortcutTargets(mask); }
			else if (op == "VIRTUAL") { u32 mask; file >> mask; fixture->setVirtual(mask); }
			else if (op == "DEVICE") {
				unsigned port; bool enabled; file >> port >> enabled;
				fixture->input.setControllerDevice(port, enabled ? RETRO_DEVICE_JOYPAD : RETRO_DEVICE_NONE);
				pads[port] = 0u;
			} else if (op == "INPUT_RESET") {
				fixture->input.reset();
				fixture->keyboard = fixture->virtualKeys = 0u;
				pads.fill(0u);
			} else throw std::runtime_error("Unknown host shortcut vector: " + op);
		}
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
