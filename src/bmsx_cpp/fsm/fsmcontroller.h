/*
 * fsmcontroller.h - State machine controller
 * 
 * Manages the lifecycle of a single state machine instance,
 * coordinating between the State (runtime) and StateDefinition (blueprint).
 */

#pragma once

#include "fsmtypes.h"
#include "statedefinition.h"
#include <memory>
#include <functional>

namespace bmsx {

// Forward declarations
class State;
class World;
class ECSystemManager;

/**
 * StateMachineController - Manages a state machine for a target object
 * 
 * Responsible for:
 * - Creating and managing the root State
 * - Bridging the target object with the state machine
 * - Providing access to external systems (World, ECS, etc.)
 */
class StateMachineController {
public:
    using Identifier = std::string;

    /**
     * Constructor
     * @param def The state definition blueprint
     * @param targetObj The object this state machine controls
     */
    StateMachineController(StateDefinition* def, Stateful* targetObj);
    ~StateMachineController();

    // Non-copyable
    StateMachineController(const StateMachineController&) = delete;
    StateMachineController& operator=(const StateMachineController&) = delete;

    // Movable
    StateMachineController(StateMachineController&&) noexcept = default;
    StateMachineController& operator=(StateMachineController&&) noexcept = default;

    // Lifecycle
    void start();
    void stop();
    void pause();
    void resume();
    void reset();
    void dispose();

    // Per-frame update
    void tick();

    // Event dispatch
    bool dispatch(const GameEvent& event);

    // State queries
    const Identifier& getCurrentState() const;
    Identifier getCurrentPath() const;
    bool isInState(const Identifier& stateId) const;
    bool isActive() const { return active && !disposed; }
    bool isPaused() const { return paused; }
    
    // Check if current path matches a given path (supports wildcards)
    bool matchesStatePath(const std::string& path) const;

    // Tick control
    bool tickEnabled = true;

    // Transition
    bool transitionTo(const Identifier& stateId);
    bool transitionToPath(const Identifier& path);

    // Access to internal state
    State* getRootState() { return rootState.get(); }
    const State* getRootState() const { return rootState.get(); }
    State* getActiveLeaf();
    const State* getActiveLeaf() const;

    // Target object
    Stateful* getTarget() { return target; }
    const Stateful* getTarget() const { return target; }

    // External system access
    void setWorld(World* w) { world = w; }
    World* getWorld() { return world; }

    void setSystemManager(ECSystemManager* mgr) { systemManager = mgr; }
    ECSystemManager* getSystemManager() { return systemManager; }

    // Definition access
    StateDefinition* getDefinition() { return definition; }
    const StateDefinition* getDefinition() const { return definition; }
    const Identifier& getDefinitionId() const { return definition ? definition->def_id : emptyId; }

    // Machine identifier
    void setMachineId(const Identifier& id) { machineId = id; }
    const Identifier& getMachineId() const { return machineId; }

    // Callbacks for external integration
    std::function<void(const Identifier& from, const Identifier& to)> onStateChange;
    std::function<void()> onDispose;

private:
    StateDefinition* definition = nullptr;
    Stateful* target = nullptr;
    std::unique_ptr<State> rootState;

    World* world = nullptr;
    ECSystemManager* systemManager = nullptr;

    Identifier machineId;
    bool active = false;
    bool paused = false;
    bool disposed = false;

    static inline Identifier emptyId;
};

} // namespace bmsx
