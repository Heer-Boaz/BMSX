# Assembly and servicing {#sec-servicing}

The reference construction provides removable upper and lower covers. The
upper cover carries the cartridge doors; the connector assemblies and controls
remain on the fixed body. The procedures below describe access to the proposed
construction, not a validated repair procedure for a manufactured product.

## Isolation and preparation {#sec-service-isolation}

1. Move POWER to OFF and disconnect the external supply at the console.
2. Remove both cartridges and all peripheral and display cables.
3. Use an ESD-controlled work area and verify that the supply rails have
   discharged before disconnecting internal parts.
4. Support the fixed body and deck; keep screws, insulating parts and other
   hardware with their assemblies.

Keep the external power supply closed. Attach measurement probes with power
removed; support and insulate the boards before making powered measurements.

## Opening and closing the case {#sec-service-opening}

Four recessed M3 × 55 screws underneath secure the covers. Support the lower
cover while removing the screws, then lift the upper cover and remove the
lower cover. Retain the two removable left-hand compression sleeves; the
right-hand columns remain with the fixed body. The feet need not be removed.

Before closing, align the sleeves, screw passages and upper-cover nuts. Check
that wires, fasteners and thermal pads are clear of the seams. Start all four
screws by hand and bring the covers together evenly. Do not force a cover
against an obstruction.

## Front sockets and controls {#sec-service-front}

The pad sockets have individual retainers; an insulating cradle supports the
keyboard socket. Disconnect a harness by its housing and release the retainer
before removing a socket. On reassembly, restore the supports and check socket
alignment without pulling on the wires.

POWER is a maintained slide control; RESET is momentary. Verify control travel
and indicator polarity after work on the front assembly. The indicator reports
the presence of the 3.3 V rail, not successful startup.

## Rear connections and cable restraints {#sec-service-rear}

The DC inlet and audio/video socket are supported by internal carriers.
Disconnect their harnesses before releasing the carriers. Support the socket
and contact board together; do not use solder joints or cables to carry the
removal force. Restore the cable restraints and insulation before reconnecting
power.

The video paths use separate signal and return connections. Identify and check
their continuity against the contact assignments in @sec-physical-av before
reassembly.

## Cartridge frame and dust doors {#sec-service-cartridge-doors}

The two doors have separate leaves, hinges and return springs. Support the
leaf and spring when releasing a hinge; retain each part with its slot. With
the cover supported, check that each door moves freely and returns closed.

The frame supplies the guides, seating stops and polarising keys. Restore its
insulators and supports before testing a cartridge. A correctly oriented card
must pass the guides and seat without force; do not remove or widen the keys
to accommodate an incorrectly oriented card.

## Cooler and thermal interfaces {#sec-service-cooling}

Allow the cooling component to cool before handling. Support it while releasing
the deck attachments and separate the thermal pads without levering against a
package. The supports pass through board clearances; they do not clamp the PCB.

For reassembly, restore the separate insulating pads at CORE and GFX and fit
the component and supports to the deck. Check contact at both packages without
bending the board. Keep wires clear of the cooling component and restore the
air path. The flat spreader and finned profile are alternatives, not proven
interchangeable thermal solutions.

## Supply measurements {#sec-service-supply-capture}

The principal power nets are RAW9 at the input, VIN9 after input protection,
V3V3 and V5 at the regulated outputs, and RESET_N. The power chapter describes
the proposed start-up sequence and the functions of these nets. Record the
connected cartridges and accessories when observing the sequence; an unloaded
reading does not establish performance under every load.

## Fault isolation and return to operation {#sec-service-replacement}

Begin with power disconnected and inspect plugs, harnesses, retainers and
insulation. Follow the affected path: input supply and protection for a power
fault; socket, cable and input controller for an accessory fault; or the
corresponding output path and display connection for picture or sound faults.
The mainboard and connector chapters identify those paths.

Before returning the console to operation, account for all parts, restore
insulating barriers and cable restraints, check both cartridge doors and
controls, and close the case. Verify power, input, display and sound functions
with the intended connections. Thermal performance requires qualification with
the actual hardware and load.
