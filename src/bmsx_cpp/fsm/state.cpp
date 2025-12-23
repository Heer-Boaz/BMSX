/*
 * state.cpp - Runtime state instance implementation
 *
 * Mirrors TypeScript fsm/state.ts
 */

#include "state.h"
#include "fsmlibrary.h"
#include "../core/registry.h"
#include "../core/world.h"
#include "../component/timelinecomponent.h"
#include <algorithm>
#include <cctype>
#include <stdexcept>
#include <iostream>
#include <sstream>

namespace bmsx {

// Static member initialization
State::Diagnostics State::diagnostics = {};
std::unordered_map<Identifier, std::vector<std::string>> State::TraceMap;

namespace {

bool isNoopString(const std::string& value) {
	if (value.empty()) {
		return false;
	}
	std::string normalized = value;
	std::transform(normalized.begin(), normalized.end(), normalized.begin(), [](unsigned char c) {
		return static_cast<char>(std::tolower(c));
	});
	return normalized == "no-op" || normalized == "noop" || normalized == "no_op";
}

} // namespace

// ============================================================================
// Constructor
// ============================================================================

State::State(const Identifier& localdef_id_, const Identifier& target_id_,
             State* parent, State* root)
    : target_id(target_id_)
    , parent_ref(parent)
{
    localdef_id = localdef_id_.empty() ? DEFAULT_BST_ID : localdef_id_;

    // Set root reference
    if (root) {
        root_ref = root;
    } else if (parent) {
        root_ref = parent->root();
    } else {
        root_ref = this;
    }

    if (target_id.empty()) {
        throw std::runtime_error("[State] Missing target id while constructing state '" + localdef_id + "'.");
    }

    // Resolve definition ID
    if (parent) {
        auto* childDef = parent->childDefinitionOrThrow(localdef_id);
        def_id = childDef->def_id;
    } else {
        auto* rootDef = StateDefinitions::instance().get(localdef_id);
        if (!rootDef) {
            throw std::runtime_error("[State] Definition '" + localdef_id + "' not found while constructing root state for '" + target_id + "'.");
        }
        def_id = rootDef->def_id;
    }

    paused = false;
    id = make_id();
    appendTraceEntry(id, "[create] machine='" + localdef_id + "' target='" + target_id + "'");

    transition_queue.clear();
    critical_section_counter = 0;
    is_processing_queue = false;

    _hist.resize(BST_MAX_HISTORY);
    _histHead = 0;
    _histSize = 0;

    bind();
}

// ============================================================================
// Factory
// ============================================================================

std::unique_ptr<State> State::create(const Identifier& localdef_id,
                                      const Identifier& target_id,
                                      State* parent, State* root) {
    auto result = std::make_unique<State>(localdef_id, target_id, parent, root);
    result->populateStates();
    result->reset(true);
    return result;
}

// ============================================================================
// Accessors
// ============================================================================

bool State::is_concurrent() const {
    auto* def = const_cast<State*>(this)->definitionOrThrow();
    return def && def->is_concurrent;
}

StateDefinition* State::definition() {
    return definitionOrThrow();
}

const StateDefinition* State::definition() const {
    return const_cast<State*>(this)->definitionOrThrow();
}

State* State::current() {
    if (states.empty()) return nullptr;
    auto it = states.find(currentid);
    return (it != states.end()) ? it->second.get() : nullptr;
}

const State* State::current() const {
    return const_cast<State*>(this)->current();
}

Identifier State::start_state_id() const {
    auto* def = const_cast<State*>(this)->definitionOrThrow();
    return def->initial.value_or("");
}

StateDefinition* State::current_state_definition() {
    State* cur = current();
    if (!cur) {
        throw std::runtime_error("[State] Current state '" + currentid + "' is not active for '" + id + "'.");
    }
    return cur->definition();
}

const StateDefinition* State::current_state_definition() const {
    return const_cast<State*>(this)->current_state_definition();
}

// ============================================================================
// Lifecycle
// ============================================================================

void State::start() {
    activateStateTimelines();

    auto startStateId = start_state_id();
    if (startStateId.empty()) {
        if (states.empty()) return; // No states, nothing to start
        throw std::runtime_error("No start state defined for state machine '" + id + "', while the state machine has states defined.");
    }

    auto it = states.find(startStateId);
    if (it == states.end()) {
        throw std::runtime_error("[State] start(): Start state '" + startStateId + "' not found in state machine '" + id + "'.");
    }

    State* startInstance = it->second.get();
    StateDefinition* startStateDef = startInstance->definition();

    // Trigger the enter event for the start state
    withCriticalSectionVoid([this, startInstance, startStateDef]() {
        startInstance->activateStateTimelines();

        std::optional<Identifier> startNext;
        if (startStateDef->entering_state) {
            startNext = (*startStateDef->entering_state)(startInstance, nullptr);
        }
        startInstance->transitionToNextStateIfProvided(startNext);
    });

    // Start the state machine for the current active state recursively
    startInstance->start();
}

void State::reset(bool initializing) {
    // Reset history
    _histHead = 0;
    _histSize = 0;

    auto* def = definitionOrThrow();
    data = def->data;

    // Reset current state to initial
    auto initial = start_state_id();
    if (!initial.empty() && !states.empty()) {
        auto it = states.find(initial);
        if (it != states.end()) {
            currentid = initial;
            // Recursively reset child states
            it->second->reset(initializing);
        }
    }
}

void State::dispose() {
    // Dispose all child states
    for (auto& [childId, childState] : states) {
        childState->dispose();
    }
    states.clear();
}

// ============================================================================
// Tick (main execution loop)
// ============================================================================

void State::tick() {
    auto* def = definitionOrThrow();
    if (!def || paused) return;

    _transitionsThisTick = 0;
    withCriticalSectionVoid([this]() {
        in_tick = true;

        // Run states first (substates tick before parent)
        runSubstateMachines();

        // Process input for the current state
        processInput();

        // Run the current state's logic
        runCurrentState();

        // Execute run checks
        doRunChecks();

        in_tick = false;
    });
}

void State::runSubstateMachines() {
    if (states.empty()) return;

    auto it = states.find(currentid);
    if (it == states.end()) {
        throw std::runtime_error("[State] Current state '" + currentid + "' not found in '" + id + "'.");
    }

    State* cur = it->second.get();
    cur->tick();

    // Parallel states run alongside the focused branch
    for (auto& [childId, childState] : states) {
        if (childId != currentid && childState->is_concurrent()) {
            childState->tick();
        }
    }
}

void State::processInput() {
    if (paused) return;

    // Process input for current state first (already handled by runSubstateMachines)
    processInputForCurrentState();

    auto* def = definitionOrThrow();
    if (def->process_input) {
        GameEvent emptyEvent;
        emptyEvent.type = "__fsm.synthetic__";
        auto next_state = (*def->process_input)(this, emptyEvent);
        transitionToNextStateIfProvided(next_state);
    }
}

void State::processInputForCurrentState() {
    auto* def = definitionOrThrow();
    if (def->input_event_handlers.empty()) return;

    // TODO: Integrate with Input system when available
    // For now, this is a placeholder
}

void State::runCurrentState() {
    auto* def = definitionOrThrow();
    if (def->tick) {
        auto next_state = (*def->tick)(this);
        if (next_state) {
            transitionToNextStateIfProvided(next_state);
        }
    }
}

void State::doRunChecks() {
    if (paused) return;
    runChecksForCurrentState();
}

void State::runChecksForCurrentState() {
    auto* def = definitionOrThrow();
    if (def->run_checks.empty()) return;

    for (const auto& rc : def->run_checks) {
        auto result = handleStateTransition(rc);
        if (result) {
            transitionToNextStateIfProvided(result);
            break; // First passing check wins
        }
    }
}

// ============================================================================
// Event dispatch
// ============================================================================

bool State::dispatch_event(const GameEvent& event) {
    if (paused) return false;

    // Check if we have child states
    bool hasChildren = !states.empty();

    if (hasChildren) {
        // Dispatch to current child first
        State* cur = current();
        if (cur && cur->dispatch_event(event)) {
            return true;
        }

        // Dispatch to concurrent children
        for (auto& [childId, childState] : states) {
            if (childId != currentid && childState->is_concurrent()) {
                if (childState->dispatch_event(event)) {
                    return true;
                }
            }
        }
    }

    // Handle at this level
    auto* def = definitionOrThrow();
    auto it = def->on.find(event.type);
    if (it != def->on.end()) {
        auto result = handleStateTransition(it->second, &event);
        if (result) {
            transitionToNextStateIfProvided(result);
            return true;
        }
    }

    return false;
}

// ============================================================================
// Transitions
// ============================================================================

void State::transition_to(const Identifier& state_id) {
    transition_to_path(state_id);
}

void State::transition_to_path(const std::string& path) {
    auto spec = parseFsPath(path);
    if (!spec.abs && spec.up == 0 && spec.segs.empty()) {
        throw std::runtime_error("Empty path is invalid.");
    }

    State* ctx = spec.abs ? root() : this;
    for (i32 u = 0; u < spec.up; ++u) {
        if (!ctx->parent_ref) {
            throw std::runtime_error("Path '" + path + "' attempts to go above root.");
        }
        ctx = ctx->parent_ref;
    }

    for (size_t i = 0; i < spec.segs.size(); ++i) {
        auto resolved = ensureChild(ctx, spec.segs[i]);
        if (!resolved.child->is_concurrent() && ctx->currentid != resolved.key) {
            ctx->transitionToState(resolved.key);
        }
        ctx = resolved.child;
    }
}

void State::transition_to_path(const std::vector<std::string>& path) {
    if (path.empty()) {
        throw std::runtime_error("Empty path is invalid.");
    }

    State* ctx = this;
    for (const auto& seg : path) {
        auto resolved = ensureChild(ctx, seg);
        if (!resolved.child->is_concurrent() && ctx->currentid != resolved.key) {
            ctx->transitionToState(resolved.key);
        }
        ctx = resolved.child;
    }
}

void State::transitionToState(const Identifier& state_id, TransitionExecutionMode execMode) {
    if (in_tick) {
        if (++_transitionsThisTick > MAX_TRANSITIONS_PER_TICK) {
            throw std::runtime_error("Transition limit exceeded in one tick for '" + id + "'.");
        }
    }

    // Queue if in critical section
    if (critical_section_counter > 0 && execMode == TransitionExecutionMode::Immediate) {
        transition_queue.push_back({ state_id });
        return;
    }

    // Noop if already in target state
    if (currentid == state_id) {
        return;
    }

    // Check guards
    if (!checkStateGuardConditions(state_id)) {
        return;
    }

    withCriticalSectionVoid([this, &state_id, execMode]() {
        Identifier prevId = currentid;
        auto* prevDef = current_state_definition();
        State* prevInstance = current();
        if (!prevInstance) {
            throw std::runtime_error("[State] Previous state '" + prevId + "' not found in '" + id + "'.");
        }

        // Exit handler
        if (prevDef->exiting_state) {
            (*prevDef->exiting_state)(prevInstance, nullptr);
        }
        prevInstance->deactivateStateTimelines();
        pushHistory(prevId);

        // Switch current
        currentid = state_id;
        State* cur = current();
        if (!cur) {
            throw std::runtime_error("[State] State '" + id + "' transitioned to '" + state_id + "' but the instance was not created.");
        }

        auto* curDef = current_state_definition();
        if (curDef->is_concurrent) {
            throw std::runtime_error("Cannot transition to parallel state '" + state_id + "'!");
        }

        cur->activateStateTimelines();

        // Enter handler
        std::optional<Identifier> next;
        if (curDef->entering_state) {
            next = (*curDef->entering_state)(cur, nullptr);
        }
        cur->transitionToNextStateIfProvided(next);
    });
}

bool State::checkStateGuardConditions(const Identifier& target_state_id) {
    // Check exit guard on current state
    if (!currentid.empty()) {
        State* cur = current();
        if (cur) {
            auto* curDef = cur->definition();
            if (curDef->transition_guards && curDef->transition_guards->can_exit) {
                if (!(*curDef->transition_guards->can_exit)(cur, target_state_id)) {
                    return false;
                }
            }
        }
    }

    // Check enter guard on target state
    auto it = states.find(target_state_id);
    if (it != states.end()) {
        auto* childDef = childDefinitionOrThrow(target_state_id);
        if (childDef->transition_guards && childDef->transition_guards->can_enter) {
            if (!(*childDef->transition_guards->can_enter)(it->second.get(), currentid)) {
                return false;
            }
        }
    }

    return true;
}

void State::transitionToNextStateIfProvided(const std::optional<Identifier>& next_state) {
    if (next_state && !next_state->empty() && !isNoopString(*next_state)) {
        transition_to(*next_state);
    }
}

std::optional<Identifier> State::handleStateTransition(const StateEventDefinition& handler, const GameEvent* event) {
    // Check guard
    if (handler.guard) {
        if (!(*handler.guard)(this, handler.target.value_or(""))) {
            return std::nullopt;
        }
    }

    // Return target if specified
    if (handler.target) {
        return handler.target;
    }

    // Call handler if present
    if (handler.handler) {
        GameEvent emptyEvent;
        emptyEvent.type = "__fsm.synthetic__";
        const GameEvent& actual = event ? *event : emptyEvent;
        return (*handler.handler)(this, actual);
    }

    return std::nullopt;
}

std::optional<Identifier> State::handleStateTransition(const TickCheckDefinition& handler) {
    // Check condition
    if (!handler.condition || !handler.condition(this)) {
        return std::nullopt;
    }

    // Check guard
    if (handler.guard) {
        if (!(*handler.guard)(this, handler.target)) {
            return std::nullopt;
        }
    }

    return handler.target;
}

// ============================================================================
// History
// ============================================================================

void State::pushHistory(const Identifier& state_id) {
    if (_hist.empty()) return;

    _hist[_histHead] = state_id;
    _histHead = (_histHead + 1) % static_cast<i32>(_hist.size());
    if (_histSize < static_cast<i32>(_hist.size())) {
        ++_histSize;
    }
}

std::optional<Identifier> State::popHistory() {
    if (_histSize == 0) return std::nullopt;

    --_histSize;
    _histHead = (_histHead - 1 + static_cast<i32>(_hist.size())) % static_cast<i32>(_hist.size());
    return _hist[_histHead];
}

void State::pop_and_transition() {
    auto prev = popHistory();
    if (prev) {
        transitionToState(*prev);
    }
}

std::vector<Identifier> State::getHistorySnapshot() const {
    std::vector<Identifier> result;
    result.reserve(_histSize);

    i32 idx = (_histHead - _histSize + static_cast<i32>(_hist.size())) % static_cast<i32>(_hist.size());
    for (i32 i = 0; i < _histSize; ++i) {
        result.push_back(_hist[idx]);
        idx = (idx + 1) % static_cast<i32>(_hist.size());
    }

    return result;
}

// ============================================================================
// Path utilities
// ============================================================================

std::string State::path() const {
    if (is_root()) {
        return "/";
    }
    std::vector<std::string> segments;
    const State* node = this;
    while (node && !node->is_root()) {
        segments.push_back(node->localdef_id);
        node = node->parent_ref;
    }
    std::reverse(segments.begin(), segments.end());

    std::ostringstream oss;
    oss << "/";
    for (size_t i = 0; i < segments.size(); ++i) {
        if (i > 0) {
            oss << "/";
        }
        oss << segments[i];
    }
    return oss.str();
}

bool State::matches_state_path(const std::string& pathStr) const {
    auto spec = parseFsPath(pathStr);

    // Determine starting context
    const State* ctx = spec.abs ? root() : this;

    // Navigate up for parent references
    for (i32 u = 0; u < spec.up; ++u) {
        if (!ctx->parent_ref) return false;
        ctx = ctx->parent_ref;
    }

    // Match segments
    return matchSegments(const_cast<State*>(ctx), spec.segs);
}

bool State::matchSegments(State* start, const std::vector<std::string>& segments) const {
    if (segments.empty()) return false;

    State* ctx = start;
    for (size_t i = 0; i < segments.size(); ++i) {
        const std::string& seg = segments[i];
        auto resolved = const_cast<State*>(this)->findChild(ctx, seg);

        if (!resolved.child || resolved.key.empty()) return false;
        if (!resolved.child->is_concurrent() && ctx->currentid != resolved.key) return false;
        if (i == segments.size() - 1) return true;

        ctx = resolved.child;
    }
    return false;
}

// ============================================================================
// Critical section
// ============================================================================

void State::enterCriticalSection() {
    ++critical_section_counter;
}

void State::leaveCriticalSection() {
    --critical_section_counter;
    if (critical_section_counter == 0) {
        if (!is_processing_queue) {
            process_transition_queue();
        }
    } else if (critical_section_counter < 0) {
        throw std::runtime_error("Critical section counter was lower than 0, which is obviously a bug. State: \"" + id + "\", StateDefId: \"" + localdef_id + "\".");
    }
}

void State::withCriticalSectionVoid(std::function<void()> fn) {
    enterCriticalSection();
    try {
        fn();
        leaveCriticalSection();
    } catch (...) {
        leaveCriticalSection();
        throw;
    }
}

void State::process_transition_queue() {
    if (is_processing_queue) return;
    is_processing_queue = true;

    try {
        for (size_t i = 0; i < transition_queue.size(); ++i) {
            const auto& t = transition_queue[i];
            transitionToState(t.path, TransitionExecutionMode::Deferred);
        }
        transition_queue.clear();
    } catch (...) {
        is_processing_queue = false;
        throw;
    }

    is_processing_queue = false;
}

// ============================================================================
// Initialization helpers
// ============================================================================

void State::bind() {
    // Binding logic - connect to registries, etc.
    // In TypeScript this connects to StateDefinitions registry
}

void State::populateStates() {
    auto* def = definitionOrThrow();
    if (def->states.empty()) return;

    for (const auto& [childId, childDef] : def->states) {
        auto childState = std::make_unique<State>(childId, target_id, this, root());
        childState->populateStates();
        states[childId] = std::move(childState);
    }

    // Set initial current state
    if (def->initial) {
        currentid = *def->initial;
    } else if (!states.empty()) {
        // Default to first state
        currentid = states.begin()->first;
    }
}

Identifier State::make_id() const {
    std::ostringstream oss;
    oss << "state:" << localdef_id << ":" << target_id << ":" << reinterpret_cast<uintptr_t>(this);
    return oss.str();
}

// ============================================================================
// Definition resolution
// ============================================================================

StateDefinition* State::definitionOrThrow() {
    if (def_id.empty()) {
        throw std::runtime_error("[State] Definition id not resolved for state '" + localdef_id + "' (target '" + target_id + "').");
    }
    auto* def = StateDefinitions::instance().get(def_id);
    if (!def) {
        throw std::runtime_error("[State] Definition '" + def_id + "' is not registered for state '" + id + "'.");
    }
    return def;
}

StateDefinition* State::childDefinitionOrThrow(const Identifier& childId) {
    auto* def = definitionOrThrow();
    if (def->states.empty()) {
        throw std::runtime_error("[State] Definition '" + def->def_id + "' has no substates while resolving '" + childId + "'.");
    }
    auto* child = resolveDefinitionChild(def, childId);
    if (!child) {
        throw std::runtime_error("[State] Definition '" + def->def_id + "' is missing child '" + childId + "'.");
    }
    return child;
}

StateDefinition* State::resolveDefinitionChild(StateDefinition* def, const Identifier& childId) {
    if (def->states.empty()) return nullptr;

    // Direct match
    auto it = def->states.find(childId);
    if (it != def->states.end()) {
        return it->second.get();
    }

    // Try with underscore prefix
    auto aliasUnderscore = "_" + childId;
    it = def->states.find(aliasUnderscore);
    if (it != def->states.end()) {
        return it->second.get();
    }

    // Try with hash prefix
    auto aliasHash = "#" + childId;
    it = def->states.find(aliasHash);
    if (it != def->states.end()) {
        return it->second.get();
    }

    return nullptr;
}

// ============================================================================
// Child state resolution
// ============================================================================

State::ChildResolution State::findChild(State* ctx, const std::string& seg) {
    if (ctx->states.empty()) return { nullptr, "" };

    // Direct match
    auto it = ctx->states.find(seg);
    if (it != ctx->states.end()) {
        return { it->second.get(), seg };
    }

    // Try with underscore prefix
    auto aliasUnderscore = "_" + seg;
    it = ctx->states.find(aliasUnderscore);
    if (it != ctx->states.end()) {
        return { it->second.get(), aliasUnderscore };
    }

    // Try with hash prefix
    auto aliasHash = "#" + seg;
    it = ctx->states.find(aliasHash);
    if (it != ctx->states.end()) {
        return { it->second.get(), aliasHash };
    }

    return { nullptr, "" };
}

State::ChildResolution State::ensureChild(State* ctx, const std::string& seg) {
    auto resolved = findChild(ctx, seg);
    if (!resolved.child || resolved.key.empty()) {
        if (ctx->states.empty()) {
            throw std::runtime_error("[State] State '" + ctx->id + "' does not define substates.");
        }
        std::ostringstream oss;
        oss << "No state '" << seg << "' under '" << ctx->id << "'. Children: ";
        bool first = true;
        for (const auto& [childId, _] : ctx->states) {
            if (!first) oss << ", ";
            oss << childId;
            first = false;
        }
        throw std::runtime_error(oss.str());
    }
    return resolved;
}

// ============================================================================
// Path parsing (mirrors State.parseFsPath in TypeScript)
// ============================================================================

State::ParsedPath State::parseFsPath(const std::string& input) {
    ParsedPath result;
    if (input.empty()) return result;

    size_t i = 0;
    size_t len = input.length();

    // Check for absolute path
    if (input[0] == '/') {
        result.abs = true;
        i = 1;
    } else if (input.compare(0, 5, "root:") == 0) {
        result.abs = true;
        i = 5;
        if (i < len && input[i] == '/') ++i;
    }

    // Count parent navigations
    while (i < len) {
        if (input.compare(i, 3, "../") == 0) {
            ++result.up;
            i += 3;
        } else if (input.compare(i, 2, "..") == 0 && (i + 2 >= len || input[i + 2] == '/')) {
            ++result.up;
            i += 2;
            if (i < len && input[i] == '/') ++i;
        } else if (input.compare(i, 7, "parent:") == 0) {
            ++result.up;
            i += 7;
            if (i < len && input[i] == '/') ++i;
        } else {
            break;
        }
    }

    // Parse remaining segments
    while (i < len) {
        size_t start = i;
        while (i < len && input[i] != '/') ++i;
        if (i > start) {
            result.segs.push_back(input.substr(start, i - start));
        }
        if (i < len && input[i] == '/') ++i;
    }

    return result;
}

// ============================================================================
// Diagnostics
// ============================================================================

void State::appendTraceEntry(const Identifier& machineId, const std::string& message) {
    auto& entries = TraceMap[machineId];
    entries.push_back(message);

    // Limit entries
    while (static_cast<i32>(entries.size()) > diagnostics.maxEntriesPerMachine) {
        entries.erase(entries.begin());
    }

    if (diagnostics.mirrorToConsole) {
        std::cout << "[FSM:" << machineId << "] " << message << std::endl;
    }
}

// ============================================================================
// Timeline integration
// ============================================================================

TimelineHost* State::timelineHost() {
    auto* obj = Registry::instance().get<WorldObject>(target_id);
    return obj->getFirstComponent<TimelineComponent>();
}

std::vector<StateTimelineBinding>& State::ensureTimelineDefinitions() {
    if (!timelineBindings.has_value()) {
        auto* def = definitionOrThrow();
        if (!def->timelines || def->timelines->empty()) {
            timelineBindings = std::vector<StateTimelineBinding>{};
        } else {
            std::vector<StateTimelineBinding> bindings;
            for (const auto& [key, config] : *def->timelines) {
                bindings.push_back(createTimelineBinding(key, config));
            }
            timelineBindings = std::move(bindings);
        }
    }

    if (!timelineBindings.has_value() || timelineBindings->empty()) {
        static std::vector<StateTimelineBinding> empty;
        return timelineBindings.has_value() ? *timelineBindings : empty;
    }

    // Ensure all timelines are defined with the host
    TimelineHost* host = timelineHost();
    if (!host) {
        return *timelineBindings;
    }

    for (auto& binding : *timelineBindings) {
        if (binding.defined) continue;

        auto timeline = binding.create();
        if (!timeline) {
            throw std::runtime_error("[State] Timeline factory for '" + binding.id + "' returned no timeline.");
        }
        if (timeline->id != binding.id) {
            throw std::runtime_error("[State] Timeline factory for '" + binding.id + "' returned timeline '" + timeline->id + "'.");
        }
        host->define_timeline(std::move(timeline));
        binding.defined = true;
    }

    return *timelineBindings;
}

StateTimelineBinding State::createTimelineBinding(const std::string& key, const StateTimelineConfig& config) {
    if (!config.create) {
        throw std::runtime_error("[State] Timeline '" + key + "' is missing a create() factory.");
    }

    StateTimelineBinding binding;
    binding.id = config.id.value_or(key);
    binding.create = config.create;
    binding.autoplay = config.autoplay;
    binding.stopOnExit = config.stop_on_exit;
    if (config.play_options) {
        binding.playOptions = *config.play_options;
    }
    binding.defined = false;

    return binding;
}

void State::activateStateTimelines() {
    auto& bindings = ensureTimelineDefinitions();
    if (bindings.empty()) return;

    TimelineHost* host = timelineHost();
    if (!host) return;

    for (const auto& binding : bindings) {
        if (!binding.autoplay) continue;
        host->play_timeline(binding.id, &binding.playOptions);
    }
}

void State::deactivateStateTimelines() {
    if (!timelineBindings.has_value() || timelineBindings->empty()) return;

    TimelineHost* host = timelineHost();
    if (!host) return;

    for (const auto& binding : *timelineBindings) {
        if (!binding.stopOnExit) continue;
        host->stop_timeline(binding.id);
    }
}

} // namespace bmsx
