#include "machine/devices/input/registers.h"

#include "spec/bmsx/io.h"
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

void InputControllerRegisterFile::write(uint32_t addr, u32 value) {
	switch (addr) {
		case IO_INP_CTRL:
			state.ctrl = value;
			return;
		case IO_INP_OUTPUT_PORT:
			state.outputPort = value;
			return;
		case IO_INP_OUTPUT_INTENSITY_Q16:
			state.outputIntensityQ16 = value;
			return;
		case IO_INP_OUTPUT_DURATION_MS:
			state.outputDurationMs = value;
			return;
	}
}

void InputControllerRegisterFile::mirror(Memory& memory) const {
	memory.writeIoU32(IO_INP_CTRL, state.ctrl);
	for (int i = 0; i < INPUT_CONTROLLER_KEY_WORD_COUNT; i += 1) {
		memory.writeIoU32(IO_INP_KEYS + static_cast<u32>(i) * IO_WORD_SIZE, state.keyWords[i]);
	}
	memory.writeIoU32(IO_INP_POINTER_BUTTONS, state.pointerButtons);
	memory.writeIoU32(IO_INP_POINTER_X, state.pointerXQ16);
	memory.writeIoU32(IO_INP_POINTER_Y, state.pointerYQ16);
	memory.writeIoU32(IO_INP_POINTER_WHEEL, state.pointerWheelQ16);
	for (int pad = 0; pad < INPUT_CONTROLLER_PAD_COUNT; pad += 1) {
		const u32 padBase = IO_INP_PADS + static_cast<u32>(pad) * IO_INP_PAD_STRIDE;
		memory.writeIoU32(padBase, state.padButtons[pad]);
		for (int axis = 0; axis < INPUT_CONTROLLER_PAD_AXIS_COUNT; axis += 1) {
			memory.writeIoU32(padBase + static_cast<u32>(axis + 1) * IO_WORD_SIZE, state.padAxesQ16[pad * INPUT_CONTROLLER_PAD_AXIS_COUNT + axis]);
		}
	}
	memory.writeIoU32(IO_INP_OUTPUT_PORT, state.outputPort);
	memory.writeIoU32(IO_INP_OUTPUT_INTENSITY_Q16, state.outputIntensityQ16);
	memory.writeIoU32(IO_INP_OUTPUT_DURATION_MS, state.outputDurationMs);
	memory.writeIoU32(IO_INP_OUTPUT_STATUS, state.outputStatus);
}

} // namespace bmsx
