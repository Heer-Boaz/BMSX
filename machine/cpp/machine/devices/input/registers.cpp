#include "machine/devices/input/registers.h"

#include "machine/bus/io.h"
#include "machine/common/numeric.h"
#include "machine/memory/memory.h"

namespace bmsx {

void InputControllerRegisterFile::reset() {
	state = InputControllerRegisterState{};
}

InputControllerRegisterState InputControllerRegisterFile::captureState() const {
	return state;
}

void InputControllerRegisterFile::restoreState(const InputControllerRegisterState& restoredState) {
	state = restoredState;
}

i32 InputControllerRegisterFile::selectedPadIndex() const {
	return static_cast<i32>(state.outputPort & static_cast<u32>(INPUT_CONTROLLER_PAD_COUNT - 1));
}

void InputControllerRegisterFile::latchSnapshot(const InputControllerSnapshot& snapshot) {
	for (int i = 0; i < INPUT_CONTROLLER_KEY_WORD_COUNT; i += 1) {
		state.keyWords[i] = snapshot.keyWords[i];
	}
	state.pointerButtons = snapshot.pointerButtons;
	state.pointerXQ16 = encodeSignedFix16(snapshot.pointerX);
	state.pointerYQ16 = encodeSignedFix16(snapshot.pointerY);
	state.pointerWheelQ16 = encodeSignedFix16(snapshot.pointerWheel);
	state.outputStatus = snapshot.rumbleSupportMask;
	for (int pad = 0; pad < INPUT_CONTROLLER_PAD_COUNT; pad += 1) {
		const InputControllerPadSnapshot& padSnapshot = snapshot.pads[pad];
		state.padButtons[pad] = padSnapshot.buttons;
		for (int axis = 0; axis < INPUT_CONTROLLER_PAD_AXIS_COUNT; axis += 1) {
			state.padAxesQ16[pad * INPUT_CONTROLLER_PAD_AXIS_COUNT + axis] = encodeSignedFix16(padSnapshot.axes[axis]);
		}
	}
}

void InputControllerRegisterFile::write(uint32_t addr, Value value) {
	switch (addr) {
		case IO_INP_CTRL:
			state.ctrl = toU32(value);
			return;
		case IO_INP_OUTPUT_PORT:
			state.outputPort = toU32(value);
			return;
		case IO_INP_OUTPUT_INTENSITY_Q16:
			state.outputIntensityQ16 = toU32(value);
			return;
		case IO_INP_OUTPUT_DURATION_MS:
			state.outputDurationMs = toU32(value);
			return;
	}
}

void InputControllerRegisterFile::mirror(Memory& memory) const {
	memory.writeIoValue(IO_INP_CTRL, valueNumber(static_cast<double>(state.ctrl)));
	for (int i = 0; i < INPUT_CONTROLLER_KEY_WORD_COUNT; i += 1) {
		memory.writeIoValue(IO_INP_KEYS + static_cast<u32>(i) * IO_WORD_SIZE, valueNumber(static_cast<double>(state.keyWords[i])));
	}
	memory.writeIoValue(IO_INP_POINTER_BUTTONS, valueNumber(static_cast<double>(state.pointerButtons)));
	memory.writeIoValue(IO_INP_POINTER_X, valueNumber(static_cast<double>(state.pointerXQ16)));
	memory.writeIoValue(IO_INP_POINTER_Y, valueNumber(static_cast<double>(state.pointerYQ16)));
	memory.writeIoValue(IO_INP_POINTER_WHEEL, valueNumber(static_cast<double>(state.pointerWheelQ16)));
	for (int pad = 0; pad < INPUT_CONTROLLER_PAD_COUNT; pad += 1) {
		const u32 padBase = IO_INP_PADS + static_cast<u32>(pad) * IO_INP_PAD_STRIDE;
		memory.writeIoValue(padBase, valueNumber(static_cast<double>(state.padButtons[pad])));
		for (int axis = 0; axis < INPUT_CONTROLLER_PAD_AXIS_COUNT; axis += 1) {
			memory.writeIoValue(padBase + static_cast<u32>(axis + 1) * IO_WORD_SIZE, valueNumber(static_cast<double>(state.padAxesQ16[pad * INPUT_CONTROLLER_PAD_AXIS_COUNT + axis])));
		}
	}
	memory.writeIoValue(IO_INP_OUTPUT_PORT, valueNumber(static_cast<double>(state.outputPort)));
	memory.writeIoValue(IO_INP_OUTPUT_INTENSITY_Q16, valueNumber(static_cast<double>(state.outputIntensityQ16)));
	memory.writeIoValue(IO_INP_OUTPUT_DURATION_MS, valueNumber(static_cast<double>(state.outputDurationMs)));
	memory.writeIoValue(IO_INP_OUTPUT_STATUS, valueNumber(static_cast<double>(state.outputStatus)));
}

} // namespace bmsx
