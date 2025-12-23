#pragma once

#include "../ecs/ecsystem.h"
#include <string>

namespace bmsx {

// System IDs for VM ECS systems
extern const std::string BMSX_CART_UPDATE_SYSTEM_ID;
extern const std::string BMSX_CART_DRAW_SYSTEM_ID;
extern const std::string BMSX_IDE_INPUT_SYSTEM_ID;
extern const std::string BMSX_IDE_UPDATE_SYSTEM_ID;
extern const std::string BMSX_IDE_DRAW_SYSTEM_ID;
extern const std::string BMSX_TERMINAL_INPUT_SYSTEM_ID;
extern const std::string BMSX_TERMINAL_UPDATE_SYSTEM_ID;
extern const std::string BMSX_TERMINAL_DRAW_SYSTEM_ID;

/**
 * Cart update system - ticks the VM update phase.
 */
class BmsxCartUpdateSystem : public ECSystem {
public:
	explicit BmsxCartUpdateSystem(int priority = 90);
	void update(World& world) override;
};

/**
 * Cart draw system - ticks the VM draw phase.
 */
class BmsxCartDrawSystem : public ECSystem {
public:
	explicit BmsxCartDrawSystem(int priority = 90);
	void update(World& world) override;
};

/**
 * IDE input system - handles editor input.
 */
class BmsxIDEInputSystem : public ECSystem {
public:
	explicit BmsxIDEInputSystem(int priority = 90);
	void update(World& world) override;
};

/**
 * IDE update system - ticks the editor update phase.
 */
class BmsxIDEUpdateSystem : public ECSystem {
public:
	explicit BmsxIDEUpdateSystem(int priority = 100);
	void update(World& world) override;
};

/**
 * IDE draw system - draws the editor overlay.
 */
class BmsxIDEDrawSystem : public ECSystem {
public:
	explicit BmsxIDEDrawSystem(int priority = 100);
	void update(World& world) override;
};

/**
 * Terminal input system - handles terminal mode input.
 */
class BmsxTerminalInputSystem : public ECSystem {
public:
	explicit BmsxTerminalInputSystem(int priority = 90);
	void update(World& world) override;
};

/**
 * Terminal update system - ticks the terminal mode.
 */
class BmsxTerminalUpdateSystem : public ECSystem {
public:
	explicit BmsxTerminalUpdateSystem(int priority = 110);
	void update(World& world) override;
};

/**
 * Terminal draw system - draws the terminal mode overlay.
 */
class BmsxTerminalDrawSystem : public ECSystem {
public:
	explicit BmsxTerminalDrawSystem(int priority = 110);
	void update(World& world) override;
};

} // namespace bmsx
