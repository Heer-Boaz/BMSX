/*
 * fsmlibrary.h - FSM Definition Library and Active State Machines Registry
 * 
 * Central registry for:
 * - StateDefinitions: Blueprints for state machines
 * - ActiveStateMachines: Currently running state machine instances
 */

#pragma once

#include "fsmtypes.h"
#include "statedefinition.h"
#include "fsmcontroller.h"
#include <memory>
#include <unordered_map>
#include <vector>
#include <functional>

namespace bmsx {

/**
 * StateDefinitions - Registry for state machine blueprints
 * 
 * Stores and retrieves StateDefinition objects by ID.
 * Definitions are typically registered once during initialization
 * and reused for creating multiple state machine instances.
 */
class StateDefinitions {
public:
    using Identifier = std::string;

    // Singleton access
    static StateDefinitions& instance() {
        static StateDefinitions inst;
        return inst;
    }

    // Register a definition
    void registerDefinition(std::unique_ptr<StateDefinition> def);
    void registerDefinition(const Identifier& id, std::unique_ptr<StateDefinition> def);

    // Retrieve a definition
    StateDefinition* get(const Identifier& id);
    const StateDefinition* get(const Identifier& id) const;

    // Check if definition exists
    bool has(const Identifier& id) const;

    // Remove a definition
    void unregister(const Identifier& id);

    // Clear all definitions
    void clear();

    // Get all registered IDs
    std::vector<Identifier> getAllIds() const;

    // Iteration
    template<typename Func>
    void forEach(Func&& fn) {
        for (auto& [id, def] : definitions) {
            fn(id, def.get());
        }
    }

    template<typename Func>
    void forEach(Func&& fn) const {
        for (const auto& [id, def] : definitions) {
            fn(id, def.get());
        }
    }

    // Statistics
    size_t count() const { return definitions.size(); }

private:
    StateDefinitions() = default;
    ~StateDefinitions() = default;

    // Non-copyable, non-movable
    StateDefinitions(const StateDefinitions&) = delete;
    StateDefinitions& operator=(const StateDefinitions&) = delete;
    StateDefinitions(StateDefinitions&&) = delete;
    StateDefinitions& operator=(StateDefinitions&&) = delete;

    std::unordered_map<Identifier, std::unique_ptr<StateDefinition>> definitions;
};

/**
 * ActiveStateMachines - Registry for running state machine instances
 * 
 * Tracks all active StateMachineController instances.
 * Provides bulk operations like tick_all() for updating all machines.
 */
class ActiveStateMachines {
public:
    using Identifier = std::string;
    using MachineId = std::string;

    // Singleton access
    static ActiveStateMachines& instance() {
        static ActiveStateMachines inst;
        return inst;
    }

    /**
     * Create and register a new state machine
     * @param defId The definition ID to use
     * @param target The target object
     * @param machineId Optional unique ID for this instance
     * @return Pointer to the created controller, or nullptr on failure
     */
    StateMachineController* create(const Identifier& defId, Stateful* target,
                                    const MachineId& machineId = "");

    /**
     * Register an externally created controller
     * @param controller The controller to register
     * @param machineId Optional unique ID
     */
    void registerMachine(std::unique_ptr<StateMachineController> controller,
                         const MachineId& machineId = "");

    // Retrieve a machine by ID
    StateMachineController* get(const MachineId& id);
    const StateMachineController* get(const MachineId& id) const;

    // Find machine by target
    StateMachineController* findByTarget(Stateful* target);
    const StateMachineController* findByTarget(const Stateful* target) const;

    // Find all machines using a specific definition
    std::vector<StateMachineController*> findByDefinition(const Identifier& defId);

    // Remove and dispose a machine
    void dispose(const MachineId& id);
    void disposeByTarget(Stateful* target);

    // Clear all machines
    void clear();

    // Bulk operations
    void tick_all();
    void pause_all();
    void resume_all();
    void start_all();
    void stop_all();

    // Dispatch event to all machines
    void dispatch_all(const GameEvent& event);

    // Statistics
    size_t count() const { return machines.size(); }
    size_t countActive() const;
    size_t countPaused() const;

    // Iteration
    template<typename Func>
    void forEach(Func&& fn) {
        for (auto& [id, machine] : machines) {
            fn(id, machine.get());
        }
    }

    template<typename Func>
    void forEach(Func&& fn) const {
        for (const auto& [id, machine] : machines) {
            fn(id, machine.get());
        }
    }

    // Debug
    void dumpState() const;

private:
    ActiveStateMachines() = default;
    ~ActiveStateMachines() = default;

    // Non-copyable, non-movable
    ActiveStateMachines(const ActiveStateMachines&) = delete;
    ActiveStateMachines& operator=(const ActiveStateMachines&) = delete;
    ActiveStateMachines(ActiveStateMachines&&) = delete;
    ActiveStateMachines& operator=(ActiveStateMachines&&) = delete;

    MachineId generateId();

    std::unordered_map<MachineId, std::unique_ptr<StateMachineController>> machines;
    std::unordered_map<Stateful*, MachineId> targetToMachine;
    uint64_t nextId = 1;
};

/**
 * FSMBuilder - Fluent API for building state definitions
 * 
 * Provides a convenient way to construct StateDefinitions programmatically.
 */
class FSMBuilder {
public:
    using Identifier = std::string;

    explicit FSMBuilder(const Identifier& id);

    // Set root properties
    FSMBuilder& initial(const Identifier& stateId);
    FSMBuilder& data(const StateData& d);

    // Add states
    FSMBuilder& state(const Identifier& stateId);
    FSMBuilder& state(const Identifier& stateId, std::function<void(FSMBuilder&)> configure);

    // State handlers (applied to current state)
    FSMBuilder& onEnter(StateExitHandler handler);
    FSMBuilder& onExit(StateExitHandler handler);
    FSMBuilder& onTick(StateTickHandler handler);

    // Events
    FSMBuilder& on(const Identifier& eventType, const Identifier& target);
    FSMBuilder& on(const Identifier& eventType, StateEventHandler handler);
    FSMBuilder& on(const Identifier& eventType, const Identifier& target, StateGuardFn guard);

    // Run checks (conditional transitions evaluated each tick)
    FSMBuilder& runCheck(StateTickCondition condition, const Identifier& target);
    FSMBuilder& runCheck(StateTickCondition condition, const Identifier& target, StateGuardFn guard);

    // Guards
    FSMBuilder& guard(StateGuardFn canEnter, StateGuardFn canExit = nullptr);

    // Flags
    FSMBuilder& concurrent(bool is = true);
    FSMBuilder& final(bool is = true);

    // Navigation
    FSMBuilder& end();  // Return to parent state
    FSMBuilder& root(); // Return to root

    // Build the definition
    std::unique_ptr<StateDefinition> build();

    // Build and register
    StateDefinition* buildAndRegister();

private:
    struct BuilderContext {
        StateDefinition* def = nullptr;
        BuilderContext* parent = nullptr;
    };

    std::unique_ptr<StateDefinition> rootDef;
    BuilderContext rootContext;
    BuilderContext* currentContext = nullptr;

    void ensureContext();
};

} // namespace bmsx
