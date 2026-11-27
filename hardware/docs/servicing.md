# Servicing

## Preparation

1. Switch POWER off and disconnect the supply.
2. Remove both cartridges and all accessory and display cables.
3. Work at an ESD-protected place. Check that the rails have discharged
   before disconnecting internal parts.
4. Support the body and deck; keep screws and insulating parts with their
   assemblies.

Connect probes with power off; support and insulate the boards before
measuring with power on.

## Opening and closing

Four recessed M3 × 55 screws underneath hold the covers. Support the lower
cover, remove the screws, lift off the upper cover and remove the lower cover.
Keep the two loose compression sleeves on the left; the columns on the right
stay with the body. The feet stay in place.

To close: align the sleeves, screw holes and nuts in the upper cover. Check
that no wires, screws or thermal pads are caught in the seams. Start all four
screws by hand and tighten evenly.

## Front sockets and controls

Each pad socket has a retainer; the keyboard socket sits in an insulating
cradle. Unplug a cable by its housing and release the retainer before removing
a socket. On reassembly, refit the supports and check the alignment of the
sockets.

POWER is a slide switch; RESET a push button. After work on the front, check
both controls and the polarity of the indicator. The indicator shows the 3.3 V
rail.

## Rear connections

The DC inlet and the SCART socket are held by carriers inside. Unplug their
cables before releasing a carrier. Support the socket and its contact board
together; do not pull on solder joints or cables. Refit the cable ties and
insulation before connecting power.

Each video signal has its own return. Check continuity against
[Audio and video](connectors.md#audio-and-video) before reassembly.

## Cartridge frame and dust doors

Each door has its own leaf, pivot and return spring. Support leaf and spring
when releasing a pivot; keep the parts with their slot. Check that each door
moves freely and closes.

The frame holds the guides, stops and polarising keys. Refit its insulators
and supports before testing with a cartridge. A correctly oriented cartridge
goes in without force; do not remove or widen the keys.

## Cooler

Let the cooler cool before handling it. Support it while releasing it from the
deck and lift the thermal pads off without levering on a package.

On reassembly fit the insulating pads on CORE and GFX, then the cooler and its
supports to the deck. Check contact on both packages without bending the
board. Keep wires clear of the cooler and the air path open.

## Supply measurements

Main nets: RAW9 at the input, VIN9 after the protection, V3V3 and V5 after the
converters, and RESET_N. The start-up sequence is in [Power supply](power.md#power-supply). Note
the connected cartridges and accessories with each measurement.

## Fault finding

With power off, check plugs, cables, retainers and insulation. Then follow the
path concerned:

| Fault | Check |
|---|---|
| No power | Supply, F60, U62, converters ([Power supply](power.md#power-supply)) |
| Accessory | Socket, cable, input lines ([Pads and pointer](connectors.md#pads-and-pointer)) |
| Picture or sound | Output path and display cable ([Audio and video](connectors.md#audio-and-video)) |

Before use, check that all parts are in place, insulation and cable ties are
refitted, doors and controls work, and the covers are closed. Check power,
input, picture and sound.
