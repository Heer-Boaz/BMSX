/*
 * statedefinition.h - State definition for FSM
 *
 * Mirrors TypeScript fsm/statedefinition.ts
 */

#ifndef BMSX_STATEDEFINITION_H
#define BMSX_STATEDEFINITION_H

#include "fsmtypes.h"
#include "../timeline/timeline.h"
#include <string>
#include <unordered_map>
#include <vector>
#include <memory>
#include <optional>

namespace bmsx {

/* ============================================================================
 * StateDefinition
 *
 * Represents the definition of a state in a finite state machine.
 * Contains the blueprint for state behavior including:
 * - Event handlers
 * - Tick behavior
 * - Transition guards
 * - Child states (for hierarchical FSMs)
 *
 * Mirrors TypeScript StateDefinition class.
 * ============================================================================ */

class StateDefinition {
public:
    // ─────────────────────────────────────────────────────────────────────────
    // Identity
    // ─────────────────────────────────────────────────────────────────────────
    Identifier id;              // Local state identifier
    Identifier def_id;          // Full path identifier (e.g. 'rootid:/parentid/thisid')

    // ─────────────────────────────────────────────────────────────────────────
    // Optional state data
    // ─────────────────────────────────────────────────────────────────────────
    std::unordered_map<std::string, std::any> data;

    // ─────────────────────────────────────────────────────────────────────────
    // Hierarchy
    // ─────────────────────────────────────────────────────────────────────────
    StateDefinition* parent = nullptr;  // Parent state definition
    StateDefinition* root = nullptr;    // Root state machine definition

    // ─────────────────────────────────────────────────────────────────────────
    // Concurrency
    // ─────────────────────────────────────────────────────────────────────────
    bool is_concurrent = false;  // Runs in parallel with focused branch
    bool is_final = false;       // This is a final state (no outgoing transitions)

    // ─────────────────────────────────────────────────────────────────────────
    // Input handling
    // ─────────────────────────────────────────────────────────────────────────
    InputEvalMode input_eval = InputEvalMode::All;

    // ─────────────────────────────────────────────────────────────────────────
    // Event list for subscriptions
    // ─────────────────────────────────────────────────────────────────────────
    std::vector<ListedSdefEvent> event_list;

    // ─────────────────────────────────────────────────────────────────────────
    // Timeline bindings
    // ─────────────────────────────────────────────────────────────────────────
    std::optional<StateTimelineMap> timelines;

    // ─────────────────────────────────────────────────────────────────────────
    // State lifecycle handlers
    // ─────────────────────────────────────────────────────────────────────────
    std::optional<StateTickHandler> tick;
    std::optional<StateExitHandler> entering_state;
    std::optional<StateExitHandler> exiting_state;
    std::optional<StateEventHandler> process_input;

    // ─────────────────────────────────────────────────────────────────────────
    // Event handlers (event name -> target state or handler)
    // ─────────────────────────────────────────────────────────────────────────
    std::unordered_map<std::string, StateEventDefinition> on;

    // ─────────────────────────────────────────────────────────────────────────
    // Input event handlers
    // ─────────────────────────────────────────────────────────────────────────
    std::unordered_map<std::string, StateEventDefinition> input_event_handlers;

    // ─────────────────────────────────────────────────────────────────────────
    // Run checks (conditions evaluated every tick)
    // ─────────────────────────────────────────────────────────────────────────
    std::vector<TickCheckDefinition> run_checks;

    // ─────────────────────────────────────────────────────────────────────────
    // Transition guards
    // ─────────────────────────────────────────────────────────────────────────
    std::optional<StateGuard> transition_guards;

    // ─────────────────────────────────────────────────────────────────────────
    // Child states (for hierarchical FSMs)
    // ─────────────────────────────────────────────────────────────────────────
    std::unordered_map<Identifier, std::unique_ptr<StateDefinition>> states;

    // ─────────────────────────────────────────────────────────────────────────
    // Initial state (for state machines with children)
    // ─────────────────────────────────────────────────────────────────────────
    std::optional<Identifier> initial;

    // ─────────────────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────────────────
    StateDefinition() = default;
    StateDefinition(const Identifier& id, StateDefinition* root = nullptr, StateDefinition* parent = nullptr);

    // ─────────────────────────────────────────────────────────────────────────
    // Methods
    // ─────────────────────────────────────────────────────────────────────────
    bool isRoot() const { return root == this; }

    // Add a child state
    StateDefinition* addState(const Identifier& stateId);

    // Get a child state by ID
    StateDefinition* getState(const Identifier& stateId);

    // Check if this is a start state (prefixed with _ or #)
    bool isStartState() const;

    // Get the full path ID
    Identifier makeFullId() const;

    // Validate the state machine structure
    void validate() const;

private:
    void constructSubstateMachine();
};

/* ============================================================================
 * State definition validation
 * ============================================================================ */

void validateStateMachine(const StateDefinition* def);

} // namespace bmsx

#endif // BMSX_STATEDEFINITION_H
