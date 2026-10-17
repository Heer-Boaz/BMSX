# Protected calls and coroutines

The installed BIOS supplies the `error`, `pcall` and `xpcall` globals and the
`coroutine` interface used here. These calls exchange language values, including
Tables, nil and Thread references; they do not exchange device-register words.
**CPU and BLua32 instruction reference** defines value kinds and ordinary calls.
**Memory and program storage** defines typed BSS, startup and module declarations.
**Interrupt controller** and **System control and timing** define hardware
exception and interrupt handling separately.

## Protected calls

Use a protected call when a cartridge needs to receive a language error as a result instead of letting that error escape its current call chain. BMSX installs `error`, `pcall`, and `xpcall` as ordinary global functions before cartridge execution. These public names need no separate import.

Protection does not turn every error into a printable message. The success flag tells you what happened; the remaining values can include `nil`, numbers, or objects whose identity matters.

### Signatures

| Function | Source-facing signature | Purpose |
|---|---|---|
| `error` | `error(message [, level])` | Raise the supplied value; do not return normally. |
| `pcall` | `pcall(f, ...)` | Call `f` with protection. |
| `xpcall` | `xpcall(f, msgh, ...)` | Call `f` with protection and transform its error through `msgh`. |

Brackets mark the optional `level` argument. The ellipses denote arguments forwarded to the target. The advertised required leading arguments are one for `error`, one for `pcall`, and two for `xpcall`.

These signatures are distinct from missing-slot behavior at the raw call boundary. A missing first argument to `error` supplies `nil`; a missing protected target is also `nil`. Neither fact advertises a shortened source signature or promises that every source-call form accepts missing required arguments. No maximum argument or result count is specified here.

### Raising a value

Despite its parameter name, `message` need not be a string. `error` raises its first argument unchanged. It can be `nil`, a boolean, number, string, table, function, or thread. It does not stringify that value. A table used as an error remains that table, rather than becoming a copy or a formatted description.

The installed behavior does not consult `level` or additional arguments. In particular, the advertised optional `level` does not select a stack level or decorate the thrown value. Do not depend on `error` adding a source-location prefix or traceback.

An error payload of `nil` is still an error. Inspect the success flag, not the payload's truth value, to distinguish failure from success.

### Calling and receiving results

`pcall` forwards the arguments after `f`. `xpcall` forwards the arguments after `f` and `msgh`; the handler is not one of the body's arguments. The target must be a function: either a BLua closure or a built-in function. A value of another kind is not accepted as a protected target.

When the surrounding expression receives all results, the layouts are:

| Outcome | Results, in order |
|---|---|
| Target returns no values | `true` |
| Target returns values | `true`, followed by every target result |
| `pcall` catches an error | `false, errorValue` |
| `xpcall` handles an error | `false, handlerValue` |

Result count and `nil` positions matter. The accompanying program's arithmetic call produces `true, 10, nil, 4`, not a compressed three-value result. An ordinary source function that falls through, or uses a bare return, returns one `nil`; its protected success therefore gives `true, nil`, not just `true`. A caught `nil` error produces exactly two results, `false, nil`. If the caller requests a fixed number of results instead, extra results are discarded and missing positions are filled with `nil`.

A protected target can itself be `pcall` or `xpcall`. Its own success flag and remaining results are then ordinary results of the outer target; an outer success flag does not mean that every nested operation succeeded.

### Transforming an error

`xpcall` requires `msgh` to be a function before it establishes its new protected call. An absent or non-function handler therefore raises an error outside that new boundary. An already active outer protected call can catch it.

A body error unwinds the body's calls before the saved handler runs. The handler receives exactly one argument: the incoming error value. If it returns normally, only its first result becomes `handlerValue`; further results are discarded. A handler returning no results supplies `nil`. The accompanying program transforms its error into `144` and discards the handler's extra result.

A language error reaching the same protected boundary while its handler is active replaces the payload with the exact string `error in error handling`. It does not return the handler's newly thrown value. The accompanying program demonstrates this result.

This rule has a specific limit: the local error handling around a directly invoked built-in handler covers explicit thrown values and language execution errors, not out-of-memory conditions. It is not a guarantee that every handler failure or every memory-exhaustion path can be recovered as `false, "error in error handling"`.

<section class="keep-together">

### Which failures are protected?

The protected language-error path handles explicitly raised values, language execution errors, and classified out-of-memory errors. Explicit values remain unchanged; the latter two categories supply reason strings.

| Condition | Error payload |
|---|---|
| Non-function protected target | `Attempted to call a non-function value.` |
| Non-function `xpcall` handler | `xpcall error handler must be a function.` |
| Nil table key in the demonstrated read | `Table index is nil.` |
| Classified memory exhaustion | `Out of memory.` |

</section>

The target check occurs inside the new protected boundary. For `pcall`, a non-function target therefore gives `false` and its reason string. For `xpcall`, the valid handler receives that target error. The handler check, by contrast, occurs before the new boundary, as described above. The nil-key read in the accompanying program demonstrates an execution error caught by `pcall`.

Protection is not a machine-fault sandbox. Synchronous hardware exceptions do not take this protected language-error route; do not use `pcall` as a guarantee of recovery from bus, address, or coprocessor faults. An entered hardware exception or interrupt context also prevents an older protected call from unwinding across that boundary. A newer protected call made within that context can protect calls on its own side of the boundary. These are limits of protection, not an exhaustive list of machine execution boundaries.

Protected calls belong to individual threads. The innermost active protected call in the current thread receives an eligible error. Installing protection in one thread does not install it in another. Protection in a coroutine is considered before that coroutine is marked failed and its error is returned to its resumer.

A protected body is not made non-yieldable merely by using `pcall` or `xpcall`. An active `xpcall` handler is non-yieldable. A demonstrated body can yield, resume, then raise an error whose handler returns `144`; attempting to yield from the handler instead produces the handler-error result rather than suspending there.

Ordinary protected unwinding closes captures of removed calls and releases their call storage. It does not promise to undo earlier writes. In the accompanying program, the earlier store of `77` remains after the demonstrated failure.

### Incremental cycle charges

The primitive base charge is 2 cycles for `error`, 4 for `pcall`, and 4 for `xpcall`. Their primitive per-argument and per-return charges are zero. A protected built-in target or handler also incurs its own base charge. These are incremental charges, not total timings: target and handler execution, call and return instructions, and other machine work still contribute. Do not budget an entire protected operation as a fixed 4-cycle service.

## Coroutines

The BIOS installs the `coroutine` table before cartridge execution. Its eight functions are available through that table; no cartridge import is needed.

A coroutine is a retained language execution context: its entry function, call frames, local/register-stack values, protected calls, and suspension point. Keep this language execution state distinct from the device contexts described in **System control and timing**. Execution is cooperative. One thread is active; an accepted `resume` transfers execution to another thread, and a `yield`, return, or unhandled language error transfers it back. Creating a thread does not run it. The main thread is initially active.

### Creating and identifying threads

**`coroutine.create(fn) → thread`** returns exactly one thread value. The entry `fn` must be a language function closure. A raw builtin function value is not accepted merely because it is callable. Omitting `fn`, passing nil, or passing another value raises `Invalid argument.` Creation leaves the thread unstarted and publicly `"suspended"`.

**`coroutine.running() → thread, is_main`** returns exactly two values: the active thread and a boolean. The boolean is true in the main thread and false in a created coroutine. Keep thread values as language values; the operations below require a thread, not an address or numeric identifier.

**`coroutine.status(thread) → string`** returns exactly one of these strings:

| Result | Meaning |
|---|---|
| `"suspended"` | Created but not started, or stopped at a yield. |
| `"running"` | Currently active. |
| `"normal"` | Waiting inside an accepted resume of another thread. |
| `"dead"` | Finished, closed, or failed with an unhandled language error. |

A missing or non-thread argument raises `Invalid argument.` The public status does not distinguish an unstarted thread from a yielded thread, or a normally completed thread from a failed one.

### Transferring execution and values

**`coroutine.resume(thread, ...) → true, ...` or `false, error`** resumes an unstarted or yielded thread. Its first argument must be a thread. A missing or incorrectly typed first argument raises `Invalid argument.` in the caller; it is not converted into an ordinary `false, error` result.

On the first accepted resume, all arguments after `thread` become the entry function's arguments. The caller becomes `"normal"`, and the target becomes `"running"`. If that target resumes another coroutine, it becomes normal while its own target runs. When control returns to a resumer, that resumer becomes running again.

An accepted resume returns a true prefix followed by either the values supplied to `yield` or the entry function's final return values. Yield leaves the target suspended; a final return leaves it dead. An unhandled language error instead returns exactly `false` and the original error value, subject to the hardware boundaries below. The target then has failed state, publicly reported as dead.

Attempting to resume a running, normal, completed, closed, or failed thread returns exactly `false, "cannot resume non-suspended coroutine"`. This rejection does not close or otherwise change the target. Hardware-exception rejection is a separate case described below.

**`coroutine.yield(...) → ...`**, when later resumed, returns the next resume's arguments. Yield first suspends the active coroutine and returns its supplied values to the resumer, after the resumer's true prefix. Later, the values after `thread` in the next resume become the results of that suspended yield call. They do not restart the entry function and do not become another set of entry arguments. Calling yield where yielding is forbidden raises `Invalid argument.`; yield does not return a false prefix.

The exchange carries a value tuple, not an automatically packed table. Its count and nil positions are preserved. In the accompanying program, the first resume supplies 10 and 3; the child yields 13, nil, and `"ready"`. The caller receives true followed by all three values. The next resume supplies 17, nil, and 23; these are the three results of the child's yield call. The child finally returns 40, nil, and 3, so the caller receives true followed by those three values.

Ordinary source-call result adjustment still applies. A fixed number of receiving variables truncates excess results or supplies nil for missing results. An expanding result position carries the actual tuple count. Preserve that count when nil values matter; nil is not an end marker. An explicit bare `return`, and an ordinary source function that reaches its end without a return value, each return **one nil value**, not a zero-result tuple. Accepting all results of a successful resume of that function therefore gives `true, nil`.

### Querying yieldability

**`coroutine.isyieldable([thread]) → boolean`** returns one boolean. With no argument it examines the active thread. With an argument it examines that thread; explicit nil is invalid and raises `Invalid argument.` Extra arguments are unused.

The main thread is not yieldable. A selected thread carrying a hardware exception frame or an active `xpcall` error-handler continuation is also not yieldable. Ordinary `pcall` execution and the body protected by `xpcall` do not themselves forbid yielding. Executing the `xpcall` error handler does. Merely having an error-handler function stored somewhere does not affect the answer.

**Yieldability does not check status and is not permission to resume.** An unstarted thread can report true. A normally completed or closed thread can also report true, and a failed thread may report true. None of those answers changes resume's requirement that the target be unstarted or suspended. Ask status when deciding whether a target can be resumed; ask yieldability about the selected context's yield restrictions.

### Failure and closing

Language errors are first offered to protected calls in the active thread. If none consumes an error and the coroutine has a resumer, ordinary coroutine error transfer returns `false, error` to that resumer. The error remains its original value, including nil or the identity of a table; it is not necessarily a string. Failed state retains the error and language frames until closing. A public dead status alone does not indicate whether this retained failure exists.

A false result returned by resume is not itself an error thrown in the caller. Consequently, protecting resume with `pcall` adds the protected call's success boolean outside resume's own result tuple. A protected invocation can therefore succeed while resume reports a target failure. By contrast, an invalid argument raised in the caller is a caller-side error.

**`coroutine.close(thread) → true` or `false, original_error`** closes an unstarted, suspended, dead, or failed thread. A missing or non-thread argument raises `Invalid argument.` Closing a running or normal thread also raises `Invalid argument.`

Closing releases the thread's language frames, pending protected-call state, entry function, and register-stack state, and leaves it dead. It does not resume the function to execute remaining statements. Open upvalues are closed while preserving their current captured values. A surviving closure can therefore still read its captured local after the owning coroutine is closed. In the accompanying program, closing after yielding the captured value 19 prevents the later assignment of 20; the surviving reader still returns 19.

An unstarted, suspended, or normally dead target returns exactly true when closed. A failed target returns exactly false and its retained original error, **but is still closed**. That close clears the retained failure; closing the same thread again returns true. The false prefix in this case reports the earlier failure, not a refusal to close.

<section class="keep-together">

### Wrapped coroutines

**`coroutine.wrap(fn) → wrapped_function`** returns exactly one variadic function, backed by one newly created coroutine. The entry requirement is the same as for create. Each call to the returned function resumes that coroutine with the supplied arguments. Successful calls remove resume's true prefix and return the yielded or final tuple unchanged, including nil positions and result count.

</section>

On a false resume result, the wrapped function raises the first error value returned by that resume instead of returning a false prefix. If the retained coroutine is in failed state, the wrapper closes it before raising that value. A retained handle to that failed thread subsequently closes successfully because the wrapper has already cleared its retained failure. This failed-state cleanup also applies if resume rejected an already failed thread. In that case the wrapper raises the rejection string, not the earlier retained body error. Rejection in other non-suspended states does not trigger failed-thread cleanup. A finished wrapper cannot be used to restart its entry function. Replacing the public `coroutine.close` table entry does not replace the wrapper's captured closing operation.

### Call arity

Create, status, close, and wrap each declare one fixed parameter; omitted fixed parameters arrive as nil, and excess arguments are not forwarded. Running declares no parameters. Resume has one fixed parameter and a variadic tail; yield and the function returned by wrap are variadic. Isyieldable also preserves its argument list, which is why omission differs from explicit nil.

### Hardware IRQ and exception boundaries

Coroutine transfer is not an IRQ wait. Hardware device contexts are described separately in **System control and timing**. Do not use resume or yield to cross hardware exception-handling boundaries. If the active caller carries a hardware exception frame, resume returns exactly `false, "cannot resume coroutine across a hardware exception"`. This rejection takes precedence over rejection for target status and leaves the target unchanged.

Yield is forbidden across an entered hardware exception boundary. Protected error handling does not unwind through that boundary to reach an older protected call. An unhandled error at such a boundary is not promised to return as a normal coroutine `false, error` tuple; it follows the Lua fault-exception route. These restrictions do not define interrupt scheduling or the timing of an IRQ wait.

### Cycle increments

The underlying create, resume, yield, status, running, close, and isyieldable operations each contribute a base increment of four cycles, with no per-argument or per-result increment. This is not their service time or the total cost of calling the installed function. Ordinary function instructions add work; wrap also creates and resumes a coroutine and may inspect, close, and raise an error. Resumed cartridge code contributes its own execution. No total per-call cycle bound is specified here.

<section class="keep-together">

## Language fault reasons

If a classified language error reaches the CPU fault-exception route, its Lua
fault reason identifies the condition below. A protected failure result does
not itself mean that this route was entered. Arbitrary values raised by `error`
keep their own value and identity; their text does not select a reason code.

| Reason | Condition |
|---|---|
| 1 | Attempt to call a non-function value |
| 4 | Nil Table key |
| 7 | Non-function `xpcall` handler |
| 8 | Explicitly raised value |
| 9 | Classified out-of-memory condition |
| 10 | Invalid argument |

</section>

**System control and timing** describes retained fault words and publication.
**Interrupt controller** describes interrupt handling. Protected language calls
are not substitutes for those hardware interfaces.

## Reset and startup boundary

A newly created coroutine has not run its entry and is reported as `suspended`.
CPU reset is not an ordinary `coroutine.close` call. It clears the active call
and resumer chain, including protected-call ownership, and starts the selected
system startup; it does not deliver a close-result tuple to the interrupted
caller. **CPU and BLua32 instruction reference** and **System control and timing**
describe CPU startup and the system-wide reset request separately.

<section class="keep-together">

## Argument and result transfer

The figure shows the producer in the complete program below. `resume` and
`yield` abbreviate `coroutine.resume` and `coroutine.yield`. Arrows show language
control and value transfers; vertical distance is not elapsed machine time.

![The producer yields values to its parent, then receives the next resume arguments as yield results.](figures/coroutines-transfer.svg)

</section>

## A complete BLua program

Start this independent cartridge through the installed BIOS. Name its
result-storage module `results` and supply the following complete entry module.
The result record owns BSS rather than guessing a free RAM address. Its arrays
are typed byte storage, indexed from zero; its error object is an ordinary Table.
The installed `print` global makes the results visible as diagnostic text.

### Result-storage module

```lua
module<const>

struct coroutines_manual_result
	completed: word
	protected_values: f64[3]
	protected_flags: word[8]
	thread_values: f64[3]
	thread_flags: word[14]
	failed_flags: word[4]
	close_value: f64
	close_flags: word[3]
	wrap_values: f64[2]
	wrap_flags: word[2]
end

bss result: coroutines_manual_result

return { result = result }
```

<section class="keep-together">

### Protected results and errors

The first part obtains three body results, including the nil between the two
Numbers. It then raises the same Table used by the caller, raises nil, applies
an error handler, raises another error in a handler, and catches a nil-key
language fault. The store of 77 occurs before the Table is raised and remains
observable afterward in this program.

```lua
module<entry>

local state<const> = require('results')
local result<const>: *coroutines_manual_result = state.result

local ok<const>, sum<const>, gap<const>, difference<const> = pcall(function(a, b)
	return a + b, nil, a - b
end, 7, 3)
result.protected_values[0] = sum
result.protected_values[1] = difference
result.protected_flags[0] = ok and 1 or 0
result.protected_flags[1] = gap == nil and 1 or 0

local failure<const> = { code = 72 }
local caught<const>, object<const> = pcall(function()
	result.protected_values[2] = 77
	error(failure)
end)
result.protected_flags[2] = not caught and object == failure and 1 or 0
print('Caught object', caught, object == failure)
local nil_ok<const>, nil_error<const> = pcall(error, nil)
result.protected_flags[3] = not nil_ok and nil_error == nil and 1 or 0
print('Caught nil', nil_ok, nil_error)
local handled<const>, code<const> = xpcall(function() error(failure) end,
	function(value) return value.code * 2, 'discarded' end)
result.protected_flags[4] = not handled and code == 144 and 1 or 0
print('Handled error', handled, code)
local broken<const>, message<const> = xpcall(function() error('body') end,
	function() error('handler') end)
result.protected_flags[5] = not broken and message == 'error in error handling' and 1 or 0
print('Handler failure', broken, message)
local index_ok<const>, index_error<const> = pcall(rawget, {}, nil)
result.protected_flags[6] = not index_ok and index_error == 'Table index is nil.' and 1 or 0
print('Nil index', index_ok, index_error)
result.protected_flags[7] = result.protected_values[2] == 77 and 1 or 0

```

</section>

<section class="keep-together">

### Yield and resume

Continue the same entry module. The new producer receives 10 and 3, yields 13
with an interior nil and a label, then receives 17, nil, 23 as the results of its
yield call. Its final result is 40, nil, 3. Parent and child status observations
are retained before and after those transfers.

```lua
local main<const>, is_main<const> = coroutine.running()
result.thread_flags[0] = is_main and 1 or 0
result.thread_flags[1] = not coroutine.isyieldable() and 1 or 0
local producer<const> = coroutine.create(function(a, b)
	local self<const>, root<const> = coroutine.running()
	result.thread_flags[2] = coroutine.isyieldable() and 1 or 0
	result.thread_flags[3] = not root and coroutine.status(self) == 'running' and 1 or 0
	result.thread_flags[4] = coroutine.status(main) == 'normal' and 1 or 0
	local x<const>, y<const>, z<const> = coroutine.yield(a + b, nil, 'ready')
	result.thread_flags[5] = x == 17 and y == nil and z == 23 and 1 or 0
	return x + z, nil, b
end)
result.thread_flags[6] = coroutine.status(producer) == 'suspended' and 1 or 0
local first_ok<const>, first<const>, hole<const>, label<const> =
	coroutine.resume(producer, 10, 3)
result.thread_values[0] = first
result.thread_flags[7] = first_ok and hole == nil and label == 'ready' and 1 or 0
print('First resume', first_ok, first, hole, label)
result.thread_flags[8] = coroutine.status(producer) == 'suspended' and 1 or 0
local last_ok<const>, last<const>, middle<const>, original<const> =
	coroutine.resume(producer, 17, nil, 23)
result.thread_values[1] = last
result.thread_values[2] = original
result.thread_flags[9] = last_ok and middle == nil and 1 or 0
print('Final resume', last_ok, last, middle, original)
result.thread_flags[10] = coroutine.status(producer) == 'dead' and 1 or 0
local dead_ok<const>, dead_error<const> = coroutine.resume(producer)
result.thread_flags[11] = not dead_ok
	and dead_error == 'cannot resume non-suspended coroutine' and 1 or 0
print('Dead resume', dead_ok, dead_error)
result.thread_flags[12] = coroutine.close(producer) and 1 or 0
result.thread_flags[13] = coroutine.status(main) == 'running' and 1 or 0

```

</section>

<section class="keep-together">

### Failure and explicit close

Continue with failure and cancellation of a suspended language computation.
A failed coroutine returns the original error Table; its first close reports
that error, and its second close succeeds. A different coroutine creates a
read closure over 19 and yields before assigning 20. Closing that suspended
coroutine leaves the surviving read closure returning 19.

```lua
local failed<const> = coroutine.create(function() error(failure) end)
local failed_ok<const>, failed_error<const> = coroutine.resume(failed)
result.failed_flags[0] = not failed_ok and failed_error == failure and 1 or 0
print('Failed resume', failed_ok, failed_error == failure)
result.failed_flags[1] = coroutine.status(failed) == 'dead' and 1 or 0
local close_ok<const>, close_error<const> = coroutine.close(failed)
result.failed_flags[2] = not close_ok and close_error == failure and 1 or 0
print('Failed close', close_ok, close_error == failure)
result.failed_flags[3] = coroutine.close(failed) and 1 or 0

local read
local abandoned<const> = coroutine.create(function()
	local value = 19
	read = function() return value end
	coroutine.yield(value)
	value = 20
end)
local started<const>, yielded<const> = coroutine.resume(abandoned)
result.close_flags[0] = started and 1 or 0
print('Before close', started, yielded)
result.close_flags[1] = coroutine.close(abandoned) and 1 or 0
result.close_value = read()
result.close_flags[2] = coroutine.status(abandoned) == 'dead' and 1 or 0

```

</section>

<section class="keep-together">

### Wrapped calls and completion

Finish the same entry module. The first wrapped function yields 12 and returns
its next input 34. The second raises the original Table; the outer pcall obtains
that Table, and the wrapper has already closed its failed Thread before the
explicit close shown here. The final loop waits after completion rather than
rendering a picture or promising an IRQ wakeup.

```lua
local wrapped<const> = coroutine.wrap(function()
	local next_value<const> = coroutine.yield(12)
	return next_value
end)
result.wrap_values[0] = wrapped()
result.wrap_values[1] = wrapped(34)
local failed_wrapper_thread
local wrap_ok<const>, wrap_error<const> = pcall(coroutine.wrap(function()
	failed_wrapper_thread = coroutine.running()
	error(failure)
end))
result.wrap_flags[0] = not wrap_ok and wrap_error == failure and 1 or 0
print('Wrapped failure', wrap_ok, wrap_error == failure)
result.wrap_flags[1] = coroutine.close(failed_wrapper_thread) and 1 or 0

print('Protected return', ok, sum, gap, difference)
print('Retained before error', result.protected_values[2])
print('Coroutine values', first, last, original)
print('Closed capture', result.close_value)
print('Wrapped values', result.wrap_values[0], result.wrap_values[1])
result.completed = 1
while true do
	halt_until_irq
end
```

</section>

### Retained values

After `completed` becomes 1, the result record contains:

<section class="keep-together">

| Field or array | Value, in increasing typed-storage index order |
|---|---|
| `protected_values` | 10, 4, 77 |
| `protected_flags` | Eight flags, all 1 |
| `thread_values` | 13, 40, 3 |
| `thread_flags` | Fourteen flags, all 1 |
| `failed_flags` | Four flags, all 1 |
| `close_value` | 19 |
| `close_flags` | Three flags, all 1 |
| `wrap_values` | 12, 34 |
| `wrap_flags` | Two flags, both 1 |

</section>

The flags distinguish successful protected return from an error, a nil error
from success, original Table identity from a formatted error message, suspended from
dead, and a failed close from a later successful close. In particular, the
reported status `dead` alone does not distinguish normal completion from failure.

### Diagnostic output

The program prints these 17 lines. Actual separators are tabs.

```text
Caught object   false   true
Caught nil   false   nil
Handled error   false   144
Handler failure   false   error in error handling
Nil index   false   Table index is nil.
First resume   true   13   nil   ready
Final resume   true   40   nil   3
Dead resume   false   cannot resume non-suspended coroutine
Failed resume   false   true
Failed close   false   true
Before close   true   19
Wrapped failure   false   true
Protected return   true   10   nil   4
Retained before error   77
Coroutine values   13   40   3
Closed capture   19
Wrapped values   12   34
```
