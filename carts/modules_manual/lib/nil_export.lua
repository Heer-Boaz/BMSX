local state<const> = require('results')
local result<const>: *modules_manual_result = state.result
result.nil_loads = result.nil_loads + 1

return nil
