-- state.lua
-- Re-export FSM State pieces for convenience

local fsm = require("fsm")

return {
	State = fsm.State,
	StateDefinition = fsm.StateDefinition,
	StateMachineController = fsm.StateMachineController,
}
