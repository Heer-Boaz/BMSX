# BMSX

BMSX is a lightweight TypeScript game engine and toolchain used to build small retro-style browser games. Instead of loading assets directly from the web, each game is packaged into a single `.rom` file that contains the engine, game code and resources.

## Features

- **WebGL renderer** with texture atlas support and optional CRT-style effects.
- **Web Audio** integration via the `SoundMaster` module.
- **Input handling** for keyboard, gamepad and on-screen touch controls.
- **Finite State Machine** and **Behaviour Tree** helpers for game logic.
- **Save state** support and built-in debugging tools (state machine and behaviour tree visualizers, rewind UI).

## Project Layout

- `src/bmsx` – the shared engine.
- `src/<game>` – individual games, each with a `bootloader.ts` and a `res/` folder.
- `scripts/` – build utilities such as `rompacker.ts` and `bootrom.ts`.
- `dist/` – output directory for the `.rom` file and generated HTML pages.

> **NOTE**: The TypeScript project is not a standalone game, but rather a collection of modules that are used by the rompacker script to create a final game package. That also implies that multiple games can be built from the same TypeScript project, as long as they have their own `bootloader.ts` and `src/`-folder that also includes a `res/`-folder.

## Building

1. Install dependencies with `npm install`. Note that this project uses `tsx` for running TypeScript scripts directly, so you don't need to compile them to JavaScript first.
   If you want to use `tsc` instead, you can run `npm run build` to compile the `rompacker.ts` TypeScript file (and imports) in `scripts/` and run the resulting JavaScript file instead.
2. Ensure you have `tslib` installed globally, as it is required for the TypeScript runtime. You can install it with:
   ```bash
   npm install -g tslib
   ```
3. Run `npx tsx scripts/rompacker.ts -romname <game>` where `<game>` is a folder inside `src/`.
   The "build the game" task in `.vscode/tasks.json` executes this command for you.

During the build the bootloader is bundled with `esbuild`, a texture atlas is generated, resources are packaged and `<game>.rom` plus `game.html`/`game_debug.html` are produced in `dist/`.

Example for building the example game `testrom` which is located in `src/testrom`:
```bash
npx tsx scripts/rompacker.ts -romname testrom
```
> **WARNING**: Any other attempt at building the TypeScript project (e.g. `tsc` or `npm run build`) will **FAIL**! Always run the rompacker script to generate the `.rom` file and HTML loader.

## Running

Open `dist/game.html` in a modern browser. The inlined boot loader (`bootrom.js`) fetches the `.rom` file, unpacks it using `pako` and executes the game code.

## ROM Pack Structure

ROM packs are created by `finalizeRompack` in `rompacker.ts`. All resources are concatenated and zipped together with metadata and a small footer containing offsets. A PNG label can optionally be prepended to allow the ROM file to double as an image. Use `scripts/rominspector.ts` to inspect an existing ROM:

```bash
npx tsx scripts/rominspector.ts <file.rom>
```

## State Machine

The BMSX engine includes a powerful state machine system that allows you to define game logic in a structured way. The `State` class provides a base for creating states, while the `StateMachine` class manages transitions and state execution.

### Key Features
- **State Definition**: States can be defined with properties like `on_enter`, `on_exit`, and `on_input` to handle transitions and input processing.
- **Transition Management**: States can transition to other states based on conditions, allowing for complex game logic.
- **State Hierarchy**: States can inherit from other states, allowing for shared behavior and properties.
- **Input Handling**: The `on_input` property allows you to define input handlers that can trigger state transitions based on player actions.

### Advanced FSM Features

The BMSX FSM system provides a rich set of features for building complex, robust game logic. In addition to the basics, the following advanced features are available:

- **Parallel State Machines**: Multiple state machines can run in parallel within a controller. States or machines with `parallel: true` will execute alongside the current machine, allowing for independent animation, AI, or effect logic.
- **State Machine Controllers**: The `StateMachineController` class manages multiple state machines, supports switching between them, and can dispatch events to all or selected machines.
- **Tape/Animation System**: States can define a `tape` (an array of values, e.g., animation frames or question indices). The FSM tracks a `head` (current index) and `ticks` (frame counter), supporting automatic advancement, repetition, and rewinding. Use `auto_tick`, `ticks2move`, `repetitions`, and `auto_rewind_tape_after_end` for fine control.
- **State History and Pop**: Each state machine maintains a history stack of previous states (up to 10 by default). Use `pop()` to return to the previous state, or `pop_statemachine(id)`/`pop_all_statemachines()` for broader control.
- **Guards**: States can define `guards` with `canEnter` and `canExit` functions to control whether transitions are allowed. If a guard returns `false`, the transition is blocked.
- **Event Dispatch and Handling**: The FSM supports event-driven transitions. Use `do(eventName, emitter, ...)` to dispatch events to the current and parallel machines. States can define `on` and `on_input` handlers for event-based transitions.
- **Substates and Hierarchy**: States can contain substates, forming a hierarchy. Transitions can target substates using dot notation (e.g., `main.idle.substate`). The FSM supports traversing and switching substates.
- **Shared State Data**: Each state machine exposes a `data` object for sharing arbitrary data between states and substates.
- **Validation**: The `validateStateMachine` function checks FSM definitions for errors, such as missing states or invalid transitions, and throws if the definition is invalid.
- **Start State and Resetting**: States can specify a `start_state_id` and control automatic resetting of state/subtree via `auto_reset`.
- **Pausing and Resuming**: State machines can be paused and resumed individually or in groups, allowing for temporary suspension of logic (e.g., during cutscenes).
- **Factory and Dynamic Creation**: Use `State.create()` to instantiate FSMs dynamically, binding them to game objects or models at runtime.

For more details, see the `src/bmsx/fsm.ts` source file and the in-code documentation.

See `src/bmsx/fsm.ts` for implementation details and further customization options.

### Decorators

The BMSX engine uses TypeScript decorators to simplify and structure state machine definitions and assignments:

- **@build_fsm(fsm_name?)**
  Use this decorator on a static method that returns a state machine blueprint. It registers the state machine definition under the given name (or the class name if omitted, see below). This allows the engine to automatically discover and build state machines for your game objects.

  > Note that omitting the name will use the class name as the FSM name and will automatically cause the `StateMachine` to be bound to the class at game startup. Thus, it is not required to use the `@assign_fsm` decorator if you only need a single FSM for a class that uses the `@build_fsm` decorator without arguments.

  ```typescript
  @build_fsm('player_animation') // Optional name for the FSM
  function generateMachineBlueprint(): StateMachineBlueprint {
      return { /* ...state definitions... */ };
  }

   // No decorator required for assigning the FSM to the class, because the @build_fsm decorator is used without a name.
   class AGameObject {
       @build_fsm() // No name provided, uses class name
       public static generateMachineBlueprint(): StateMachineBlueprint {
           return { /* ...state definitions... */ };
       }
   }

- `@assign_fsm(...fsms)`
Attach one or more named FSMs to a class. This is useful for game objects that need to participate in multiple state machines (for example, animation and AI). The decorator ensures the FSMs are linked to the class and available at runtime.

   ```typescript
   @assign_fsm('player_animation', 'ai_controller')
   export class Fighter { ... }
   ```

#### How it works
- The decorators automatically register FSM blueprints and assignments in global registries (StateDefinitionBuilders), so the engine can instantiate and manage them without manual wiring.
- *FSM assignments are inherited through the class hierarchy*, so subclasses automatically get the FSMs of their parent classes unless overridden.
See `src/bmsx/fsmdecorators.ts` for implementation details.

### Event and Transition Path Syntax

The BMSX FSM system uses a flexible syntax for denoting events and state transitions in your state machine definitions:

- **Event Names and Scopes**:
  - Prefix an event name with `$` (e.g., `$click`) to indicate the event should be handled in the *local/self* scope (the current state or object).
  - Event names without `$` are handled in the *global* scope (dispatched to all listeners).
  - Example:
    ```typescript
    on: {
      '$click': 'idle',        // Local event handler
      'game_end': 'gameover',  // Global event handler
    }
    ```

- **Transition Paths**:
  - State transitions can target substates or other machines using dot notation:
    - `main.idle.substate` targets a substate within a hierarchy.
  - Special prefixes can be used for relative transitions:
    - `#this.` or `this.`: Transition within the current state machine.
    - `#parent.` or `parent.`: Transition within the parent state machine.
    - `#root.` or `root.`: Transition from the root of the state machine hierarchy.
  - If no prefix is given, the transition is relative to the current context.
  - Example:
    ```typescript
    // Transition to a substate in the current machine
    to: 'idle.substate'
    // Transition to a state in the parent machine
    to: 'parent.someState'
    // Transition to a state in the root machine
    to: 'root.globalState'
    // Transition within the current machine (explicit)
    to: 'this.someOtherState'
    ```

- **Usage in Handlers**:
  - In `on` and `on_input` handlers, you can use these notations for both event names and transition targets.
  - Example:
    ```typescript
    on: {
      '$customEvent': {
        do(this: MyObj) { /* ... */ },
        to: 'parent.specialState',
      },
      'globalEvent': 'root.globalState',
    },
    on_input: {
      'a[j]': {
        do(this: MyObj) { /* ... */ },
        to: 'this.nextState',
      },
    }
    ```

See `src/bmsx/fsm.ts` and `src/bmsx/fsmtypes.ts` for more details and advanced usage patterns.

#### Transition Handler Options

Each event or input handler in a state definition can use a rich object to control transitions and actions. The following properties are supported:

- **`do`**: A function to execute when the event or input is triggered. It receives the state (and optionally the game object as `this`) and any event arguments. It can return a transition object or state ID to trigger a transition.
- **`to`**: The target state to transition to (string or transition object). This is the most common way to specify a transition.
- **`switch`**: Like `to`, but only switches the lowest-level state (see `fsmtypes.ts` for details).
- **`if`**: A condition function. The transition/action only occurs if this returns `true`.
- **`scope`**: Explicitly sets the event scope (`'self'` or `'all'`). Usually inferred from the event name, but can be set manually.
- **`transition_type`**: `'to'` (default) or `'switch'`. Controls the type of transition (see above).
- **`force_transition_to_same_state`**: If `true`, allows transitioning to the same state even if already active (useful for re-entering a state).
- **`args`**: Arguments to pass to the target state.

You can use these options in any `on`, `on_input`, or `run_checks` handler. Example:

```typescript
on: {
  '$customEvent': {
    if(this: MyObj, state) { return this.isReady; },
    do(this: MyObj, state, ...args) { this.prepare(); },
    to: { state_id: 'ready', args: { foo: 1 }, force_transition_to_same_state: true },
    scope: 'self',
  },
  'globalEvent': {
    do(this: MyObj, state) { this.cleanup(); },
    switch: 'idle',
  },
},
run_checks: [
  {
    if(state) { return state.data.shouldEnd; },
    to: 'end',
  },
],
```

See `src/bmsx/fsmtypes.ts` for the full type definition and advanced usage patterns.

### Example Usage

```typescript
@build_fsm()
public static bouw(): StateMachineBlueprint {
   return {
      states: {
            _start: {
               enter(this: quiz) {
                  this.maximum_characters_per_line = maximum_characters_per_line_question;
                  this.setTextFromLines(['Text1', 'Text2', 'Text3',]);
               },
               run(this: quiz, _state: State) {
                  this.typeNextCharacter();
               },
               on_input: {
                  '?(a[j!c], b[j!c])': {
                        do() { $.consumeActions(1, 'a', 'b') },
                        to: 'vraag'
                  },
                  'down[j]': 'endstate', // Debugging shortcut to end the quiz
               }
            },

            vraag: {
               tape: Array.from({ length: quizItems.length }, (_, i) => i),
               auto_reset: 'none',
               enter(this: quiz, state: State, args: string) {
                  if (args === 'prev') { // Previous question for debugging
                        state.setHeadNoSideEffect(state.head - 2);
                        if (state.head < 0) {
                           state.rewind_tape();
                        }
                  }
                  // (...)
               },
               run(this: quiz, _state: State) {
                  this.typeNextCharacter();
               },
               next(this: quiz, state: State) {
                  this.currentQuestionIndex = state.current_tape_value;
               },
               end(this: quiz) {
                  return 'endstate'; // Transition to end state when the tape is exhausted
               },
               on_input: {
                  'a[j!c]': {
                        do(this: quiz) {
                           $.consumeAction(1, 'a');
                           this.currentAnswerOptionChosen = 'a';
                           return { state_id: 'antwoord', args: this.currentAnswerOptionChosen };
                        },
                  },
                  'b[j!c]': {
                        do(this: quiz) {
                           $.consumeAction(1, 'b');
                           this.currentAnswerOptionChosen = 'b';
                           return { state_id: 'antwoord', args: this.currentAnswerOptionChosen };
                        },
                  },
                  'left[j!c]': {
                        do(this: quiz) {
                           $.consumeAction(1, 'left'); // Debugging shortcut to go back to the previous question
                           return { state_id: 'vraag', args: 'prev', force_transition_to_same_state: true, transition_type: 'to' };
                        },
                  },
                  'right[j!c]': {
                        do(this: quiz) {
                           $.consumeAction(1, 'right'); // Debugging shortcut to go to the next question
                           return { state_id: 'vraag', args: 'next', force_transition_to_same_state: true, transition_type: 'to' };
                        },
                  },
               },
            },

            antwoord: {
               enter(this: quiz, _state: State, gekozen_antwoord: string) {
                  this.switchSintToAnswer();
                  const currentQ = quizItems[this.currentQuestionIndex];
                  if (gekozen_antwoord === 'a') {
                        this.setTextFromLines([currentQ.reactionA]);
                  } else {
                        this.setTextFromLines([currentQ.reactionB]);
                  }
               },
               run(this: quiz, _state: State) {
                  this.typeNextCharacter();
               },
               on_input: {
                  '?(a[j!c], b[j!c])': {
                        do(this: quiz) {
                           $.consumeActions(1, 'a', 'b');
                           if (this.currentQuestionIndex < quizItems.length - 1) {
                              return 'vraag'; // Transition to next question
                           } else {
                              return 'endstate'; // Transition to end state when the tape is exhausted
                           }
                        },
                  },
               },
            },

            endstate: {
               guards: {
                  canExit(this: quiz) { return false; }
               },
               enter(this: quiz) {
                  this.switchSintToKlaar();
                  this.setTextFromLines(['Win text because losing is not an option!']);
               },
               run(this: quiz, _state: State) {
                  this.typeNextCharacter();
               }
            }
      }
   };
}
```

## Player Input

### Device Support, Multi-Player, and Controller Assignment

BMSX supports flexible input from multiple sources and players, with robust runtime device management:

- **Keyboard Support:**
  - The keyboard can be mapped to any player (default: Player 1).
  - Multiple players can use different keyboard layouts if desired (see `InputMap`).
  - Keyboard keys are mapped to gamepad-style actions (see `Input.KEYBOARDKEY2GAMEPADBUTTON`).

- **Gamepad Support:**
  - Up to four players are supported, each with their own gamepad.
  - Gamepads can be connected/disconnected at runtime. The engine detects new controllers and can assign them to available player slots automatically or via user selection.
  - Gamepad button mapping is handled via `InputMap` and can be customized per player.
  - The API allows querying and consuming actions per player, regardless of input device.

- **On-Screen Gamepad:**
  - The on-screen gamepad is automatically shown on touch devices.
  - The on-screen gamepad can be enabled/disabled at runtime via `Input.enableOnscreenGamepad()`.
  - You can programmatically hide specific on-screen buttons using `Input.hideOnscreenGamepadButtons([...buttonIds])`.
  > TL;DR: The on-screen gamepad is shown by default when the game is started by a touch action, but can be hidden or shown programmatically.

- **Automatic Device Detection and Assignment:**
  - The engine listens for gamepad connection/disconnection events and can prompt the user to assign a new device to a player slot.
  - If a new controller is connected, a player index selection UI is shown, allowing the user to choose which player the device should control.
  - Devices can be reassigned at runtime, and the on-screen gamepad can be reassigned to any player as needed.

- **Multi-Player Input Access:**
  - Use the main game API to access input for any player:
    - `$.getPressedActions(playerIndex, query)`
    - `$.checkActionTriggered(playerIndex, action)`
    - `$.consumeAction(playerIndex, action)`
    - `$.setInputMap(playerIndex, inputMap)`
  - The `Input` singleton also provides `getPlayerInput(playerIndex)` to access the `PlayerInput` instance for a given player (1–4).
  - Example: Get the state of the 'jump' action for Player 1:
    ```typescript
    const jumpState = $.getActionState(1, 'jump[t{>50}]'); // playerIndex is 1-based
    if (jumpState.pressed && !jumpState.consumed) {
        // Player 2 is holding jump
    }
    ```
  - Example: Check if Player 2 triggered a low kick action:
    ```typescript
    if ($.getActionState(2, 'down && kick[j]')) {
        // Player 2 performed a low kick
    }
    ```

- **Player Indexing:**
  - Player indices are 1-based (Player 1 = 1, Player 2 = 2, etc.).
  - All input APIs accept a `playerIndex` parameter to specify which player's input to query or consume.

- **Runtime Controller Reassignment:**
  - Controllers (including the on-screen gamepad) can be reassigned to any player at runtime.
  - The engine provides UI and API support for reassigning devices, and will automatically update mappings if a device is disconnected or reconnected.

For more details, see the `Input` and `PlayerInput` classes in `src/bmsx/input.ts`, and the main game API in `src/bmsx/game.ts`.

The `InputStateManager` tracks a short, rolling history of button events for each player, enabling features like input buffering, combo detection, and action prioritization. This system is central to responsive gameplay, especially for fighting games or platformers where precise input timing is critical.

### Key Features

- **Input Buffering:**
  Button presses and releases are stored for a few frames, allowing the game to "see" inputs that happen just before an action becomes available (e.g., buffering a jump or attack during an animation).
  However, the implementation does not yet support leveraging this feature, as the `PlayerInput`-class does not currently make use of the `InputStateManager`'s buffering capabilities. This is planned for future versions.

- **Action Queuing:**
  Not implemented yet, but planned for future versions. This would allow actions to be queued up and executed in sequence, enabling complex move sets and combos.

- **Action Priority:**
  Actions can be prioritized in the following ways:
  - Using `getPressedActions(query?: ActionStateQuery)` to retrieve actions based on their state, where the `ActionStateQuery` includes the property `actionsByPriority: string[]` to specify the order of action processing. Example:
      ```typescript
               const priorityActions = $.getPressedActions(this.player_index, { pressed: true, consumed: false, actionsByPriority: ['duck', 'punch', 'highkick', 'lowkick', 'jump_right', 'jump_left', 'right', 'left', 'jump',] });

               // If no actions are pressed, switch to idle
               if (priorityActions.length === 0) {
                  return 'idle';
               }

               for (const actionObject of priorityActions) {
                  const { action } = actionObject;

                  switch (action as Action) {
                     case 'right':
                     case 'left':
                        this.facing = action as typeof this.facing;

                        this.x += action === 'right' ? Fighter.SPEED : -Fighter.SPEED;
                        return 'walk';
                     case 'jump_left':
                        this.facing = 'left';
                        $.consumeAction(this.player_index, 'jump')
                        return { state_id: 'jump', args: true };
                     case 'jump_right':
                        this.facing = 'right';
                        $.consumeAction(this.player_index, 'jump')
                        return { state_id: 'jump', args: true };
                     case 'duck':
                        return action; // Do not consume the duck action, as it would immediately make the fighter stand up again
                     case 'punch':
                     case 'highkick':
                     case 'lowkick':
                     case 'jump':
                        $.input.getPlayerInput(this.player_index).consumeAction(action);
                        return action;
                  }
               }
            }
      ```
  - Using `State.on_input` to register input handlers that can specify their own priority, allowing for flexible action resolution based on game state. The `State.on_input` property accepts multiple handlers, which are processed in the order they were registered, allowing for prioritization of certain actions over others. Example:
      ```typescript
            on_input: {
               'a[j!c]': {
                     do(this: quiz) {
                        $.consumeAction(1, 'a');
                        this.currentAnswerOptionChosen = 'a';
                        return { state_id: 'antwoord', args: this.currentAnswerOptionChosen };
                     },
               },
               'b[j!c]': {
                     do(this: quiz) {
                        $.consumeAction(1, 'b');
                        this.currentAnswerOptionChosen = 'b';
                        return { state_id: 'antwoord', args: this.currentAnswerOptionChosen };
                     },
               },
               'left[j!c]': {
                     do(this: quiz) {
                        $.consumeAction(1, 'left');
                        return { state_id: 'vraag', args: 'prev', force_transition_to_same_state: true, transition_type: 'to' };
                     },
               },
               'right[j!c]': {
                     do(this: quiz) {
                        $.consumeAction(1, 'right');
                        return { state_id: 'vraag', args: 'next', force_transition_to_same_state: true, transition_type: 'to' };
                     },
               },
            },
      ```

- **Combo and Window Modifiers:**
  The `[w{ms}]` modifier allows you to define a sliding time window (in milliseconds) for chaining actions, enabling combos or multi-step moves that require rapid input.

- **Action Parsing and Modifiers:**
The action parsing system is designed to be flexible and extensible, allowing for complex action definitions that can adapt to various gameplay mechanics.

  Action definitions support logical operators (`&&`, `||`), grouping, and modifiers such as:
  - `[p]` for pressed
  - `[j]` for just pressed
  - `[aj]` for all just pressed (multi-button)
  - `[c]` for consumed
  - `[!c]` for not consumed
  - `[t{^x}]`, where `^` = `<`, `>`, `<=`, etc. and `x` = <duration> for press time conditions (e.g., short tap, or long press)
  - `[ic]` to ignore the consumed state
  - Custom combos and conditions using functions like `?()` and `?j()`
> **Note**: The `[p]` and `[!c]` modifiers are implicitly applied to all actions, so it is not necessary to include it in every action definition. It is primarily used for clarity in complex expressions and to make the action definition consistent.

- **Flexible Action Definitions:**
  Actions can be defined as simple button presses or as complex expressions, e.g.:
  - `jump && attack[j]` (pressed jump and just-pressed attack)
  - `?j(a[j!c], b[j!c])` (any just-pressed and not-consumed)
  - `special[t{>=50}]` (pressed for or longer than 50ms)

- **APIs for Consuming Actions:**
  - `PlayerInput.consumeAction(action)` and `PlayerInput.consumeActions(...actions)` mark actions as handled, preventing them from being processed again.

- **Action State Querying:**
  The `getActionState(action)` method returns a rich object with `pressed`, `justpressed`, `consumed`, `presstime`, and `timestamp` fields, supporting advanced gameplay logic.

- **Multiple Input Sources:**
  Supports keyboard, gamepad, and on-screen controls, with seamless mapping and aggregation.

### Example Usage

```typescript
// Check if a combo is triggered
if (playerInput.checkActionTriggered('down[p] && punch[j]')) {
    // Execute special move
}

// Peek at the next queued action
const nextAction = playerInput.peekQueuedAction();
if (nextAction?.action === 'jump') {
    // Prepare to jump
}
```

## Serializing & Deserializing Game State

BMSX provides a robust, extensible system for saving and loading the entire game state, supporting features like rewind, save slots, and debugging. The system is designed to handle complex object graphs, circular references, and custom serialization logic.

### Key Features

- **Full Model Serialization:**
  The entire game model (including all spaces, objects, and state machines) can be serialized and restored, preserving the exact state of the game world.
- **Reference Tracking:**
  The serializer tracks object references, allowing for correct handling of shared objects and cycles in the object graph.
- **Binary & JSON Formats:**
  Game state can be saved as a compact binary format (for efficiency and rewind) or as JSON (for debugging and inspection).
- **Compression:**
  Binary game state snapshots are compressed using a custom LZ77+RLE compressor (`bincompressor.ts`) for efficient storage and fast rewind.
- **Custom Exclusion & Hooks:**
  Use the `@onsave`, `@onload`, `@insavegame`, and `@excludepropfromsavegame` decorators to customize what gets saved/loaded and to run custom logic during serialization/deserialization.
- **Rewind Support:**
  The engine maintains a rolling buffer of compressed game state snapshots, enabling frame-accurate rewind and replay via the debugger UI (`rewindui.ts`).
- **Savegame Class:**
  The `Savegame` class (see `gameserializer.ts`) encapsulates all persistent state, including model properties, spaces, objects, sound state, and view state.

### How It Works

#### Saving

1. **Create Savegame Object:**
   The model's `save()` method creates a `Savegame` instance, collecting all relevant properties, spaces, and objects.
   Properties and classes can be excluded from serialization using decorators.
2. **Serialize:**
   The `Serializer` class serializes the `Savegame` object, using reference tracking to handle cycles and shared objects.
   Serialization can be to JSON or to a compact binary format (`binencoder.ts`).
3. **Compress:**
   The binary snapshot is compressed using the `BinaryCompressor` (LZ77+RLE) for efficient storage and fast rewind.
4. **Store:**
   The compressed snapshot can be stored in memory (for rewind), in localStorage, or in a file (for save slots).

#### Loading

1. **Decompress:**
   The binary snapshot is decompressed using the `BinaryCompressor`.
2. **Deserialize:**
   The `Reviver` class reconstructs the object graph, restoring all objects, references, and types.
   Registered constructors and `@onload` hooks are used to re-initialize objects as needed.
3. **Restore State:**
   The model's `load()` method applies the deserialized state, re-populating spaces, objects, and properties.
   Persistent entities and event subscriptions are re-initialized.

#### Example: Saving and Loading

```typescript
// Save the current game state (compressed binary)
const snapshot: Uint8Array = $.model.save(true);

// Load a previously saved state
$.model.load(snapshot, true);
```

#### Example: Using Decorators

```typescript
@insavegame
class MyObject {
    @excludepropfromsavegame
    private tempData: any;

    @onsave
    static saveExtras(obj: MyObject) {
        return { extra: obj.computeExtra() };
    }

    @onload
    restoreExtras() {
        // Custom logic after loading
    }
}
```

#### Rewind System

- The engine maintains a buffer of compressed game state snapshots for the last N seconds (default: 60s).
- The rewind UI (`rewindui.ts`) allows the player or developer to scrub through previous frames and restore any previous state instantly.
- Snapshots are taken automatically each frame and are compressed (using a simple compression algorithm) for efficiency.

#### Debugging and Inspection

- Use `debugPrintBinarySnapshot(buf)` to pretty-print a binary snapshot for debugging.
- The ROM inspector and debugger tools can display and manipulate saved game states.
   > Kidding, that is something that Copilot hallucinated, there is no such function yet :-)

#### Advanced Features

- **Selective Serialization:**
  Exclude properties or entire classes from serialization using `@excludepropfromsavegame` and `@excludeclassfromsavegame`.
- **Custom Save/Load Logic:**
  Use `@onsave` and `@onload` to add custom logic for saving and restoring derived or computed properties.
- **Type Registration:**
  Register custom classes with `@insavegame` to ensure correct serialization and deserialization.
  > **Note**: The `@insavegame` decorator is used to mark classes that should be included in the savegame serialization process, allowing the serializer to recognize and handle them correctly. **If a class is not marked with `@insavegame` and it was not omitted from serialization using `@excludeclassfromsavegame`, you will get an error when trying to save or load the game state!**

#### References

- See [`src/bmsx/gameserializer.ts`](src/bmsx/gameserializer.ts) for the main serialization logic and decorators.
- See [`src/bmsx/binencoder.ts`](src/bmsx/binencoder.ts) and [`src/bmsx/bincompressor.ts`](src/bmsx/bincompressor.ts) for binary encoding and compression.
- See [`src/bmsx/basemodel.ts`](src/bmsx/basemodel.ts) and [`src/bmsx/game.ts`](src/bmsx/game.ts) for integration with the game model and rewind system.
- See [`src/bmsx/debugger/rewindui.ts`](src/bmsx/debugger/rewindui.ts) for the rewind debugger UI.

---
## Graphics and Rendering
BMSX features a modern, efficient graphics and rendering system designed for retro-style games, with support for both 2D canvas and advanced WebGL rendering. The system is highly extensible, supporting texture atlases, sprite batching, post-processing effects, and flexible view management.

### Key Features

- **WebGL Renderer:**
  - The `GLView` class provides a high-performance WebGL2 renderer with support for batched sprite rendering, texture atlases, and advanced effects.
  - Optional CRT-style post-processing effects (scanlines, color bleed, blur, glow, fringing, noise) can be enabled for authentic retro visuals.
  - Efficient sprite batching and atlas management allow for hundreds of objects to be drawn per frame with minimal overhead.

- **Canvas Renderer:**
  - The `BaseView` class provides a fallback 2D canvas renderer, supporting all core drawing operations and view management.

- **Texture Atlases:**
  - All game graphics are packed into one or more texture atlases for efficient GPU usage and fast rendering.
  - The atlas system supports both static and dynamic atlases, with metadata for each sprite.

- **Flexible Drawing API:**
  - Draw images, rectangles, polygons, and custom shapes using a unified API (`drawImg`, `drawRectangle`, `drawPolygon`, etc.).
  - Support for flipping, scaling, colorizing, and layering sprites.

- **View Management:**
  - The view system automatically handles resizing, fullscreen, and aspect ratio management.
  - The game can run in windowed or fullscreen mode, with automatic scaling to fit the display.
  - The view tracks viewport, canvas, and window sizes, and recalculates layout on resize or orientation change.

- **Depth Sorting:**
  - Objects in each space are sorted by their z-coordinate before drawing, ensuring correct layering and overlap.

- **Component-Based Rendering:**
  - Each `GameObject` can implement a `paint()` method for custom rendering, and can update render components before drawing.

- **Screen Overlays and UI:**
  - Built-in support for overlays (pause, resume, fading text) and on-screen gamepad.
  - Utility functions for adding/removing DOM elements to/from the game screen.

### Example: Drawing a Sprite

```typescript
$.view.drawImg({
  imgid: 'player',
  pos: { x: 100, y: 50 },
  scale: { x: 2, y: 2 },
  flip: { flip_h: false, flip_v: false },
  colorize: { r: 1, g: 1, b: 1, a: 1 },
});
```

### Example: Custom Paint Method

```typescript
class MyObject extends GameObject {
  paint() {
    $.view.drawRectangle({
      area: { start: { x: this.x, y: this.y }, end: { x: this.x + 16, y: this.y + 16 } },
      color: { r: 1, g: 0, b: 0, a: 1 },
    });
  }
}
```

### CRT and Post-Processing Effects

- Enable or disable CRT effects via properties on `GLView`:
  - `applyScanlines`, `applyColorBleed`, `applyBlur`, `applyGlow`, `applyFringing`, `applyNoise`, etc.
  - Adjust effect intensity and color via properties like `noiseIntensity`, `colorBleed`, `blurIntensity`, `glowColor`.
- Effects are applied in a post-processing pass after all sprites are drawn.

### Fullscreen and Responsive Layout

- The view system automatically handles window resizing, orientation changes, and fullscreen toggling.
- The canvas is scaled to fit the available window or device screen, maintaining aspect ratio and pixel-perfect rendering.

### Integration with Game Model

- The view draws all objects in the current space, sorted by depth, and calls their `paint()` methods if visible.
- The view is tightly integrated with the game model and input system, supporting overlays, on-screen controls, and UI.

### References

- See [`src/bmsx/glview.ts`](src/bmsx/glview.ts) for the WebGL renderer and CRT effects.
- See [`src/bmsx/view.ts`](src/bmsx/view.ts) for the base view, drawing API, and layout management.
- See [`src/bmsx/game.ts`](src/bmsx/game.ts) and [`src/bmsx/basemodel.ts`](src/bmsx/basemodel.ts) for integration with the game model and object system.

### Sprites and the `drawImg` API

BMSX uses a flexible sprite system for rendering game objects. Sprites are described by the `Sprite` and `SpriteObject` classes, which encapsulate image, position, scale, flipping, color, and more. The main rendering method for sprites is `drawImg`, which is used by both the engine and user code.

#### Sprite System
- **SpriteObject**: An abstract base class for game objects that are rendered as sprites. It manages flipping, colorizing, and image assignment, and automatically updates hitboxes and polygons based on the current image and flip state.
- **Sprite**: Encapsulates all rendering options for a sprite, including position (`x`, `y`, `z`), scale, flip, color, and image ID. The `paint()` method draws the sprite at its current position, while `paint_offset(offset)` draws it at an offset.
- **Integration**: Most game objects that appear on screen inherit from `SpriteObject` and use a `Sprite` for their visual representation.
- **Hitboxes and Polygons**: Sprites automatically update their hitboxes and polygons based on the current image and flip state, allowing for accurate collision detection and interaction.
   > The sprite will automatically update its image, flip state, and color when the `Sprite` properties change, ensuring that the visual representation is always in sync with the game logic.

#### `drawImg` Options
> **Note**: The `Sprite` will automatically draw itself when its `paint()` method is called, which is typically done by the view system during the rendering loop. Therefore, you do not need to call `drawImg` directly for sprites; instead, the game engine handles this for you (via the loop in the `BaseModel`).

The `drawImg` method (see `GLView` and `BaseView`) is the core API for drawing images and sprites. It accepts a `DrawImgOptions` object with the following properties:

- `imgid`: **(string, required)** – The image asset ID to draw (must exist in the texture atlas).
- `pos`: **({ x, y, z? })** – The position to draw the image. `z` is optional and used for depth sorting.
- `scale`: **({ x, y })** – The scale factor for the image (default: `{ x: 1, y: 1 }`).
- `flip`: **({ flip_h, flip_v })** – Whether to flip the image horizontally or vertically (default: both false).
- `colorize`: **({ r, g, b, a })** – RGBA color multiplier for tinting the sprite (default: white, fully opaque).

Example:
```typescript
$.view.drawImg({
  imgid: 'enemy',
  pos: { x: 200, y: 120, z: 5 },
  scale: { x: 1.5, y: 1.5 },
  flip: { flip_h: true, flip_v: false },
  colorize: { r: 1, g: 0.5, b: 0.5, a: 1 },
});
```

- All options are deeply cloned internally to avoid side effects.
- If the image ID is not found, an error is thrown.
- The `z` value is used for depth sorting in the WebGL renderer.

#### Sprite Rendering Flow
- Sprites are queued for drawing each frame via `drawImg`.
- The renderer sorts sprites by `z` (depth) and batches them for efficient GPU rendering.
- Flipping, scaling, and colorizing are handled in the shader using the options provided.
- Sprite hitboxes and polygons are automatically updated when the image or flip state changes.

#### See Also
- [`src/bmsx/sprite.ts`](src/bmsx/sprite.ts) for the sprite and sprite object classes.
- [`src/bmsx/glview.ts`](src/bmsx/glview.ts) for the `drawImg` implementation and batching.
- [`src/bmsx/view.ts`](src/bmsx/view.ts) for the drawing API and 2D fallback.

---
