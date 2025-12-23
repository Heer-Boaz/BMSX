/*
 * registry.h - Global object registry for BMSX
 *
 * This mirrors the TypeScript Registry class which:
 * - Stores all Registerable objects by ID
 * - Supports persistent objects that survive clear()
 * - Provides lookup and iteration by type
 */

#ifndef BMSX_REGISTRY_H
#define BMSX_REGISTRY_H

#include "types.h"
#include <string>
#include <unordered_map>
#include <vector>
#include <functional>

namespace bmsx {

// Forward declarations
class WorldObject;
class World;

/* ============================================================================
 * Registerable interface - any object that can be registered
 * ============================================================================ */

// Type alias for identifiers
using Identifier = std::string;

class Registerable {
public:
    virtual ~Registerable() = default;

    // Unique identifier (required) - matches TypeScript registryId
    virtual const Identifier& registryId() const = 0;

    // Helper that returns registryId (for compatibility)
    const std::string& getId() const { return registryId(); }

    // Whether this object persists across clear() calls
    virtual bool isRegistryPersistent() const { return false; }
};

/* ============================================================================
 * Registry - Global object registry (singleton)
 * ============================================================================ */

class Registry {
public:
    // Singleton access
    static Registry& instance();

    // Registration
    void registerObject(Registerable* entity);
    bool deregister(const std::string& id, bool removePersistent = false);
    bool deregister(Registerable* entity, bool removePersistent = false);

    // Lookup
    template<typename T = Registerable>
    T* get(const std::string& id) {
        auto it = m_registry.find(id);
        if (it != m_registry.end()) {
            return dynamic_cast<T*>(it->second);
        }
        return nullptr;
    }

    bool has(const std::string& id) const;

    // Clear non-persistent entries
    void clear();

    // Iteration
    std::vector<Registerable*> getAll() const;
    std::vector<std::string> getAllIds() const;

    std::vector<Registerable*> getPersistentEntities() const;

    template<typename T>
    std::vector<T*> getAllOfType() const {
        std::vector<T*> result;
        for (const auto& [id, entity] : m_registry) {
            if (auto* typed = dynamic_cast<T*>(entity)) {
                result.push_back(typed);
            }
        }
        return result;
    }

    template<typename T>
    std::vector<std::string> getAllIdsOfType() const {
        std::vector<std::string> result;
        for (const auto& [id, entity] : m_registry) {
            if (dynamic_cast<T*>(entity)) {
                result.push_back(id);
            }
        }
        return result;
    }

    template<typename T, typename Func>
    void forEach(Func&& fn) {
        for (auto& [id, entity] : m_registry) {
            if (auto* typed = dynamic_cast<T*>(entity)) {
                fn(typed);
            }
        }
    }

private:
    Registry() = default;
    ~Registry() = default;

    // Non-copyable
    Registry(const Registry&) = delete;
    Registry& operator=(const Registry&) = delete;

    std::unordered_map<std::string, Registerable*> m_registry;
};

} // namespace bmsx

#endif // BMSX_REGISTRY_H
