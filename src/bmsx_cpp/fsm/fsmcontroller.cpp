/*
 * fsmcontroller.cpp - State machine controller implementation
 */

#include "fsmcontroller.h"
#include "state.h"
#include "fsmlibrary.h"

namespace bmsx {

StateMachineController::StateMachineController(StateDefinition* def, Stateful* targetObj)
    : definition(def)
    , target(targetObj)
{
    // Create the root state from the definition
    // State::create handles populateStates() and reset()
    rootState = State::create(
        def->def_id,                    // localdef_id
        targetObj->getId(),             // target_id
        nullptr,                        // parent
        nullptr                         // root
    );
}

StateMachineController::~StateMachineController() {
    dispose();
}

void StateMachineController::start() {
    if (active || disposed) return;

    active = true;
    paused = false;

    if (rootState) {
        rootState->start();
    }
}

void StateMachineController::stop() {
    if (!active || disposed) return;

    active = false;
    paused = true;

    // State machine will handle its own cleanup when stopped
    // The TypeScript version doesn't explicitly exit states on stop
}

void StateMachineController::pause() {
    if (!active || disposed) return;
    paused = true;
    if (rootState) {
        rootState->paused = true;
    }
}

void StateMachineController::resume() {
    if (!active || disposed) return;
    paused = false;
    if (rootState) {
        rootState->paused = false;
    }
}

void StateMachineController::reset() {
    if (disposed) return;

    if (rootState) {
        rootState->reset();
    }
}

void StateMachineController::dispose() {
    if (disposed) return;
    disposed = true;

    if (onDispose) {
        onDispose();
    }

    if (rootState) {
        rootState->dispose();
        rootState.reset();
    }

    active = false;
    paused = true;
}

void StateMachineController::tick() {
    if (!active || paused || disposed) return;
    if (!tickEnabled) return;

    if (rootState) {
        rootState->tick();
    }
}

bool StateMachineController::dispatch(const GameEvent& event) {
    if (!active || disposed) return false;

    if (rootState) {
        return rootState->dispatch_event(event);
    }

    return false;
}

const StateMachineController::Identifier& StateMachineController::getCurrentState() const {
    if (rootState) {
        return rootState->currentid;
    }
    static Identifier empty;
    return empty;
}

StateMachineController::Identifier StateMachineController::getCurrentPath() const {
    if (rootState) {
        return rootState->path();
    }
    return "";
}

bool StateMachineController::isInState(const Identifier& stateId) const {
    if (rootState) {
        return rootState->matches_state_path(stateId);
    }
    return false;
}

bool StateMachineController::matchesStatePath(const std::string& path) const {
    if (rootState) {
        return rootState->matches_state_path(path);
    }
    return false;
}

bool StateMachineController::transitionTo(const Identifier& stateId) {
    if (!active || disposed) return false;

    if (rootState) {
        Identifier previousState = getCurrentState();
        rootState->transition_to(stateId);
        if (onStateChange && previousState != getCurrentState()) {
            onStateChange(previousState, getCurrentState());
        }
        return previousState != getCurrentState();
    }

    return false;
}

bool StateMachineController::transitionToPath(const Identifier& path) {
    if (!active || disposed) return false;

    if (rootState) {
        Identifier previousState = getCurrentState();
        rootState->transition_to_path(path);
        if (onStateChange && previousState != getCurrentState()) {
            onStateChange(previousState, getCurrentState());
        }
        return previousState != getCurrentState();
    }

    return false;
}

State* StateMachineController::getActiveLeaf() {
    if (!rootState) return nullptr;

    State* node = rootState.get();
    while (node->current()) {
        node = node->current();
    }
    return node;
}

const State* StateMachineController::getActiveLeaf() const {
    if (!rootState) return nullptr;

    const State* node = rootState.get();
    while (node->current()) {
        node = node->current();
    }
    return node;
}

} // namespace bmsx
