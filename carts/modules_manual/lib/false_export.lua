require('lib/nil_export')
local state<const> = require('results')
local result<const>: *modules_manual_result = state.result
result.false_loads = result.false_loads + 1
result.nil_seen_from_false = result.nil_loads

return false
