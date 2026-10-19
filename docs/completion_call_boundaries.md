# Physical completion-call boundaries

Prerequisite found while auditing Studio execution results, 2026-09-23.
A completion root has its own return destination. It must not unwind into a
protected call belonging to the interrupted execution or yield/fail that
interrupted coroutine to its resumer. An unhandled completion error follows the
ordinary physical Lua-fault exception path, retaining the root for inspection.
Protected calls and child coroutines created **inside** the root still work.

## Production reference

Lua 5.4.8's [`luaD_callnoyield`](https://github.com/lua/lua/blob/v5.4.8/ldo.c#L661-L663)
and [`luaD_pcall`](https://github.com/lua/lua/blob/v5.4.8/ldo.c#L957-L972)
distinguish the embedding call boundary from Lua's surrounding resumable stack.
BMSX uses its existing physical completion-root bit, not Lua's C-stack counters
or longjmp implementation. This is a generic call-boundary repair, not an IDE
exception or a ban on ordinary guest coroutine yields/protected calls.
