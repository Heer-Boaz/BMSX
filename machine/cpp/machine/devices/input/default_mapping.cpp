#include "machine/devices/input/contracts.h"

namespace bmsx {

const InputControllerDefaultMapping& inputControllerDefaultMapping() {
	static const InputControllerDefaultMapping mapping = [] {
		InputControllerDefaultMapping result;
		auto& pointer = result.pointer;
		auto& keyboard = result.keyboard;
		auto& gamepad = result.gamepad;

		pointer["pointer_primary"] = {"pointer_primary"};
		pointer["pointer_secondary"] = {"pointer_secondary"};
		pointer["pointer_aux"] = {"pointer_aux"};
		pointer["pointer_back"] = {"pointer_back"};
		pointer["pointer_forward"] = {"pointer_forward"};
		pointer["pointer_delta"] = {"pointer_delta"};
		pointer["pointer_position"] = {"pointer_position"};
		pointer["pointer_wheel"] = {"pointer_wheel"};

		keyboard["a"] = {"KeyX"};
		keyboard["b"] = {"KeyC"};
		keyboard["x"] = {"KeyZ"};
		keyboard["y"] = {"KeyS"};
		keyboard["lb"] = {"ShiftLeft"};
		keyboard["rb"] = {"ShiftRight"};
		keyboard["lt"] = {"CtrlLeft"};
		keyboard["rt"] = {"CtrlRight"};
		keyboard["select"] = {"Backspace"};
		keyboard["start"] = {"Enter"};
		keyboard["ls"] = {"KeyQ"};
		keyboard["rs"] = {"KeyE"};
		keyboard["up"] = {"ArrowUp"};
		keyboard["down"] = {"ArrowDown"};
		keyboard["left"] = {"ArrowLeft"};
		keyboard["right"] = {"ArrowRight"};
		keyboard["home"] = {"Escape"};
		keyboard["touch"] = {"Space"};

		gamepad["a"] = {"a"};
		gamepad["b"] = {"b"};
		gamepad["x"] = {"x"};
		gamepad["y"] = {"y"};
		gamepad["lb"] = {"lb"};
		gamepad["rb"] = {"rb"};
		gamepad["lt"] = {"lt"};
		gamepad["rt"] = {"rt"};
		gamepad["select"] = {"select"};
		gamepad["start"] = {"start"};
		gamepad["ls"] = {"ls"};
		gamepad["rs"] = {"rs"};
		gamepad["up"] = {"up"};
		gamepad["down"] = {"down"};
		gamepad["left"] = {"left"};
		gamepad["right"] = {"right"};
		gamepad["home"] = {"home"};
		gamepad["touch"] = {"touch"};

		return result;
	}();
	return mapping;
}

} // namespace bmsx
