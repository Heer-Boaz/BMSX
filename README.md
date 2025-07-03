# BMSX

BMSX is a lightweight TypeScript game engine and toolchain used to build small retro-style browser games. Instead of loading assets directly from the web, each game is packaged into a single `.rom` file that contains the engine, game code and resources.

---

# Table of Contents
- [Features](#features)
- [Project Layout](#project-layout)
- [game.html](#gamehtml)
- [Multi-Game Support](#multi-game-support)
- [Build Pipeline Overview](#build-pipeline-overview)
- [Example: Adding a New Game](#example-adding-a-new-game)
- [Best Practices](#best-practices)
- [References](#references)
- [Building](#building)
- [Running](#running)
- [ROM Pack Structure](#rom-pack-structure)
- [Building & Resources](#building--resources)
- [Game Objects and Spaces](#game-objects-and-spaces)
- [Component System](#component-system)
- [Graphics and Rendering](#graphics-and-rendering)
- [Sound and Music](#sound-and-music)
- [Registry](#registry)
- [State Machine](#state-machine)
- [Player Input](#player-input)
- [Serializing & Deserializing Game State](#serializing--deserializing-game-state)
- [Event Registry and Emitting](#event-registry-and-emitting)

---

# Features

- **WebGL renderer** with texture atlas support and optional CRT-style effects.
- **Web Audio** integration via the `SoundMaster` module.
- **Input handling** for keyboard, gamepad and on-screen touch controls.
- **Finite State Machine** and **Behaviour Tree** helpers for game logic.
- **Save state** support and built-in debugging tools (state machine and behaviour tree visualizers, rewind UI).

# Project Layout

The BMSX project is organized to support modular engine development, multiple games per repository, and a simple build pipeline. Here’s a detailed breakdown of the directory structure and its purpose:

- **`src/bmsx/`**
  The core engine source code. This folder contains all reusable engine modules, including:
  - **Rendering:** `glview.ts`, `view.ts` (WebGL/canvas rendering, drawing API, CRT effects)
  - **Game Logic:** `game.ts`, `basemodel.ts`, `gameobject.ts`, `sprite.ts` (game loop, object model, spaces, sprites)
  - **Input:** `input.ts` (keyboard, gamepad, on-screen controls, multi-player support)
  - **Audio:** `soundmaster.ts` (music/SFX playback, integration with save/load)
  - **State Machines & AI:** `fsm.ts`, `fsmdecorators.ts`, `fsmtypes.ts`, `behaviortree.ts` (FSM and behavior tree helpers)
  - **Serialization:** `gameserializer.ts`, `binencoder.ts`, `bincompressor.ts` (save/load, rewind, compression)
  - **Components:** `component.ts`, `collisioncomponents.ts` (modular logic, collision, movement)
  - **Events:** `eventemitter.ts`, `registry.ts` (event system, global registry)
  - **Utilities:** Math, color, vector, and helper modules

- **`src/<game>/`**
  Each game has its own folder under `src/`.
  A game folder typically contains:
  - **`bootloader.ts`**: The entry point for the game, responsible for initializing game-specific logic and resources.
  - **`res/`**: All game-specific resources (images, audio, data files). Subfolders may include:
    - `img/` – Sprites and textures
    - `snd/` – Sound effects
    - `mus/` – Music tracks
    - `manifest/` – Resource manifests
    - `_ignore/` – Source art or unused assets
  - **`resourceids.ts`**: Enumerations for all image and audio IDs used in the game.
  - **Game logic files**: Game-specific objects, spaces, scenes, and scripts.

- **`scripts/`**
  Build and utility scripts, all written in TypeScript and run via `tsx`:
  - **`rompacker.ts`**: The main build script. Packages the engine, game code, and resources into a `.rom` file and generates HTML loaders.
  - **`bootrom.ts`**: The bootloader that runs in the browser and loads the ROM.
  - **`atlasbuilder.ts`**: Builds texture atlases from individual images.
  - **`boundingbox_extractor.ts`**: Extracts hitboxes from sprite data.
  - **`rominspector.ts`**: Tool for inspecting and debugging ROM files.
  - **Other scripts**: Utilities for asset processing, debugging, and development.

- **`dist/`**
  Output directory for built games and HTML loaders:
  - `<game>.rom` – The packaged ROM file for each game.
  - `game.html`, `game_debug.html` – HTML loaders for running the game in a browser.
  - `bootrom.js` – The inlined bootloader script.
  - Any additional generated assets (e.g., images, CSS).

- **`rom/`**
  Optional: May contain additional ROM-related assets, such as PNG labels, icons, or manifest files.

- **`node_modules/`**
  Standard npm dependencies.

- **`.vscode/`**
  VS Code workspace settings, tasks, and launch configurations.
  - `tasks.json` – Defines build and utility tasks (e.g., "build the game").
  - `launch.json` – Debugging configurations.

- **`package.json`**
  Project metadata, dependencies, and npm scripts for building, packing, and watching the project.

- **`tsconfig.json`**
  TypeScript configuration for the root project and references to per-folder configs.

- **Other files and folders:**
  - `README.md` – This documentation.
  - `LICENSE`, `.gitignore`, etc.

---

## game.html

The `game.html` file is the main entry point for running the game in a web browser. It is generated by the build process and includes the necessary scripts and assets to load and run the game. This file is designed for both desktop and mobile browsers, with support for touch controls, fullscreen, and progressive web app (PWA) features.

### Structure

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Game Title</title>
    <link rel="manifest" href="manifest.webmanifest">
    <link rel="apple-touch-icon" href="bmsx_icon.png">
    <link rel="icon" type="image/png" href="bmsx_icon.png">
    <link rel="shortcut icon" type="image/x-icon" href="bmsx_icon.png">
    <link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap" rel="stylesheet">
    <script id="bootrom">//#romjs</script>
    <script id="pacojs" distributedby="http://nodeca.github.io/pako/">//#zipjs</script>
    <style>
        /*#css*/
    </style>
</head>
<body>
    <div>
        <img id="msx" class="hidden" src="#bmsxurl" alt="MSX" hidden>
        <div id="hidor"></div>
        <div id="loading" class="coloring">Loading...</div>
        <div id="extra-message" class="coloring" hidden></div>
        <div id="d-pad-controls" hidden> ... </div>
        <div id="button-controls" hidden> ... </div>
        <div id="gameContainer">
            <canvas id="gamescreen" hidden></canvas>
        </div>
    </div>
    <script id="bload-script">
        //#debug
        window.onload = function () { ... }
    </script>
</body>
</html>
```

### Key Elements
- `<title>`: The game’s title, set dynamically during the build process.
- `<link rel="manifest">`: Enables PWA features and home screen installation.
- `<link rel="icon">, <link rel="apple-touch-icon">`: Favicon and mobile icon support.
- Google Fonts: Uses a retro-style pixel font for authentic visuals.
- `<script id="bootrom">`: Inlined bootloader script that loads and starts the game from the .rom file.
- `<script id="pacojs">`: Inlined Pako library for decompressing the ROM pack.
- `<style>`: Inlined and minified CSS for layout, UI, and touch controls.
- `<img id="msx">`: Boot animation image, shown during loading.
- `<div id="loading">`: Loading message and progress indicator.
- `<div id="extra-message">`: Additional messages (e.g., PWA install prompt).
- `<div id="d-pad-controls">, <div id="button-controls">`: On-screen gamepad and action buttons for touch devices, fully styled and interactive.
- `<canvas id="gamescreen">`: The main rendering surface for the game.
- `<script id="bload-script">`: Bootstraps the game, loads the ROM, and starts execution.

### Features and Behavior
- Bootloader Logic:
The bootloader (bootrom.js) is responsible for:
  - Fetching and decompressing the .rom file (using Pako).
  - Parsing and loading all resources (images, audio, code).
  - Injecting the bundled game code and starting the game.
  - Handling errors and displaying messages if loading fails.
  - Managing the boot animation and transition to the game screen.
- Touch and On-Screen Controls:
  - The on-screen D-pad and action buttons are shown automatically on touch devices.
  - SVG-based controls provide responsive, visually appealing input for mobile users.
  - The controls are hidden on desktop unless triggered by touch events.
- Responsive Layout:
  - The canvas and UI elements automatically scale to fit the window or device screen.
  - The layout adapts to orientation changes and fullscreen mode.
  - Progressive Web App (PWA) Support:
- Includes a manifest for home screen installation.
  - Provides mobile icons and splash screens.
  - Shows a prompt to add to home screen if not running in standalone mode.
- Loading and Boot Animation:
  - Displays a loading message and boot animation while resources are being loaded and decompressed.
  - Once loading is complete, the boot animation fades out and the game canvas is shown.
- Debug Mode:
  - The build process generates both game.html (normal) and game_debug.html (with debug features enabled).
  - Debug mode can be toggled via build options and includes extra logging and developer tools.
- Error Handling:
  - If loading fails, an error message is displayed in the loading area.
  - The bootloader ensures that errors do not leave the UI in a broken state.

### Customization
- Template Replacement:
During the build process (rompacker.ts), placeholders in gamebase.html and gamebase.css are replaced with actual values (title, icons, inlined scripts, CSS, etc.).
- Adding UI Elements:
You can customize the HTML template to add overlays, modals, or additional UI as needed for your game.
- Styling:
All UI and controls are styled via gamebase.css, which is minified and inlined during the build.

### References
- scripts/rompacker.ts: Build logic for generating game.html and injecting assets.
- gamebase.html: The HTML template used for all games.
- gamebase.css: The CSS template for layout and UI.
- scripts/bootrom.ts: The bootloader logic injected into the HTML.

---

## Multi-Game Support

BMSX is designed to support multiple games in a single repository. Each game lives in its own subfolder under `src/`, with its own resources and bootloader. The build system (`rompacker.ts`) can package any game by specifying its folder name (e.g., `-romname testrom`).

---

## Build Pipeline Overview

1. **Resource Packing:**
   Images, audio, and other resources are packed into a texture atlas and resource bundle.
2. **Game Packaging:**
   The engine, game code, and resources are bundled into a `.rom` file.
3. **HTML Loader Generation:**
   `game.html` and `game_debug.html` are generated to load and run the ROM in a browser.
4. **Output:**
   All build artifacts are placed in `dist/`.

---

## Example: Adding a New Game

1. Create a new folder under `src/` (e.g., `src/mygame`).
2. Add a `bootloader.ts` and a `res/` folder with your assets.
3. Add a `resourceids.ts` for your image and audio IDs.
4. Run the build script:
   ```sh
   npx tsx scripts/rompacker.ts -romname mygame
   ```
5. Open `dist/game.html` to play your new game.

---

## Best Practices

- Keep engine code in `src/bmsx/` and game-specific code in `src/<game>/`.
- Use the provided scripts for building and inspecting ROMs.
- Organize resources by type and use `resourceids.ts` for easy referencing.
- Use VS Code tasks for common build operations.

---

## References

- `src/bmsx/` – Engine modules
- `src/<game>/` – Game folders
- `scripts/` – Build and utility scripts
- `dist/` – Build output
- `package.json` – Scripts and dependencies
- `tsconfig.json` – TypeScript configuration

> **NOTE:** The TypeScript project is not a standalone game, but rather a collection of modules that are used by the rompacker script to create a final game package. Multiple games can be built from the same TypeScript project, as long as they have their own bootloader.ts and res/ folder.

---

# Building

> **NOTE**: You can run `npm run build:game` to build the test game!

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
> **WARNING**: Any other attempt at building the TypeScript project (e.g. `tsc`) will **FAIL**! Always run the rompacker script to generate the `.rom` file and HTML loader.

# Running

Open `dist/game.html` in a modern browser. The inlined boot loader (`bootrom.js`) fetches the `.rom` file, unpacks it using `pako` and executes the game code.

# ROM Pack Structure

ROM packs are created by `finalizeRompack` in `rompacker.ts`. All resources are concatenated and zipped together with metadata and a small footer containing offsets. A PNG label can optionally be prepended to allow the ROM file to double as an image. Use `scripts/rominspector.ts` to inspect an existing ROM:

```bash
npx tsx scripts/rominspector.ts <file.rom>
```

## Building & Resources

The BMSX build process is managed by the `rompacker.ts` script, which automates the packaging of all game code and resources into a single `.rom` file.

### Resource Crawling and Filtering

- **Resource Directory Traversal:**
  During the build, `rompacker.ts` recursively crawls through the `res/` folder of your game (e.g., `src/mygame/res/`) to discover all assets (images, audio, manifests, etc.).
- **Ignoring `_ignore` Folders:**
  Any directory named `_ignore` (at any depth) is automatically skipped. This allows you to keep source art, unused assets, or work-in-progress files in your project without including them in the final build.
- **File Filtering:**
  By default, the packer ignores files with extensions like `.rom`, `.js`, `.ts`, `.map`, and `.tsbuildinfo`. You can also filter by specific extensions (e.g., only `.png` or `.wav`).

### Resource File Annotations

The build system supports special annotations in filenames to control how assets are processed and packed:

- **Audio Annotations:**
  - `@m` — Marks the file as music (otherwise, it's treated as SFX).
  - `@p=<n>` — Sets the playback priority (e.g., `theme@p=10.wav`).
  - `@l=<n>` — Sets a loop point in seconds (e.g., `bgm@l=12.wav`).

- **Image Annotations:**
  - `@cc` — Marks the image as having a concave collision polygon (for advanced collision detection).
  - `@cx` — Marks the image as having a convex collision polygon.
  - `@atlas=<n>` — Assigns the image to a specific texture atlas (e.g., `enemy@atlas=2.png`). If not specified, atlas 0 is used by default.

- **How Annotations Work:**
  The packer parses these annotations from the filename (before the extension), strips them from the resource name, and uses them to set metadata for each asset. For example, `enemy@cc@atlas=2.png` will be included as an image named `enemy`, with concave collision and placed in atlas 2.

### Resource Metadata and Validation

- **Metadata Extraction:**
  For each resource, the packer extracts metadata such as collision type, atlas assignment, audio type, priority, and loop points. This metadata is included in the ROM and used at runtime by the engine.
- **Duplicate Checking:**
  The build process checks for duplicate resource IDs and names within each type (image, audio) and throws an error if any are found, ensuring resource integrity.

### Texture Atlas Generation

- **Automatic Atlas Packing:**
  Images are automatically packed into one or more texture atlases for efficient GPU usage. The `@atlas=<n>` annotation allows you to control which atlas an image is placed in.
- **Atlas Output:**
  Atlases are generated as PNG files and included in the ROM. Metadata for each sprite's location within the atlas is also generated.

### Resource List and Enums

- **Resource Enum Generation:**
  The packer generates a `resourceids.ts` file in your game folder, containing enums for all image and audio IDs. This allows you to reference resources by name in your code, with full type safety.

### Example: Annotated Resource Filenames
- `src/mygame/res/plaatjes/player@cc.png` // Concave collision polygon, placed in atlas 0 (default)
- `src/mygame/res/img/enemy@cx@atlas=1.png` // Convex collision, placed in atlas 1 (default atlas=0)
- `src/mygame/res/snd/bgm@l=30@m.wav` // Music, loop starts at 30s
- `src/mygame/res/audio/sfx_jump@p=5.wav` // SFX (default), priority 5
- `src/mygame/res/_ignore/old_sprite.png` // Ignored by the packer due to `_ignore` directory

### Build Process Overview

1. **Crawl the `res/` folder**, skipping `_ignore` directories and filtering files.
2. **Parse annotations** from filenames to extract metadata.
3. **Generate texture atlases** and assign images based on `@atlas` annotations.
4. **Build resource enums** for use in game code.
5. **Package all resources, code, and metadata** into a single `.rom` file.

### References

- See [`scripts/rompacker.ts`](scripts/rompacker.ts) for the full build logic and annotation parsing.
- See [`src/<game>/resourceids.ts`](src/<game>/resourceids.ts) for the generated resource enums.

---

# Game Objects and Spaces

BMSX organizes all interactive entities as `GameObject` instances, which are managed within one or more `Space` objects. This system enables flexible world partitioning, scene management, and efficient object lookup, while supporting advanced features like serialization, event handling, and modular composition.

## Game Objects

- **GameObject Class:**
  - The core entity type in BMSX, representing anything with a position, size, state, and behavior.
  - Implements position (`x`, `y`, `z`), size, hitbox, hit polygons, direction, and more.
  - Supports attaching components for modular behavior (see Component System).
  - Provides event hooks for collision, leaving screen, spawning, disposal, and more.
  - Can be extended for custom logic, AI, or rendering (e.g., `SpriteObject`).

- **Properties and Methods:**
  - `id`: Unique identifier for each object.
  - `pos`, `size`, `direction`: Spatial properties for movement and collision.
  - `components`: Map of attached components for modular logic.
  - `addComponent`, `removeComponent`, `getComponent`: Manage components at runtime.
  - `onspawn`, `dispose`, `paint`, `collide`, `oncollide`, `onWallcollide`, `onLeaveScreen`, etc.: Lifecycle and event hooks.
  - `collides`, `detect_object_collision`, `overlaps_point`: Collision detection utilities.
  - `updateComponentsWithTag(tag, ...)`: Update all components with a given tag (used for preprocessing/postprocessing logic).

- **SpriteObject:**
  - Extends `GameObject` for entities with visual representation.
  - Manages image ID, flipping, colorizing, and hitbox/polygon updates based on sprite state.
  - Integrates with the rendering system for efficient drawing.

## Spaces

- **Space Class:**
  - Represents a collection of game objects (e.g., a level, room, or scene).
  - Each space has a unique `id` and manages its own set of objects.
  - Provides methods to add (`spawn`), remove (`exile`), and clear objects.
  - Supports sorting objects by depth (`z`) for correct rendering order.
  - Spaces can be dynamically created, removed, or switched at runtime.

- **BaseModel and World Management:**
  - The `BaseModel` class manages all spaces and provides APIs to get, move, and query objects across spaces.
  - Methods like `getGameObject`, `getFromCurrentSpace`, `move_obj_to_space`, and `setSpace` allow flexible world and scene management.
  - The model tracks which objects are in which spaces, enabling efficient lookups and serialization.

```typescript
// Create a new game object and add it to a space
const player = new Player('player1');
model.currentSpace.spawn(player, { x: 100, y: 50 });

// Move an object to another space
model.move_obj_to_space('player1', 'level2');

// Remove an object from the current space
model.currentSpace.exile(player);

// Get an object by ID (from any space)
const enemy = model.getGameObject('enemy42');

// Attach a component for collision
player.addComponent(new TileCollisionComponent(player.id));

// Handle collision event
player.oncollide = (src) => { /* custom logic */ };
```

## Collision and Movement

BMSX provides a simple and extensible system for collision detection and movement, supporting both simple bounding box (AABB) and advanced polygon-based collision. The system is designed for flexibility, allowing you to choose the right level of precision and performance for your game objects.

### Position and Movement

- **Position Properties:**
  - Every `GameObject` has a 3D position (`x`, `y`, `z`) and size (`sx`, `sy`, `sz`), accessible via properties or as a `vec3`.
  - The `z` coordinate is used for depth sorting (rendering order), while `x` and `y` are for spatial placement.

- **Setting Position:**
  - Use `gameobject.x = value` (or `.y`, `.z`) to set position. This will automatically trigger any attached components (e.g., for collision, movement constraints) via the `@update_tagged_components('position_update_axis')` decorator.
  - Use `gameobject.setXNoSweep(value)` (or `setYNoSweep`, `setZNoSweep`) to set position **without** triggering component updates or collision checks. This is useful for teleporting, spawning, or resetting objects without side effects.

- **Movement Methods:**
  - `moveXNoSweep(dx)`, `moveYNoSweep(dy)`, `moveZNoSweep(dz)` increment position without triggering collision or component logic.
  - For normal movement (with collision and component updates), set `.x`, `.y`, or `.z` directly.

### Collision Detection

- **AABB (Axis-Aligned Bounding Box) Collision:**
  - By default, collision is checked using the object's `hitbox`, which is an area defined by its position and size (or a custom `hitarea`).
  - Use `gameobject.collides(other)` to check collision with another `GameObject` or an `Area`.
  - Use `gameobject.detect_object_collision(other)` for a fast AABB check.
  - The static method `GameObject.detect_aabb_collision_areas(a1, a2)` checks collision between two areas.

- **Polygon-Based Collision:**
  - For more precise collision, objects can define a `hitpolygon` (concave or convex), typically extracted from the sprite image using the bounding box extractor during the build process.
  - If either object in a collision check has a polygon, the engine will use polygon-polygon or polygon-box intersection tests.
  - The engine supports both concave and convex polygons, and automatically handles flipped variants for sprite flipping.
  - Use `gameobject.hasHitPolygon` to check if an object has a polygonal hitbox.

- **Collision Centroid:**
  - Use `gameobject.getCollisionCentroid(other)` to get the centroid of the intersection area between two objects (useful for effects, hit reactions, etc.).

- **Point Overlap:**
  - Use `gameobject.overlaps_point(p)` to check if a 2D point overlaps the object's hitbox (returns the offset if so).

### Hitboxes and Polygons

- **Hitbox (`hitbox`):**
  - By default, the hitbox is derived from the object's position and size, or from a custom `hitarea`.
  - The bounding box extractor (`boundingbox_extractor.ts`) can generate tight bounding boxes from sprite images at build time.

- **Hitpolygon (`hitpolygon`):**
  - Polygons are extracted from sprite images using border tracing and hull extraction algorithms.
  - The build system generates flipped variants for all four flip states (original, horizontal, vertical, both).
  - At runtime, the correct polygon is selected based on the sprite's flip state.

### Sprite Integration

- **SpriteObject:**
  - Extends `GameObject` and manages image ID, flipping, colorizing, and hitbox/polygon updates based on sprite state.
  - When the sprite's image or flip state changes, hitboxes and polygons are updated automatically to match the new orientation.

- **Automatic Hitbox/Polygon Updates:**
  - When you set `sprite.imgid` or change `flip_h`/`flip_v`, the engine updates the hitarea and hitpolygon to match the new image and orientation.

### Component-Based Movement and Collision

- **Movement and Collision Components:**
  - Use built-in components like `ScreenBoundaryComponent`, `TileCollisionComponent`, and `ProhibitLeavingScreenComponent` for modular movement and collision logic.
  - Components can be attached to any `GameObject` and participate in preprocessing/postprocessing update phases.

- **Component Update Flow:**
  - When you set `.x`, `.y`, or `.z`, the engine automatically updates all components tagged for `'position_update_axis'`.
  - You can also manually update components with `updateComponentsWithTag(tag, ...args)`.

#### Example Usage

```typescript
// Move an object with collision/component updates
player.x += 5;

// Teleport an object without triggering collision/components
player.setXNoSweep(100);

// Check collision with another object
if (player.collides(enemy)) {
    // Handle collision
}

// Attach a collision component
player.addComponent(new TileCollisionComponent(player.id));

// Check if a point overlaps the player
if (player.overlaps_point({ x: mouseX, y: mouseY })) {
    // Handle click or selection
}
```

### Advanced: Custom Hitboxes and Polygons
- You can override the default hitbox or polygon by setting hitarea or hitpolygon directly.
- For custom shapes, generate polygons at build time using boundingbox_extractor.ts or define them manually.

### References
- src/bmsx/gameobject.ts: Game object base class, collision, and movement logic.
- src/bmsx/sprite.ts: Sprite object integration, hitbox/polygon updates.
- scripts/boundingbox_extractor.ts: Bounding box and polygon extraction from images.
- src/bmsx/rompack.ts: Data structures for areas, polygons, and asset metadata.

## Serialization and Events

- **Save/Load:**
  - Both game objects and spaces are serializable, supporting full save/load and rewind.
  - Only relevant properties are saved (transient fields like `objects` can be excluded).
  - On load, objects and spaces are restored, and persistent event subscriptions are re-initialized.

- **Event Handling:**
  - Game objects can subscribe to and emit events (e.g., collisions, leaving screen, custom events).
  - Spaces and the model can trigger events on all contained objects as needed.

## Example Usage

## Best Practices

- Use spaces to partition your world into logical areas (levels, rooms, scenes) for efficient management.
- Extend `GameObject` or `SpriteObject` for custom entities, and use components for modular behavior.
- Use the model's APIs to move, spawn, or remove objects as gameplay requires.
- Leverage event hooks and the registry for decoupled, flexible logic.
- Ensure each object has a unique `id` and is properly registered for serialization and event handling.

## References

- See [`src/bmsx/gameobject.ts`](src/bmsx/gameobject.ts) for the `GameObject` and `SpriteObject` classes.
- See [`src/bmsx/basemodel.ts`](src/bmsx/basemodel.ts) for the model, space management, and world APIs.
- See [`src/bmsx/sprite.ts`](src/bmsx/sprite.ts) for sprite rendering and hitbox logic.
- See [`src/bmsx/glview.ts`](src/bmsx/glview.ts) for rendering integration.
- See [`src/bmsx/game.ts`](src/bmsx/game.ts) for overall game loop and object management.

---

# Component System

The BMSX Component System provides a flexible, extensible way to add modular behavior to game objects. Components encapsulate logic such as movement, collision, AI, and more, and can be attached, removed, or updated independently of the main object class. This enables composition and code reuse.

## Key Features

- **Component Architecture:**
  - All components extend the abstract `Component` class, which provides lifecycle hooks, event subscription, and integration with the registry and serialization.
  - Components are attached to game objects (which implement `ComponentContainer`) and can be added or removed at runtime.
  - Each component has a unique `id` (derived from its parent and class name) and a reference to its parent object.

- **Preprocessing and Postprocessing Tags:**
  - Components can be tagged for specific update phases using the `componenttags_preprocessing` and `componenttags_postprocessing` decorators.
  - Preprocessing tags allow components to run logic before the main update (e.g., storing old positions).
  - Postprocessing tags allow components to run logic after the main update (e.g., collision checks, boundary enforcement).
  - The `update_tagged_components` decorator on game object methods ensures that all components with the relevant tag are updated at the correct time.

- **Auto-Attach and Decorators:**
  - Use the `attach_components` decorator to automatically add components to all instances of a game object class.
  - Components can also be added manually at runtime using `addComponent`.
  - Decorators make it easy to compose objects with common behaviors (e.g., collision, movement, AI) without inheritance.

- **Component API:**
  - `addComponent(component)` – Attach a component to a game object.
  - `removeComponent(constructor)` – Remove a component by its class.
  - `getComponent(constructor)` – Retrieve a component by its class.
  - `updateComponentsWithTag(tag, ...args)` – Update all components with a given tag.

- **Integration with Serialization and Registry:**
  - Components are registered in the global registry and are serializable by default (using the `@insavegame` decorator).
  - On deserialization, components are re-registered and event subscriptions are restored.
  - Components can be marked as persistent if needed.

- **Collision and Movement Example:**
  - The engine provides built-in components for collision detection and screen boundaries (see `collisioncomponents.ts`).
  - Example: `ScreenBoundaryComponent`, `TileCollisionComponent`, and `ProhibitLeavingScreenComponent` handle movement, collision, and boundary enforcement using preprocessing/postprocessing tags and event handlers.

## Example Usage

```typescript
// Define a custom component
@insavegame
class MyComponent extends Component {
  postprocessingUpdate({ params, returnvalue }) {
    // Custom logic after main update
  }
}

// Attach components to a game object
const obj = new GameObject('player');
obj.addComponent(new ScreenBoundaryComponent(obj.id));
obj.addComponent(new MyComponent(obj.id));

// Use auto-attach decorator
@attach_components(ScreenBoundaryComponent, TileCollisionComponent)
class Enemy extends GameObject { ... }

// Update tagged components in your object's update method
@update_tagged_components('position_update_axis')
protected setPosX(x: number) { ... }
```

## Best Practices

- Use components to encapsulate reusable logic (movement, collision, AI, etc.) and avoid deep inheritance hierarchies.
- Tag components for preprocessing/postprocessing to control update order and dependencies.
- Use the registry and serialization decorators to ensure components are tracked and saved correctly.
- Compose game objects with multiple components for rich, modular behavior.

## References

- See [`src/bmsx/component.ts`](src/bmsx/component.ts) for the component base class, decorators, and tagging system.
- See [`src/bmsx/gameobject.ts`](src/bmsx/gameobject.ts) for how components are managed by game objects.
- See [`src/bmsx/collisioncomponents.ts`](src/bmsx/collisioncomponents.ts) for built-in movement and collision components.

---

# Graphics and Rendering
BMSX features a simple, modern, efficient graphics and rendering system designed for retro-style games, with support for both 2D canvas and advanced WebGL rendering. The system supports texture atlases, sprite batching, post-processing effects, and basic view management.

## Key Features

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

## Example: Drawing a Sprite

```typescript
$.view.drawImg({
  imgid: 'player',
  pos: { x: 100, y: 50 },
  scale: { x: 2, y: 2 },
  flip: { flip_h: false, flip_v: false },
  colorize: { r: 1, g: 1, b: 1, a: 1 },
});
```

## Example: Custom Paint Method

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

## CRT and Post-Processing Effects

- Enable or disable CRT effects via properties on `GLView`:
  - `applyScanlines`, `applyColorBleed`, `applyBlur`, `applyGlow`, `applyFringing`, `applyNoise`, etc.
  - Adjust effect intensity and color via properties like `noiseIntensity`, `colorBleed`, `blurIntensity`, `glowColor`.
- Effects are applied in a post-processing pass after all sprites are drawn.

## Fullscreen and Responsive Layout

- The view system automatically handles window resizing, orientation changes, and fullscreen toggling.
- The canvas is scaled to fit the available window or device screen, maintaining aspect ratio and pixel-perfect rendering.

## Integration with Game Model

- The view draws all objects in the current space, sorted by depth, and calls their `paint()` methods if visible.
- The view is tightly integrated with the game model and input system, supporting overlays, on-screen controls, and UI.

## References

- See [`src/bmsx/glview.ts`](src/bmsx/glview.ts) for the WebGL renderer and CRT effects.
- See [`src/bmsx/view.ts`](src/bmsx/view.ts) for the base view, drawing API, and layout management.
- See [`src/bmsx/game.ts`](src/bmsx/game.ts) and [`src/bmsx/basemodel.ts`](src/bmsx/basemodel.ts) for integration with the game model and object system.

## Sprites and the `drawImg` API

BMSX uses a simple sprite system for rendering game objects. Sprites are described by the `Sprite` and `SpriteObject` classes, which encapsulate image, position, scale, flipping, color, and more. The main rendering method for sprites is `drawImg`, which is used by both the engine and user code.

### Sprite System
- **SpriteObject**: An abstract base class for game objects that are rendered as sprites. It manages flipping, colorizing, and image assignment, and automatically updates hitboxes and polygons based on the current image and flip state.
- **Sprite**: Encapsulates all rendering options for a sprite, including position (`x`, `y`, `z`), scale, flip, color, and image ID. The `paint()` method draws the sprite at its current position, while `paint_offset(offset)` draws it at an offset.
- **Integration**: Most game objects that appear on screen inherit from `SpriteObject` and use a `Sprite` for their visual representation.
- **Hitboxes and Polygons**: Sprites automatically update their hitboxes and polygons based on the current image and flip state, allowing for accurate collision detection and interaction.
   > The sprite will automatically update its image, flip state, and color when the `Sprite` properties change, ensuring that the visual representation is always in sync with the game logic.

### `drawImg` Options
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

### Sprite Rendering Flow
- Sprites are queued for drawing each frame via `drawImg`.
- The renderer sorts sprites by `z` (depth) and batches them for efficient GPU rendering.
- Flipping, scaling, and colorizing are handled in the shader using the options provided.
- Sprite hitboxes and polygons are automatically updated when the image or flip state changes.

### See Also
- [`src/bmsx/sprite.ts`](src/bmsx/sprite.ts) for the sprite and sprite object classes.
- [`src/bmsx/glview.ts`](src/bmsx/glview.ts) for the `drawImg` implementation and batching.
- [`src/bmsx/view.ts`](src/bmsx/view.ts) for the drawing API and 2D fallback.

---

# Sound and Music

BMSX provides a simple audio system for music and sound effects, supporting playback, pausing, rewinding, and integration with the save/load system. All audio is managed by the `SM` (SoundMaster) class, which handles decoding, playback, and resource management for both music and sound effects (SFX).

## Key Features

- **Audio Resource Management:**
  - All audio assets are referenced by string IDs, defined in the `AudioId` enum (see `src/ella2023/resourceids.ts` or your game's resourceids file).
  - Audio resources are packed into the ROM and decoded at runtime.
  - Both music and SFX are supported, with separate channels and controls.

- **Playback API:**
  - Use `SM.play(id: string, offset?: number)` to play a sound or music track by its ID. The `offset` parameter (in seconds) allows starting playback from a specific position.
  - Use `SM.stopEffect()` to stop all SFX, and `SM.stopMusic()` to stop music playback.
  - The engine ensures only one SFX and one music track play at a time (by default), but this can be customized.
  - Looping is supported for music tracks with loop points defined in the audio metadata.

- **Volume and Audio Context:**
  - The global volume can be set via `SM.volume = 0.5` (range: 0.0–1.0).
  - The audio context is automatically managed and resumed as needed.

- **Playback State and Queries:**
  - Use `SM.currentTrackByType('music' | 'sfx')` to get the currently playing track ID.
  - Use `SM.currentTimeByType('music' | 'sfx')` to get the current playback position (in seconds).
  - Pause and resume all audio with `SM.pause()` and `SM.resume()`.

- **Integration with Save/Load and Rewind:**
  - The current music/SFX track and playback position are saved as part of the game state (see `Savegame` in `gameserializer.ts`).
  - When loading or rewinding, the correct track and position are restored automatically.

- **Adding New Audio Resources:**
  - Add your audio files to the appropriate resource folder and update your game's `resourceids.ts` to include new IDs in the `AudioId` enum.
  - Reference these IDs in your game logic when calling `SM.play()`.

## Example Usage

```typescript
// Play a sound effect
SM.play(AudioId.punch);

// Play background music from the start
SM.play(AudioId.trainen);

// Stop all sound effects
SM.stopEffect();

// Stop music
SM.stopMusic();

// Set volume to 50%
SM.volume = 0.5;

// Query current music track and position
const currentTrack = SM.currentTrackByType('music');
const currentTime = SM.currentTimeByType('music');
```

## Audio Resource IDs

All audio and music tracks are referenced by string IDs, defined in your game's `resourceids.ts`:

```typescript
export enum AudioId {
  none = 'none',
  gameover = 'gameover',
  knokken = 'knokken',
  oei = 'oei',
  start = 'start',
  trainen = 'trainen',
  vernederdans = 'vernederdans',
  hit1 = 'hit1',
  hit2 = 'hit2',
  kick = 'kick',
  punch = 'punch',
  stuk = 'stuk',
}
```

Use these IDs with the `SM` API to play or stop audio.

## Advanced Features

- **Looping and Offsets:**
  - Music tracks can define loop points in their metadata for seamless looping.
  - You can start playback from any offset (in seconds) for advanced effects or resume.

- **Audio in Savegames and Rewind:**
  - The current audio state (track, offset) is saved and restored with the game state, ensuring seamless audio continuity when loading or rewinding.

- **Error Handling:**
  - If you attempt to play an unknown audio ID, a warning is logged and playback is skipped.

## References

- See [`src/bmsx/soundmaster.ts`](src/bmsx/soundmaster.ts) for the audio engine implementation.
- See [`src/ella2023/resourceids.ts`](src/ella2023/resourceids.ts) (or your game's resourceids) for audio IDs.
- See [`src/bmsx/gameserializer.ts`](src/bmsx/gameserializer.ts) for save/load integration.
- See [`src/bmsx/game.ts`](src/bmsx/game.ts) for how the audio system is integrated with the main game loop.

---

# Registry

The BMSX `Registry` is a global, type-safe object registry that tracks all game entities (objects, components, systems) by unique identifier. It provides fast lookup, registration, and management of game objects, and is essential for serialization, deserialization, and event management.

## Key Features

- **Centralized Object Management:**
  - All objects that implement the `Registerable` interface can be registered in the `Registry`.
  - Each object must have a unique `id` (string or `'model'`).
  - The registry allows you to look up, register, and deregister objects at runtime.

- **Persistent vs. Non-Persistent Entities:**
  - Objects can be marked as persistent (`registrypersistent: true`), meaning they survive across save/load cycles and are re-registered after deserialization.
  - Non-persistent objects are removed from the registry when the game state is cleared or reloaded.
  - This distinction is important for event subscriptions and systems that must remain active across loads (e.g., input, sound, global managers).

- **API Overview:**
  - `Registry.instance.get(id)` – Retrieve an object by its identifier.
  - `Registry.instance.has(id)` – Check if an object is registered.
  - `Registry.instance.register(entity)` – Register a new object.
  - `Registry.instance.deregister(id)` – Remove an object by ID or instance.
  - `Registry.instance.getPersistentEntities()` – Get all persistent entities (for re-registering after load).
  - `Registry.instance.clear()` – Remove all non-persistent entities from the registry.
  - `Registry.instance.getRegisteredEntities()` – Get all currently registered entities.
  - `Registry.instance.getRegisteredEntityIds()` – Get all registered IDs.
  - `Registry.instance.getRegisteredEntitiesByType(type)` – Get all entities of a given class name.
  - `Registry.instance.getRegisteredEntityIdsByType(type)` – Get all IDs of a given class name.

- **Integration with Game Model and Serialization:**
  - The registry is used by the game model to track all active objects.
  - During save/load, persistent entities are re-registered to ensure event subscriptions and global systems remain functional.
  - The registry is also used for dependency injection and global lookups (e.g., finding the player, input system, or sound manager).

## Example Usage

```typescript
// Register a new object
Registry.instance.register(myObject);

// Retrieve an object by ID
const obj = Registry.instance.get('player1');

// Check if an object exists
if (Registry.instance.has('enemy42')) { ... }

// Remove an object
Registry.instance.deregister('enemy42');

// Get all persistent entities (for re-registering after load)
const persistent = Registry.instance.getPersistentEntities();

// Clear all non-persistent entities
Registry.instance.clear();
```

## Best Practices

- Always assign a unique `id` to each `Registerable` object.
- Mark global systems and managers as `registrypersistent: true` to ensure they survive save/load cycles.
- Use the registry for fast lookups and to avoid passing references throughout your codebase.
- When creating custom systems, consider registering them for easy access and event management.

## References

- See [`src/bmsx/registry.ts`](src/bmsx/registry.ts) for the full implementation and API.
- See [`src/bmsx/game.ts`](src/bmsx/game.ts) for how the registry is used in the game loop and model.
- See [`src/bmsx/gameserializer.ts`](src/bmsx/gameserializer.ts) for how persistent entities are handled during save/load.

---

# State Machine

The BMSX engine includes a simple state machine system that allows you to define game logic in a structured way. The `State` class provides a base for creating states, while the `StateMachine` class manages transitions and state execution.

## Key Features
- **State Definition**: States can be defined with properties like `on_enter`, `on_exit`, and `on_input` to handle transitions and input processing.
- **Transition Management**: States can transition to other states based on conditions, allowing for complex game logic.
- **State Hierarchy**: States can inherit from other states, allowing for shared behavior and properties.
- **Input Handling**: The `on_input` property allows you to define input handlers that can trigger state transitions based on player actions.

## Advanced FSM Features

The BMSX FSM system provides a set of features for building simple game logic. In addition to the basics, the following advanced features are available:

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

### How it works
- The decorators automatically register FSM blueprints and assignments in global registries (StateDefinitionBuilders), so the engine can instantiate and manage them without manual wiring.
- *FSM assignments are inherited through the class hierarchy*, so subclasses automatically get the FSMs of their parent classes unless overridden.
See `src/bmsx/fsmdecorators.ts` for implementation details.

## Event and Transition Path Syntax

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

### Transition Handler Options

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

## The `is` Method in BMSX State Machines

BMSX allows checking the current state of a state machine using the `is` method, which is useful for implementing conditional logic, branching behaviors, and debugging.

### The `is` Method: Evaluation and Semantics

- The `is` method is available on both the `StateMachineController` (usually as `object.sc`) and on individual `State` instances.
- It checks whether the current state (or substate) matches a given path or identifier.
- The method supports both simple state IDs and hierarchical dot-separated paths (e.g., `jump._jump_up`, `main.attack.combo`).
- The check is always performed against the **current state path** of the state machine or substate machine, traversing the hierarchy as needed.
- Returns `true` if the current state path matches the provided path, `false` otherwise.
- If the path is ambiguous or the state/machine does not exist, an error is thrown (helping catch typos or invalid checks during development).

#### How `is` is Evaluated

- If you pass a simple state ID (e.g., `'idle'`), it checks if the current state of the current machine matches `'idle'`.
- If you pass a hierarchical path (e.g., `'jump.jump_up'`), it checks if the current state and all substates match the path from the root down.
- If you call `is` on a specific state machine (e.g., `object.sc.get_statemachine('player_animation').is('walk')`), it checks the state of that machine only.
- The method supports relative and absolute paths, including prefixes like `this.`, `parent.`, and `root.` for advanced checks (see FSM docs for details).

#### Usage Examples (Reflecting Actual Evaluation)

```typescript
// Check if the current state of the main (default) machine is 'idle'
if (object.sc.is('idle')) {
    // The current state is exactly 'idle' in the current machine
}

// Check if the current state is a specific substate (e.g., during a jump phase)
if (object.sc.is('jump.jump_up')) {
    // The current state is 'jump', and its substate is 'jump_up'
}

// Check if the current state is any substate of 'jump'
if (object.sc.is('jump')) {
    // The current state is 'jump' (regardless of substate)
}

// Check on a specific state machine by ID (e.g., for animation FSM)
if (object.sc.get_statemachine('player_animation').is('walk')) {
    // The animation FSM is currently in the 'walk' state
}

// Example from Eila's FSM: check if not in certain states before switching
if (!this.sc.is('stoerheidsdans') && !this.sc.is('nagenieten') && !this.sc.is('humiliated')) {
    // Only perform action if not in any of these states
}
```

### Features and Capabilities

- **Hierarchical State Paths:**
  - Supports dot notation for nested substates (e.g., `jump.jump_up`).
  - Can check for any depth in the state hierarchy.
- **Multiple State Machines:**
  - If you have multiple state machines attached to an object, you can check the state of any machine by ID using `get_statemachine(id).is(...)`.
- **Flexible Context:**
  - The `is` method can be called on the controller (`sc`) or directly on a `State` instance for fine-grained checks.
- **Error Handling:**
  - Throws an error if the specified machine or state does not exist, helping catch typos or invalid checks during development.
- **Integration with FSM Decorators:**
  - Works seamlessly with FSMs defined and assigned via decorators, supporting both single and multiple FSMs per object.

### Advanced: Relative and Absolute Paths

- You can use relative or absolute paths to check for states in different machines or substates.
- Special prefixes (e.g., `this.`, `parent.`, `root.`) can be used for more advanced checks, matching the transition path syntax.

### Best Practices

- Use the `is` method in your game logic, AI, and animation code to branch behavior based on the current state.
- Combine with event handlers and transitions for robust, state-driven systems.
- Use hierarchical paths for fine-grained control in complex FSMs.
- See [`src/bmsx/fsm.ts`](src/bmsx/fsm.ts) for the implementation of the `is` method and advanced usage patterns.
- See the FSM section above for more on state machine structure and transitions.

## Example Usage

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

# Player Input

## Device Support, Multi-Player, and Controller Assignment

BMSX supports flexible input from multiple sources and players, with runtime device management:

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
    - `$.getActionState(playerIndex, action)`
    - `$.getPressedActions(playerIndex, query)`
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
    if ($.getActionState(2, 'down[p] && kick[j]')) {
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

## Key Features

- **Input Buffering:**
  Button presses and releases are stored for a few frames, allowing the game to "see" inputs that happen just before an action becomes available (e.g., buffering a jump or attack during an animation).
  > However, the implementation is crappy and unuseful and awful and makes babies cry.

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

  The BMSX action parser supports advanced combo and windowed action detection using special function-like modifiers. These allow you to define complex input patterns such as "any of these buttons just pressed", "all of these buttons just pressed", or "any/all of these actions were pressed within a time window". This is especially useful for fighting games, rhythm games, or any scenario where input timing and combos matter.

  **Supported Modifiers:**
These modifiers are parsed as special function nodes in the action parser, allowing for complex expressions and combinations.

  - `&`: **All true**
    Returns `true` if **all** actions inside the parentheses are true in the current frame.
    Example:
    ```typescript
    '&(up[!p], down[p], left[!p], right[p])' // triggers if up is not pressed, down is pressed, left is not pressed, and right is pressed
    ```
    This triggers only if all four actions are true in the current frame.
  - `?`: **Any true**
    Returns `true` if **any** of the actions inside the parentheses are true in the current frame.
    Example:
    ```typescript
    '?((up[!p] && down[p]), left[!p], right[p])' // triggers if up is not pressed and down is pressed, or left is not pressed, or right is pressed
    ```
    This triggers if any of the conditions are true in the current frame.
  - `?jp(...)`: **Any Just Pressed**
    Returns `true` if **any** of the actions inside the parentheses were just pressed in the current frame.
    Example:
    ```typescript
    '?jp(a[j], b[j])'
    ```
    This triggers if either action [a](http://_vscodecontentref_/0) or `b` was just pressed and not consumed.

  - [&jp(...)](http://_vscodecontentref_/1): **All Just Pressed**
    Returns `true` if **all** of the actions inside the parentheses were just pressed in the current frame.
    Example:
    ```typescript
    '&jp(up[j], down[j])'
    ```
    This triggers only if both `up` and `down` were just pressed simultaneously.
  - `?jr(...)`: **Any Just Released**
    Returns `true` if **any** of the actions inside the parentheses were just released in the current frame.
    Example:
    ```typescript
    '?jr(a, b)'
    ```
    This triggers if either action [a](http://_vscodecontentref_/0) or `b` was just released.
  - `&jr(...)`: **All Just Released**
    Returns `true` if **all** of the actions inside the parentheses were just released in the current frame.
    Example:
    ```typescript
    '&jr(up, down)'
    ```
    This triggers only if both `up` and `down` were just released simultaneously.

  - `?wp{n}(...)`: **Any Was Pressed in Window**
    Returns `true` if **any** of the actions inside the parentheses was pressed at any time within the last `n` frames (input buffer window).
    Example:
    ```typescript
    '?wp{10}(punch, kick)'
    ```
    This triggers if either `punch` or `kick` was pressed at any point in the last 10 frames, regardless of whether it is still held.

  - `&wp{n}(...)`: **All Were Pressed in Window**
    Returns `true` if **all** of the actions inside the parentheses were pressed at least once within the last `n` frames.
    Example:
    ```typescript
    '&w{20}(left, right, jump)'
    ```
    This triggers only if all three actions ([left](http://_vscodecontentref_/2), [right](http://_vscodecontentref_/3), and `jump`) were pressed at least once in the last 20 frames.
  - `?wr{n}(...)`: **Any Was Released in Window**
    Returns `true` if **any** of the actions inside the parentheses was released at any time within the last `n` frames.
    Example:
    ```typescript
    '?wr{10}(punch, kick)'
    ```
    This triggers if either `punch` or `kick` was released at any point in the last 10 frames.
  - `&wr{n}(...)`: **All Were Released in Window**
    Returns `true` if **all** of the actions inside the parentheses were released at least once within the last `n` frames.
    Example:
    ```typescript
    '&wr{10}(punch, kick)'
    ```
    This triggers only if both `punch` and `kick` were released at least once in the last 10 frames.

  **How it works:**
  - These modifiers are parsed as special function nodes in the action parser (see [ActionParser](http://_vscodecontentref_/4) in [actionparser.ts](http://_vscodecontentref_/5)).
  - For windowed combos, the parser ensures the correct time window is passed down to all nested actions, so the input buffer is queried for the relevant period.
  - The logic for `?w{n}` and `aw{n}` is implemented in [compileAnyWasPressedFunction](http://_vscodecontentref_/6) and [compileAllWasPressedFunction](http://_vscodecontentref_/7), respectively, ensuring correct evaluation even for nested or complex expressions.

  **Usage Tips:**
  - Use `?jp(...)` and [&j(...)](http://_vscodecontentref_/8) for frame-accurate combos (e.g., simultaneous button presses).
  - Use `?wp{n}(...)` and `&wp{n}(...)` for buffered or sequence-based combos (e.g., "press A then B within 10 frames").
  - Combine with other modifiers (like `[!c]` for not consumed) for even more precise control.

- **Action Parsing and Modifiers:**
The action parsing system is designed to be flexible and extensible, allowing for complex action definitions that can adapt to various gameplay mechanics.

  Action definitions support logical operators (`&&`, `||`), grouping, and modifiers such as:
  - `[p]` for pressed
  - `[!p]` for not pressed
  - `[j]` for just pressed
  - `[&j]` for all just pressed (multi-button)
  - `[?j]` for any just pressed (multi-button)
  - `[jr]` for just released
  - `[&jr]` for all just released (multi-button)
  - `[c]` for consumed
  - `[!c]` for not consumed
  - `[t{^x}]`, where `^` = `<`, `>`, `<=`, etc. and `x` = <duration> for press time conditions (e.g., short tap, or long press)
  - `[wp{x}]`, where `x` = <duration> for was-pressed condition (input was pressed at any time in the last x frames, useful for combos)
  - `[wr{x}]`, where `x` = <duration> for was-released condition (input was released at any time in the last x frames)
  - `[ic]` to ignore the consumed state
  - Custom combos and conditions using functions like `?()` and `?jp()`
> **Note**: The `[!c]` modifier is implicitly applied to all actions, so it is not necessary to include it in every action definition. It is primarily used for clarity in complex expressions and to make the action definition consistent. Use the `[ic]` modifier to ignore the consumed state if you want to check for actions that were triggered regardless of their consumed state.

- **Flexible Action Definitions:**
  Actions can be defined as simple button presses or as complex expressions, e.g.:
  - `jump[p] && attack[j]` (pressed jump and just-pressed attack)
  - `?j(a[jic], b[jic])` (any just-pressed and consumed state is ignored for `a` and `b`)
  - `special[t{>=50}]` (pressed for or longer than 50ms)

- **APIs for Consuming Actions:**
  - `PlayerInput.consumeAction(action)` and `PlayerInput.consumeActions(...actions)` mark actions as handled, preventing them from being processed again.

- **Action State Querying:**
  The `getActionState(action)` method returns a rich object with `pressed`, `justpressed`, `consumed`, `presstime`, and `timestamp` fields, supporting advanced gameplay logic.

- **Multiple Input Sources:**
  Supports keyboard, gamepad, and on-screen controls, with seamless mapping and aggregation.

# Serializing & Deserializing Game State

BMSX provides a simple, extensible system for saving and loading the entire game state, supporting features like rewind, save slots, and debugging. The system is designed to handle complex object graphs, circular references, and custom serialization logic.

## Key Features

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

## How It Works

### Saving

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

### Loading

1. **Decompress:**
   The binary snapshot is decompressed using the `BinaryCompressor`.
2. **Deserialize:**
   The `Reviver` class reconstructs the object graph, restoring all objects, references, and types.
   Registered constructors and `@onload` hooks are used to re-initialize objects as needed.
3. **Restore State:**
   The model's `load()` method applies the deserialized state, re-populating spaces, objects, and properties.
   Persistent entities and event subscriptions are re-initialized.

### Example: Saving and Loading

```typescript
// Save the current game state (compressed binary)
const snapshot: Uint8Array = $.model.save(true);

// Load a previously saved state
$.model.load(snapshot, true);
```

### Example: Using Decorators

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

### Rewind System

- The engine maintains a buffer of compressed game state snapshots for the last N seconds (default: 60s).
- The rewind UI (`rewindui.ts`) allows the player or developer to scrub through previous frames and restore any previous state instantly.
- Snapshots are taken automatically each frame and are compressed (using a simple compression algorithm) for efficiency.

### Debugging and Inspection

- Use `debugPrintBinarySnapshot(buf)` to pretty-print a binary snapshot for debugging.
- The ROM inspector and debugger tools can display and manipulate saved game states.
   > Kidding, that is something that Copilot hallucinated, there is no such function yet :-)

### Advanced Features

- **Selective Serialization:**
  Exclude properties or entire classes from serialization using `@excludepropfromsavegame` and `@excludeclassfromsavegame`.
- **Custom Save/Load Logic:**
  Use `@onsave` and `@onload` to add custom logic for saving and restoring derived or computed properties.
- **Type Registration:**
  Register custom classes with `@insavegame` to ensure correct serialization and deserialization.
  > **Note**: The `@insavegame` decorator is used to mark classes that should be included in the savegame serialization process, allowing the serializer to recognize and handle them correctly. **If a class is not marked with `@insavegame` and it was not omitted from serialization using `@excludeclassfromsavegame`, you will get an error when trying to save or load the game state!**

### References

- See [`src/bmsx/gameserializer.ts`](src/bmsx/gameserializer.ts) for the main serialization logic and decorators.
- See [`src/bmsx/binencoder.ts`](src/bmsx/binencoder.ts) and [`src/bmsx/bincompressor.ts`](src/bmsx/bincompressor.ts) for binary encoding and compression.
- See [`src/bmsx/basemodel.ts`](src/bmsx/basemodel.ts) and [`src/bmsx/game.ts`](src/bmsx/game.ts) for integration with the game model and rewind system.
- See [`src/bmsx/debugger/rewindui.ts`](src/bmsx/debugger/rewindui.ts) for the rewind debugger UI.

---

# Event Registry and Emitting

BMSX features a simple event system that enables decoupled communication between game objects, systems, and engine components. The event registry is managed by the `EventEmitter` singleton (see `src/bmsx/eventemitter.ts`), which supports event subscription, emission, and deregistration patterns.

## Core Concepts

- **EventEmitter**: Central dispatcher for all events. Registered as a persistent singleton (`id = 'event_emitter'`) in the global registry.
- **Event Registry**: All event listeners and subscribers are tracked, allowing for efficient event emission and cleanup.
- **Event Scopes**: Events can be scoped to global, self, parent, or specific emitter IDs, supporting fine-grained control over event delivery.
- **Subscription Decorators**: Use decorators to declaratively subscribe methods to events with specific scopes (see below).
- **Automatic Subscription/Unsubscription**: Game objects and components can automatically register and deregister event handlers during their lifecycle (e.g., on spawn/dispose).

## Subscribing to Events

You can subscribe to events using decorators provided in `eventemitter.ts`:

- `@subscribesToGlobalEvent(eventName)`: Listen to an event globally (all emitters).
- `@subscribesToSelfScopedEvent(eventName)`: Listen to events emitted by the object itself.
- `@subscribesToParentScopedEvent(eventName)`: Listen to events emitted by the object's parent.
- `@subscribesToEmitterScopedEvent(eventName, emitter_id)`: Listen to events from a specific emitter by ID.

Example:
```typescript
@subscribesToGlobalEvent('playerDied')
onPlayerDied(event) {
    // Handle player death globally
}

@subscribesToSelfScopedEvent('damaged')
onDamaged(event) {
    // Handle when this object is damaged
}
```

## Emitting Events

To emit an event, use the `emit` method on the global game object (`$`):

```typescript
$.emit('eventName', emitter, ...args);
```
- `eventName`: The name of the event.
- `emitter`: The object emitting the event (must implement `Identifiable`).
- `...args`: Additional arguments passed to listeners.

Example:

```typescript
$.emit('damaged', this, damageAmount);
```

You can also use the `@emits_event(eventName)` decorator to automatically emit an event when a method is called.

## Registering and Deregistering Objects

All event subscribers and game objects are registered in the global registry for lookup and event routing. Use the following methods (see `src/bmsx/game.ts`):

- `$.register(obj)`: Register an object (must implement `Registerable`).
- `$.deregister(objOrId)`: Deregister an object by instance or ID.

Game objects are automatically registered when spawned (see `onspawn` in `gameobject.ts`):

```typescript
public onspawn(spawningPos?: Vector): void {
    // ...
    $.registry.register(this); // Registers the object for event routing
    this.onLoadSetup();        // Sets up event subscriptions
    // ...
}
```

When disposed, objects should deregister themselves and remove event subscriptions:

```typescript
public dispose(): void {
    $.event_emitter.removeSubscriber(this); // Unsubscribe from all events
    // ...
}
```

## Event Handler Lifecycle

- **onspawn**: Registers the object and sets up event subscriptions.
- **dispose**: Removes all event subscriptions and deregisters the object.

This ensures that event handlers are always up-to-date and that no memory leaks occur from lingering subscriptions.

## Best Practices

- Use decorators to declare event subscriptions for clarity and maintainability.
- Always deregister objects and remove event subscriptions when disposing of game objects or components.
- Use event scopes to control which objects receive which events, reducing unnecessary event traffic.
- Prefer emitting events via `$.emit` for consistency and integration with the registry.

## References

- [`src/bmsx/eventemitter.ts`](src/bmsx/eventemitter.ts): Event system implementation, decorators, and API.
- [`src/bmsx/game.ts`](src/bmsx/game.ts): Game API for registering, deregistering, and emitting events.
- [`src/bmsx/gameobject.ts`](src/bmsx/gameobject.ts): Game object lifecycle, including `onspawn` and `dispose`.

---
