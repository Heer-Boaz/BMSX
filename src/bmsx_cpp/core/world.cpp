/*
 * world.cpp - World and Space implementation
 *
 * This mirrors the TypeScript World/Space/WorldObject architecture.
 * Key points:
 * - WorldObject has NO tick() or paint() - those are handled by Systems
 * - Lifecycle methods (onspawn, ondespawn, activate, deactivate, dispose) are
 *   concrete implementations that mirror the TypeScript behavior
 */

#include "world.h"
#include "engine.h"
#include "../component/component.h"
#include <algorithm>
#include <stdexcept>

namespace bmsx {

/* ============================================================================
 * WorldObject implementation
 * ============================================================================ */

u64 WorldObject::s_nextId = 1;

WorldObject::WorldObject() {
    id = generateId();
    // sc and events created during activate()
}

WorldObject::WorldObject(const Identifier& objId)
    : id(objId) {
}

WorldObject::~WorldObject() {
    if (!_disposed) {
        dispose();
    }
}

Identifier WorldObject::generateId() {
    // Mirror TypeScript: "ClassName_uniqueNumber"
    // In C++ we don't have runtime class name reflection easily,
    // so we use a generic prefix. Subclasses can override.
    return "obj_" + std::to_string(s_nextId++);
}

Vec3 WorldObject::center() const {
    return {
        _pos.x + _size.x / 2.0f,
        _pos.y + _size.y / 2.0f,
        _pos.z + _size.z / 2.0f
    };
}

void WorldObject::setX(f32 v) {
    _pos.x = v;
    // In TypeScript, setting x might trigger component updates via @update_tagged_components
    // For C++ we'd need to implement a similar mechanism if needed
}

void WorldObject::setY(f32 v) {
    _pos.y = v;
}

void WorldObject::setZ(f32 v) {
    _pos.z = v;
    // Mark depth sort dirty
    $().world()->markDepthDirtyForObjectId(id);
}

void WorldObject::markForDisposal() {
    _dispose_flag = true;
    deactivate();
}

void WorldObject::addComponentInternal(std::unique_ptr<Component> comp) {
    comp->setParent(this);
    Component* ptr = comp.get();
    components.push_back(std::move(comp));

    // Add to type map
    std::string key = std::string(ptr->typeName());
    componentMap[key].push_back(ptr);

    // Late-init hooks
    ptr->onAttach();
}

void WorldObject::removeComponent(Component* comp) {
    // Remove from type map
    std::string key = std::string(comp->typeName());
    auto mapIt = componentMap.find(key);
    if (mapIt != componentMap.end()) {
        auto& vec = mapIt->second;
        vec.erase(std::remove(vec.begin(), vec.end(), comp), vec.end());
        if (vec.empty()) {
            componentMap.erase(mapIt);
        }
    }

    // Remove from components vector
    for (auto it = components.begin(); it != components.end(); ++it) {
        if (it->get() == comp) {
            comp->detach();
            components.erase(it);
            break;
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle methods - these mirror TypeScript exactly
// ─────────────────────────────────────────────────────────────────────────────

void WorldObject::onspawn(const Vec3* pos, SpawnReason reason) {
    if (pos) {
        setX_nonotify(pos->x);
        setY_nonotify(pos->y);
        setZ_nonotify(pos->z);
    }

    if (reason == SpawnReason::Fresh) {
        // Fresh spawn: full BeginPlay
        activate();
    }
    // Revive and transfer: do not mutate flags or controller
}

void WorldObject::ondespawn() {
    active = false;
    eventhandling_enabled = false;
    // Events would be emitted here in TypeScript
}

void WorldObject::activate() {
    // Register in registry
    Registry::instance().registerObject(this);

    // Initialize linked FSMs
    initializeLinkedFSMs();

    // Add auto-components
    addAutoComponents();

    // Enable flags
    eventhandling_enabled = true;
    tick_enabled = true;
    active = true;

    // Start FSM
    if (sc) {
        sc->tickEnabled = true;
        sc->start();
    }
}

void WorldObject::deactivate() {
    active = false;
    eventhandling_enabled = false;
    tick_enabled = false;
    if (sc) {
        sc->pause();
    }
}

void WorldObject::dispose() {
    if (_disposed) return;
    _disposed = true;

    deactivate();

    // Dispose all components
    for (auto& comp : components) {
        comp->dispose();
    }
    components.clear();
    componentMap.clear();

    // Dispose FSM
    if (sc) {
        sc->dispose();
    }

    unbind();
}

void WorldObject::submitForRendering(GameView* view) {
    (void)view;
    // Default implementation does nothing
    // Subclasses with sprites/meshes override this to submit to RenderQueues
    // In TypeScript, this is typically done via SpriteComponent
}

void WorldObject::bind() {
    Registry::instance().registerObject(this);
}

void WorldObject::unbind() {
    Registry::instance().deregister(this);
}

void WorldObject::addAutoComponents() {
    // In TypeScript this uses decorators to auto-attach components
    // In C++ we'd need a different mechanism (static registry per class)
}

void WorldObject::initializeLinkedFSMs() {
    // In TypeScript this uses decorators (@assign_fsm, @build_fsm)
    // In C++ we'd need a different mechanism
}

/* ============================================================================
 * Space implementation
 * ============================================================================ */

Space::Space(const Identifier& spaceId)
    : id(spaceId) {
}

Space::~Space() {
    clear();
}

void Space::addObject(WorldObject* obj) {
    objects.push_back(obj);
    objectsById[obj->id] = obj;
    depthSortDirty = true;
}

void Space::removeObject(WorldObject* obj, bool skipOnDespawn) {
    auto it = std::find(objects.begin(), objects.end(), obj);
    if (it == objects.end()) {
        return;
    }

    if (!skipOnDespawn) {
        obj->ondespawn();
    }

    objects.erase(it);
    objectsById.erase(obj->id);
}

void Space::clear() {
    for (auto* obj : objects) {
        obj->ondespawn();
    }
    objects.clear();
    objectsById.clear();
}

WorldObject* Space::get(const Identifier& objId) {
    auto it = objectsById.find(objId);
    return it != objectsById.end() ? it->second : nullptr;
}

bool Space::contains(const Identifier& objId) const {
    return objectsById.find(objId) != objectsById.end();
}

void Space::sortByDepth() {
    if (!depthSortDirty) return;

    std::stable_sort(objects.begin(), objects.end(),
        [](const WorldObject* a, const WorldObject* b) {
            return a->z() < b->z();
        });

    depthSortDirty = false;
}

/* ============================================================================
 * World implementation
 * ============================================================================ */

World::World() {
    // Create default space
    addSpace("default");
    setActiveSpace("default");
}

World::~World() {
    // Clear all spaces
    for (auto& space : _spaces) {
        space->clear();
    }
    _spaces.clear();
    _spaceMap.clear();
}

Space* World::addSpace(const Identifier& spaceId) {
    if (_spaceMap.find(spaceId) != _spaceMap.end()) {
        throw std::runtime_error("Space '" + spaceId + "' already exists");
    }

    auto space = std::make_unique<Space>(spaceId);
    Space* ptr = space.get();
    _spaceMap[spaceId] = ptr;
    _spaces.push_back(std::move(space));

    return ptr;
}

void World::removeSpace(const Identifier& spaceId) {
    auto mapIt = _spaceMap.find(spaceId);
    if (mapIt == _spaceMap.end()) {
        return;
    }

    Space* space = mapIt->second;

    // Remove all objects from objToSpaceMap
    for (auto* obj : space->objects) {
        _objToSpaceMap.erase(obj->id);
    }

    space->clear();

    // Remove from vector
    for (auto it = _spaces.begin(); it != _spaces.end(); ++it) {
        if (it->get() == space) {
            _spaces.erase(it);
            break;
        }
    }

    _spaceMap.erase(spaceId);

    // Update active space if needed
    if (_activeSpace == space) {
        _activeSpace = _spaces.empty() ? nullptr : _spaces[0].get();
        _activeSpaceId = _activeSpace ? _activeSpace->id : "";
    }
}

Space* World::getSpace(const Identifier& spaceId) {
    auto it = _spaceMap.find(spaceId);
    return it != _spaceMap.end() ? it->second : nullptr;
}

void World::setActiveSpace(const Identifier& spaceId) {
    auto space = getSpace(spaceId);
    if (space) {
        _activeSpace = space;
        _activeSpaceId = spaceId;
    }
}

void World::spawn(WorldObject* obj, const Identifier& spaceId, const Vec3* pos) {
    Space* space = getSpace(spaceId);
    if (!space) {
        throw std::runtime_error("Space '" + spaceId + "' not found");
    }

    space->addObject(obj);
    _objToSpaceMap[obj->id] = spaceId;

    obj->onspawn(pos, SpawnReason::Fresh);
}

void World::despawn(WorldObject* obj) {
    auto it = _objToSpaceMap.find(obj->id);
    if (it == _objToSpaceMap.end()) {
        return;
    }

    Space* space = getSpace(it->second);
    if (space) {
        space->removeObject(obj);
    }

    _objToSpaceMap.erase(obj->id);
}

void World::despawnFromAllSpaces(WorldObject* obj) {
    // In BMSX, an object can only be in one space at a time
    despawn(obj);
    obj->dispose();
}

void World::transferObject(WorldObject* obj, const Identifier& toSpaceId) {
    auto fromIt = _objToSpaceMap.find(obj->id);
    if (fromIt == _objToSpaceMap.end()) {
        return;
    }

    Space* fromSpace = getSpace(fromIt->second);
    Space* toSpace = getSpace(toSpaceId);

    if (!toSpace) {
        throw std::runtime_error("Target space '" + toSpaceId + "' not found");
    }

    if (fromSpace) {
        fromSpace->removeObject(obj, true); // Skip ondespawn for transfer
    }

    toSpace->addObject(obj);
    _objToSpaceMap[obj->id] = toSpaceId;

    // Call onspawn with transfer reason
    obj->onspawn(nullptr, SpawnReason::Transfer);
}

bool World::exists(const Identifier& objId) const {
    return _objToSpaceMap.find(objId) != _objToSpaceMap.end();
}

WorldObject* World::getObject(const Identifier& objId) {
    auto it = _objToSpaceMap.find(objId);
    if (it == _objToSpaceMap.end()) {
        return nullptr;
    }

    Space* space = const_cast<World*>(this)->getSpace(it->second);
    return space ? space->get(objId) : nullptr;
}

Space* World::getSpaceOfObject(const Identifier& objId) {
    auto it = _objToSpaceMap.find(objId);
    if (it == _objToSpaceMap.end()) {
        return nullptr;
    }
    return getSpace(it->second);
}

void World::markDepthDirtyForObjectId(const Identifier& objId) {
    Space* space = getSpaceOfObject(objId);
    if (space) {
        space->depthSortDirty = true;
    }
}

std::vector<WorldObject*> World::objects(const ObjectScope& scope) {
    std::vector<WorldObject*> result;
    if (!_activeSpace) return result;

    for (auto* obj : _activeSpace->objects) {
        if (scope.activeOnly && !obj->active) continue;
        result.push_back(obj);
    }
    return result;
}

void World::stepPhysics(f64 dt) {
    (void)dt;
    // TODO: Integrate physics engine (e.g., Jolt, Rapier)
    // For now, this is a placeholder for the physics step
}

bool World::collidesWithTile(WorldObject* obj, const std::string& direction) const {
    (void)obj;
    (void)direction;
    // TODO: Implement actual tile collision detection using tilemap data
    // This is a placeholder - real implementation would check against
    // the active space's tilemap collision layer
    return false;
}

void World::run(f64 deltaTime) {
    (void)deltaTime;  // Used by systems

    // In TypeScript, World.run() drives the system manager through phases:
    // 1. Input
    // 2. ActionEffect
    // 3. ModeResolution (FSM tick)
    // 4. Physics
    // 5. Animation
    // 6. Presentation
    // 7. EventFlush

    // Phase 3: ModeResolution - tick FSMs
    _currentPhase = TickGroup::ModeResolution;
    if (sc) {
        sc->tick();
    }

    // For libretro, we'll need to implement the system manager
    // and call systems.updatePhase(world, phase) for each phase

    // Clean up disposed objects
    if (_activeSpace) {
        for (auto it = _activeSpace->objects.begin(); it != _activeSpace->objects.end(); ) {
            if ((*it)->disposeFlag()) {
                despawnFromAllSpaces(*it);
                it = _activeSpace->objects.begin(); // Restart after removal
            } else {
                ++it;
            }
        }
    }
}

} // namespace bmsx
