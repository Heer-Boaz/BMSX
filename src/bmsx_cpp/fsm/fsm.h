/*
 * fsm.h - Finite State Machine Library
 * 
 * Main include file for the FSM system.
 * 
 * Components:
 * - fsmtypes.h: Core types (GameEvent, handlers, guards)
 * - statedefinition.h: State blueprint/definition
 * - state.h: Runtime state instance
 * - fsmcontroller.h: State machine controller
 * - fsmlibrary.h: Registries and builder
 * 
 * Usage:
 * 
 *   // Build a state machine definition
 *   auto* def = FSMBuilder("player_fsm")
 *       .initial("idle")
 *       .state("idle")
 *           .onEnter([](State* s, auto) { ... })
 *           .on("run", "running")
 *           .on("jump", "jumping")
 *       .end()
 *       .state("running")
 *           .onTick([](State* s) -> std::optional<std::string> {
 *               if (s->ticks > 60) return "idle";
 *               return std::nullopt;
 *           })
 *           .on("stop", "idle")
 *       .end()
 *       .state("jumping")
 *           .runCheck([](State* s) { return s->ticks > 30; }, "idle")
 *       .end()
 *       .buildAndRegister();
 * 
 *   // Create a state machine instance
 *   auto* machine = ActiveStateMachines::instance().create("player_fsm", &player);
 *   machine->start();
 * 
 *   // Update each frame
 *   ActiveStateMachines::instance().tick_all();
 * 
 *   // Dispatch events
 *   GameEvent evt;
 *   evt.type = "jump";
 *   machine->dispatch(evt);
 */

#pragma once

#include "fsmtypes.h"
#include "statedefinition.h"
#include "state.h"
#include "fsmcontroller.h"
#include "fsmlibrary.h"
