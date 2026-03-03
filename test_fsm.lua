local function collect_event_list(def, list, seen)
for name, action in pairs(def.on or {}) do
local emitter = nil
if type(action) == "table" and action.emitter ~= nil then
emitter = action.emitter
end
local key = name .. ":" .. tostring(emitter)
if not seen[key] then
list[#list + 1] = { name = name, emitter = emitter }
seen[key] = true
end
end
for _, child in pairs(def.states or {}) do
collect_event_list(child, list, seen)
end
end
local parent = { on = { ["wow"] = { emitter = "d" } }, states = { sub = { on = { ["wow"] = { go = "/ok" } } } } }
local list = {}
collect_event_list(parent, list, {})
for i,x in ipairs(list) do print(x.name, x.emitter) end
