6. VDP wordt nóg geloofwaardiger als echte hardware met deze aanvullingen

De VDP is al het best uitgewerkte device in het document. Om hem nog hardwarematiger te maken, zou ik focussen op vijf dingen.

6.1 Maak elk VDP-subblok een state machine

Niet per se met zware classes. Wel met expliciete staten.

Voor DEX bijvoorbeeld:

Idle
DirectFrameOpen
StreamFrameOpen
Executing
FaultLatched
SubmitBusy

Voor SBX:

Idle
FaceWindowDirty
PacketOpen
FrameSealed
FrameRejected

Voor BBU:

Idle
PacketDecode
SourceResolve
InstanceEmit
LimitReached
PacketRejected

Voor FBM:

PageWritable
PagePendingPresent
PagePresented
ReadbackRequested

Dan verdwijnen boolean soup en repeated lifecycle checks vanzelf. Niet omdat je meer defensive code schrijft, maar omdat één eigenaar één overgang benoemt.

6.2 Leg fault policy per subunit vast als tabel

Je hebt al goede fault codes. Ik zou ze in een contracttabel gieten:

Fault source              Fault code                    Effect
DEX bad packet            STREAM_BAD_PACKET             abort sealed stream frame
DEX direct bad state       SUBMIT_STATE                  drop command, keep direct frame open
FIFO parser fault          STREAM_BAD_PACKET             abort stream frame
SBX seal fault             SBX_*                         reject frame
BBU packet fault           BBU_*                         reject packet/frame
Submit busy                SUBMIT_BUSY                   reject attempt, no visible mutation
Unknown doorbell           CMD_BAD_DOORBELL              latch fault, drop doorbell

Dat maakt het moeilijker voor toekomstige code om een exception, ad-hoc rejection of silent drop te introduceren.

6.3 Maak VDP timing zichtbaarer

Hardware wordt geloofwaardig door timing. Niet alleen door registers.

Voor elke VDP-unit zou ik vastleggen:

voert werk direct uit bij MMIO write?
wordt werk gelatched tot CMD?
draait het bij FIFO replay?
draait het tijdens machine tick?
commit het bij VBLANK?
is het busy gedurende N ticks?
kan de CPU status pollen?
kan het IRQ genereren?

Vooral DEX, BBU, SBX en toekomstige MSU hebben hier baat bij. Als alles instant is, voelt het sneller maar minder hardwarematig. Als alles asynchroon is, wordt het complex. De middenweg: expliciete timing per unit.

6.4 Behandel VDP register docs als ABI, niet als commentaar

Maak van IO_VDP_*, packet opcodes, status bits en fault codes een echte cart-facing ABI met:

owner file;
mirrored TS/C++ constants;
test die magic values vergelijkt;
BIOS helper tests die raw packets/register writes produceren;
geen render-side imports van register constants behalve via allowed output contracts.

Je document is hier al goed bezig. Ik zou dit doortrekken naar een “hardware register map” document of generated table.

6.5 Host-output is geen scene graph

Deze zin zou ik bijna als wet opnemen:

VDP host output is a hardware output transaction, not a scene submission API.

Zodra iemand een “sprite command”, “draw rectangle”, “submit glyph” of “scene object” aan de renderer wil geven vanuit machine/runtime, moet er alarm afgaan. Host/editor overlay mag eigen render queues hebben, maar cart-visible VDP-output moet uit VDP device state komen.

7. Geo wordt nóg geloofwaardiger als device als je het minder als math helper behandelt

Je noemt Geometry expliciet als open item, en dat is terecht. Geo heeft al MMIO registers, scheduler service, IRQs, status/fault words en TS/C++ controllers. Dat is een goede start, maar nog geen bewijs dat het een device is.

De toets moet zijn:

Kan ik Geo beschrijven als een cartridge-zichtbare coprocessor met registers, latches, timing, faults, RAM/scratch en save-state?

Als ja, dan is Geo hardware. Als nee, dan is het een math library met MMIO-kleding.

Wat ik voor Geo zou doen
7.1 Geef Geo een duidelijke unit-identiteit

Bijvoorbeeld:

GEO:
  2D overlap/collision accelerator
  transform/project unit indien aanwezig
  command latch bank
  operand/result memory window
  scratch arena
  status/fault/IRQ controller

Niet alles hoeft in één keer. Maar het moet duidelijk zijn welke functies hardware-werk zijn en welke gameplay/helper-werk zijn.

7.2 Maak ingress expliciet

Geo zou alleen cart-visible input moeten krijgen via:

MMIO operand registers;
command doorbell;
DMA/source pointer registers;
geometry RAM/scratch window;
BIOS helpers die exact deze paden gebruiken.

Niet via runtime helper calls zoals:

runtime.checkOverlap(a, b)
engine.geometry.query(...)
cartLib.privateGeo(...)

BIOS helpers mogen bestaan, maar ze moeten register writes of memory writes doen. Dan blijft de console zichtbaar hetzelfde.

7.3 Maak timing en busy gedrag concreet

Geo wordt pas echt hardwarematig als het niet alleen “function call returns result” is.

Mogelijke contractvorm:

CPU writes operands
CPU writes GEO_CMD
Geo latches operands
Geo status becomes BUSY
Scheduler advances Geo work
Geo writes result registers / result RAM
Geo clears BUSY
Geo optionally raises IRQ
CPU polls status or handles IRQ

Niet alle commands hoeven multi-tick te zijn. Sommige kunnen instant zijn. Maar ook instant moet contractueel zijn:

Command class A:
  completes during command write

Command class B:
  completes after scheduled service

Command class C:
  streams over source memory and may fault mid-stream

Dat voorkomt dat later elke Geo-functie willekeurig synchronously/asynchronously wordt.

7.4 Maak fault behavior cart-zichtbaar

Geo mag niet “throwen” op cart-originating invalid geometry. Dat moet status/fault worden.

Voorbeelden:

GEO_FAULT_BAD_CMD
GEO_FAULT_BAD_OPERAND_FORMAT
GEO_FAULT_SOURCE_OOB
GEO_FAULT_RESULT_OOB
GEO_FAULT_BUSY
GEO_FAULT_UNALIGNED_SOURCE
GEO_FAULT_SCRATCH_OVERFLOW

Met beleid:

sticky-first fault of latest fault?
write-one-to-clear?
busy blijft staan of command wordt geannuleerd?
result registers blijven oud, worden invalid, of krijgen partial result?
IRQ bij fault ja/nee?

Die details maken het device serieus.

7.5 Scratch ownership is kernarchitectuur

Scratch buffers zijn vaak waar “hardware” weer library wordt. Geo moet precies weten:

welke scratch is device-owned?
welke scratch wordt gesaved?
welke scratch is transient execution state?
welke scratch is host-only tijdelijke berekening?
welke scratch mag door cart memory zichtbaar zijn?
welke scratch is TS/C++ mirrored?

Als Geo een accelerator is, dan moeten actieve command state en relevante scratch voor determinisme in save-state zitten. Maar temporary host-side arrays voor een pure intermediate hoeven dat niet, zolang ze na restore deterministisch opnieuw ontstaan uit device state.

7.6 Result memory en status moeten testbaar zijn

Een goede Geo-test zou niet direct C++/TS methods aanroepen als bewijs. Hij zou doen:

write operands through MMIO/RAM
write command
advance scheduler
read status/result registers
assert IRQ/fault behavior
save state
mutate
restore
read same status/result/scratch-visible state

Dat is de emulator-test. Direct method unit tests mogen daarnaast bestaan voor tiny math kernels, maar ze bewijzen de hardware-boundary niet.

8. APU mist in dit document nog als first-class hardware peer

Je vraagt expliciet naar APU, en mijn grootste feedback is: de APU zou dezelfde architectuurdiscipline moeten krijgen als VDP en Geo.

In de huidige tekst komt audio vooral langs als host-edge flushing, dirty audio invalidation en libretro audio queue reset. Dat is belangrijk, maar het beschrijft vooral host/audio resource handling. Voor emulatorgeloofwaardigheid moet de APU zelf een machine device worden met eigen registers, timing, channel-state en save-state.

Gewenste APU-vorm

Cart-visible flow:

cart Lua / BIOS helper
  -> MMIO audio registers / RAM sample buffers / command FIFO
  -> APU device
  -> host audio output buffer

Niet:

cart Lua -> runtime audio API -> SoundMaster -> host clip

Host audio mag onderaan natuurlijk bestaan. Maar cart-facing audio hoort via APU/firmware/MMIO te lopen.

APU hardwarecontract

Ik zou de APU opsplitsen in herkenbare units:

APU register file:
  global control, master volume, IRQ/status, fault latch

Voice/channel units:
  oscillator/sample playback/noise/PCM/ADSR/pan/pitch

Mixer:
  channel accumulation, clipping/saturation, output format

DMA/FIFO:
  sample streaming, command queue, buffer refill

Timer/sequencer:
  tick rate, envelope step, LFO/modulation, IRQ events

AOUT:
  host-facing audio transaction/output ring

Dan krijg je een parallel met VDP:

VDP -> VOUT
APU -> AOUT

Dat is mooi en streng. VOUT levert video frames. AOUT levert audio frames/samples. De host backend consumeert die, maar interpreteert geen cart-intent.

APU save-state moet meer zijn dan queue reset

Libretro audio queue resetten na load is host-correct, maar APU-state moet zelf volledig restorebaar zijn:

channel enabled flags;
frequency/phase accumulators;
sample cursor/playhead;
envelope stage and level;
length counters;
loop points;
noise LFSR state;
PCM buffer pointers;
DMA/FIFO read/write pointers;
pending IRQ flags;
mixer state if relevant;
resampler fractional position if device-visible/determinism-relevant;
latched faults/status.

Anders krijg je na save/load video en CPU terug, maar audio begint met een subtiele andere fase. Dat is precies het soort ghost bug dat pas in libretro opduikt wanneer iemand savestates spammed tijdens een boss theme.

APU performance zonder engine-shape

De APU mag snel zijn. Dat betekent:

geen per-sample allocations;
geen closures in hot mix paths;
fixed-size channel arrays;
ring buffers met expliciete ownership;
host output batches;
no lazy ensure in mix/present path;
sample buffer uploads aan host edge;
APU command ingress via MMIO/FIFO, niet via generic sound service.

APU mag host audio resources kennen aan de output edge, maar niet als cart API. Het equivalent van VDP dirty rows is hier misschien:

APU fills device-owned mix ring
AOUT exposes contiguous ready span
host audio backend consumes span
host acks consumed sample count

Of, als libretro pull-model dominant is:

host requests N samples
APU advances machine/audio time deterministically
APU writes N samples into provided output buffer

De belangrijke regel blijft: host consumeert audio output, host bestuurt geen APU-semantiek.

APU fault/status voorbeeld

Cart-originating audio fouten als status:

APU_FAULT_BAD_CMD
APU_FAULT_BAD_CHANNEL
APU_FAULT_SAMPLE_SOURCE_OOB
APU_FAULT_DMA_BUSY
APU_FAULT_FIFO_OVERFLOW
APU_FAULT_UNSUPPORTED_FORMAT

Met status:

APU_STATUS_BUSY
APU_STATUS_IRQ
APU_STATUS_FAULT
APU_STATUS_FIFO_EMPTY
APU_STATUS_FIFO_FULL
APU_STATUS_UNDERRUN

En MMIO:

IO_APU_STATUS
IO_APU_FAULT_CODE
IO_APU_FAULT_DETAIL
IO_APU_FAULT_ACK
IO_APU_CMD
IO_APU_ARG0...
IO_APU_VOICE_BASE...

Dit zou APU op hetzelfde niveau brengen als VDP: een device, geen sound-manager met console-saus.
