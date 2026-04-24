#include "machine/runtime/game/table.h"

#include "machine/runtime/runtime.h"

#include <string>

namespace bmsx {
namespace {

Table* getRuntimeGameTable(Runtime& runtime) {
	return asTable(runtime.machine().cpu().getGlobalByKey(runtime.luaKey("game")));
}

Table* getRuntimeViewportTable(Runtime& runtime) {
	return asTable(getRuntimeGameTable(runtime)->get(runtime.luaKey("viewportsize")));
}

Table* getRuntimeViewTable(Runtime& runtime) {
	return asTable(getRuntimeGameTable(runtime)->get(runtime.luaKey("view")));
}

bool readRuntimeViewBool(Runtime& runtime, Table& viewTable, const char* field) {
	const Value value = viewTable.get(runtime.luaKey(field));
	if (!valueIsBool(value)) {
		throw BMSX_RUNTIME_ERROR(std::string("game.view.") + field + " must be boolean.");
	}
	return valueToBool(value);
}

} // namespace

void syncRuntimeGameViewStateToTable(Runtime& runtime) {
	if (!runtime.isInitialized()) {
		return;
	}
	const GameViewState& state = runtime.gameViewState();
	auto* const viewportTable = getRuntimeViewportTable(runtime);
	viewportTable->set(runtime.luaKey("x"), valueNumber(static_cast<double>(state.viewportSize.x)));
	viewportTable->set(runtime.luaKey("y"), valueNumber(static_cast<double>(state.viewportSize.y)));

	auto* const viewTable = getRuntimeViewTable(runtime);
	viewTable->set(runtime.luaKey("crt_postprocessing_enabled"), valueBool(state.crtPostprocessingEnabled));
	viewTable->set(runtime.luaKey("enable_noise"), valueBool(state.enableNoise));
	viewTable->set(runtime.luaKey("enable_colorbleed"), valueBool(state.enableColorBleed));
	viewTable->set(runtime.luaKey("enable_scanlines"), valueBool(state.enableScanlines));
	viewTable->set(runtime.luaKey("enable_blur"), valueBool(state.enableBlur));
	viewTable->set(runtime.luaKey("enable_glow"), valueBool(state.enableGlow));
	viewTable->set(runtime.luaKey("enable_fringing"), valueBool(state.enableFringing));
	viewTable->set(runtime.luaKey("enable_aperture"), valueBool(state.enableAperture));
}

void applyRuntimeGameViewTableToState(Runtime& runtime) {
	if (!runtime.isInitialized()) {
		return;
	}
	auto* const viewTable = getRuntimeViewTable(runtime);
	GameViewState& state = runtime.gameViewState();
	state.crtPostprocessingEnabled = readRuntimeViewBool(runtime, *viewTable, "crt_postprocessing_enabled");
	state.enableNoise = readRuntimeViewBool(runtime, *viewTable, "enable_noise");
	state.enableColorBleed = readRuntimeViewBool(runtime, *viewTable, "enable_colorbleed");
	state.enableScanlines = readRuntimeViewBool(runtime, *viewTable, "enable_scanlines");
	state.enableBlur = readRuntimeViewBool(runtime, *viewTable, "enable_blur");
	state.enableGlow = readRuntimeViewBool(runtime, *viewTable, "enable_glow");
	state.enableFringing = readRuntimeViewBool(runtime, *viewTable, "enable_fringing");
	state.enableAperture = readRuntimeViewBool(runtime, *viewTable, "enable_aperture");
}

} // namespace bmsx
