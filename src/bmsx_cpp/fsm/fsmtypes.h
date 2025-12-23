/*
 * fsmtypes.h - Finite State Machine type definitions
 *
 * Mirrors TypeScript fsm/fsmtypes.ts
 */

#ifndef BMSX_FSMTYPES_H
#define BMSX_FSMTYPES_H

#include "../core/types.h"
#include <string>
#include <unordered_map>
#include <vector>
#include <functional>
#include <variant>
#include <optional>
#include <any>

namespace bmsx {

// Forward declarations
class State;
class StateDefinition;
class StateMachineController;
class WorldObject;

// Type aliases matching TypeScript
using Identifier = std::string;

/* ============================================================================
 * Stateful interface
 *
 * Any object that can have state machines attached to it.
 * Mirrors TypeScript Stateful interface.
 * ============================================================================ */

class Stateful {
public:
    virtual ~Stateful() = default;
    virtual Identifier getId() const = 0;
    virtual StateMachineController* getStateMachineController() = 0;
    virtual bool isEventHandlingEnabled() const = 0;
    // Event port access for dispatching events
    // virtual EventPort* getEvents() = 0;
};

/* ============================================================================
 * Game Event
 *
 * Represents an event in the game system.
 * ============================================================================ */

struct GameEvent {
    std::string type;
    Identifier emitter;
    f64 timestamp = 0;
    std::unordered_map<std::string, std::any> payload;
};

/* ============================================================================
 * Event Payload
 * ============================================================================ */

using EventPayload = std::unordered_map<std::string, std::any>;

/* ============================================================================
 * Transition target
 * ============================================================================ */

using TransitionTarget = Identifier;

/* ============================================================================
 * State event handler function type
 *
 * Returns optional transition target (state to transition to).
 * ============================================================================ */

using StateEventHandler = std::function<std::optional<TransitionTarget>(State*, const GameEvent&)>;
using StateEnterHandler = std::function<std::optional<TransitionTarget>(State*, const EventPayload*)>;
using StateExitHandler = std::function<void(State*, const EventPayload*)>;
using StateTickHandler = std::function<std::optional<TransitionTarget>(State*)>;

/* ============================================================================
 * State guard function type
 *
 * Returns true if transition is allowed.
 * ============================================================================ */

using StateGuardFn = std::function<bool(State*, const Identifier& targetState)>;

/* ============================================================================
 * State guards
 * ============================================================================ */

struct StateGuard {
    std::optional<StateGuardFn> can_exit;
    std::optional<StateGuardFn> can_enter;
};

// Alias for transition guards (same as StateGuard)
using TransitionGuards = StateGuard;

/* ============================================================================
 * State event definition
 *
 * Defines how an event is handled in a state.
 * ============================================================================ */

struct StateEventDefinition {
    // Target state to transition to
    std::optional<Identifier> target;

    // Handler function (if custom logic needed)
    std::optional<StateEventHandler> handler;

    // Guard condition
    std::optional<StateGuardFn> guard;

    // Actions to execute
    std::vector<std::string> actions;
};

/* ============================================================================
 * Tick check definition
 *
 * Condition checked every tick that can trigger transitions.
 * ============================================================================ */

// State tick condition function type
using StateTickCondition = std::function<bool(State*)>;

struct TickCheckDefinition {
    // Condition function
    StateTickCondition condition;

    // Target state if condition is true
    Identifier target;

    // Optional guard
    std::optional<StateGuardFn> guard;
};

/* ============================================================================
 * Listed state definition event
 * ============================================================================ */

struct ListedSdefEvent {
    std::string name;
};

/* ============================================================================
 * State action specifications
 *
 * Various action types that can be executed on state transitions.
 * ============================================================================ */

struct StateActionEmit {
    std::string event;
    std::optional<EventPayload> payload;
    std::optional<Identifier> emitter;
};

struct StateActionSetProperty {
    std::string target;
    std::any value;
};

struct StateActionAdjustProperty {
    std::string target;
    std::optional<f64> add;
    std::optional<f64> sub;
    std::optional<f64> mul;
    std::optional<f64> div;
    std::optional<std::any> set;
};

struct StateActionInvoke {
    std::function<void(State*)> fn;
    std::optional<EventPayload> payload;
};

// Variant of all action types
using StateAction = std::variant<
    StateActionEmit,
    StateActionSetProperty,
    StateActionAdjustProperty,
    StateActionInvoke
>;

/* ============================================================================
 * Forward declarations for timeline integration
 * ============================================================================ */

// Forward declaration for Timeline class
template<typename T> class Timeline;

// Forward declaration for timeline types (defined in timeline/timeline.h)
struct TimelinePlayOptions;
struct StateTimelineConfig;
struct StateTimelineBinding;

using StateTimelineMap = std::unordered_map<std::string, StateTimelineConfig>;

/* ============================================================================
 * Input evaluation mode
 * ============================================================================ */

enum class InputEvalMode {
    First,  // Stop after first matching input handler
    All     // Evaluate all input handlers
};

/* ============================================================================
 * Transition execution mode
 * ============================================================================ */

enum class TransitionExecutionMode {
    Immediate,  // Execute transition immediately
    Queued,     // Queue transition for later
    Deferred    // Defer transition to end of frame
};

/* ============================================================================
 * Transition trigger source
 * ============================================================================ */

enum class TransitionTrigger {
    Manual,         // Explicit transition call
    Event,          // Triggered by event
    Input,          // Triggered by input
    RunCheck,       // Triggered by run check condition
    ProcessInput,   // Triggered during input processing
    Tick,           // Triggered during tick
    Enter,          // Triggered on state enter
    QueueDrain      // Triggered when draining transition queue
};

/* ============================================================================
 * Transition outcome
 * ============================================================================ */

enum class TransitionOutcome {
    Success,    // Transition completed
    Queued,     // Transition was queued
    Blocked,    // Transition was blocked by guard
    Noop        // No transition occurred
};

/* ============================================================================
 * Transition trace entry (for diagnostics)
 * ============================================================================ */

struct TransitionTraceEntry {
    TransitionOutcome outcome;
    TransitionExecutionMode execution;
    std::optional<Identifier> from;
    Identifier to;
    std::optional<TransitionTrigger> trigger;
    std::string reason;
};

/* ============================================================================
 * Constants
 * ============================================================================ */

constexpr i32 BST_MAX_HISTORY = 10;
constexpr const char* DEFAULT_BST_ID = "master";
constexpr const char* START_STATE_PREFIXES = "_#";

// Type alias for state data
using StateData = std::unordered_map<std::string, std::any>;

} // namespace bmsx

#endif // BMSX_FSMTYPES_H
