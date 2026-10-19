# Cartridge sockets and mapped card devices

A cartridge socket identifies a place for a card, not a fixed collection of devices. BMSX provides two sockets, numbered 0 and 1. Each socket can be occupied independently. An occupied socket establishes that a card is present; it does not establish that the card supplies ROM, RAM, or a mailbox, and it does not establish that the card is bootable.

## Card composition

A card may supply ROM, RAM, and a mailbox independently. Presence identifies
the card as a whole; it does not enumerate those devices or report their
capacities. Know the inserted card's composition before using its storage or
mailbox. Selecting a socket does not create a missing device.

| Installed resource | Composition | What its presence establishes |
| --- | --- | --- |
| Card | Occupies socket 0 or socket 1 | Socket occupancy, not device inventory or boot readiness |
| ROM | Optional, independent of RAM and mailbox | Read-only bytes are installed on the card |
| RAM | Optional; capacity belongs to the particular card | The card supplies writable storage, not necessarily the complete RAM aperture |
| Mailbox | Optional, independent of ROM and RAM | The card supplies a mailbox device |

Do not derive installed capacity from the size of an address aperture. The
address windows reserve bus locations; they do not promise that storage is
installed at every offset. ROM, RAM and mailbox accesses to an absent device
follow the rules in the corresponding sections below.

## Boot selection

The installed BIOS examines present sockets in order, socket 0 before socket 1, using SELECT while inspecting them. It chooses the first card that satisfies its ROM boot-readiness checks. A card can therefore occupy a socket without becoming a boot candidate, and the first occupied socket need not be the socket from which startup proceeds. These checks describe the installed BIOS boot policy, not a cartridge-discovery BIOS interface available to software.

For the ROM header, startup requirements, and boot routes, see [Memory — Cartridge startup](../book1/memory.md#rom-header-fields). Those definitions remain authoritative; card composition alone does not replace their requirements.

## Selection and execution

SELECT and the active instruction-fetch domain are distinct. Cartridge instruction fetching follows the socket bound to the active execution domain. Changing SELECT alone does not redirect active cartridge instruction fetching to the other socket, execute that socket, or initialize it.

A cartridge-targeted `CP0.EXEC` samples the selected socket and replaces the
instruction-fetch latch. Both sockets use the same cartridge addresses, so an
image does not require relocation merely because it is inserted in the other
socket. A closure retains a function-record address, not a socket: entering it
uses the current execution-socket latch. See [Memory — EXEC and cartridge entry](../book1/memory.md#exec-and-cartridge-entry)
and [CPU execution control](../book1/cpu.md#cp0-and-execution-control).


## Programming route

1. Establish the inserted card's composition and preserve any storage still in
   use. STATUS reports occupancy, not RAM capacity or mailbox presence.
2. Write SELECT for ordinary CPU accesses. Use aligned word stores for mailbox
   commands; selecting a socket neither resets nor enters it.
3. For mailbox interrupts, clear the local latch to rearm its next rising edge,
   and acknowledge the owned pending bit at the central controller separately.
4. For DMA, set both request levels, addresses, count and control before START.
   Use explicit socket request selectors when a pending transfer must remain
   independent of later CPU selection changes.
5. Wait for the channel's terminal state and inspect faults before using its
   output. Transport completion is not an application response from the card.

The following reference defines the retained words, write effects, request
levels and access restrictions used by that sequence.

## Cartridge controller

The cartridge controller provides two independent physical sockets, numbered 0 and 1. Either socket may contain a cartridge or be empty. The controller selects a socket without testing whether a cartridge is present; software must distinguish socket selection from cartridge presence.

### Controller registers

| Address | Name | Access | Controller-reset value |
|---|---|---|---|
| `0x08010420` | `SELECT` | Read/write | `0x00000000` |
| `0x08010424` | `STATUS` | Read-only | Installed-cartridge presence bits; bit 16 clear |

`SELECT` retains the complete raw 32-bit selection word. A read returns that word, including bits 31:1. Only bit 0 participates in ordinary socket selection. The other bits remain stored and readable; they neither select additional sockets nor report cartridge properties.

| Register | Bits | Meaning |
|---|---|---|
| `SELECT` | 0 | Ordinary socket selection: 0 selects socket 0; 1 selects socket 1. |
| `SELECT` | 31:1 | Retained raw bits; no effect on socket selection. |
| `STATUS` | 0 | 1 when socket 0 contains a cartridge. |
| `STATUS` | 1 | 1 when socket 1 contains a cartridge. |
| `STATUS` | 16 | Ordinary selected socket: 0 for socket 0; 1 for socket 1. |
| `STATUS` | 15:2, 31:17 | Read as zero. |

### Selection and presence

A `SELECT` write takes effect immediately for subsequent ordinary cartridge accesses. It changes selection only: it does not reset either cartridge, generate a cartridge interrupt, or republish cartridge DMA requests.

An individual bus transaction may explicitly select a socket instead of using `SELECT`. Such an override does not modify the retained selection word. `STATUS` continues to report ordinary selection, not the socket chosen by that transaction.

<div class="keep-together">

`STATUS` is a computed report, not a writable status latch. Its two presence bits describe both sockets independently of selection. Thus selecting an empty socket still changes bit 16, while the presence bits remain unchanged. Reads from an empty selected socket return zero; writes to it have no effect and generate no cartridge effects.

</div>

### Controller reset

Controller reset clears the entire `SELECT` word, resets each present cartridge, and republishes DMA request lines for both sockets. Empty sockets contribute no asserted request lines. Reset does not change which sockets contain cartridges, so `STATUS` need not read as zero afterward. The controller itself neither raises nor clears an interrupt as part of this reset sequence; cartridge-specific reset behavior is defined separately.


## Card storage and MMIO access

A card may provide ROM, RAM, and an MMIO attachment independently. The presence of one does not imply the presence of either other region. The address windows below reserve locations on the cartridge bus; their sizes are not a statement of the storage capacity installed on a particular card. ROM and RAM offsets are measured in bytes from their respective window bases.

| Region | First address | Exclusive limit | Window size |
| --- | --- | --- | --- |
| ROM | `0x10000000` | `0x30000000` | 512 MiB |
| RAM | `0x30000000` | `0x30f00000` | 15 MiB |
| MMIO | `0x30f00000` | `0x31000000` | 1 MiB |

A ROM or RAM read returns zero when that region is absent or when its byte offset is outside installed capacity. Addresses do not wrap around the installed region: a smaller ROM or RAM is not mirrored through the remainder of its window. A write cannot create missing RAM or extend installed RAM capacity. Writes to ROM are ignored.

ROM and RAM scalar values are little-endian: the lowest-addressed byte occupies
bits 7:0. For scalar ROM and RAM reads, the starting address selects the region. A multi-byte read remains a read of that selected region, including when fewer than the requested number of installed bytes remain. Available bytes occupy the low-order portion of the result; missing high-order bytes are zero. This differs from a byte sequence spanning address windows, where each byte is selected by its own address.

| Operation | Width, capacity, tail, or reset behavior |
| --- | --- |
| ROM/RAM byte read | Returns the addressed installed byte, otherwise zero. |
| ROM/RAM 16-bit read | At a one-byte tail, returns that byte in bits 0–7 and zero in bits 8–15. Returns zero beyond capacity. |
| ROM/RAM 32-bit read | Assembles remaining bytes into successive low-order byte lanes; unavailable high-order lanes are zero. Returns zero beyond capacity. |
| RAM write | An 8-, 16-, or 32-bit write occurs only when its starting address selects RAM and its entire width fits installed RAM. A partial-width tail write changes nothing. |
| MMIO 8-/16-bit write | Ignored, even when the MMIO attachment is present. |
| MMIO 32-bit write | Delivers the word and the unchanged MMIO-relative byte offset to the attached unit; does nothing when that unit is absent. |
| Logical card reset | Resets the attached MMIO unit, if present. Retains RAM contents and leaves ROM unchanged. |

MMIO reads return zero when no attachment is present. Otherwise, the register read uses the byte offset from `0x30f00000` without rounding that offset to a word boundary. An 8-bit read selects the returned word's byte lane using address bits 1–0. A 16-bit read selects its low or high half using address bit 1. A 32-bit read returns the complete word. These lane rules describe read results; they do not make narrower MMIO writes effective.

RAM begins zero-filled when provisioned. That initial state must not be confused with logical card reset, which does not clear RAM.


## Cartridge mailbox

The cartridge mailbox contains two retained 32-bit words, DATA and CONTROL, and a local interrupt-pending latch. STATUS exposes that latch. IRQ_ACK is a write action rather than a retained register. The mailbox base is `30F00000H` on the selected card. The four word ports are
DATA `30F00000H`, CONTROL `30F00004H`, STATUS `30F00008H` and IRQ_ACK
`30F0000CH`. Every register reads `00000000H` after mailbox reset.
All offsets below are relative to that base.

### Register map

| Address | Name | Access | Bits / word-write action | Reset read |
|---|---|---|---|---|
| `30F00000H` | DATA | R/W | Retains all 32 bits; write replaces the complete word | `00000000H` |
| `30F00004H` | CONTROL | R/W + trigger | Bits 31:1 retained; bit 0 requests an IRQ and is excluded from readback | `00000000H` |
| `30F00008H` | STATUS | R; writes ignored | Bit 0 IRQ_PENDING; bits 31:1 zero | `00000000H` |
| `30F0000CH` | IRQ_ACK | R=0; W action | Any nonzero word clears local pending; zero has no effect | `00000000H` |

Read decoding ignores the low two offset bits. Consequently, `+0x00` through `+0x03` read DATA, `+0x04` through `+0x07` read CONTROL, and `+0x08` through `+0x0B` read STATUS. Every other offset group reads zero, including `+0x0C` through `+0x0F`.

Use aligned word stores for the mailbox actions. Only `+0x00`, `+0x04`, and
`+0x0C` perform an action. Writes to STATUS and other aligned offsets are ignored;
byte and halfword writes do not perform mailbox actions.

### DATA and CONTROL

DATA holds the last word written to it. Writing DATA does not change CONTROL or the local interrupt-pending latch.

CONTROL has the following defined fields:

| Bits | Mask | Name | Meaning on a CONTROL write |
|---|---|---|---|
| 0 | `0x00000001` | IRQ_TRIGGER | Requests a local interrupt-pending transition. Not retained by the write. |
| 1 | `0x00000002` | DREQ_READ | Sets the DREQ_READ level. |
| 2 | `0x00000004` | DREQ_WRITE | Sets the DREQ_WRITE level. |
| 31:3 | `0xFFFFFFF8` | Unnamed | Retained exactly as written; no defined IRQ or DREQ contribution. |

A CONTROL write replaces the retained word; it does not set or clear selected retained bits independently. Preserve any retained fields that must remain unchanged when constructing a new CONTROL value. CONTROL readback returns the retained word directly, including unnamed bits. The IRQ_TRIGGER action bit is excluded from the value retained by a CONTROL write, rather than appearing as a latched trigger request in readback.

### Interrupt pending and acknowledgement

An IRQ_TRIGGER write sets local IRQ_PENDING. A new interrupt edge occurs only when this changes the local latch from clear to set. Repeated trigger writes while IRQ_PENDING is already set do not generate additional edges.

Writing CONTROL with IRQ_TRIGGER clear does not clear IRQ_PENDING. To rearm the local edge, write any nonzero word to IRQ_ACK. A subsequent trigger write can then generate another edge; no intervening trigger-clear CONTROL write is required. IRQ_ACK does not alter DATA or CONTROL. This local acknowledgement is distinct from acknowledgement at a central interrupt controller.

### DREQ levels and reset

DREQ_READ and DREQ_WRITE independently follow retained CONTROL bits 1 and 2. Either, both, or neither may be asserted. Interrupt triggering and local acknowledgement do not substitute for programming these levels. Unnamed CONTROL bits do not affect them.

Reset clears DATA, CONTROL, and the local pending latch. DATA, CONTROL, and STATUS therefore read zero, and both DREQ levels are deasserted.



## Interrupts: two latches, two acknowledgements

Socket 0 raises central interrupt bit 9 (`00000200H`); socket 1 raises bit 10
(`00000400H`). These are distinct from each card's local STATUS bit 0.
The central FLAGS port is `08000000H`, ACK is `08000004H` and MASK is
`08000008H`. A central ACK clears the pending bits selected by its written
ones. It does not clear the card's local pending latch.

![A card-local edge and its separate central pending bit](figures/cartridge-irq.svg)

Central pending records an edge even with its MASK bit clear. MASK affects
delivery, not pending storage. A FLAGS read changes neither latch. Conversely,
mailbox IRQ_ACK clears only the local latch; an already pending central bit
remains until central ACK. Neither latch counts repeated events.

<div class="keep-together">

For one socket, starting with both pending latches clear:

| Accepted operation | Local pending | Central socket bit |
|---|---:|---:|
| CONTROL = `1` | 1 | 1 |
| Central ACK = socket mask | 1 | 0 |
| CONTROL = `1` again | 1 | 0 |
| Local IRQ_ACK = `1` | 0 | 0 |
| CONTROL = `1` again | 1 | 1 |
| Local IRQ_ACK = `1` | 0 | 1 |
| Central ACK = socket mask | 0 | 0 |

</div>

The third row demonstrates why acknowledging only the central controller does
not rearm a mailbox edge. When handling both sockets, select the intended card
before touching its local registers and acknowledge only the central bits owned
by that handler. The complete CPU-enable, `irq(flags)` and predicate-wait route
is in [Interrupt controller](../book1/irq.md#cpu-delivery-and-waiting).
A card-local trigger or a central pending bit is not a remote-work completion
protocol.

## DMA between sockets

A DMA channel can address both cartridge sockets in one transfer without changing the CPU’s cartridge selection. Each endpoint’s request field supplies its own socket override. `READ_REQUEST` controls the source endpoint; `WRITE_REQUEST` controls the destination endpoint. For either field, selectors 7–10 choose the following request and socket:

| Selector | Request condition | Endpoint socket override |
| --- | --- | --- |
| 7 | Socket 0 `DREQ_WRITE` | Socket 0 |
| 8 | Socket 0 `DREQ_READ` | Socket 0 |
| 9 | Socket 1 `DREQ_WRITE` | Socket 1 |
| 10 | Socket 1 `DREQ_READ` | Socket 1 |

The two overrides are independent of one another and of `CART_SELECT`. Selecting a cartridge request does not constrain the endpoint to a particular cartridge address range: its address may target ROM, card RAM, or mailbox MMIO. The request controls admission and socket routing; the addressed region controls the access itself.

Both programmed request conditions must be asserted before a block is admitted. `FORCE` (selector 0) is always asserted; `DISABLED` (selector 15) never is. Mailbox `CONTROL` bit 1 drives `DREQ_READ`, and bit 2 drives `DREQ_WRITE`. Both may be asserted together. These are request levels, not FIFO occupancy indications or a sequence of per-word requests. An absent card, or a card without a mailbox, supplies no asserted cartridge requests.

<div class="keep-together">

For example, a four-word copy from socket 0 to socket 1, incrementing both addresses, uses source selector 8 and destination selector 9:

| `CONTROL` field | Value | Contribution |
| --- | --- | --- |
| Read increment, bit 0 | 1 | `00000001H` |
| Write increment, bit 1 | 1 | `00000002H` |
| Read request, bits 5:2 | 8 | `00000020H` |
| Write request, bits 9:6 | 9 | `00000240H` |
| Block words minus 1, bits 13:10 | 3 | `00000C00H` |
| **Combined `CONTROL`** | | **`00000E63H`** |

</div>

Each increment advances four bytes per word. This block requires socket 0 `DREQ_READ` and socket 1 `DREQ_WRITE`; the CPU’s current selection cannot reroute either endpoint.

Admission and completion are distinct. Admission snapshots the channel’s addresses, remaining count, control, and the number of words in the next block, then establishes its service deadline. No endpoint transfer occurs at admission. At service, each word is read and then written; addresses and remaining count are updated after the block. A zero remaining count completes the channel. An admitted block is nonpreemptible: deasserting a request can prevent a later block from being admitted, but does not cancel or shorten the active block.

Selectors other than 7–10 supply no cartridge socket override. Such an endpoint uses `CART_SELECT` when its cartridge access is serviced. `CART_SELECT` is not part of the admitted snapshot, so changing it after admission can redirect a pending, unoverridden access. Keep the selection unchanged until that access completes, or use an explicit cartridge request override.

The installed timing basis is 33,868,800 Hz. For a contiguous N-word endpoint span, cartridge service costs `8N + 4` cycles. This includes card RAM and mailbox MMIO: neither receives main-RAM pricing. Main RAM costs `N + 1` cycles. Two cartridge endpoints have additive costs, even when they select different sockets:

| Transfer, wholly within each endpoint’s region | Cycles | Four words | Sixteen words |
| --- | --- | --- | --- |
| Cartridge ↔ main RAM | `8N + 4` | 36 | 132 |
| Cartridge ↔ cartridge | `16N + 8` | 72 | 264 |
| Cartridge ↔ installed I/O | `8N + 4` | 36 | 132 |

Thus the example ROM(socket 0) → RAM(socket 1) block costs 72 cycles from admission. Incrementing across a cartridge ROM, RAM, or MMIO boundary starts a new span and incurs setup again. These figures are admitted-block service costs, not physical sustainable bandwidth or CPU-launch delay. Request waiting, channel competition, and software programming or polling are additional. See [DMA](../book1/dma.md) for the general channel programming sequence.

## Access faults

The mapped-bus rules below are separate from ordinary CPU admission. Ordinary
halfword accesses require two-byte alignment and word accesses four-byte
alignment. A misaligned ordinary load or store enters its address-error
exception before reaching the bus. A new mapped fault during an ordinary load
enters a data-bus-error exception before committing the read value; a new fault
during an ordinary store enters the same exception. A bus-level zero return is
not a successful ordinary CPU load of zero. See [Memory — Scalar memory
accesses](../book1/memory.md#scalar-memory-accesses).

Installed I/O and cartridge MMIO have different mapped-access rules. The installed-I/O `CART_SELECT` and `CART_STATUS` registers use word-aligned slots. An unaligned mapped 32-bit access raises `UNALIGNED_IO` (2). An 8-bit read at an aligned register address returns its low byte; other byte lanes fault. All mapped 16-bit reads and all mapped 8-bit or 16-bit stores to installed I/O also fault. Faulting reads return zero and faulting stores are suppressed.

A mapped 32-bit store to `CART_STATUS` raises `READ_ONLY` (3), leaving the register unchanged. This differs from storing to mailbox `STATUS`, which is ignored without that fault.

Cartridge mapped accesses have no aperture-wide word-alignment gate; card decoding and byte lanes determine their effect. Mailbox 8-bit and 16-bit stores are ignored. Mailbox 32-bit stores decode the exact relative offset, so unaligned offsets are ignored rather than rounded to a register.

The entire access must fit inside the cartridge aperture. The highest admitted addresses are `30FFFFFCH` for 32 bits, `30FFFFFEH` for 16 bits, and `30FFFFFFH` for 8 bits. Crossing that final boundary raises `UNMAPPED` (1), returning zero or suppressing the store. An absent selected card returns zero and ignores stores without a fault; ROM stores are likewise ignored.

DMA uses these same mapped-access rules, but a fault does not abort its programmed read, write, and count progression. `DONE` therefore does not prove that endpoint addresses were valid. The first outstanding bus fault retains its code, address, and access; later faults do not replace it. See [Memory — Bus faults](../book1/memory.md#bus-fault-status-and-cpu-exceptions) for the fault registers and acknowledgement procedure.


## Two-card programming example

Assume a bootable card in socket 0 with ROM and a mailbox, and a data card in
socket 1 with at least 32 bytes of RAM and a mailbox. The sequence owns DMA0,
both mailbox controls, socket-1 RAM bytes 16–31 and central DMA0 pending bit 0.
No other writer changes these resources or the selected request levels.
Interrupt delivery remains masked; completion is polled instead of using HALT
without an enabled interrupt. No remote processor or automatic mailbox response
is assumed.

Declare four words in socket 0's executable ROM, assert the read request on
socket 0 and the write request on socket 1, then program the idle channel:

```lua
rodata seed: word[4] = {
    0x01234567, 0x89abcdef, 0x55aa33cc, 0xf00dcafe,
}
mem[0x08000008] = 0           -- Mask delivery; retain pending source bits.
mem[0x08000004] = 1           -- Acknowledge this owner's old DMA0 pending bit.
mem[0x08010420] = 0
mem[0x30f00004] = 2           -- Socket 0 DREQ_READ.
mem[0x08010420] = 1
mem[0x30f00004] = 4           -- Socket 1 DREQ_WRITE.
mem[0x0800000c] = seed        -- DMA0 READ_ADDR: socket-0 ROM.
mem[0x08000010] = 0x30000010  -- DMA0 WRITE_ADDR: socket-1 RAM.
mem[0x08000014] = 4           -- Four words, not four bytes.
mem[0x08000018] = 0x00000e63  -- Increment both; requests 8/9; four-word block.
mem[0x08000020] = 1           -- START.
while (mem[0x0800001c] & 1) ~= 0 do
end
```

The explicit endpoint overrides keep the source on socket 0 and destination on
socket 1 while ordinary CPU selection remains 1. After normal completion,
DMA STATUS is 2 and COUNT is zero. READ_ADDR is `seed + 16`, WRITE_ADDR is
`30000020H`, and the masked DMA0 pending bit is set. Before consuming the data,
check for new bus faults using the [Memory fault-attribution procedure](../book1/memory.md#attribute-a-bus-fault-before-start);
DMA DONE does not imply valid endpoint accesses.

Read socket 1's destination while it remains selected:

```lua
local destination<const>: *word = 0x30000010
local first = destination[0]
local last = destination[3]
mem[0x30f00004] = 0           -- Deassert socket-1 requests after completion.
mem[0x08010420] = 0
mem[0x30f00004] = 0           -- Deassert socket-0 requests.
mem[0x08000004] = 1
```

The received words are `01234567H`, `89ABCDEFH`, `55AA33CCH`, `F00DCAFEH`;
`first` and `last` select the first and fourth. This writes no socket-0 RAM.
Logical card reset would retain the destination, so a warm rerun cannot assume
that untouched card RAM is zero. The one admitted block costs 72 system cycles
under the timing rules above; CPU setup, request waiting, polling and loads are
additional. This is not a statement-to-statement latency or interrupt-entry
guarantee.
