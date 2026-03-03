sed -i 's/elseif spec.emitter == false then/elseif not spec.emitter then/g' src/bmsx/res/bios/eventemitter.lua
sed -i 's/if event.emitter == false then/if not event.emitter then/g' src/bmsx/res/bios/fsm.lua
