import { IO_IRQ_MASK } from '../../machine/ts/spec/bmsx/io';

/** Real allocation admission: no forced-major stress hook or artificial debt. */
export const gcPressureBody = `
mem[${IO_IRQ_MASK}] = 0
nonce = 37
pressure = false
owner = { child = false, text = false, removed = false }
array_owner = { false }
scalar_owner = { child = false }
scalar_array = { false }
weak = setmetatable({}, { __mode = 'v' })
entries = setmetatable({}, { __mode = 'k' })
local make = function()
 local captured = false
 return function(value) captured = value end, function() return captured end
end
change, read = make()
scalar_change = make()
assign = function(target, array, field_value, array_value)
 target.child = field_value
 array[1] = array_value
end
for i = 1, 100 do assign(owner, array_owner, false, false); change(false) end
old_text = 'old-live:' .. nonce
halt_until_irq
assign(scalar_owner, scalar_array, 8, 9)
scalar_change(10)
install = function()
 local child = { answer = 73 }
 assign(owner, array_owner, child, { answer = 74 })
 change({ answer = 75 })
 owner.text = 'pressure-live:é😀:' .. nonce
 owner.removed = 'pressure-retired:é😀:' .. nonce
 owner.removed = nil
 weak[1] = child
 weak[2] = { dead = true }
 weak[3] = 'pressure-weak-string:é😀:' .. nonce
 head = {}
 local tail = {}
 entries[head] = { next = tail }
 entries[tail] = { answer = 91 }
 weak[4] = tail
 local doomed = {}
 entries[doomed] = { self = doomed }
 weak[5] = doomed
end
install()
halt_until_irq
for i = 1, 2200 do pressure = { ${Array(384).fill("false").join(",")} } end
halt_until_irq
assert(owner.child.answer == 73, 'reachable field child')
assert(array_owner[1].answer == 74, 'reachable array child')
assert(read().answer == 75, 'reachable closed-cell child')
assert(weak[1] == owner.child, 'live weak value')
assert(weak[2] == nil, 'dead weak value')
assert(weak[3] == 'pressure-weak-string:é😀:' .. nonce, 'surviving weak String entries remain value-like')
assert(weak[4] == entries[head].next and entries[weak[4]].answer == 91, 'strong values of weak-key maps')
local retained = weak[5]
assert(retained ~= nil and entries[retained].self == retained, 'a strong value can retain its own weak key')
assert(owner.text == 'pressure-live:é😀:' .. nonce and old_text == 'old-live:' .. nonce, 'canonical live String bytes')
return true`;
