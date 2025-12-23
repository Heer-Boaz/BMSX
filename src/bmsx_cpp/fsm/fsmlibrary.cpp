/*
 * fsmlibrary.cpp - FSM Definition Library and Active State Machines implementation
 */

#include "fsmlibrary.h"
#include "state.h"
#include <iostream>
#include <sstream>

namespace bmsx {

// ============================================================================
// StateDefinitions
// ============================================================================

void StateDefinitions::registerDefinition(std::unique_ptr<StateDefinition> def) {
    if (!def) return;
    registerDefinition(def->def_id, std::move(def));
}

void StateDefinitions::registerDefinition(const Identifier& id, std::unique_ptr<StateDefinition> def) {
    if (!def) return;
    def->def_id = id;
    definitions[id] = std::move(def);
}

StateDefinition* StateDefinitions::get(const Identifier& id) {
    auto it = definitions.find(id);
    return (it != definitions.end()) ? it->second.get() : nullptr;
}

const StateDefinition* StateDefinitions::get(const Identifier& id) const {
    auto it = definitions.find(id);
    return (it != definitions.end()) ? it->second.get() : nullptr;
}

bool StateDefinitions::has(const Identifier& id) const {
    return definitions.find(id) != definitions.end();
}

void StateDefinitions::unregister(const Identifier& id) {
    definitions.erase(id);
}

void StateDefinitions::clear() {
    definitions.clear();
}

std::vector<StateDefinitions::Identifier> StateDefinitions::getAllIds() const {
    std::vector<Identifier> ids;
    ids.reserve(definitions.size());
    for (const auto& [id, def] : definitions) {
        ids.push_back(id);
    }
    return ids;
}

// ============================================================================
// ActiveStateMachines
// ============================================================================

StateMachineController* ActiveStateMachines::create(
    const Identifier& defId, Stateful* target, const MachineId& machineId)
{
    auto* def = StateDefinitions::instance().get(defId);
    if (!def) {
        return nullptr;
    }

    auto controller = std::make_unique<StateMachineController>(def, target);
    MachineId id = machineId.empty() ? generateId() : machineId;
    controller->setMachineId(id);

    auto* ptr = controller.get();
    machines[id] = std::move(controller);
    if (target) {
        targetToMachine[target] = id;
    }

    return ptr;
}

void ActiveStateMachines::registerMachine(
    std::unique_ptr<StateMachineController> controller, const MachineId& machineId)
{
    if (!controller) return;

    MachineId id = machineId.empty() ? generateId() : machineId;
    controller->setMachineId(id);

    if (auto* target = controller->getTarget()) {
        targetToMachine[target] = id;
    }

    machines[id] = std::move(controller);
}

StateMachineController* ActiveStateMachines::get(const MachineId& id) {
    auto it = machines.find(id);
    return (it != machines.end()) ? it->second.get() : nullptr;
}

const StateMachineController* ActiveStateMachines::get(const MachineId& id) const {
    auto it = machines.find(id);
    return (it != machines.end()) ? it->second.get() : nullptr;
}

StateMachineController* ActiveStateMachines::findByTarget(Stateful* target) {
    auto it = targetToMachine.find(target);
    if (it != targetToMachine.end()) {
        return get(it->second);
    }
    return nullptr;
}

const StateMachineController* ActiveStateMachines::findByTarget(const Stateful* target) const {
    auto it = targetToMachine.find(const_cast<Stateful*>(target));
    if (it != targetToMachine.end()) {
        return get(it->second);
    }
    return nullptr;
}

std::vector<StateMachineController*> ActiveStateMachines::findByDefinition(const Identifier& defId) {
    std::vector<StateMachineController*> result;
    for (auto& [id, machine] : machines) {
        if (machine->getDefinitionId() == defId) {
            result.push_back(machine.get());
        }
    }
    return result;
}

void ActiveStateMachines::dispose(const MachineId& id) {
    auto it = machines.find(id);
    if (it == machines.end()) return;

    if (auto* target = it->second->getTarget()) {
        targetToMachine.erase(target);
    }

    it->second->dispose();
    machines.erase(it);
}

void ActiveStateMachines::disposeByTarget(Stateful* target) {
    auto it = targetToMachine.find(target);
    if (it != targetToMachine.end()) {
        dispose(it->second);
    }
}

void ActiveStateMachines::clear() {
    for (auto& [id, machine] : machines) {
        machine->dispose();
    }
    machines.clear();
    targetToMachine.clear();
}

void ActiveStateMachines::tick_all() {
    for (auto& [id, machine] : machines) {
        machine->tick();
    }
}

void ActiveStateMachines::pause_all() {
    for (auto& [id, machine] : machines) {
        machine->pause();
    }
}

void ActiveStateMachines::resume_all() {
    for (auto& [id, machine] : machines) {
        machine->resume();
    }
}

void ActiveStateMachines::start_all() {
    for (auto& [id, machine] : machines) {
        machine->start();
    }
}

void ActiveStateMachines::stop_all() {
    for (auto& [id, machine] : machines) {
        machine->stop();
    }
}

void ActiveStateMachines::dispatch_all(const GameEvent& event) {
    for (auto& [id, machine] : machines) {
        machine->dispatch(event);
    }
}

size_t ActiveStateMachines::countActive() const {
    size_t count = 0;
    for (const auto& [id, machine] : machines) {
        if (machine->isActive()) ++count;
    }
    return count;
}

size_t ActiveStateMachines::countPaused() const {
    size_t count = 0;
    for (const auto& [id, machine] : machines) {
        if (machine->isPaused()) ++count;
    }
    return count;
}

void ActiveStateMachines::dumpState() const {
    std::cout << "=== Active State Machines ===" << std::endl;
    std::cout << "Total: " << machines.size() << std::endl;
    std::cout << "Active: " << countActive() << std::endl;
    std::cout << "Paused: " << countPaused() << std::endl;
    std::cout << std::endl;

    for (const auto& [id, machine] : machines) {
        std::cout << "  [" << id << "]"
                  << " def=" << machine->getDefinitionId()
                  << " state=" << machine->getCurrentPath()
                  << " active=" << (machine->isActive() ? "yes" : "no")
                  << " paused=" << (machine->isPaused() ? "yes" : "no")
                  << std::endl;
    }
}

ActiveStateMachines::MachineId ActiveStateMachines::generateId() {
    std::ostringstream oss;
    oss << "fsm_" << (nextId++);
    return oss.str();
}

// ============================================================================
// FSMBuilder
// ============================================================================

FSMBuilder::FSMBuilder(const Identifier& id)
    : rootDef(std::make_unique<StateDefinition>())
{
    rootDef->id = id;
    rootDef->def_id = id;

    rootContext.def = rootDef.get();
    rootContext.parent = nullptr;
    currentContext = &rootContext;
}

void FSMBuilder::ensureContext() {
    if (!currentContext) {
        currentContext = &rootContext;
    }
}

FSMBuilder& FSMBuilder::initial(const Identifier& stateId) {
    ensureContext();
    currentContext->def->initial = stateId;
    return *this;
}

FSMBuilder& FSMBuilder::data(const StateData& d) {
    ensureContext();
    currentContext->def->data = d;
    return *this;
}

FSMBuilder& FSMBuilder::state(const Identifier& stateId) {
    ensureContext();

    auto childDef = std::make_unique<StateDefinition>();
    childDef->id = stateId;
    childDef->def_id = currentContext->def->def_id + "." + stateId;
    childDef->parent = currentContext->def;
    childDef->root = rootDef.get();

    auto* childPtr = childDef.get();
    currentContext->def->states[stateId] = std::move(childDef);

    // Create new context for child
    auto* newContext = new BuilderContext();
    newContext->def = childPtr;
    newContext->parent = currentContext;
    currentContext = newContext;

    return *this;
}

FSMBuilder& FSMBuilder::state(const Identifier& stateId, std::function<void(FSMBuilder&)> configure) {
    state(stateId);
    if (configure) {
        configure(*this);
    }
    return end();
}

FSMBuilder& FSMBuilder::onEnter(StateExitHandler handler) {
    ensureContext();
    currentContext->def->entering_state = handler;
    return *this;
}

FSMBuilder& FSMBuilder::onExit(StateExitHandler handler) {
    ensureContext();
    currentContext->def->exiting_state = handler;
    return *this;
}

FSMBuilder& FSMBuilder::onTick(StateTickHandler handler) {
    ensureContext();
    currentContext->def->tick = handler;
    return *this;
}

FSMBuilder& FSMBuilder::on(const Identifier& eventType, const Identifier& target) {
    ensureContext();
    StateEventDefinition eventDef;
    eventDef.target = target;
    currentContext->def->on[eventType] = eventDef;
    return *this;
}

FSMBuilder& FSMBuilder::on(const Identifier& eventType, StateEventHandler handler) {
    ensureContext();
    StateEventDefinition eventDef;
    eventDef.handler = handler;
    currentContext->def->on[eventType] = eventDef;
    return *this;
}

FSMBuilder& FSMBuilder::on(const Identifier& eventType, const Identifier& target, StateGuardFn guard) {
    ensureContext();
    StateEventDefinition eventDef;
    eventDef.target = target;
    eventDef.guard = guard;
    currentContext->def->on[eventType] = eventDef;
    return *this;
}

FSMBuilder& FSMBuilder::runCheck(StateTickCondition condition, const Identifier& target) {
    ensureContext();
    TickCheckDefinition check;
    check.condition = condition;
    check.target = target;
    currentContext->def->run_checks.push_back(check);
    return *this;
}

FSMBuilder& FSMBuilder::runCheck(StateTickCondition condition, const Identifier& target, StateGuardFn guard) {
    ensureContext();
    TickCheckDefinition check;
    check.condition = condition;
    check.target = target;
    check.guard = guard;
    currentContext->def->run_checks.push_back(check);
    return *this;
}

FSMBuilder& FSMBuilder::guard(StateGuardFn canEnter, StateGuardFn canExit) {
    ensureContext();
    if (!currentContext->def->transition_guards) {
        currentContext->def->transition_guards = StateGuard();
    }
    currentContext->def->transition_guards->can_enter = canEnter;
    currentContext->def->transition_guards->can_exit = canExit;
    return *this;
}

FSMBuilder& FSMBuilder::concurrent(bool is) {
    ensureContext();
    currentContext->def->is_concurrent = is;
    return *this;
}

FSMBuilder& FSMBuilder::final(bool is) {
    ensureContext();
    currentContext->def->is_final = is;
    return *this;
}

FSMBuilder& FSMBuilder::end() {
    if (currentContext && currentContext->parent) {
        auto* old = currentContext;
        currentContext = currentContext->parent;
        if (old != &rootContext) {
            delete old;
        }
    }
    return *this;
}

FSMBuilder& FSMBuilder::root() {
    // Clean up any nested contexts
    while (currentContext && currentContext != &rootContext) {
        auto* old = currentContext;
        currentContext = currentContext->parent;
        delete old;
    }
    currentContext = &rootContext;
    return *this;
}

std::unique_ptr<StateDefinition> FSMBuilder::build() {
    root();  // Clean up contexts
    return std::move(rootDef);
}

StateDefinition* FSMBuilder::buildAndRegister() {
    auto def = build();
    auto* ptr = def.get();
    StateDefinitions::instance().registerDefinition(std::move(def));
    return ptr;
}

} // namespace bmsx
