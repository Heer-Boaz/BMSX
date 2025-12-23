/*
 * world.cpp - World and Space implementation
 */

#include "world.h"
#include <algorithm>
#include <stdexcept>

namespace bmsx {

/* ============================================================================
 * WorldObject implementation
 * ============================================================================ */

static u64 s_nextObjectId = 1;

WorldObject::WorldObject() {
    id = "obj_" + std::to_string(s_nextObjectId++);
}

WorldObject::WorldObject(const Identifier& objId)
    : id(objId) {
}

WorldObject::~WorldObject() {
    dispose();
}

void WorldObject::removeComponent(Component* comp) {
    // Remove from type map
    std::string key = std::string(comp->typeName());
    auto mapIt = componentMap.find(key);
    if (mapIt != componentMap.end()) {
        auto& vec = mapIt->second;
        vec.erase(std::remove(vec.begin(), vec.end(), comp), vec.end());
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

void WorldObject::onspawn(const Vec3* pos, SpawnReason reason) {
    (void)reason;
    if (pos) {
        setPosition(*pos);
    }
}

void WorldObject::ondespawn() {
    // Override in subclasses
}

void WorldObject::tick(f64 dt) {
    // Tick all components
    for (auto& comp : components) {
        comp->tick(dt);
    }
}

void WorldObject::paint() {
    // Override in subclasses for custom rendering
}

void WorldObject::dispose() {
    for (auto& comp : components) {
        comp->detach();
    }
    components.clear();
    componentMap.clear();
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

void Space::spawn(WorldObject* obj, const Vec3* pos, SpawnReason reason) {
    if (!obj) {
        throw std::runtime_error("Cannot spawn null object");
    }

    objects.push_back(obj);
    objectsById[obj->id] = obj;
    depthSortDirty = true;

    obj->onspawn(pos, reason);
}

void Space::despawn(WorldObject* obj, bool skipOnDespawn) {
    auto it = std::find(objects.begin(), objects.end(), obj);
    if (it == objects.end()) {
        return; // Not in this space
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
            return a->z < b->z;
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
    clearAllSpaces();
}

Space* World::addSpace(const Identifier& spaceId) {
    if (spaceMap.find(spaceId) != spaceMap.end()) {
        throw std::runtime_error("Space '" + spaceId + "' already exists");
    }

    auto space = std::make_unique<Space>(spaceId);
    Space* ptr = space.get();
    spaceMap[spaceId] = ptr;
    spaces.push_back(std::move(space));

    return ptr;
}

void World::removeSpace(const Identifier& spaceId) {
    auto mapIt = spaceMap.find(spaceId);
    if (mapIt == spaceMap.end()) {
        return;
    }

    Space* space = mapIt->second;

    // Remove all objects from objToSpaceMap
    for (auto* obj : space->objects) {
        objToSpaceMap.erase(obj->id);
    }

    // Clear the space
    space->clear();

    // Remove from vector
    for (auto it = spaces.begin(); it != spaces.end(); ++it) {
        if (it->get() == space) {
            spaces.erase(it);
            break;
        }
    }

    spaceMap.erase(spaceId);

    // Update active space if needed
    if (activeSpace == space) {
        activeSpace = spaces.empty() ? nullptr : spaces[0].get();
        activeSpaceId = activeSpace ? activeSpace->id : "";
    }
}

Space* World::getSpace(const Identifier& spaceId) {
    auto it = spaceMap.find(spaceId);
    return it != spaceMap.end() ? it->second : nullptr;
}

void World::setActiveSpace(const Identifier& spaceId) {
    Space* space = getSpace(spaceId);
    if (!space) {
        throw std::runtime_error("Space '" + spaceId + "' does not exist");
    }

    activeSpaceId = spaceId;
    activeSpace = space;
}

void World::spawn(WorldObject* obj, const Vec3* pos, SpawnReason reason) {
    if (!activeSpace) {
        throw std::runtime_error("No active space to spawn object into");
    }

    if (objToSpaceMap.find(obj->id) != objToSpaceMap.end() && reason == SpawnReason::Fresh) {
        throw std::runtime_error("Object '" + obj->id + "' already exists in a space");
    }

    activeSpace->spawn(obj, pos, reason);
    objToSpaceMap[obj->id] = activeSpaceId;

    WorldLifecycleContext ctx;
    ctx.world = this;
    ctx.spaceId = activeSpaceId;
    ctx.reason = reason;
    if (pos) ctx.position = *pos;

    dispatchLifecycleSlot(obj, "spawn", ctx);
}

void World::despawnFromAllSpaces(WorldObject* obj) {
    for (auto& sp : spaces) {
        if (sp->contains(obj->id)) {
            sp->despawn(obj, false);
            break;
        }
    }
    objToSpaceMap.erase(obj->id);
}

void World::despawnFromActiveSpace(WorldObject* obj) {
    if (activeSpace && activeSpace->contains(obj->id)) {
        activeSpace->despawn(obj, false);
        objToSpaceMap.erase(obj->id);
    }
}

void World::transfer(WorldObject* obj, const Identifier& toSpaceId) {
    Space* toSpace = getSpace(toSpaceId);
    if (!toSpace) {
        throw std::runtime_error("Target space '" + toSpaceId + "' does not exist");
    }

    // Find current space
    auto fromIt = objToSpaceMap.find(obj->id);
    if (fromIt == objToSpaceMap.end()) {
        throw std::runtime_error("Object '" + obj->id + "' is not in any space");
    }

    Space* fromSpace = getSpace(fromIt->second);
    if (fromSpace == toSpace) {
        return; // Already in target space
    }

    // Despawn from old space (skip lifecycle)
    fromSpace->despawn(obj, true);

    // Spawn in new space (skip lifecycle)
    toSpace->spawn(obj, nullptr, SpawnReason::Transfer);

    // Update mapping
    objToSpaceMap[obj->id] = toSpaceId;
}

void World::destroy(WorldObject* obj) {
    despawnFromAllSpaces(obj);

    WorldLifecycleContext ctx;
    ctx.world = this;

    dispatchLifecycleSlot(obj, "dispose", ctx);
    obj->dispose();
}

WorldObject* World::getObject(const Identifier& objId) {
    auto spaceIt = objToSpaceMap.find(objId);
    if (spaceIt == objToSpaceMap.end()) {
        return nullptr;
    }

    Space* space = getSpace(spaceIt->second);
    return space ? space->get(objId) : nullptr;
}

Space* World::getSpaceOfObject(const Identifier& objId) {
    auto it = objToSpaceMap.find(objId);
    if (it == objToSpaceMap.end()) {
        return nullptr;
    }
    return getSpace(it->second);
}

void World::dispatchLifecycleSlot(WorldObject* obj, const std::string& slot, const WorldLifecycleContext& ctx) {
    // TODO: Implement handler registry dispatch like in TypeScript
    // For now, this is a stub that can be extended
    (void)obj;
    (void)slot;
    (void)ctx;
}

void World::tick(f64 dt) {
    if (paused) return;

    // Tick all objects in active space
    if (activeSpace) {
        // Copy vector in case objects are added/removed during tick
        std::vector<WorldObject*> toTick = activeSpace->objects;

        for (auto* obj : toTick) {
            if (!obj->markedForDisposal) {
                obj->tick(dt);
            }
        }

        // Clean up disposed objects
        for (auto it = activeSpace->objects.begin(); it != activeSpace->objects.end(); ) {
            if ((*it)->markedForDisposal) {
                WorldObject* obj = *it;
                it = activeSpace->objects.erase(it);
                activeSpace->objectsById.erase(obj->id);
                objToSpaceMap.erase(obj->id);
                obj->dispose();
            } else {
                ++it;
            }
        }
    }
}

void World::clearAllSpaces() {
    for (auto& sp : spaces) {
        sp->clear();
    }
    objToSpaceMap.clear();
}

} // namespace bmsx
