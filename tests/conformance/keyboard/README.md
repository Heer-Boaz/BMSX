# Shared keyboard conformance

Run from the repository root:

```sh
npm run test:keyboard-parity
```

The command configures/builds the native runner locally, runs the **same vectors**
through TypeScript and C++, compares every published result, and asserts named
expected outcomes. It does not require a ROM, browser, or physical device. On
failure the vector file, case names, and both output traces remain in the printed
`bmsx-keyboard-parity-*` temporary directory. A native runner executable can be
supplied as an argument when comparing a separately compiled implementation.

## Compared representations

- All 75 canonical key definitions, HID usages, modifier indices and Shift labels.
- All three native keyboard pages: initial selection and every row's keys,
  starts, spans and total units.
- Per-step page/count, selection, visibility, Shift state, revision, action result,
  pressed/highlighted keys, and eight raw HID words supplied to the ICU.
- Ordered bitmap rectangle/glyph/image commands at each publication, including
  positions, geometry, colors, labels, atlas identities,
  icon flips, complete glyph items, configured-font ownership, and published-page
  hit testing.

Both runners construct the actual input source, `OnScreenKeyboard`,
`HostOnScreenKeyboard`, `HostKeyboardInteraction`, `HostUiInput` and default font.
The TS runner uses the existing offscreen host-overlay fixture. The native test
adapter presents canonical vector pad words through libretro callbacks; it does
not introduce a new application input adapter.

Mouse/controller frames retain the real production order:

1. Publish physical device changes and poll the input source once.
2. Update modal input, dispatch keyboard interaction and consume UI input.
3. Sample the actual HID banks and publish bitmap commands.

Virtual HID state becomes visible on the next input poll, not by an extra hidden
poll after interaction. Direct model vectors therefore have an explicit `POLL`
operation. `FRAME_KEY` obtains its integer target from the actual **published**
key rectangle, rather than copying the layout algorithm. Model operations do not
silently repaint; `PUBLISH` is explicit.

Coverage includes every key's HID down/up, overlapping source lifetimes,
physical/virtual modifier chords, unused modifier taps, feedback, row navigation,
page selection, exact fractional bounds, docking, captured mouse movement,
release-plus-controller activation, focus reopening while held, independent
controllers, UI repeat, and seeded valid model transitions. Named assertions
prevent two identically incorrect implementations from passing by equivalence
alone.

## Deliberate limits

The common trace compares the native bitmap layout, not the touch-first browser
ABC/Fn layout. It does not manufacture stable identities for libretro contacts
or equate per-pointer browser leases with native contact occupancy. Those
platform contracts remain covered by their own browser/native tests. Exact
command equality at the exercised bounds is not a cross-renderer pixel or
physical-device usability claim.

The existing core parity manifest separately gates the four keyboard owner
pairs and genuinely matching out-of-line method contracts. It is a structural
gate, not a substitute for this executable comparison.

Reference: [Qt Virtual Keyboard input-panel tests](https://github.com/qt/qtvirtualkeyboard/blob/v6.8.0/tests/auto/inputpanel/data/tst_inputpanel.qml#L274-L333)
exercise actual key presses/releases and check emitted modifiers, repeat and text,
including release inaccuracy. The local runner/build pattern follows BMSX's
existing geometry and terminal conformance suites.
