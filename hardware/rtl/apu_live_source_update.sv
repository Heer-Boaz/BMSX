`timescale 1ns/1ps
// Active slot-write owner. The bank has already constructed the complete new
// raw register image; accepting update_valid writes its selected word on the
// same edge. The currently selected cartridge is retained at that edge.
// Non-source fields go directly to the playback action. Source fields bind
// the new image first; nonzero generator kind bypasses memory binding.
//
// The external reservation/timeline owner must prevent a new slot operation
// or frame from overtaking this accepted update until busy falls. A successful
// source-replacement action publishes the captured socket to the bank on the
// same edge playback accepts its new source. On bind failure, playback must
// stop and the bank must receive PHASE=0 before action_ready is asserted;
// raw words stay written. SOURCE_RANGE then remains valid until accepted.
// The binder is an external owner, not a cartridge-capacity oracle here. It
// must share reset or cancel/drain an accepted request before admitting a new
// one: responses carry no generation tag. Same-edge and delayed replies are
// accepted; a delayed responder holds valid until bind_rsp_ready.
module apu_live_source_update (
 input wire clk,reset_n,
 input wire update_valid,output wire update_ready,
 input wire [3:0] update_slot,input wire [4:0] update_index,
 input wire [31:0] update_word,input wire [671:0] update_parameters,
 input wire selected_cartridge,
 output wire busy,
 output wire bind_valid,input wire bind_ready,output wire [671:0] bind_parameters,
 output wire bind_cartridge,input wire bind_rsp_valid,output wire bind_rsp_ready,input wire bind_rsp_ok,
 output wire action_valid,input wire action_ready,output wire action_success,action_source_replace,
 output wire [3:0] action_slot,output wire [4:0] action_index,output wire [31:0] action_word,
 output wire [671:0] action_parameters,output wire action_cartridge,
 output wire rebind_valid,output wire [3:0] rebind_slot,output wire rebind_cartridge,
 output wire fault_valid,input wire fault_ready,output wire [31:0] fault_code,fault_detail
);
 localparam [2:0] IDLE=0,BIND=1,BIND_WAIT=2,ACTION=3,FAULT=4;
 reg [2:0] state;
 reg [3:0] slot;
 reg [4:0] index;
 reg [31:0] word;
 reg [671:0] parameters;
 reg cartridge,source_replace,success;
 wire source_word=update_index<=7 || update_index==19;
 assign update_ready=reset_n && state==IDLE;
 assign busy=state!=IDLE;
 assign bind_valid=reset_n && state==BIND;
 assign bind_parameters=parameters;
 assign bind_cartridge=cartridge;
 assign bind_rsp_ready=reset_n && (state==BIND_WAIT || state==BIND && bind_ready);
 assign action_valid=reset_n && state==ACTION;
 assign action_success=success;
 assign action_source_replace=source_replace;
 assign action_slot=slot;assign action_index=index;assign action_word=word;
 assign action_parameters=parameters;assign action_cartridge=cartridge;
 assign rebind_valid=action_valid && action_ready && success && source_replace;
 assign rebind_slot=slot;assign rebind_cartridge=cartridge;
 assign fault_valid=reset_n && state==FAULT;
 assign fault_code=32'h00000102;assign fault_detail=parameters[0+:32];
 always @(posedge clk or negedge reset_n) begin
  if(!reset_n) begin
   state<=IDLE;slot<=0;index<=0;word<=0;parameters<=0;cartridge<=0;source_replace<=0;success<=0;
  end else case(state)
   IDLE: if(update_valid) begin
    slot<=update_slot;index<=update_index;word<=update_word;parameters<=update_parameters;
    cartridge<=selected_cartridge;source_replace<=source_word;success<=1;
    if(source_word && update_parameters[19*32+:32]==0) state<=BIND;
    else state<=ACTION;
   end
   BIND: if(bind_ready) begin
    if(bind_rsp_valid) begin success<=bind_rsp_ok;state<=ACTION;end
    else state<=BIND_WAIT;
   end
   BIND_WAIT: if(bind_rsp_valid) begin success<=bind_rsp_ok;state<=ACTION;end
   ACTION: if(action_ready) begin if(success) state<=IDLE;else state<=FAULT;end
   FAULT: if(fault_ready) state<=IDLE;
  endcase
 end
endmodule
