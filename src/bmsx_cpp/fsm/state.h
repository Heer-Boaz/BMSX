/*
 * state.h - Runtime state instance for FSM
 *
 * Mirrors TypeScript fsm/state.ts
 */

#ifndef BMSX_STATE_H
#define BMSX_STATE_H

#include "fsmtypes.h"
#include "statedefinition.h"
#include "../timeline/timeline.h"
#include <string>
#include <unordered_map>
#include <vector>
#include <memory>
#include <optional>
#include <deque>
#include <functional>

namespace bmsx {

// Forward declarations
class StateMachineController;

/* ============================================================================
 * State
 *
 * Represents a runtime instance of a state in a state machine.
 * Each State instance references a StateDefinition for its behavior blueprint.
 *
 * Key responsibilities:
 * - Track current active state in hierarchy
 * - Execute tick/enter/exit handlers
 * - Dispatch events to handlers
 * - Process transitions with critical section support
 *
 * Mirrors TypeScript State class.
 * ============================================================================ */

// Transition queue item
struct TransitionQueueItem {
    Identifier path;
    // TODO: diagnostic snapshot
};

class State {
public:
    // ─────────────────────────────────────────────────────────────────────────
    // Identity
    // ─────────────────────────────────────────────────────────────────────────
    Identifier id;                  // Instance identifier (unique)
    Identifier localdef_id;         // Local definition ID (e.g. "idle")
    Identifier def_id;              // Full definition ID (e.g. "player_fsm.idle")

    // ─────────────────────────────────────────────────────────────────────────
    // References
    // ─────────────────────────────────────────────────────────────────────────
    Identifier target_id;           // Target object ID

    // ─────────────────────────────────────────────────────────────────────────
    // Hierarchy
    // ─────────────────────────────────────────────────────────────────────────
private:
    State* parent_ref = nullptr;    // Parent state instance
    State* root_ref = nullptr;      // Root state machine instance

public:
    // Substates (child state machines)
    std::unordered_map<Identifier, std::unique_ptr<State>> states;

    // ─────────────────────────────────────────────────────────────────────────
    // Current state tracking
    // ─────────────────────────────────────────────────────────────────────────
    Identifier currentid;           // Currently active child state ID

    // ─────────────────────────────────────────────────────────────────────────
    // State data (runtime, shared across states)
    // ─────────────────────────────────────────────────────────────────────────
    std::unordered_map<std::string, std::any> data;

    // ─────────────────────────────────────────────────────────────────────────
    // Flags
    // ─────────────────────────────────────────────────────────────────────────
    bool paused = false;

    // ─────────────────────────────────────────────────────────────────────────
    // History (ring buffer for previous states)
    // ─────────────────────────────────────────────────────────────────────────
private:
    std::vector<Identifier> _hist;
    i32 _histHead = 0;
    i32 _histSize = 0;

    // ─────────────────────────────────────────────────────────────────────────
    // Critical section / transition queue
    // ─────────────────────────────────────────────────────────────────────────
    i32 critical_section_counter = 0;
    bool is_processing_queue = false;
    std::vector<TransitionQueueItem> transition_queue;

    // Tick tracking
    i32 _transitionsThisTick = 0;
    bool in_tick = false;
    static constexpr i32 MAX_TRANSITIONS_PER_TICK = 1000;

    // ─────────────────────────────────────────────────────────────────────────
    // Timeline bindings
    // ─────────────────────────────────────────────────────────────────────────
    std::optional<std::vector<StateTimelineBinding>> timelineBindings;

public:
    // ─────────────────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────────────────
    State() = default;
    State(const Identifier& localdef_id, const Identifier& target_id,
          State* parent = nullptr, State* root = nullptr);

    // ─────────────────────────────────────────────────────────────────────────
    // Factory
    // ─────────────────────────────────────────────────────────────────────────
    static std::unique_ptr<State> create(const Identifier& localdef_id,
                                          const Identifier& target_id,
                                          State* parent = nullptr,
                                          State* root = nullptr);

    // ─────────────────────────────────────────────────────────────────────────
    // Accessors
    // ─────────────────────────────────────────────────────────────────────────
    State* parent() { return parent_ref; }
    const State* parent() const { return parent_ref; }
    State* root() { return root_ref ? root_ref : this; }
    const State* root() const { return root_ref ? root_ref : this; }
    bool is_root() const { return root() == this; }
    bool is_concurrent() const;

    // Definition access
    StateDefinition* definition();
    const StateDefinition* definition() const;

    // Current child state
    State* current();
    const State* current() const;

    // Start state ID from definition
    Identifier start_state_id() const;

    // Current state definition
    StateDefinition* current_state_definition();
    const StateDefinition* current_state_definition() const;

    // ─────────────────────────────────────────────────────────────────────────
    // Lifecycle
    // ─────────────────────────────────────────────────────────────────────────

    // Start the state machine (enters initial state)
    void start();

    // Reset to initial state
    void reset(bool initializing = false);

    // Dispose and cleanup
    void dispose();

    // ─────────────────────────────────────────────────────────────────────────
    // State machine execution (tick)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Runs the current state of the FSM.
     * If paused, does nothing.
     * Calls in order:
     * 1. runSubstateMachines()
     * 2. processInput()
     * 3. runCurrentState()
     * 4. doRunChecks()
     */
    void tick();

    // ─────────────────────────────────────────────────────────────────────────
    // Event dispatch
    // ─────────────────────────────────────────────────────────────────────────

    bool dispatch_event(const GameEvent& event);

    // ─────────────────────────────────────────────────────────────────────────
    // Transitions
    // ─────────────────────────────────────────────────────────────────────────

    void transition_to(const Identifier& state_id);
    void transition_to_path(const std::string& path);
    void transition_to_path(const std::vector<std::string>& path);

    // History
    void pushHistory(const Identifier& state_id);
    std::optional<Identifier> popHistory();
    void pop_and_transition();
    std::vector<Identifier> getHistorySnapshot() const;

    // Path utilities
    std::string path() const;
    bool matches_state_path(const std::string& path) const;

    // ─────────────────────────────────────────────────────────────────────────
    // Diagnostics
    // ─────────────────────────────────────────────────────────────────────────

    struct Diagnostics {
        bool traceTransitions = true;
        bool traceDispatch = true;
        bool mirrorToConsole = false;
        i32 maxEntriesPerMachine = 512;
    };

    static Diagnostics diagnostics;
    static std::unordered_map<Identifier, std::vector<std::string>> TraceMap;

    // Allow StateMachineController to access private members
    friend class StateMachineController;

private:
    // ─────────────────────────────────────────────────────────────────────────
    // Initialization helpers
    // ─────────────────────────────────────────────────────────────────────────
    void bind();
    void populateStates();
    Identifier make_id() const;

    // ─────────────────────────────────────────────────────────────────────────
    // Definition resolution
    // ─────────────────────────────────────────────────────────────────────────
    StateDefinition* definitionOrThrow();
    StateDefinition* childDefinitionOrThrow(const Identifier& childId);
    StateDefinition* resolveDefinitionChild(StateDefinition* def, const Identifier& childId);

    // ─────────────────────────────────────────────────────────────────────────
    // Child state resolution
    // ─────────────────────────────────────────────────────────────────────────
    struct ChildResolution { State* child; Identifier key; };
    ChildResolution findChild(State* ctx, const std::string& seg);
    ChildResolution ensureChild(State* ctx, const std::string& seg);

    // ─────────────────────────────────────────────────────────────────────────
    // Critical section
    // ─────────────────────────────────────────────────────────────────────────
    void enterCriticalSection();
    void leaveCriticalSection();

    template<typename Fn>
    auto withCriticalSection(Fn&& fn) -> decltype(fn()) {
        enterCriticalSection();
        try {
            auto result = fn();
            leaveCriticalSection();
            return result;
        } catch (...) {
            leaveCriticalSection();
            throw;
        }
    }

    // Specialization for void return type
    void withCriticalSectionVoid(std::function<void()> fn);

    void process_transition_queue();

    // ─────────────────────────────────────────────────────────────────────────
    // Tick sub-operations
    // ─────────────────────────────────────────────────────────────────────────
    void runSubstateMachines();
    void processInput();
    void processInputForCurrentState();
    void runCurrentState();
    void doRunChecks();
    void runChecksForCurrentState();

    // ─────────────────────────────────────────────────────────────────────────
    // Timeline integration
    // ─────────────────────────────────────────────────────────────────────────
    TimelineHost* timelineHost();
    std::vector<StateTimelineBinding>& ensureTimelineDefinitions();
    StateTimelineBinding createTimelineBinding(const std::string& key, const StateTimelineConfig& config);
    void activateStateTimelines();
    void deactivateStateTimelines();

    // ─────────────────────────────────────────────────────────────────────────
    // Transition helpers
    // ─────────────────────────────────────────────────────────────────────────
    void transitionToState(const Identifier& state_id,
                           TransitionExecutionMode execMode = TransitionExecutionMode::Immediate);
    bool checkStateGuardConditions(const Identifier& target_state_id);
    void transitionToNextStateIfProvided(const std::optional<Identifier>& next_state);

    // ─────────────────────────────────────────────────────────────────────────
    // Event handling
    // ─────────────────────────────────────────────────────────────────────────
    std::optional<Identifier> handleStateTransition(const StateEventDefinition& handler);
    std::optional<Identifier> handleStateTransition(const TickCheckDefinition& handler);

    // ─────────────────────────────────────────────────────────────────────────
    // Path parsing (mirrors State.parseFsPath in TypeScript)
    // ─────────────────────────────────────────────────────────────────────────
    struct ParsedPath {
        bool abs = false;
        i32 up = 0;
        std::vector<std::string> segs;
    };
    static ParsedPath parseFsPath(const std::string& input);

    // Path matching helper
    bool matchSegments(State* start, const std::vector<std::string>& segments) const;

    // ─────────────────────────────────────────────────────────────────────────
    // Diagnostics
    // ─────────────────────────────────────────────────────────────────────────
    static bool shouldTraceTransitions() { return diagnostics.traceTransitions; }
    static bool shouldTraceDispatch() { return diagnostics.traceDispatch; }
    static void appendTraceEntry(const Identifier& machineId, const std::string& message);
};

} // namespace bmsx

#endif // BMSX_STATE_H
