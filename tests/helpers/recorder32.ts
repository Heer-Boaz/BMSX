export const RECORDER32_MODULES = ['testlib/fsm/transition_recorder', 'testlib/actioneffects/recorder', 'cartlib/clock'];
export const RECORDER32_INITIALIZE = `
local fsm<const> = require('testlib/fsm/transition_recorder')
local effects<const> = require('testlib/actioneffects/recorder')
recorder_roots = {
 fsm.new({id='machine.instance',def_id='machine'},3),
 effects.new({owner={id='owner',definition_id='definition'}},3),
 {def_id='lane'}, {def_id='before'}, {def_id='after'},
 fsm.record, effects.record,
}
return recorder_roots
`;

// Requesting a non-power-of-two capacity also checks the producer
// representation: the allocated ring rounds up before masking word counters.
export const RECORDER32_ROM_SOURCE = `
local fsm<const> = require('testlib/fsm/transition_recorder')
local effects<const> = require('testlib/actioneffects/recorder')
local boot<const> = require('test/boot')
return boot.pcall(function()
 local channel<const> = fsm.new({id='machine.instance',def_id='machine'},3)
 local effect<const> = effects.new({owner={id='owner',definition_id='definition'}},3)
 local lane<const>, before<const>, after<const> = {def_id='lane'}, {def_id='before'}, {def_id='after'}
 local checks = 0
 for _,start in boot.ipairs({0x7ffffffd,0xfffffffd}) do
  channel[4]=start; effect[4]=start
  for batch=0,2 do
   for index=1,4 do
    fsm.record(channel,lane,before,after,index==2)
    effects.record(effect,index==2 and 'trigger' or 'activate','fire',index==2 and 'accepted' or index)
   end
   for index=1,4 do
    local expected<const> = start+batch*4+index
    local slot<const> = ((expected-1)&3)+1
    local record<const> = channel[5][slot]
    local fact<const> = effect[5][slot]
    if record[1]~=expected or fact[1]~=expected or channel[3]~=4 or effect[3]~=4 then boot.error('wrapping recorder position') end
    if record[3]~='lane' or record[4]~='before' or record[5]~='after' or record[6]~=(index==2) then boot.error('FSM record contents') end
    if fact[3]~=(index==2 and 'trigger' or 'activate') or fact[4]~='fire' or fact[5]~=(index==2 and 'accepted' or index) then boot.error('effect record contents') end
    checks=checks+1
   end
  end
 end
 return checks,channel[4],channel[3],effect[4],effect[3]
end)
`;

export const RECORDER32_BOOT_SOURCE = `setmetatable=require([[kernel/gc_barrier]]).set_metatable
return {pcall=__bmsx_pcall,error=__bmsx_error,ipairs=function(t)
 local i=0; return function() i=i+1; if i<=#t then return i,t[i] end end
end}`;
