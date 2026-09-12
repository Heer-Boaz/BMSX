# Behavior-authoring: bronherkomst vóór ruimere graphbewerkingen

Datum: 2026-09-10. Onderzocht op `592c86a94`.
**Status: ontwerp; producer- en querycorrecties geland, B04 nog open.** Dit verdiept B04
en scherpt het bewerkingscontract van B03 aan uit de
[gebruikersreview](behavior_authoring_ux_review.md). De tegenvoorbeelden hieronder
zijn geen reden om de bronbehoudende edit-, Undo- of Hot Resume-owners weg te gooien.

De [resourceconsumer](behavior_source_resources.md) gebruikt inmiddels per-resource
models/ranges voor index, FSM-bewijs, inspectie, history en mementos. Dit verhelpt
de één-buffer-aanname maar is nog geen bredere recognizer: memberorigins,
API-zekerheid, querydependencies en concrete write-targets blijven voorwaarden.

De [eerste implementatie](lua_function_source_ownership.md) scheidt function-body,
opslagbinding en geschreven returns in de generieke binder/summaries. Zij voegt
nog geen source-originquery of ruimere Lens-herkenning toe. De tijdens de
CPU-proef gevonden prototype-idbotsing blijft een afzonderlijke compiler/
Hot Resume-ownergrens; geen suffix-op-botsing of Lens-beperking als omweg.

De [tweede producercorrectie](lua_write_ownership.md) bindt waarde-writes aan hun
werkelijke function-body, niet aan de declaratiescope van hun bestemming.
De doorproef toont bovendien dat `compose` hypothetische aliases in dezelfde
value-relation kan publiceren. Vóór een sterkere source-query moet daarom ook
de querycontext expliciet zijn; correcte write-feiten alleen zijn nog geen
uitvoerings-/exclusiviteitsbewijs. De huidige Lens-recognizer is ongewijzigd.

De [parametercorrectie](lua_parameter_context.md) onderscheidt inmiddels
ingangswaarden van formele bindings die geschreven worden. Zij verhelpt
argumentvervuiling door reassignments, maar voltooit de querycontext niet.
De [receiverbinding](lua_receiver_binding.md) corrigeert vervolgens zowel de
semantische als de gecompileerde implicit-`self`-writes. Ook methodedispatch
gebruikt geen naamgebaseerde terugval naar de oorspronkelijke receiver meer.

De [receiverprojectiecorrectie](lua_receiver_projection.md) scheidt vervolgens
module-writes van de selectie van mogelijke receiver-writers. Navigatie vraagt
projectie expliciet aan; gewone naam-demand publiceert alleen module- en actieve
frame-writes. Geprojecteerde bodies behouden ook hun lexical-owner en lokale
table-writes. Dit voltooit nog niet de scheiding van analysecontexten binnen de
gedeelde may-value-relation.

De [recursieve ingangswaarden](lua_recursive_inputs.md) verliezen geen nieuwe
argumenten meer bij framehergebruik. Read-antwoorden worden doorgepropageerd,
los van assignment-/storagealiases. Dit corrigeert de bestaande may-query;
de sterkere gecorreleerde bronquery blijft de volgende architectuurgrens.

De [bound-value-origins](lua_bound_value_origins.md) koppelen vervolgens owned
waarden direct aan hun werkelijke syntax, met afzonderlijke closure-/receiver-
identiteit en file-generation lifetime. De query consumeert retained numerieke
rootidentiteiten in plaats van opnieuw gecodeerde broncoördinaten. Dit is nog
geen gesloten originverzameling voor literals/writes of gecorreleerde calls;
de Lens-recognizer mag die sterkere claim hier niet uit afleiden.

De [completion-/returnwaarden](lua_completion_values.md) behouden vervolgens
expliciete nil/lege returns, onbekende returnexpressies en mogelijke impliciete
nil bij het bereiken van het functie-einde. De binder deelt die completionfeiten
met volgende snapshots; summaries lopen niet opnieuw door de syntax. Dit sluit
nog niet alle onbekende writes, callcontexten of bronorigins. De gepaarde koude
query wordt circa 7 ms duurder; de latencypoort blijft open, zonder informatie
weg te filteren om de oude meting terug te krijgen.

De [assignment-bijdragen](lua_assignment_contributions.md) behouden ook elke
geschreven toekenning, onbekende berekening en ontbrekende initializer/resultlane,
met de echte syntax en slotindex. Waardegelijkheid dedupliceert geen schrijfplekken
meer. De werkelijke workspaceproef legde daarbij een onjuiste scalar-/unknown-
opslagalias aan het licht: die waarden blijven bijdragen, maar vormen geen
gedeelde opslaglocatie. Concrete waardeafhankelijkheden blijven voorwaarts
beschikbaar voor keyed-callselectie. De onafhankelijke CPU-proef corrigeert ook
vroegtijdig overschreven local-initializerregisters in de compiler. Dit zijn
producer-/solvercorrecties, niet de nog ontbrekende gecorreleerde bronquery,
resource-eigen documentconsumers of B03/B06-authoring.

De [callcontexten en applicatie-edges](lua_call_applications.md) bewaren nu
gekoppelde inputs per callsite/owner, ook bij gedeelde of recursief hergebruikte
analyseframes. Dezelfde statische call blijft de identiteit in summary en
demand-index; contextuele inputs vervangen die bronidentiteit niet. Herhaalde
queries gebruiken de gedeelde dependency-cache. Dit maakt nog geen gesloten
callee-/originverzameling en onderscheidt niet vanzelf hypothetische effecten
van module-rooted toepassingen. De volgende grens blijft de concrete bronquery
en haar resource-eigen consumer; B03/B06-authoring en latency blijven open.

De importproef corrigeert ook [module-exportpublicatie](lua_module_export_publication.md):
een factory-call op de exportplek moet zijn eerste resultaat opslaan, niet een
nil-slot achterlaten. De compiler doet dat nu via de bestaande export-ABI. Dit
maakt van module-returns nog geen gewone Lua-runtime-loader en sluit de bronquery
of de UX-einddoelen niet af.

De [written-sourcequery](lua_written_source_queries.md) volgt nu echte geschreven
bijdragen bovenop die binderfeiten. Zij behoudt gelijke literals als afzonderlijke
plekken, alle global-writers, formal/receiver-inputs, onbekende berekeningen en
snapshotgeldigheid zonder de may-callsolver te activeren. Zij geeft een bron-
afhankelijkhedengraph, geen gesloten runtime-/callee-proof: modules, memberpaden
en gewone callresultaten blijven expliciete querygrenzen. B03/B06-authoring,
resource-eigen consumers en de bredere latencyvoorwaarde blijven open.

De [modulebronquery](lua_module_source_exports.md) volgt inmiddels de canonieke
export en reexports naar hun eigen bestanden. Compiler en binder delen daarvoor
de syntaxselectie. Eerdere returns blijven publicatie-onzekerheid, geen extra
exports. Factory-calls en memberpaden zijn hiermee nog niet bewezen en er wordt
geen runtime-loadercontract verzonnen. B03/B06 blijven de UX-einddoelen.

De [source-callgraph](lua_source_call_graph.md) verbindt die geschreven tuples
nu aan de bestaande applicatie-edges en hun ancestry. Gedeelde analyseframes
vervangen niet hun verschillende callerplekken; projection en lexical closures
blijven zichtbaar. Een queryvolgorde-bug tussen bodyprojectie en caller-vragen is
gecorrigeerd. Volledige discovery van returned-closure-users, argument-substitutie
en de resource-eigen editorconsument zijn hiermee nog niet af.

De [contextuele bronwaarden](lua_source_call_graph.md#contextual-written-values-2026-09-12)
volgen inmiddels geschreven argumenten en returnwaarden via die callcontexten.
De [named-memberquery](lua_member_source_provenance.md) behoudt daarnaast de
daadwerkelijke veldwrites met hun writercontext en bronbestand, ook bij nested
factories en captured storage. Dit zijn mogelijke herkomsten, geen gesloten
API-/runtimebewijs; de recognizer mag bekende kandidaten niet zonder meer als
zekere registratie toelaten. B04-consumptie en B03/B06 blijven open.

De [eerste workspaceconsumer](behavior_written_sources.md) vervangt nu de lokale
const-/aliaswalker door de written-sourcequery. Directe imports/reexports,
gewone aliases en callbacks behouden hun eigen bestand en consumer-scope;
Source/Edit/Undo gebruikt de gewone provider-editor. Negatieve lookups en
popups volgen de workspace/source-index-lifetime. De bredere API-binding,
contextuele members/factories en graph-write-owners zijn hiermee niet voltooid.

## 1. Beslissing

Behavior Lens wordt geen universele omkeerbare Lua-interpreter. Het is een
**domeinspecifieke broneditor op generieke taalfeiten**:

1. Lua-syntax, bindings, bronherkomst en callcontext komen van de bestaande
   toolchain/frontend/query-store. Geen tweede alias-, wrapper- of
   constantevaluator in Lens.
2. De behavior-bijdrage kent de echte cartlib-API's en hun veldrollen. Die kennis
   is nodig: `children`, `choices`, FSM-paden en effectrequirements betekenen niet
   hetzelfde. Zij hoort niet in de generieke Lua-analyse of machine.
3. Iedere operatie benoemt welke geschreven expressie/list/definitie zij wijzigt.
   Een gevonden functietarget, gelijke waarde of correct getekende lijn is geen
   bewijs van die bewerkingsgrens.
4. Resource-owned tekst, gerichte edits, bookmarks, Undo en de gewone compiler/
   Hot Resume blijven de schrijfroute. Geen graphdatabase, gekookt tussenasset,
   guest-inspectormetadata of alternatieve live-update-API.

De API-afhankelijkheid is dus niet de workaround. De **extra afhankelijkheid van
één schrijfwijze** — direct literal, lokale `<const>`, één bestand — en het
overinterpreteren van beperkte analysefeiten zijn de problemen.

"Future-proof" betekent hier uitbreidbare, juiste owners en expliciete
betekenis van operaties; niet de belofte dat iedere dynamisch gegenereerde boom
een unieke per-node terugvertaling naar Lua heeft. Een factory kan één geschreven
constructor voor veel aanroepen gebruiken. Die bron blijft bewerkbaar, maar
"wijzig alleen deze runtime-instantie" volgt daar niet uit.

## 2. Wat de live owners en tegenproeven aantonen

| Bevinding | Live owner en consequentie |
| --- | --- |
| Equivalente eenvoudige schrijfwijzen geven verschillende Lens-resultaten. | `registrations.ts` eist `moduleTargetBinding === 'immutable'`; `source.ts` volgt lokale const-initializers; `behavior_tree.ts` leest het type uit een direct stringliteral. Een gewone ongewijzigde module-local verdwijnt uit discovery; een const type-alias wordt geen bekend nodetype. Dit zijn readerbeperkingen, niet cartlib-requirements. |
| Een const module-alias bevriest geen modulevelden. | `semantic/model.ts` classificeert de lexical root. `registrations.ts` behandelt module/memberpad vervolgens als API-identiteit. Na `trees.register = function(...) return 7 end` vindt Lens nog één BT-registratie; gecompileerde BLua voert de vervangende functie uit. De generieke resolver vindt beide mogelijke functies, maar die gebruikt de recognizer hier niet. |
| Eén bekend target betekent niet dat alle uitkomsten bekend zijn. | Bij een conditionele vervanging door `make_handler()` geeft `resolveCallableTargets` alleen de ene bekende functie terug. De array is geen completeness-/exclusiviteitsbewijs. Alleen controleren op `targets.length === 1` zou de fout verplaatsen. |
| Waarde-identiteit is geen bronidentiteit. | `WorkspaceValueIdentityIndex` kan twee afzonderlijke const-declaraties met literal `'idle'` dezelfde value-root geven. Hun geschreven occurrences zijn verschillend. Gebruik die value-root niet als edit-, selectie- of bronlocatie-identiteit. |
| Wrappercalls verliezen in de publieke callweergave hun onderscheid. | Twee calls `wrap('left', def1)` / `wrap('right', def2)` leveren intern instantiations, maar de publieke `CallFact` van `trees.register(id, definition)` behoudt die site met formele parameters. Lens toont `BT id`, niet twee gecorreleerde toepassingen. `instantiate.ts` bezit de benodigde actual→formal-grens; geen Lens-wrapperexpansie toevoegen. |
| Lexical bindingbehoud bewijst geen gelijkblijvende initialisatie. | `LuaRelocationAnalysis` documenteert die grens correct. De transferanalyse accepteert een move met `next_value()`, terwijl de waarde van een niet-verplaatste sibling na compilatie van `2` naar `1` verandert. Undo herstelt de bron exact. Dat is geen Undo-fout; het is een andere vraag dan source-/bindingcorrectheid. |
| Multi-file vereist meer dan een rijkere recognizer. | `BehaviorSourceDocuments` cachet op één modelversie; `BehaviorSourceIndex` rekent ranges door één buffer; bookmarks en content-notificaties volgen het registratiemodel. De generieke workspace kent geïmporteerde targets al, maar buitenlandse AST's rechtstreeks in deze consumers stoppen is onjuist. |

De huidige `CallFact`/query-store is niet ineens een verkeerde call-hierarchy-
owner. Zijn resultaatcontract is onvoldoende voor de sterkere bronherkomstclaim.
Ook een monotone `WriteSet` is geen program-point-specifieke reaching-definition-
analyse: gevonden writes verdwijnen daar niet doordat een latere write ze op
een uitvoeringspad overschrijft.

### Reproduceerbare kerngevallen

De twee CPU-proeven gebruiken een zelfgeschreven, minimale module onder het
modulepad `cartlib/behaviour_tree/library`. Zij testen echte BLua-taalsemantiek,
**niet** de uitvoering van de volledige cartlib-BT-compiler.

**API-identiteit:** de fixturemodule exporteert `register` die `1` retourneert.

```lua
local trees<const> = require('cartlib/behaviour_tree/library')
trees.register = function(id, def) return 7 end
return trees.register('audit', { root = { type = 'sequence', children = {} } })
```

Gemeten: Lens telt één BT-registratie, de resolver noemt original én replacement,
de BLua32-CPU retourneert `7`. `<const>` bewijst hier alleen de lexical binding.

**Effectvolgorde:** de fixturemodule retourneert het aangeboden `def` onveranderd.

```lua
local trees<const> = require('cartlib/behaviour_tree/library')
local serial = 0
local next_value<const> = function() serial = serial + 1 return serial end
local left<const> = { type = 'sequence', children = {
    { type = 'wait', duration_ticks = next_value() },
    { type = 'wait', duration_ticks = next_value() },
} }
local right<const> = { type = 'sequence', children = {} }
trees.register('left', { root = left })
trees.register('right', { root = right })
return left.children[#left.children].duration_ticks
```

Verplaats het eerste field van `left.children` naar de lege `right.children`
met `BehaviorTreeTransferAnalysis` en `createLuaTableFieldTransfer`. De query
geeft `available`; de ongemoeid gelaten tweede wait heeft vóór de move duur `2`,
erna duur `1`. Eén `EditorTextModel.undo()` herstelt alle bytes en dirty=false.
Een graphmove verandert bewust gedrag, maar mag niet als geïsoleerde verplaatsing
van al geëvalueerde nodewaarden worden voorgesteld.

De overige drie tegenproeven zijn:

```lua
-- Afzonderlijke callcontexten; id en definition moeten gepaard blijven.
local trees<const> = require('cartlib/behaviour_tree/library')
local wrap<const> = function(id, definition)
    return trees.register(id, definition)
end
wrap('left', { root = { type = 'wait', duration_ticks = 1 } })
wrap('right', { root = { type = 'wait', duration_ticks = 2 } })

-- Gelijke semantic value, verschillende geschreven bron.
local first<const> = 'idle'
local second<const> = 'idle'

-- Eén bekend callable target sluit een onopgeloste vervanging niet uit.
local callbacks = { step = function() return 'a' end }
if condition then callbacks.step = make_handler() end
callbacks.step()
```

Uitgevoerd via `buildLuaSemanticFrontend`, `LuaSemanticQueryStore`,
`WorkspaceValueIdentityIndex` en de genoemde edit-/compilerowners:

```sh
npx tsx --tsconfig tsconfig.base.json --import ./tests/lua/test_setup.ts \
  /tmp/bmsx-source-authoring/module_write.ts
npx tsx --tsconfig tsconfig.base.json --import ./tests/lua/test_setup.ts \
  /tmp/bmsx-source-authoring/probe.ts
```

Scripts/logs zijn tijdelijk auditbewijs. De minimale Lua-gevallen en gemeten
uitkomsten staan hierboven zodat de bevindingen niet uitsluitend van `/tmp`
afhangen. Geen nieuwe CI-test eist dat deze beperkingen blijven bestaan. Dit is
geen browser-, Hot Resume-, heap- of host-frameperformancemeting.

De bestaande `behavior_tree_transfer.test.ts`, `state_machine_source.test.ts`
en `actioneffect_source.test.ts` zijn opnieuw uitgevoerd: **26 passed, 0 failed**
(`/tmp/bmsx-source-authoring/source-tests.log`). Zij bewijzen hun huidige
contracten, niet dat het voorgestelde broncontract al bestaat.

## 3. Productiecode: overnemen wat dezelfde grens oplost

| Gelezen implementatie | Bruikbaar contract; niet blind kopiëren |
| --- | --- |
| [TypeScript extract-symbol](https://github.com/microsoft/TypeScript/blob/c63de15a992d37f0d6cec03ac7631872838602cb/src/services/refactors/extractSymbol.ts#L201-L291) en [binding/read/write-analyse](https://github.com/microsoft/TypeScript/blob/c63de15a992d37f0d6cec03ac7631872838602cb/src/services/refactors/extractSymbol.ts#L2020-L2142) | Applicability en redenen horen bij een concrete operatie en bestemming, op echte symbolen. Niet één globaal `canEdit`; geen overgenomen automatische parameter/substitutiegenerator als oplossing voor onze Lua-grens. |
| [TypeScript move-to-new-file](https://github.com/microsoft/TypeScript/blob/c63de15a992d37f0d6cec03ac7631872838602cb/src/services/refactors/moveToNewFile.ts) en [ChangeTracker](https://github.com/microsoft/TypeScript/blob/c63de15a992d37f0d6cec03ac7631872838602cb/src/services/textChanges.ts#L496-L589) | Semantische gebruiksanalyse bepaalt wijzigingen, de taalowner maakt SourceFile-gebonden edits. BMSX behoudt zijn eigen lossless token/trivia-edits; geen printer-roundtrip of ongevraagde importherschrijver. |
| [Roslyn DocumentEditor](https://github.com/dotnet/roslyn/blob/6a0c2f224d2950393bb54e32c7a2ec460e9e5d83/src/Workspaces/Core/Portable/Editing/DocumentEditor.cs), [SyntaxEditor](https://github.com/dotnet/roslyn/blob/6a0c2f224d2950393bb54e32c7a2ec460e9e5d83/src/Workspaces/Core/Portable/Editing/SyntaxEditor.cs#L104-L163) en [SolutionEditor](https://github.com/dotnet/roslyn/blob/6a0c2f224d2950393bb54e32c7a2ec460e9e5d83/src/Workspaces/Core/Portable/Editing/SolutionEditor.cs) | Oorspronkelijk document/semantic model, echte syntaxnodes en een documentgebonden change-set. Geen afgeleide waarde als bronnode-identiteit. Geen Roslyn-objectmodel/servicecontainer in BMSX nabouwen. |
| [VS Code bulk text edits](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/workbench/contrib/bulkEdit/browser/bulkTextEdits.ts#L294-L350) | Modelreferenties en versies blijven geldig tot apply; één-model-edit blijft eenvoudig, meerdere modellen krijgen gezamenlijk Undo-eigenaarschap. Niet twee losse edits met handmatige rollback. |

Deze code is daadwerkelijk gelezen. De toepassing op dynamische Lua is een
**ontwerpafleiding**, geen claim dat TypeScript/Roslyn een willekeurige Lua-BT
omkeerbaar visualiseren. LimboAI/Godot blijven de voorbeelden voor gestures en
domein-UX, maar hun authored resourceboom bezit niet onze Lua-bronsemantiek.

## 4. Generiek broncontract, zonder tweede semantic engine

### Vier verschillende identiteiten

- **Geschreven occurrence:** AST-node in een bepaald bestand/snapshot. Dezelfde
  literalwaarde op een andere plek blijft een andere occurrence. Binnen die
  generatie de bestaande AST-identiteit gebruiken, geen stringkeys terugdecoderen.
- **Contextueel gebruik:** welke aanroep/argumentbinding deze bron gebruikt.
  Een gedeelde wrapperbody alleen identificeert haar callers niet. Een statische
  callcontext is ook nog geen identiteit van een concrete runtime-allocatie.
- **Graph occurrence:** de geselecteerde toepassing onder een registratie en
  haar bronpad. Eenzelfde definitie kan meerdere zichtbare occurrences hebben.
- **Edit-owner:** de geschreven expression/field/list en het resource-owned model
  dat diens bytes bezit. Dit kan een ander bestand zijn dan de registratie.

Semantic value-/symbol-identiteiten blijven voor hun eigen queries bestaan.
Er komt geen tweede verzameling permanente graph-id's naast de bron. Over
sourcewijzigingen heen blijven de bestaande bookmarks/correspondence eigenaar;
AST-identiteit van een oud snapshot is geen actuele editlocatie.

### Wat een bronquery moet beantwoorden

Input: de echte expression/callsite uit een immutable workspace-snapshot, met
de relevante generieke callcontext wanneer die nodig is. Het resultaat moet
onderscheid behouden tussen:

1. de geschreven use-site en de concrete constructor/field/function/literal-
   occurrences die bijdragen;
2. hun binding/substitutiecontext — met gekoppelde argumenten, geen cartesiaans
   product van los samengevoegde ids en definities;
3. bekende alternatieven **en** onopgeloste bijdragen; één bekend alternatief
   is geen gesloten verzameling zolang een andere bron onbekend blijft;
4. wat over writes en evaluatiemoment is vastgesteld, in plaats van afwezigheid
   in een navigatieresultaat als bewijs van onveranderlijkheid te nemen;
5. de snapshot-/dependencygeldigheid van die feiten.

Dit is geen verplicht groot bewijsobject op ieder graphitem. Bronfeiten komen
uit de taalproducent vóór value-deduplicatie informatie verliest; de demand-query
retineert alleen de benodigde resultaten. `instantiate.ts` blijft de enige
actual→formal-owner. Interne frame-arrays niet rechtstreeks uit Lens uitlezen.
De bestaande mogelijke-symbolen-API omwikkelen levert deze ontbrekende informatie
niet op. Evenmin een Lens-lokale walker die calls/assignments opnieuw interpreteert.

`unknown` is hier een taalfeit over geschreven, mogelijk dynamische bron, geen
fallback voor corrupte interne state. Parserrecovery, dynamische uitkomst en
bewezen afwezigheid mogen niet tot dezelfde lege lijst worden platgeslagen.
Het concrete API-/opslagontwerp hoort bij de eerste producerslice, met metingen
naast de huidige query-store; niet vooraf een nieuwe servicehiërarchie invoeren.

## 5. Wat cartlib-interpretatie wél bezit

De domeinbijdrage koppelt de **opgeloste API-binding** aan haar registration-
argumenten en veldrollen. Module/membernamen mogen candidates selecteren, maar
bewijzen op zichzelf geen actuele callee. De const-spelling van een lokale
variabelenaam mag die rol niet overnemen. Bij een overschreven of onopgeloste
callee mag een mogelijke match niet als zekere BT/FSM/effectregistratie verschijnen.

Hetzelfde geldt voor nodetypes, tabellen en callbacks: consumeer generieke
bronfeiten zodat directe waarden, ongewijzigde aliases, members en imports niet
elk een Lens-specifieke uitzondering vragen. Een eenvoudig doorgeefwrappertje
moet zijn afzonderlijke id/definition-paren behouden; een dynamische generator
hoeft niet tot een verzonnen eindige lijst runtime-instanties te worden uitgerold.

Het consumptiemoment blijft belangrijk. De live BT-library compileert een
definition naar een program bij `register`; de FSM-library bouwt een
state-definition; ActionEffects slaat een definition op en rebindt componenten.
Hieruit volgt **niet** dat alle velden bij alle drie dezelfde copy/live-semantiek
hebben. Per veld/operatie het werkelijke compile-/readpad toetsen. "De uiteindelijke
table aan het einde van het bestand" is geen algemeen registratiemodel.

Shared callbacksyntax is gedeelde bron, maar haar geretourneerde FSM-pad wordt
in de betreffende FSM-scope geïnterpreteerd. Het pad eenmaal globaal aan een
stringwaarde binden zou opnieuw occurrences en value identity verwarren.

## 6. Een bewerkingscontract per gebruikersintentie

**Beslissing voor B03:** drag/reparent is een bronstructurele bewerking, geen
verplaatsing van een al geïnstantieerde runtime-node. Zij verandert bewust het
gedrag. Dat vereist geen bewijs dat het spel equivalent blijft, maar wel een
exacte bronbestemming, behouden bedoelde bindings en eerlijke zichtbaarheid van
gedeelde bron en verplaatst initialisatiewerk.

| Bedoeling | Schrijfdoel en betekenis |
| --- | --- |
| Inspect / Source | Bekende use-site en origin(s) bekijken/navigeren. Geen text edit, geen dirty/Undo/HR-effect, ook niet bij onopgeloste waarden. |
| Geselecteerde propertyexpressie wijzigen | Het geschreven field-value vervangen. Bij `duration = config.delay` verandert dit niet stilletjes `config.delay` voor alle andere gebruikers. |
| Gedeelde definitie wijzigen | Expliciet haar bronowner bewerken. Bekende andere consumers tonen; geen exclusiviteit claimen wanneer analyse de volledige gebruiksverzameling niet vaststelt. |
| BT reorder/reparent | Het echte list-field verplaatsen naar een concrete insertion-site. Bij `{child = shared_node}` of een losse `shared_node`-entry reist de referentie, niet automatisch de elders gemaakte constructor. Inline constructors reizen wel als bron, inclusief hun eager initializers. |
| Child → weighted choice / single slot vervangen | Een andere domeinoperatie, met expliciete weight/slotkeuze. Niet als lijstmove verpakken of een gewicht/fallbacknode verzinnen. |
| Eén toepassing van een factory wijzigen | Alleen een aangetoonde geschreven callerinput aanpassen wanneer dat de gekozen instelling bezit. Anders is het een wijziging van de gedeelde factorybron, niet een per-instantie-edit. Geen automatische extractie, clone of literalization. |

De structurele analyse behoudt de bestaande listrollen, topology-/cyclechecks,
overlappende syntaxgrenzen en lexical relocation. Uitbreiding naar callcontexten
mag daarbij source-constructoridentiteit niet verwarren met runtime-tableidentiteit.

Daarnaast moet de operatie haar **verplaatste evaluatie** beschrijven. Een call
in een field-initializer wordt tijdens constructie uitgevoerd; de body van een
meeverplaatste function expression niet tijdens de creatie van die closure.
Ook reads van mutable bindings kunnen door een ander evaluatiemoment verschillen.
Alleen zoeken naar `CallExpression` is dus geen voldoende analyse. Bekende extra
gevolgen horen in de bestaande impactreview, onbekende gevolgen mogen niet als
"geen impact" worden gelabeld. Dit is dezelfde bronoperatie met haar consequenties,
geen "probeer toch maar"-pad dat ontbrekende bindings of insertion-sites omzeilt.

Een pure syntaxmove hoeft niet te wachten op een volledige interprocedurale
purity-/effectchecker. Zij mag alleen niet een sterkere garantie aanbieden dan
haar contract. Er komt geen automatisch hulplocal om initialisatievolgorde te
bevriezen en geen herschreven callback als verborgen prijs voor een drag.
Dit onderscheid geldt ook voor het bestaande same-list reorder en duplicate;
het is niet uitsluitend een toekomstige cross-depthkwestie.

## 7. Generaties, modellen en Undo

- `EditorLuaSemanticProject` blijft één mutable owner per resource domain boven
  immutable snapshots. Unsaved editorbronnen vervangen de installed basis. De
  behavior-projectie neemt dat snapshot, niet alleen het registrerende file record.
- Generieke bronfeiten dragen taalbestand/syntax. De IDE koppelt die via haar
  bestaande resource/project-owners aan domain/model; geen IDE ResourceIdentity
  importeren in de Lua-binder en geen domein afleiden uit alleen een padstring.
- Ranges/offsets en edits lopen door het model dat de bron bezit. Het registrerende
  tabmodel blijft niet impliciet eigenaar van een geïmporteerde callback of tabel.
- Snapshotgeldigheid is de basis. Een cache over snapshotgrenzen heen vereist
  echte dependencies, inclusief negatieve lookups: een eerder ontbrekend module-
  export kan later verschijnen. Alleen gevonden originbestanden volgen is dan
  onvoldoende. `SemanticDemandIndex` is niet zo'n workspace-notificatieservice.
- Niet automatisch een tweede fijnmazig dependency-framework bouwen. Gebruik
  eerst de project/snapshot-owner voor correctheid; meet koude rebuilds van
  betrokken/open projecties. Cross-generation hergebruik uitsluitend waar de
  producer invalidatie werkelijk bewijst. Geen reparse/workspace-scan per frame,
  hover of command-enablement, en geen stale projectie als snelle fallback.
- Een prepared edit/review hoort bij de bronfeiten waarop hij is gebaseerd,
  inclusief geraadpleegde bronnen die niet worden gewijzigd. Bronwijzigingen
  beëindigen die geldigheid via de owner-lifetime; oude async resultaten worden
  geen actuele edits. Alleen `SourceEditReview.model` volgen is niet genoeg als
  de analyse ook andere resources las.

**Read many / write one is niet write many.** Imported fields kunnen in hun eigen
model één gewone edit/Undo krijgen. Daarvoor is geen workspace-transactionmanager
nodig. Een echte file-A→file-B-move schrijft wél twee modellen: dan eerst gedeeld
workspace-edit/Undo-eigenaarschap naar het VS Code-voorbeeld, inclusief gedrag
bij latere individuele edits. Twee `pushEditOperations` met handmatige rollback
is geen vervanger. Dat grotere contract is niet vooraf nodig voor multi-file
inspectie of het bewerken van één geïmporteerde definitie.

Hot Resume blijft een afzonderlijke consumer van de gewijzigde Lua. Onvolledige
graphanalyse mag de gewone broneditor, compiler of Hot Resume niet blokkeren.
Geslaagde cold-execution-/Undo-proeven bewijzen geen live closure-migratie.

## 8. Bouwvolgorde en acceptatie

De oorspronkelijke numerieke B01→B07-volgorde is **geen** afhankelijkhedenketen:

1. **B04, producercontract:** concrete generieke source-query met occurrence,
   callcorrelatie, onbekende bijdragen en snapshotgeldigheid. Eerst onderstaande
   onafhankelijke gevallen naast de bestaande semantics/relocation meten; geen
   nieuwe Lens-aliasresolver als tussenstap.
2. **B04, resource-eigen consumer:** recognition/projectie, Source, invalidatie
   en een read-many/write-one-edit op dat contract. `moduleTargetBinding` niet
   langer als bewijs van een bevroren API-export gebruiken.
3. **B03, volledige same-document dragflow:** gebruik hetzelfde broncontract
   voor hogere/lagere parents, lege destinations en enige members, met de
   bovenstaande source-intentie, impactreview, bookmarks en één Undo. De
   bestaande transfer-/relocation-/edit-primitieven behouden hun echte scope.
4. **Write-many pas wanneer gevraagd:** los contract voor cross-file moves en
   gedeeld workspace Undo; niet stilzwijgend meenemen met imported Source-links.

B01/B02/B05 en de niet-mutating B06-presentatie kunnen onafhankelijk verbeteren,
zolang zij geen nieuwe sourcezekerheid beloven. B06-authoring gebruikt hetzelfde
bron-/editcontract. B07 blijft gedeelde viewport-architectuur. Niet iedere
tekst-/contextmenuverbetering hoeft op een algemene effectanalyse te wachten.

Dit vereist geen big-bang vervanging van de semantic engine. De eerste verticale
bronproef kan een direct/imported constructor met aliases zijn, zolang onbekende
bijdragen correct in het generieke resultaat blijven staan. Daarna de gecorreleerde
wrappertoepassingen uitbreiden bij de bestaande instantiation-owner. Niet eerst
een Lens-only uitzondering bouwen en die later als "gedeelde helper" verplaatsen.

| Onafhankelijke fixture | Te bewijzen eindgedrag, niet de huidige beperking vastklikken |
| --- | --- |
| Direct literal, const alias, gewone local zonder relevante writes, member/reexport | Gelijke bewezen betekenis; juiste afzonderlijke use- en originlocaties. Niet alleen een snapshot met ongeveer dezelfde kaarttekst. |
| `<const>` module met overschreven export; één known plus unknown callee | Geen zekere oorspronkelijke API-call afleiden uit pad, const-spelling of targetaantal. |
| Twee gelijke literals op verschillende plekken | Een edit schrijft uitsluitend de gekozen occurrence; value-interning blijft werken. |
| Twee wrappercalls met verschillende ids en definities | Gekoppelde callerinputs; geen `left` met `right`-definitie en geen samengevouwen `BT id`. |
| Gedeelde factory/constructor/list in verschillende toepassingen | Sourcegebruik en zichtbare occurrence blijven onderscheiden; geen verzonnen runtime-exclusiviteit of ongevraagde clone. |
| Geïmporteerde FSM-states en membercallback, gedeeld in twee FSM-scopes | Juiste sourceowners en scoped paden; edits/Undo in de dependency vernieuwen beide projecties. |
| Mutaties voor/na registratie, eager initializercall en captured mutable read | Vastgestelde grenzen/evaluatiefase kloppen; lexical behoud wordt niet als effectbehoud gerapporteerd. Gebruik de CPU alleen in de test, niet voor editorresolutie. |
| Onopgeloste factory, computed key of onvolledige syntax | Onzekerheid op het juiste deel; andere bekende bron blijft inspecteerbaar. Geen tweede canonical format of runtime-evaluatie. |
| Unsaved importwijziging; ontbrekend export wordt toegevoegd | Nieuwe sourcefeiten zonder registratie-edit; geen positieve-dependency-only cache. |
| Dependency wijzigt tijdens menu/review/async source-open | Oude facts/ranges worden niet toegepast; lifetime, focus en command-owner sluiten samen. |
| Zelfde pad/id in andere domains; meerdere registraties in één bestand | Juiste input/model, Source/Back en selectie, onafhankelijk van displaylabels. |
| Reparent/reorder/duplicate met comments en callbackcaptures | Exacte geselecteerde bronoperatie, expliciete gevolgen, één correcte Undo/Redo; daarna aparte echte Save/Hot Resume-proef. |

Bij elke producerslice: bestaande generic Lua-tests naast deze kleine fixtures;
geen Nemesis/Pietious-namen of regelnummers als contract. Cartlib-adaptertests
toetsen daarnaast de **echte** API-consumers, niet alleen een stub onder hetzelfde
modulepad. Een echte Studio-flow bewijst Source/Back, dirty, Undo en model-lifetime.

Meet parse/bind/query/projectie afzonderlijk, retained hover/draw zonder nieuwe
analyse en geheugen na herhaalde generaties/open-close. Een global full-call-
expansion om een picker te vullen is geen acceptabele vervanger voor demand-
queries. Deze analyse levert nog geen performanceclaim voor de nieuwe bronquery.
