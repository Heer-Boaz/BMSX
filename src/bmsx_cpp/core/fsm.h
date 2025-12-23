/*
 * fsm.h - Finite State Machine types for BMSX
 *
 * This provides stub/placeholder types for the FSM system.
 * The full FSM implementation mirrors TypeScript's StateMachineController,
 * State, and state definition system.
 */

#ifndef BMSX_FSM_H
#define BMSX_FSM_H

#include <string>
#include <functional>
#include <unordered_map>
#include <memory>

namespace bmsx {

// Forward declarations
class WorldObject;

/* ============================================================================
 * StateMachineController - Manages multiple state machines for an object
 *
 * This mirrors the TypeScript StateMachineController which:
 * - Holds multiple named State machines
 * - Dispatches events to active machines
 * - Controls tick/pause/start for all machines
 * ============================================================================ */

class StateMachineController {
public:
    StateMachineController() = default;
    explicit StateMachineController(const std::string& fsmId, const std::string& targetId);
    ~StateMachineController();

    // Lifecycle
    void start();
    void pause();
    void resume();
    void dispose();

    // Tick control
    void tick();
    bool tickEnabled = true;

private:
    std::string m_targetId;
    bool m_started = false;
    bool m_paused = false;
};

} // namespace bmsx

#endif // BMSX_FSM_H
