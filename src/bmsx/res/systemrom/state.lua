-- state.lua
-- re-export fsm state pieces for convenience

local fsm = require("fsm")

return {
	state = fsm.state,
	statedefinition = fsm.statedefinition,
	statemachinecontroller = fsm.statemachinecontroller,
}
