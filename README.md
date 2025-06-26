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
