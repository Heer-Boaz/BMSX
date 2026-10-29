`timescale 1ns/1ps
// Single in-flight playback-word owner. The source/binding owner supplies the
// chosen path and its native address representation: a local SRAM word index,
// or a full SYS address and the already-bound cartridge socket strobes.
// In particular this circuit does not inspect cartridge capacity, create a
// binding, or decide what a source read outside a bound region means.
//
// Both requests are held until accepted. A complete result, including a SYS
// fault/timeout, is held for the consumer; an upstream decoder must not turn a
// failed transfer into sample data. The local publication/snapshot owner has
// no fault output. An accepted response may arrive on the request edge.
// A queued read cannot be redirected by a later cartridge SELECT write.
// Reset must also cancel/drain any request already accepted by the selected
// target before another request can be issued: this interface has no response
// transaction IDs, so a late pre-reset reply cannot be distinguished from a
// new reply. An unaccepted request is dropped immediately.
// Ready/valid channel retention follows the explicit payload/state separation
// used by OpenTitan prim_fifo_sync:
// https://github.com/lowRISC/opentitan/blob/master/hw/ip/prim/rtl/prim_fifo_sync.sv
module apu_source_word_router (
 input wire clk,reset_n,
 input wire req_valid,output wire req_ready,input wire req_local,
 input wire [16:0] req_local_word,input wire [31:0] req_rom_address,
 input wire [7:0] req_rom_signals,
 input wire req_timeout_enable,input wire [17:0] req_wait_last,
 output wire local_valid,input wire local_ready,output wire [16:0] local_word,
 input wire local_rsp_valid,input wire [31:0] local_rsp_data,
 output wire rom_valid,input wire rom_ready,output wire [31:0] rom_address,
 output wire [7:0] rom_signals,output wire rom_timeout_enable,
 output wire [17:0] rom_wait_last,
 input wire rom_rsp_valid,output wire rom_rsp_ready,
 input wire [31:0] rom_rsp_data,rom_rsp_fault,input wire rom_rsp_timeout,
 output wire rsp_valid,input wire rsp_ready,
 output reg [31:0] rsp_data,rsp_fault,output reg rsp_timeout
);
 localparam [1:0] IDLE=0,ISSUE=1,WAIT_REPLY=2,REPLY=3;
 reg [1:0] state;
 reg local_path;
 reg [16:0] local_address;
 reg [31:0] external_address;
 reg [7:0] external_signals;
 reg timeout_enable;
 reg [17:0] wait_last;
 wire target_ready=local_path ? local_ready : rom_ready;
 wire target_rsp=local_path ? local_rsp_valid : rom_rsp_valid;
 assign req_ready=reset_n && state==IDLE;
 assign local_valid=reset_n && state==ISSUE && local_path;
 assign local_word=local_address;
 assign rom_valid=reset_n && state==ISSUE && !local_path;
 assign rom_address=external_address;
 assign rom_signals=external_signals;
 assign rom_timeout_enable=timeout_enable;
 assign rom_wait_last=wait_last;
 assign rom_rsp_ready=reset_n && !local_path &&
  (state==WAIT_REPLY || (state==ISSUE && rom_ready));
 assign rsp_valid=reset_n && state==REPLY;
 always @(posedge clk or negedge reset_n) begin
  if(!reset_n) begin
   state<=IDLE;local_path<=0;local_address<=0;external_address<=0;
   external_signals<=0;timeout_enable<=0;wait_last<=0;
   rsp_data<=0;rsp_fault<=0;rsp_timeout<=0;
  end else case(state)
   IDLE: if(req_valid) begin
    local_path<=req_local;local_address<=req_local_word;
    external_address<=req_rom_address;external_signals<=req_rom_signals;
    timeout_enable<=req_timeout_enable;wait_last<=req_wait_last;state<=ISSUE;
   end
   ISSUE: if(target_ready) begin
    if(target_rsp) begin
     rsp_data<=local_path ? local_rsp_data : rom_rsp_data;
     rsp_fault<=local_path ? 32'd0 : rom_rsp_fault;
     rsp_timeout<=local_path ? 1'b0 : rom_rsp_timeout;
     state<=REPLY;
    end else state<=WAIT_REPLY;
   end
   WAIT_REPLY: if(target_rsp) begin
    rsp_data<=local_path ? local_rsp_data : rom_rsp_data;
    rsp_fault<=local_path ? 32'd0 : rom_rsp_fault;
    rsp_timeout<=local_path ? 1'b0 : rom_rsp_timeout;
    state<=REPLY;
   end
   REPLY: if(rsp_ready) state<=IDLE;
  endcase
 end
endmodule
