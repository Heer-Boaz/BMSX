#include "machine/firmware/input_state_tables.h"

#include "machine/runtime/runtime.h"

namespace bmsx {

InputStateTableKeys createInputStateTableKeys(Runtime& runtime) {
	return InputStateTableKeys{
		runtime.luaKey("pressed"),
		runtime.luaKey("justpressed"),
		runtime.luaKey("justreleased"),
		runtime.luaKey("waspressed"),
		runtime.luaKey("wasreleased"),
		runtime.luaKey("repeatpressed"),
		runtime.luaKey("repeatcount"),
		runtime.luaKey("consumed"),
		runtime.luaKey("presstime"),
		runtime.luaKey("timestamp"),
		runtime.luaKey("pressedAtMs"),
		runtime.luaKey("releasedAtMs"),
		runtime.luaKey("pressId"),
		runtime.luaKey("value"),
		runtime.luaKey("value2d"),
		runtime.luaKey("x"),
		runtime.luaKey("y"),
	};
}

uint32_t packActionStateFlags(const ActionState& state) {
	uint32_t flags = 0;
	if (state.pressed) flags |= ACTION_STATE_FLAG_PRESSED;
	if (state.justpressed) flags |= ACTION_STATE_FLAG_JUSTPRESSED;
	if (state.justreleased) flags |= ACTION_STATE_FLAG_JUSTRELEASED;
	if (state.waspressed) flags |= ACTION_STATE_FLAG_WASPRESSED;
	if (state.wasreleased) flags |= ACTION_STATE_FLAG_WASRELEASED;
	if (state.consumed) flags |= ACTION_STATE_FLAG_CONSUMED;
	if (state.alljustpressed) flags |= ACTION_STATE_FLAG_ALLJUSTPRESSED;
	if (state.allwaspressed) flags |= ACTION_STATE_FLAG_ALLWASPRESSED;
	if (state.alljustreleased) flags |= ACTION_STATE_FLAG_ALLJUSTRELEASED;
	if (state.guardedjustpressed.has_value() && state.guardedjustpressed.value()) flags |= ACTION_STATE_FLAG_GUARDEDJUSTPRESSED;
	if (state.repeatpressed.has_value() && state.repeatpressed.value()) flags |= ACTION_STATE_FLAG_REPEATPRESSED;
	return flags;
}

Value buildButtonStateTable(Runtime& runtime, const InputStateTableKeys& keys, const ButtonState& state, bool repeatPressed, int repeatCount) {
	CPU& cpu = runtime.machine().cpu();
	Table* table = cpu.createTable(0, 13);
	table->set(keys.pressed, valueBool(state.pressed));
	table->set(keys.justpressed, valueBool(state.justpressed));
	table->set(keys.justreleased, valueBool(state.justreleased));
	table->set(keys.waspressed, valueBool(state.waspressed));
	table->set(keys.wasreleased, valueBool(state.wasreleased));
	table->set(keys.repeatpressed, valueBool(repeatPressed));
	table->set(keys.repeatcount, valueNumber(static_cast<double>(repeatCount)));
	table->set(keys.consumed, valueBool(state.consumed));
	table->set(keys.value, valueNumber(static_cast<double>(state.value)));
	if (state.presstime.has_value()) {
		table->set(keys.presstime, valueNumber(state.presstime.value()));
	}
	if (state.timestamp.has_value()) {
		table->set(keys.timestamp, valueNumber(state.timestamp.value()));
	}
	if (state.pressedAtMs.has_value()) {
		table->set(keys.pressedAtMs, valueNumber(state.pressedAtMs.value()));
	}
	if (state.releasedAtMs.has_value()) {
		table->set(keys.releasedAtMs, valueNumber(state.releasedAtMs.value()));
	}
	if (state.pressId.has_value()) {
		table->set(keys.pressId, valueNumber(static_cast<double>(state.pressId.value())));
	}
	if (state.value2d.has_value()) {
		Table* value2d = cpu.createTable(0, 2);
		value2d->set(keys.x, valueNumber(static_cast<double>(state.value2d->x)));
		value2d->set(keys.y, valueNumber(static_cast<double>(state.value2d->y)));
		table->set(keys.value2d, valueTable(value2d));
	}
	return valueTable(table);
}

} // namespace bmsx
