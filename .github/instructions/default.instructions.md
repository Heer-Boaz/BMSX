---
applyTo: '**/*.ts'
---
Provide project context and coding guidelines that AI should follow when generating code, answering questions, or reviewing changes.

0. Building the game engine requires:
   ```bash
   npx tsc --build ./src/bmsx
   ```
   Building the testrom requires:
   ```bash
   npx tsx scripts/rompacker/rompacker.ts --nodeploy -romname testrom --force
   ```
   Building any other rompack (game) requires:
   ```
   npx tsx scripts/rompacker/rompacker.ts --nodeploy -romname <romname> --force
   ```

1. **Project Structure**: Understand the overall structure of the project, including key directories and files.
2. **File Naming Conventions**: Follow consistent naming conventions for files and classes. Use PascalCase for class names and lowercase for file names.
3. **Best-practices more important than backwards compatibility**: Feel free to make breaking changes if necessary, but document them clearly.
4. **What would Unreal Engine or Unity do?**: When coding, consider how similar problems are solved in game development environments like Unreal Engine or Unity.
5. **Coding Standards**:
  - Follow established coding standards and best practices for TypeScript development.
  - Assume that I am the only developer. There are no other users or developers of the game engine.
  - Try to move boilerplate code into reusable functions or classes of the core game engine codefiles.
  - Don't introduce `as any` casts or `<any>` type assertions.
  - Don't introduce unused variables.
  - Don't introduce assertions like `typeof foo === 'function'`.
  - Don't use `require` in non-script code (e.g. `rompacker-core.ts` and `rominspector.ts` can have `require`, but core engine files or game source files cannot).
  - Avoid direct references to GameObjects or Components. Rather, use the `BaseModel`-class (e.g. `$.getGameObject` or `$.getFromCurrentSpace`, `$.get`).
  - Ensure that registry persistent objects are not serialized.
  - Use the annotations provided in the codebase to maintain consistency, these include:
    - `@attach_components`: Indicates that the decorated class should have `Component`s automatically attached.
    - `@update_tagged_components`: Indicates that the decorated function should update all its components that are subscribed to one or more given tags.
    - `@build_fsm`: Indicates that the decorated function should build a finite state machine (FSM) for the associated class. Note that, when using this decorator, the instances of the class will be automatically assigned the FSM, as long as no arguments are passed to the decorator.
    - `@assign_fsm`: Indicates that the decorated class should be assigned an existing FSM with the given ID.
    - `@onsave`: Indicates that the decorated function should be called when the object is saved.
    - `@onload`: Indicates that the decorated function should be called when the object is loaded.
    - `@insavegame`: Indicates that the decorated class is included in the serialized game state.
    - `@excludefromsavegame`: Indicates that the decorated class is excluded from the serialized game state.
    - `@excludepropfromsavegame`: Indicates that the decorated class-property is excluded from the serialized game state.
  - Don't introduce any game logic in `game.ts`, instead, place it in appropriate systems or components. High-level game logic should be invoked from `BaseModel.run`.
  - Ensure that any new render logic is implemented in the rendering system, and not directly in the game logic files.
  - Ensure that any debugging UI or features are implemented in the debugging system (e.g. `bmsxdebugger.ts`).
  - When introducing new features, consider how they can be serialized and deserialized as part of the game state. Also consider that many objects/properties should be *excluded* from serialization.
  - Don't unnecessarily override methods.
  - Don't introduce code that is based on assumptions about the game state or the behavior of other systems. Always use the provided APIs and abstractions to interact with the game world.
6. **Performance**:
  - Consider the performance implications of generated code, especially in critical areas of the application, noting that the engine is supposed to perform well on lower-end hardware such as iPhone 10/11/12.
  - Use scratch buffers and object pooling to minimize memory allocations and improve performance.
  - Use in-place algorithms and data structures to reduce memory overhead and improve cache locality.
  - Prevent unnecessary allocations by reusing existing objects and buffers.