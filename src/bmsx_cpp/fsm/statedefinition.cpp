/*
 * statedefinition.cpp - State definition implementation
 */

#include "statedefinition.h"
#include <stdexcept>

namespace bmsx {

StateDefinition::StateDefinition(const Identifier& stateId, StateDefinition* rootDef, StateDefinition* parentDef)
    : id(stateId)
    , parent(parentDef)
    , root(rootDef ? rootDef : this)
{
    def_id = makeFullId();
}

Identifier StateDefinition::makeFullId() const {
    if (isRoot()) return id;

    if (!parent) {
        throw std::runtime_error("StateDefinition '" + id + "' is missing a parent while computing def_id.");
    }

    const auto& parentId = parent->def_id.empty() ? parent->id : parent->def_id;
    const char* separator = parent->isRoot() ? ":/" : "/";
    return parentId + separator + id;
}

StateDefinition* StateDefinition::addState(const Identifier& stateId) {
    auto newState = std::make_unique<StateDefinition>(stateId, root, this);
    StateDefinition* ptr = newState.get();
    states[stateId] = std::move(newState);

    // If this is the first state and no initial is set, use it as initial
    if (!initial) {
        initial = stateId;
    }

    return ptr;
}

StateDefinition* StateDefinition::getState(const Identifier& stateId) {
    auto it = states.find(stateId);
    if (it != states.end()) {
        return it->second.get();
    }
    return nullptr;
}

bool StateDefinition::isStartState() const {
    if (id.empty()) return false;
    char firstChar = id[0];
    return firstChar == '_' || firstChar == '#';
}

void StateDefinition::validate() const {
    validateStateMachine(this);
}

void StateDefinition::constructSubstateMachine() {
    // Set initial state to first child if not set
    if (!states.empty() && !initial) {
        initial = states.begin()->first;
    }
}

void validateStateMachine(const StateDefinition* def) {
    if (!def) return;

    // If there are child states, validate the initial state exists
    if (!def->states.empty() && def->initial) {
        if (def->states.find(*def->initial) == def->states.end()) {
            throw std::runtime_error(
                "StateDefinition '" + def->id + "' has initial state '" +
                *def->initial + "' but no such child state exists."
            );
        }
    }

    // Recursively validate child states
    for (const auto& [childId, childDef] : def->states) {
        validateStateMachine(childDef.get());
    }
}

} // namespace bmsx
