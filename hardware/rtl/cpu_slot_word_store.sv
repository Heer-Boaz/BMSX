`timescale 1ns/1ps
// Physical typed-slot access over the CORE 32-bit scalar-memory interface.
// Each slot occupies three aligned words in an explicitly allocated region:
// payload[31:0], payload[63:32], then kind in bits 3:0 of the third word.
// Address arithmetic is native 32-bit byte-address arithmetic; allocation,
// region ownership, lifetime and bounds belong to the VM/frame owner.
//
// A held slot request is not accepted until all three physical words complete.
// The first two CORE requests set req_hold; the last releases that reservation.
// Other masters must use the same CORE arbiter for exclusive visibility. The
// reservation does not protect bypass paths, nor does it make a reset or bus
// fault transactional: a partially written row remains in physical memory.
// A fault is exposed with the address and completed-word count, not converted to
// success; the surrounding VM/reset owner determines subsequent action.
// As with CORE, each physical response arrives after its request is accepted;
// RESET_N resets both owners and cancels any unconsumed response. The source
// must hold its slot request until mem_ready or shared reset.
//
// The selected physical region is NOT established by this module. In
// particular, no guest-RAM space is silently reserved by this implementation.
// https://github.com/pulp-platform/axi/blob/master/src/axi_serializer.sv
module cpu_slot_word_store (
 input wire clk,reset_n,
 input wire [31:0] region_base,
 input wire mem_valid,output wire mem_ready,input wire mem_write,
 input wire [31:0] mem_address,input wire [67:0] mem_wdata,
 output wire mem_rsp_valid,input wire mem_rsp_ready,output wire [67:0] mem_rsp_data,
 output wire req_valid,input wire req_ready,output wire req_write,req_hold,
 output wire [31:0] req_address,req_wdata,
 input wire rsp_valid,input wire [31:0] rsp_rdata,rsp_fault_code,input wire rsp_timeout,
 output reg fault_valid,output reg [31:0] fault_address,fault_code,
 output reg fault_timeout,fault_write,output reg [1:0] fault_words_completed
);
 localparam [2:0] IDLE=0,ISSUE=1,WAIT_WORD=2,COMPLETE=3,HOLD_RESPONSE=4,FAULT=5;
 reg [2:0] state;
 reg [1:0] word_index;
 reg write_latch;
 reg [31:0] address_latch;
 reg [67:0] data_latch,read_latch;
 wire active=reset_n && state==ISSUE;
 assign req_valid=active;
 assign req_write=write_latch;
 assign req_hold=word_index!=2;
 assign req_address=address_latch+{28'd0,word_index,2'b00};
 assign req_wdata=word_index==0 ? data_latch[31:0] : word_index==1 ? data_latch[63:32] : {28'd0,data_latch[67:64]};
 assign mem_ready=reset_n && state==COMPLETE;
 assign mem_rsp_valid=reset_n && (state==HOLD_RESPONSE || state==COMPLETE && !write_latch);
 assign mem_rsp_data=read_latch;
 always @(posedge clk or negedge reset_n) begin
  if(!reset_n) begin
   state<=IDLE;word_index<=0;write_latch<=0;address_latch<=0;data_latch<=0;read_latch<=0;
   fault_valid<=0;fault_address<=0;fault_code<=0;fault_timeout<=0;fault_write<=0;fault_words_completed<=0;
  end else case(state)
   IDLE: if(mem_valid) begin
    address_latch<=region_base+(mem_address<<3)+(mem_address<<2);
    data_latch<=mem_wdata;write_latch<=mem_write;word_index<=0;state<=ISSUE;
   end
   ISSUE: if(req_ready) state<=WAIT_WORD;
   WAIT_WORD: if(rsp_valid) begin
    if(rsp_fault_code!=0 || rsp_timeout) begin
     fault_valid<=1;fault_address<=req_address;fault_code<=rsp_fault_code;
     fault_timeout<=rsp_timeout;fault_write<=write_latch;fault_words_completed<=word_index;
     state<=FAULT;
    end else begin
     if(!write_latch) case(word_index)
      0:read_latch[31:0]<=rsp_rdata;
      1:read_latch[63:32]<=rsp_rdata;
      2:read_latch[67:64]<=rsp_rdata[3:0];
     endcase
     if(word_index==2) state<=COMPLETE;
     else begin word_index<=word_index+1'b1;state<=ISSUE;end
    end
   end
   COMPLETE: if(mem_valid) begin
    if(write_latch || mem_rsp_ready) state<=IDLE;
    else state<=HOLD_RESPONSE;
   end
   HOLD_RESPONSE: if(mem_rsp_ready) state<=IDLE;
  endcase
 end
endmodule
