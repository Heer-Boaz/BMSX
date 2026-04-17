Goed punt. Laat me eerst begrijpen hoe `require` nu werkt in de compiler en runtime:

Searched for regex `require|module|import` (`**/src/bmsx/emulator/program_compiler.ts`), 30 results

Searched for regex `require|module|appendLuaChunk|compileChunk` (`**/src/bmsx/emulator/lua_pipeline.ts`), 30 results

Searched for regex `resolveGlobal|resolveRequire|compileCall.*require|RequireExpression|require` (`**/src/bmsx/emulator/program_compiler.ts`), 20 results

Searched for regex `moduleProtoMap|module.*proto|compileLuaChunkToProgram` (`**/src/bmsx/emulator/program_compiler.ts`), 12 results

Read [](file:///home/boaz/BMSX/src/bmsx/emulator/program_compiler.ts#2870-2870), lines 2870 to 2960

Now let me look at how `require` actually works at runtime — when a cart does `local foo = require("bar")`:

Read [](file:///home/boaz/BMSX/src/bmsx/emulator/globals.ts#1430-1430), lines 1430 to 1445

Searched for regex `requireModule|function require` (`**/src/bmsx/emulator/lua_pipeline.ts`), 4 results

Read [](file:///home/boaz/BMSX/src/bmsx/emulator/lua_pipeline.ts#1422-1422), lines 1422 to 1508

Now let me understand the semantic frontend and how it resolves cross-module references:

Searched for regex `resolveGlobalAccess|systemGlobal|isSystemGlobal|SYSTEM_GLOBAL` (`**/src/bmsx/emulator/program_compiler.ts`), 20 results

Now let me look at how variables from required modules are accessed — what happens after `local m = require("foo")` and then `m.bar()`:

Read [](file:///home/boaz/BMSX/src/bmsx/emulator/program_compiler.ts#215-215), lines 215 to 260

Now let me look at the semantic frontend to see if it has cross-module resolution:

Searched for regex `require|module|cross.*file|inter.*module|import|export` (`**/src/bmsx/emulator/lua_frontend.ts`), 15 results

Now let me look at how modules are currently compiled and how `require` is handled at compile time. Let me look at the code around how the compiler actually compiles a call to `require(...)`:

Read [](file:///home/boaz/BMSX/src/bmsx/emulator/program_compiler.ts#1035-1035), lines 1035 to 1100

Now I understand the full picture. Let me check how modules are actually structured — does a cart typically do `local m = require("foo")` and then `m.bar()`, or are there other patterns?

Searched for regex `require\(` (`**/src/carts/**/*.lua`), 30 results

Now let me see how a module like `constants.lua` returns its table, and how it's used:

Searched for regex `constants\.\w+` (`**/src/carts/pietious/*.lua`), 20 results

Read [](file:///home/boaz/BMSX/src/carts/pietious/constants.lua#1-1), lines 1 to 20

Now I understand the complete picture. Let me look at a typical module return pattern:

Searched for regex `^return|^local function` (`**/src/carts/pietious/combat_overlap.lua`), 1 result

Searched for regex `^return|^local function` (`**/src/carts/pietious/worldobject.lua`), no results

Read [](file:///home/boaz/BMSX/src/carts/pietious/combat_overlap.lua#1-1), lines 1 to 18

Now I have a complete understanding. Here's the analysis:

---

## Het probleem

Elk `require` compileert naar iets als:

```lua
-- In cart.lua:
local constants<const> = require('constants')    -- CALL native, returns table
-- ...later:
constants.hud.health_bar_x                       -- GETUP + GETFIELD + GETFIELD = 3 instructies
```

De gecompileerde bytecode voor `constants.hud.health_bar_x`:
```
GETUP    r0, upval:constants     ; 1 cycle (nieuw)  — haal de module-tabel op
GETFIELD r0, r0, k("hud")       ; 1 cycle           — subtabel lookup
GETFIELD r0, r0, k("health_bar_x") ; 1 cycle        — waarde lookup
```

En voor `combat_overlap.classify_player_contact(event)`:
```
GETUP    r0, upval:combat_overlap    ; 1 cycle
SELF     r0, r0, k("classify_player_contact")  ; 1 cycle (GET + MOV)
MOV      r2, r_event                 ; 1 cycle
CALL     r0, 2, 1                    ; 2 cycles
```

**Het kernprobleem**: elke module is op runtime een **tabel**, en alle inter-module referenties gaan door tabel-lookups. De compiler weet at compile time precies welke modules er zijn en wat ze exporteren, maar behandelt `require()` als een opaque native call die een willekeurige tabel teruggeeft.

## Wat het zou moeten zijn

De compiler kent alle modules. Elke module wordt al apart gecompileerd als een proto in `compileLuaChunkToProgram`. De compiler zou de exports van een module als **directe global slots** (GETGL/SETGL) kunnen toewijzen, in plaats van ze in een tabel te wrappen.

### Twee strategieën

**Strategie A: Module-export flattening**

Als de compiler ziet dat een module een tabel met functies exporteert (het `local M = {}; function M.foo() ... end; return M` patroon), dan:

1. Elke geëxporteerde functie/waarde krijgt een eigen **global slot** (GETGL)
2. `require('combat_overlap')` verdwijnt als runtime-call
3. `combat_overlap.classify_player_contact(event)` compileert naar:

```
GETGL    r0, gl:combat_overlap__classify_player_contact
MOV      r1, r_event
CALL     r0, 1, 1     ; geen SELF nodig want het is geen method
```

Van **GETUP + SELF + MOV + CALL** (5 cycles) naar **GETGL + MOV + CALL** (4 cycles). Plus: geen tabel-alloc, geen SETT's bij module-init.

**Strategie B: Cross-module upvalue binding (link-time)**

De compiler weet dat `require('constants')` verwijst naar de proto voor constants.lua. In plaats van een runtime CALL die een tabel teruggeeft, "linkt" de compiler de exports van die proto direct in de consumer:

1. Module-level `local`s die geëxporteerd worden (via `return M`) worden zichtbaar als **upvalues** in consumerprotos
2. Functies uit een module worden direct als **CLOSURE referenties** of **GETGL slots** gebonden
3. `require()` wordt een no-op of compileert weg

### Welke strategie past bij BMSX?

**Strategie A** is eenvoudiger en past beter:

- Module-exports worden gewoon extra global slots (net zoals `define_prefab`, `inst`, etc. nu al global slots zijn)
- Geen complexe upvalue-linking nodig
- De compiler moet puur de `return { ... }` of `return M` patronen herkennen en de inhoud naar globals promoveren
- Modules die een niet-tabel returnen (primitief, functie) krijgen gewoon één global slot

### Wat de compiler moet doen

1. **Statische analyse**: Bij compilatie, analyseer alle `require()`'d modules. Als de module-source beschikbaar is (altijd waar voor cart-modules), parse de `return`-expressie.

2. **Export discovery**: Herken de patronen:
   - `local M = {}; function M.foo() ... end; return M` → exports: `{foo: closure}`
   - `return { foo = ..., bar = ... }` → exports: `{foo: ..., bar: ...}`
   - `return single_value` → export: de waarde zelf

3. **Slot assignment**: Elke export krijgt een unique GETGL/SETGL slot met een "namespaced" naam (bijv. `combat_overlap.classify_player_contact` → global slot `combat_overlap__classify_player_contact`).

4. **Consumer rewrite**: Waar de consumer `m.foo()` doet, vervang:
   - `GETUP rN, upval:m` + `GETFIELD rN, rN, k("foo")` → `GETGL rN, slot:m__foo`
   - `GETUP rN, upval:m` + `SELF rN, rN, k("bar")` → `GETGL rN, slot:m__bar` (plus SELF wordt gewoon GETGL + call, geen method dispatch nodig)

5. **Module init**: In plaats van de module-proto te CALLen en het resultaat in een cache te stoppen, worden de module-protos gewoon uitgevoerd als init-code, en hun exports belanden in global slots.

### Cycle impact

**`constants.hud.health_bar_x`** (geneste constante):
- Huidig: GETUP(1) + GETFIELD(1) + GETFIELD(1) = **3 cycles**
- Met flattening: GETGL(1) = **1 cycle** (als `constants__hud__health_bar_x` een global slot is)

**`combat_overlap.classify_player_contact(event)`**:
- Huidig: GETUP(1) + SELF(1) + MOV(1) + CALL(2) = **5 cycles**
- Met flattening: GETGL(1) + MOV(1) + CALL(2) = **4 cycles** (en SELF → gewone CALL want het is geen echte method)

**`for k,v in pairs(constants.enemies)` setup**:
- Huidig: GETUP(1) + GETFIELD(1) + ... = extra GETFIELD per use
- Met flattening: GETGL(1) = direct

### Overwegingen

| Punt | Status |
|------|--------|
| **Module-tabel als first-class value** | Verdwijnt. Modules zijn geen tabellen meer. Als iemand `local m = require("foo"); dosomething(m)` doet (de hele tabel doorgeeft), dan werkt het niet meer. Maar dat is ok — dat patroon is toch anti-pattern. |
| **Circulaire requires** | Worden al niet ondersteund in de huidige compiler (module protos worden lineair gecompileerd). Geen probleem. |
| **Runtime require (string variabel)** | Al niet ondersteund — `require` verwacht een string literal. Geen probleem. |
| **Hot reload** | Module globals worden gewoon overschreven bij hot reload, net als nu met de module cache. |
| **BIOS modules vs cart modules** | BIOS modules (engine code) worden al als Lua closures in GETSYS slots gezet. Cart modules zouden GETGL slots gebruiken. Consistent. |
| **Geneste tabellen in constants** | `constants.physics.walk_dx` wordt `constants__physics__walk_dx`. De compiler moet recursief door de return-tabel van constants.lua gaan. Dit is een compile-time operatie. |

### De echte winst

Het gaat niet alleen om de cycles. Het gaat om **hoe de taal voelt**:

- Nu: modules = tabellen = indirectie = overhead → schrijvers worden gestraft voor gestructureerde code
- Straks: modules = namespaces = compile-time constructen → schrijvers gebruiken `require` als organisatiemiddel zonder runtime-kosten

Dit past perfect bij jouw filosofie: **de compiler doet het werk, niet de runtime**.
