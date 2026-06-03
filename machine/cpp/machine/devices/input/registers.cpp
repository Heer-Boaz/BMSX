#include "machine/devices/input/registers.h"

#include "machine/bus/io.h"
#include "machine/devices/input/contracts.h"
#include "machine/memory/memory.h"

namespace bmsx {

// disable-next-line single_line_method_pattern -- memory-map callbacks require a C-style thunk into the input registerfile instance.
void InputControllerRegisterFile::writeThunk(void* context, uint32_t addr, Value value) {
	static_cast<InputControllerRegisterFile*>(context)->write(addr, value);
}

void InputControllerRegisterFile::reset() {
	state = InputControllerRegisterState{};
}

InputControllerRegisterState InputControllerRegisterFile::captureState() const {
	return state;
}

void InputControllerRegisterFile::restoreState(const InputControllerRegisterState& restoredState) {
	state = restoredState;
}

i32 InputControllerRegisterFile::selectedPlayerIndex() const {
	return decodeInputControllerPlayerSelect(state.player);
}

void InputControllerRegisterFile::write(uint32_t addr, Value value) {
	switch (addr) {
		case IO_INP_PLAYER:
			state.player = toU32(value);
			return;
		case IO_INP_ACTION:
			state.actionStringId = asStringId(value);
			return;
		case IO_INP_BIND:
			state.bindStringId = asStringId(value);
			return;
		case IO_INP_CTRL:
			state.ctrl = toU32(value);
			return;
		case IO_INP_QUERY:
			state.queryStringId = asStringId(value);
			return;
		case IO_INP_CONSUME:
			state.consumeStringId = asStringId(value);
			return;
		case IO_INP_OUTPUT_INTENSITY_Q16:
			state.outputIntensityQ16 = toU32(value);
			return;
		case IO_INP_OUTPUT_DURATION_MS:
			state.outputDurationMs = toU32(value);
			return;
	}
}

void InputControllerRegisterFile::writeResult(Memory& memory, u32 status, u32 value, u32 valueX, u32 valueY) {
	state.status = status;
	state.value = value;
	state.valueX = valueX;
	state.valueY = valueY;
	memory.writeIoValue(IO_INP_STATUS, valueNumber(static_cast<double>(status)));
	memory.writeIoValue(IO_INP_VALUE, valueNumber(static_cast<double>(value)));
	memory.writeIoValue(IO_INP_VALUE_X, valueNumber(static_cast<double>(valueX)));
	memory.writeIoValue(IO_INP_VALUE_Y, valueNumber(static_cast<double>(valueY)));
}

void InputControllerRegisterFile::mirror(Memory& memory) const {
	memory.writeIoValue(IO_INP_PLAYER, valueNumber(static_cast<double>(state.player)));
	memory.writeIoValue(IO_INP_ACTION, valueString(state.actionStringId));
	memory.writeIoValue(IO_INP_BIND, valueString(state.bindStringId));
	memory.writeIoValue(IO_INP_CTRL, valueNumber(static_cast<double>(state.ctrl)));
	memory.writeIoValue(IO_INP_QUERY, valueString(state.queryStringId));
	memory.writeIoValue(IO_INP_STATUS, valueNumber(static_cast<double>(state.status)));
	memory.writeIoValue(IO_INP_VALUE, valueNumber(static_cast<double>(state.value)));
	memory.writeIoValue(IO_INP_VALUE_X, valueNumber(static_cast<double>(state.valueX)));
	memory.writeIoValue(IO_INP_VALUE_Y, valueNumber(static_cast<double>(state.valueY)));
	memory.writeIoValue(IO_INP_CONSUME, valueString(state.consumeStringId));
	memory.writeIoValue(IO_INP_OUTPUT_INTENSITY_Q16, valueNumber(static_cast<double>(state.outputIntensityQ16)));
	memory.writeIoValue(IO_INP_OUTPUT_DURATION_MS, valueNumber(static_cast<double>(state.outputDurationMs)));
}

} // namespace bmsx
