#include "vm_systems.h"
#include "vm_runtime.h"

namespace bmsx {

// System ID definitions
const std::string BMSX_CART_UPDATE_SYSTEM_ID = "bmsx:cart_update_system";
const std::string BMSX_CART_DRAW_SYSTEM_ID = "bmsx:cart_draw_system";
const std::string BMSX_IDE_INPUT_SYSTEM_ID = "bmsx:ide_input_system";
const std::string BMSX_IDE_UPDATE_SYSTEM_ID = "bmsx:ide_update_system";
const std::string BMSX_IDE_DRAW_SYSTEM_ID = "bmsx:ide_draw_system";
const std::string BMSX_TERMINAL_INPUT_SYSTEM_ID = "bmsx:terminal_input_system";
const std::string BMSX_TERMINAL_UPDATE_SYSTEM_ID = "bmsx:terminal_update_system";
const std::string BMSX_TERMINAL_DRAW_SYSTEM_ID = "bmsx:terminal_draw_system";

// =============================================================================
// BmsxCartUpdateSystem
// =============================================================================

BmsxCartUpdateSystem::BmsxCartUpdateSystem(int priority)
	: ECSystem(TickGroup::ModeResolution, priority)
{
	ecsId = BMSX_CART_UPDATE_SYSTEM_ID;
	runsWhileGamePaused = true;
}

void BmsxCartUpdateSystem::update(World& /*world*/) {
	if (VMRuntime::hasInstance()) {
		VMRuntime::instance().tickUpdate();
	}
}

// =============================================================================
// BmsxCartDrawSystem
// =============================================================================

BmsxCartDrawSystem::BmsxCartDrawSystem(int priority)
	: ECSystem(TickGroup::Presentation, priority)
{
	ecsId = BMSX_CART_DRAW_SYSTEM_ID;
	runsWhileGamePaused = true;
}

void BmsxCartDrawSystem::update(World& /*world*/) {
	if (VMRuntime::hasInstance()) {
		VMRuntime::instance().tickDraw();
	}
}

// =============================================================================
// BmsxIDEInputSystem
// =============================================================================

BmsxIDEInputSystem::BmsxIDEInputSystem(int priority)
	: ECSystem(TickGroup::Input, priority)
{
	ecsId = BMSX_IDE_INPUT_SYSTEM_ID;
	runsWhileGamePaused = true;
}

void BmsxIDEInputSystem::update(World& /*world*/) {
	if (VMRuntime::hasInstance()) {
		VMRuntime::instance().tickIdeInput();
	}
}

// =============================================================================
// BmsxIDEUpdateSystem
// =============================================================================

BmsxIDEUpdateSystem::BmsxIDEUpdateSystem(int priority)
	: ECSystem(TickGroup::ModeResolution, priority)
{
	ecsId = BMSX_IDE_UPDATE_SYSTEM_ID;
	runsWhileGamePaused = true;
}

void BmsxIDEUpdateSystem::update(World& /*world*/) {
	if (VMRuntime::hasInstance()) {
		VMRuntime::instance().tickIDE();
	}
}

// =============================================================================
// BmsxIDEDrawSystem
// =============================================================================

BmsxIDEDrawSystem::BmsxIDEDrawSystem(int priority)
	: ECSystem(TickGroup::Presentation, priority)
{
	ecsId = BMSX_IDE_DRAW_SYSTEM_ID;
	runsWhileGamePaused = true;
}

void BmsxIDEDrawSystem::update(World& /*world*/) {
	if (VMRuntime::hasInstance()) {
		VMRuntime::instance().tickIDEDraw();
	}
}

// =============================================================================
// BmsxTerminalInputSystem
// =============================================================================

BmsxTerminalInputSystem::BmsxTerminalInputSystem(int priority)
	: ECSystem(TickGroup::Input, priority)
{
	ecsId = BMSX_TERMINAL_INPUT_SYSTEM_ID;
	runsWhileGamePaused = true;
}

void BmsxTerminalInputSystem::update(World& /*world*/) {
	if (VMRuntime::hasInstance()) {
		VMRuntime::instance().tickTerminalInput();
	}
}

// =============================================================================
// BmsxTerminalUpdateSystem
// =============================================================================

BmsxTerminalUpdateSystem::BmsxTerminalUpdateSystem(int priority)
	: ECSystem(TickGroup::ModeResolution, priority)
{
	ecsId = BMSX_TERMINAL_UPDATE_SYSTEM_ID;
	runsWhileGamePaused = true;
}

void BmsxTerminalUpdateSystem::update(World& /*world*/) {
	if (VMRuntime::hasInstance()) {
		VMRuntime::instance().tickTerminalMode();
	}
}

// =============================================================================
// BmsxTerminalDrawSystem
// =============================================================================

BmsxTerminalDrawSystem::BmsxTerminalDrawSystem(int priority)
	: ECSystem(TickGroup::Presentation, priority)
{
	ecsId = BMSX_TERMINAL_DRAW_SYSTEM_ID;
	runsWhileGamePaused = true;
}

void BmsxTerminalDrawSystem::update(World& /*world*/) {
	if (VMRuntime::hasInstance()) {
		VMRuntime::instance().tickTerminalModeDraw();
	}
}

} // namespace bmsx
