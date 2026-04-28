#include "machine/runtime/game/table.h"

#include "machine/runtime/runtime.h"
#include "render/gameview.h"

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

void syncRuntimeGameViewToTable(Runtime& runtime) {
	if (!runtime.isInitialized()) {
		return;
	}
	const GameView& view = runtime.view();
	auto* const viewportTable = getRuntimeViewportTable(runtime);
	viewportTable->set(runtime.luaKey("x"), valueNumber(static_cast<double>(view.viewportSize.x)));
	viewportTable->set(runtime.luaKey("y"), valueNumber(static_cast<double>(view.viewportSize.y)));

	auto* const viewTable = getRuntimeViewTable(runtime);
	viewTable->set(runtime.luaKey("crt_postprocessing_enabled"), valueBool(view.crt_postprocessing_enabled));
	viewTable->set(runtime.luaKey("enable_noise"), valueBool(view.applyNoise));
	viewTable->set(runtime.luaKey("enable_colorbleed"), valueBool(view.applyColorBleed));
	viewTable->set(runtime.luaKey("enable_scanlines"), valueBool(view.applyScanlines));
	viewTable->set(runtime.luaKey("enable_blur"), valueBool(view.applyBlur));
	viewTable->set(runtime.luaKey("enable_glow"), valueBool(view.applyGlow));
	viewTable->set(runtime.luaKey("enable_fringing"), valueBool(view.applyFringing));
	viewTable->set(runtime.luaKey("enable_aperture"), valueBool(view.applyAperture));
}

void applyRuntimeGameViewTableToHost(Runtime& runtime) {
	if (!runtime.isInitialized()) {
		return;
	}
	auto* const viewTable = getRuntimeViewTable(runtime);
	GameView& view = runtime.view();
	view.crt_postprocessing_enabled = readRuntimeViewBool(runtime, *viewTable, "crt_postprocessing_enabled");
	view.applyNoise = readRuntimeViewBool(runtime, *viewTable, "enable_noise");
	view.applyColorBleed = readRuntimeViewBool(runtime, *viewTable, "enable_colorbleed");
	view.applyScanlines = readRuntimeViewBool(runtime, *viewTable, "enable_scanlines");
	view.applyBlur = readRuntimeViewBool(runtime, *viewTable, "enable_blur");
	view.applyGlow = readRuntimeViewBool(runtime, *viewTable, "enable_glow");
	view.applyFringing = readRuntimeViewBool(runtime, *viewTable, "enable_fringing");
	view.applyAperture = readRuntimeViewBool(runtime, *viewTable, "enable_aperture");
}

} // namespace bmsx
