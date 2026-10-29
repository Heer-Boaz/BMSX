`timescale 1ns/1ps
// APU source-binding owner: the complete console-owned sample-RAM extent is
// checked here, while ROM binding is delegated to a separately designed ROM
// owner. The external interface does not prescribe a capacity query, imply
// that a cartridge reports its length, or select the proposed bus-window
// semantics. That owner must implement whichever ROM contract is approved.
// Invalid ranges and zero-sized requests fail before delegation; ROM requests
// in the corresponding mapped window retain their complete raw descriptor and
// execution-time cartridge selection until the external result returns.
//
// A successful decision retains the descriptor until commit. commit_ready is
// asserted independently of commit_valid: PLAY setup uses commit_valid as an
// atomic acceptance strobe alongside its slot and cursor updates. On failure
// no descriptor is published. This is reservation before publication, not
// rollback of a committed write. Shared reset or external cancellation/drain
// is required for untagged ROM work before accepting a new binding.
//
// Decoder identity, format metadata and the 32-bit channel word are retained
// in full; this module does not silently narrow the BADP decoder's channels or
// assume that SOURCE_BYTES limits all later decoder reads. There is no complete
// physical ROM-binder, decoder integration or silicon timing claim here.
// Stable request/result and storage separation follow OpenTitan prim_fifo_sync:
// https://github.com/lowRISC/opentitan/blob/master/hw/ip/prim/rtl/prim_fifo_sync.sv
module apu_source_bind (
 input wire clk,reset_n,
 input wire bind_valid,output wire bind_ready,input wire [671:0] bind_parameters,input wire bind_cartridge,
 output wire bind_rsp_valid,input wire bind_rsp_ready,output wire bind_rsp_ok,
 output wire external_valid,input wire external_ready,output wire [671:0] external_parameters,
 output wire external_cartridge,output wire [1:0] external_region,
 input wire external_rsp_valid,output wire external_rsp_ready,input wire external_rsp_ok,
 output wire commit_ready,input wire commit_valid,
 output wire published_valid,output wire [671:0] published_parameters,
 output wire published_cartridge,output wire [1:0] published_region
);
 localparam [2:0] IDLE=0,EXTERNAL=1,EXTERNAL_WAIT=2,REPLY=3,HELD=4;
 localparam [1:0] LOCAL=0,SYSTEM_ROM=1,CART_ROM=2;
 reg [2:0] state;
 reg [671:0] parameters;
 reg cartridge,ok;
 reg [1:0] region;
 wire [31:0] start=bind_parameters[0+:32];
 wire [31:0] length=bind_parameters[32+:32];
 wire [32:0] end_exclusive={1'b0,start}+{1'b0,length};
 wire in_local=start>=32'h40000000 && end_exclusive<=33'h040080000;
 wire in_system=start<32'h01000000 && end_exclusive<=33'h001000000;
 wire in_cart=start>=32'h10000000 && start<32'h30000000 && end_exclusive<=33'h030000000;
 assign bind_ready=reset_n && state==IDLE;
 assign bind_rsp_valid=reset_n && state==REPLY;
 assign bind_rsp_ok=ok;
 assign external_valid=reset_n && state==EXTERNAL;
 assign external_parameters=parameters;
 assign external_cartridge=cartridge;
 assign external_region=region;
 assign external_rsp_ready=reset_n && (state==EXTERNAL_WAIT || (state==EXTERNAL && external_ready));
 assign commit_ready=reset_n && state==HELD;
 assign published_valid=commit_ready && commit_valid;
 assign published_parameters=parameters;
 assign published_cartridge=cartridge;
 assign published_region=region;
 always @(posedge clk or negedge reset_n) begin
  if(!reset_n) begin state<=IDLE;parameters<=0;cartridge<=0;ok<=0;region<=LOCAL;end
  else case(state)
   IDLE: if(bind_valid && bind_ready) begin
    parameters<=bind_parameters;cartridge<=bind_cartridge;
    if(length==0) begin ok<=0;region<=LOCAL;state<=REPLY;end
    else if(in_local) begin ok<=1;region<=LOCAL;state<=REPLY;end
    else if(in_system || in_cart) begin region<=in_system ? SYSTEM_ROM : CART_ROM;state<=EXTERNAL;end
    else begin ok<=0;region<=LOCAL;state<=REPLY;end
   end
   EXTERNAL: if(external_ready) begin
    if(external_rsp_valid) begin ok<=external_rsp_ok;state<=REPLY;end
    else state<=EXTERNAL_WAIT;
   end
   EXTERNAL_WAIT: if(external_rsp_valid) begin ok<=external_rsp_ok;state<=REPLY;end
   REPLY: if(bind_rsp_ready) begin if(ok) state<=HELD;else state<=IDLE;end
   HELD: if(commit_valid) state<=IDLE;
  endcase
 end
endmodule
