# BMSX FSM — Authoring & Design Notes

Deze notitie bundelt observaties van de huidige FSM‑architectuur, pijnpunten voor AI‑assistenten (Copilot/Codex), en concrete voorstellen om authoring betrouwbaarder en toekomstvast te maken. Focus: duidelijkere padnotatie, consistentie in transities en inzet van type‑hulpmiddelen — zonder breaking changes.

## Doelen

- Duidelijker, AI‑vriendelijk FSM‑authoring (minder stringly‑typed valkuilen).
- JSON/Hot‑swap en handler‑registry blijven first‑class.
- Backwards compatibiliteit behouden, maar modernere schrijfwijze stimuleren.
- Compile‑time feedback waar haalbaar, runtime valideren waar nodig.

## Huidige Architectuur (samenvatting)

- Definities en lifecycle:
  - `StateDefinitions`: alle machines (gebouwd via `StateDefinitionBuilders` en uit `$.rom.fsm`).
  - `validateStateMachine`: valideert startstates en transitie‑targets; resolve’t paden; waarschuwt bij missende handlers.
  - `addEventsToDef`/`getMachineEvents`: eventharvesting, ‘$’ => self‑scope; namen worden genormaliseerd; duplicaten gelogd.

- Handler‑hoisting en dynamiek:
  - `HandlerRegistry`: centrale opslag van handlers (met hot‑swap).
  - `walkAndHoist(...)`: hoist direct slots (`enter/run/next/end/exit/process_input`), `on`/`on_input` (incl. `if/do`), `run_checks`, `guards` naar registry (proxy‑thunks of id’s).
  - `registerHandlersForLinkedMachines`: koppelt class‑methods aan handler‑keys op basis van decorators.

- Runtime FSM (`State`):
  - Tick‑loop: `runSubstateMachines` → `processInput` → `run` → `doRunChecks`.
  - Transities: `to` (tree) en `switch` (laagste level), plus `to_path`/`switch_path` voor dot‑paden.
  - Padcontexten: `#this`, `#parent`, `#root` (dot‑gescheiden).
  - `on_input`: pattern‑DSL voor input; matching + automatische consumptie.
  - Tape: `ticks2move`, `repetitions`, `auto_*` flags; parallelle states.

- JSON + Hot‑swap:
  - ROM‑blauwdrukken worden ingelezen en ge‑hoist; valide; evt. vervanging van bestaande machines.
  - (Optioneel) migratie aanwezig: `migrateMachineDiff(root, oldDef, newDef)` om instance‑trees te reconciliëren en data te mergen.

## Observaties uit voorbeelden

- `ella2023/eila.ts`: scheiding besturing vs animatie; `@assign_fsm('player_animation')`; transities met `#this.*`/`#root.*`; tape voor animaties, parallelle subtrees.
- `sint2024/quiz.ts`: UI‑flow met `on_input` DSL (bijv. `'? (a[j!c], b[j!c])'`), tape over vragen, guarded end‑state.

## Pijnpunten voor AI‑assistenten

- String‑DSL’s zonder schema: inputpatronen en paden zijn gevoelig voor typos, valideren pas runtime.
- `this`‑binding: handlers moeten `function (this: T, state: State, ...)` zijn; arrow functions breken context.
- Variëteit in transities: zowel `to` als `switch`, plus directe strings; inconsistentie vergroot foutkans.
- Impliciete conventies (startstate `_`/`#`, parallel, tape) zijn niet expliciet genoeg voor generatieve tools.

## Voorstel: Bestandsysteem‑achtige Padnotatie (non‑breaking)

Introduceer een tweede, meer intuïtieve notatie die vóór gebruik wordt genormaliseerd naar de legacy vorm. Beide blijven ondersteund.

- Ankers en scheiding:
  - Absoluut: `root:/...`
  - Relatief: `./...` (huidige context), `../...` (ouder)
  - Aliassen: `this:/...` ≡ `./...`, `parent:/...` ≡ `../...`
  - Scheidingsteken: `/` (legacy blijft dot‑gescheiden)
  - Wildcard: `*` binnen een pad = `start_state_id` van de huidige context

- Mapping (voorbeeld):
  - `#this.jump_up` → `./jump_up`
  - `#root.idle` → `root:/idle`
  - `#this.jump.flyingkick` → `./jump/flyingkick`
  - `#root.menu.<start>` → `root:/menu/*`
  - Kale ids zoals `'idle'` blijven toegestaan (lokaal)

- Implementatie‑outline (compatibel):
  1) Nieuwe util `normalizeSPath(raw: string): string` die `root:/...`, `./...`, `../...` omzet naar `#root.#...`/`#this.#...` met dot‑scheiding. Bare ids en legacy blijven ongemoeid.
  2) Validatie: in `resolveStateDefPath(...)` eerst normaliseren; wildcard `*` vervangen door `ctx.start_state_id`.
  3) Runtime: in `State.to/switch/is/handle_path` padstrings eerst normaliseren; `*` naar `start_state_id`.

### Indicatieve code‑schetsen

```ts
// spath.ts
export function normalizeSPath(raw: string): string {
  if (!raw || typeof raw !== 'string') return raw as any;
  const s = raw.trim();
  if (s.startsWith('#')) return s;                // legacy
  if (s.startsWith('/')) return '#root.' + s.slice(1).replace(/\//g, '.');
  if (s.startsWith('root:/'))   return '#root.'   + s.slice(6).replace(/\//g, '.');
  if (s.startsWith('this:/'))   return '#this.'   + s.slice(6).replace(/\//g, '.');
  if (s.startsWith('parent:/')) return '#parent.' + s.slice(8).replace(/\//g, '.');
  if (s.startsWith('./'))  return '#this.'   + s.slice(2).replace(/\//g, '.');
  if (s.startsWith('../')) return '#parent.' + s.slice(3).replace(/\//g, '.');
  return s.includes('/') ? s.replace(/\//g, '.') : s; // fallback: slash → dot
}
```

```ts
// statedefinition.ts — voor resolven
function resolveStateDefPath(from: StateDefinition, target: string, origin: string): void {
  target = normalizeSPath(target);
  const parts = target.split('.');
  // ... bepaal ctx (#this/#parent/#root)
  for (let i = startIndex; i < parts.length; i++) {
    let part = parts[i];
    if (part === '*') {
      if (!ctx.start_state_id) throw new Error("'*' used but no start_state_id");
      part = ctx.start_state_id;
    }
    if (!ctx.states?.[part]) throw new Error(...);
    ctx = ctx.states[part] as StateDefinition;
  }
}
```

```ts
// state.ts — voor runtime
public to(state_id: Identifier, ...args: any[]) {
  state_id = normalizeSPath(state_id);
  // bestaande logic (this/root/parent) blijft werken
}

private handle_path(path: string | string[]): [string, string[], State] {
  if (typeof path === 'string') path = normalizeSPath(path);
  const parts = Array.isArray(path) ? path : path.split('.');
  // ... bepaal currentContext
  if (currentPart === '*') currentPart = currentContext.definition.start_state_id;
  return [currentPart, restParts, currentContext];
}
```

## Overige Verbeteringen (AI‑vriendelijkheid)

- Getypeerde helpers voor input‑DSL (optioneel):
  - In plaats van rauwe strings: `input.or(just('a').pressed().notConsumed(), just('b').pressed().notConsumed())` → serialiseert naar `'?(a[j!c], b[j!c])'`.
  - Levert betere autocomplete en minder typos, maar blijft compatible met huidige parser.

- Eén sleutel voor transities:
  - Project‑wijd consequent `to:` of `switch:` (advies: kies één default; `switch` enkel wanneer vereist). Minder mix‑up in voorbeelden = minder AI‑fouten.

- Arrow functions vermijden:
  - Handlers altijd als `function (this: T, state: State, ...) { ... }` noteren. Documenteer dit zichtbaar en overweeg een lint‑regel voor kernbestanden.

- JSON schema/typedefs:
  - Publiceer `StateMachineBlueprintJSON` (object‑vorm) en tolereer zowel function‑slots (hoisting → proxy) als handler‑id strings.
  - Conventie voor handler‑ids matcht registry: `${machine}.handlers.${ClassName}.${key}`.

- Hot‑swap migratie optioneel activeren:
  - Bij vervanging in `setupFSMlibrary`: voor alle actieve machines `migrateMachineDiff(instance, oldDef, newDef)` aanroepen om trees/data te reconciliëren.

## Authoring‑Richtlijnen (kort)

- Handlers: geen arrows; gebruik `function (this: T, state: State, ...)`.
- Events: prefix met `$` voor self‑scope; namen worden genormaliseerd; duplicaten worden gelogd.
- Paden (aanbevolen notatie):
  - Absoluut: `root:/menu/*`, `root:/fight/idle`
  - Relatief: `./jump/up`, `../nagenieten`
  - Legacy (`#this.*`, `#root.*`) blijft werken.
- Transities: kies consequent `to:` (default) of `switch:` wanneer laagste level nodig is.
- Input: houd je aan bestaande DSL of gebruik helper‑bouwers als die worden toegevoegd.
- Tape/auto_reset: gebruik spaarzaam; `ticks2move`, `repetitions`, `auto_tick`, `auto_reset` documenteren bij de state.

## Voorbeelden (mapping)

- Eila (besturing):
  - Voorheen: `return { state_id: '#this.jump_up', args: directional }`
  - Nu:      `return { state_id: './jump_up', args: directional }`
  - Voorheen: `return '#root.idle'`
  - Nu:      `return 'root:/idle'`

- Quiz (UI):
  - `on_input: { '?(a[j!c], b[j!c])': { to: 'vraag' } }` — ongewijzigd; alternatief met helper‑DSL mogelijk.

## Adoptieplan

1) Fase 1 (non‑breaking):
   - `normalizeSPath` + wildcard‑ondersteuning toevoegen (validatie + runtime).
   - Dit document opnemen (AUTHORING.md).
   - Keuze maken voor één transitie‑sleutel (documenteren).

2) Fase 2 (geleidelijk):
   - Voorbeeldmachines (`eila.ts`, `quiz.ts`) omzetten naar `root:/` en `./` in nieuwe commits.
   - Eventueel input‑DSL helpers toevoegen.

## Verdere overwegingen

- Linting/typing: branded type voor padstrings of helper‑API die altijd via normalizer gaat.
- Tests: kleine set unit‑tests voor padresolutie (legacy + nieuwe notatie, inclusief `*`).
- Telemetrie/logging: waarschuwing als arrows worden gedetecteerd in slots die `this` vergen (best‑effort runtime check).

## Appendix — Kernconcepten (korte referentie)

- Event scope: `$event` = self; anders global. Events worden geharvest en genormaliseerd.
- Transities: `to` (tree) vs `switch` (laagste niveau).
- Parallelle states: alle niet‑current parallelle states runnen ook per tick.
- Tape: `ticks2advance_tape`, `repetitions`, `tape_playback_mode`, `tape_playback_easing`, `auto_tick`.
- Auto‑reset: `'state' | 'tree' | 'subtree' | 'none'`.
- Hoisting: handlers uit definities/decorators → registry (proxy‑thunks voor hot‑swap).
