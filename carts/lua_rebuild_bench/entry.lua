module<entry>
local vblank<const> = require('cartlib/gx/vblank')
local irq_mask<const>: *word = 0x08000008
*irq_mask = 0x0004

-- Deliberately retain the supplied PUC workload, including its calls, ordinary
-- locals and nil-producing expression. Authoring rewrites would change the
-- experiment (especially const-function inlining). Only names are lowercased.
-- disable
local n_objects = 1825
local mode = "normal"

local pool = {}
for i = 1, 1825 do pool[i] = setmetatable({}, nil) end

local function setpos(o, x, y) o.x = x; o.y = y end          -- 2 SETFIELD
local function get_x(o) return o.x end                         -- GETFIELD

local actor = {}
actor.__index = actor
function actor:set_state(s) self.state = s end                 -- 1 SETFIELD

local calls, newt, setfield = 0, 0, 0

local function frame()
  local list = {}
  local acc = 0
  for i = 1, n_objects do
    local o
    if mode == "reuse" then o = setmetatable(pool[i], actor) elseif mode == "ctor" then o = setmetatable({kind = false, x = 0, y = 0, state = 0, room = 0, hp = 0, extra = false}, actor) else o = setmetatable({}, actor) end
    o.kind = "tile"                      -- SETFIELD
    setpos(o, i, i)                      -- CALL, 2 SETFIELD
    for k = 1, 3 do acc = acc + get_x(o) end   -- 3 CALL
    o:set_state(1)                       -- SELF + CALL, 1 SETFIELD
    o.room = 1                           -- SETFIELD
    o.hp = 3                             -- SETFIELD
    o.extra = (i % 3 == 0) and i or nil  -- SETFIELD (partly nil)
    list[i] = o
  end
  return acc
end

-- enable
-- The harness grants one completed unit at a time, so a unit that exceeds a
-- guest frame cannot be confused with the next unit's partially executed work.
rebuild_mode = "normal"
rebuild_requested = 0
rebuild_completed = 0
rebuild_checksum = 0
rebuild_ready = true
while true do
    vblank.wait()
    if rebuild_requested > rebuild_completed then
        mode = rebuild_mode
        rebuild_checksum = frame()
        rebuild_completed = rebuild_requested
    end
end
