# Studio/IDE agent instructions

These rules extend the repository `AGENTS.md` for work under `ide/`.

## Command surfaces

- Before adding a command to a menu, name that menu's subject: the item under
  the pointer, the active document, or the panel chrome. A command whose
  subject differs does not belong there. The command palette, a keybinding and
  that one owning menu may all show it.
- Header overflow and header context are chrome only: hide, float, dock, move,
  split, close, plus header icons that did not fit. Do not compose the
  item-command menu into that object. `WorkbenchViewPanel` already takes
  header actions, header context and the body's own menu separately. Do not
  change the panel unless a contribution cannot express that split; then stop
  and report the contract.
- A body context menu is about the element under the pointer in that body: a
  tree row, or a field in an inspector. An inspector body does not repeat the
  selected item's row menu. If the field actions are not decided, remove the
  item list, including Open Source. Do not invent field commands in that
  session.
- A row menu lists operations on the clicked item and shows their keybindings.
  A drag-only variant is a modifier on one entry, not a second row.
- Do not spread a shared `*_CONTEXT_ACTIONS` list onto surfaces that do not own
  its subject. Remove those commands. Do not add rows to make menus match.

## Inspectors

- An inspector may edit a literal kind the existing source reader already
  classifies. Related scalars share a row, including a position next to a
  gizmo.
- A closed set needs a declared schema. Do not invent that schema, and do not
  infer it from a numeric literal or a guest value. Anything else stays an
  expression with Open Source.
- Show identity in full or wrapped, not middle-truncated.

## Scope and acceptance

- One contribution per session. When the same fault exists in other
  contributions, name them and stop.
- Done means no open menu mixes another surface's subject. A new command id or
  a green enablement test is not evidence.
