local heap<const> = require('kernel/gc_full')
local startup<const> = require('bmsx/startup')

-- Finish collection before initializing the managed System program.
heap.collect_full()
cop0.exec = startup.managed_entry
