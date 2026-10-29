`timescale 1ns/1ps
// Physical one-instruction fetch sequencer for the BLua32 execution owner.
// CPU instruction bytes are big-endian; the memory router returns little-endian
// raw words.  The caller provides the PC and execution-domain bus strobes (a
// cartridge instruction stream remains on its bound socket).  A WIDE prefix
// owns exactly one following word, including across 32-bit address wrap.
// Faults report the original instruction PC, including for a failed body read.
// The nested WIDE body is passed to the caller, since decoding a skipped
// instruction must not execute a hard halt. No speculative reads are issued.
// This is not an execution core, instruction cache, or one-cycle guarantee.
// Ibex uses a separate fetch request/response owner with PC-associated faults:
// https://github.com/lowRISC/ibex/blob/master/doc/03_reference/instruction_fetch.rst
module cpu_instruction_fetch (
 input wire clk,reset_n,
 input wire req_valid,output wire req_ready,input wire [31:0] req_pc,
 input wire [7:0] req_bus_signals,
 output wire mem_valid,input wire mem_ready,output wire [31:0] mem_address,
 output wire [7:0] mem_bus_signals,
 input wire mem_rsp_valid,input wire [31:0] mem_rsp_data,input wire [31:0] mem_rsp_fault,
 output wire rsp_valid,input wire rsp_ready,
 output reg [31:0] rsp_pc,rsp_next_pc,rsp_prefix,rsp_body,
 output reg rsp_wide,rsp_misaligned,rsp_bus_fault
);
 localparam [2:0] IDLE=0,FIRST_REQ=1,FIRST_WAIT=2,BODY_REQ=3,BODY_WAIT=4,REPLY=5;
 reg [2:0] state;
 reg [31:0] pc;
 reg [7:0] signals;
 wire [31:0] instruction={mem_rsp_data[7:0],mem_rsp_data[15:8],mem_rsp_data[23:16],mem_rsp_data[31:24]};
 assign req_ready=reset_n && state==IDLE;
 assign mem_valid=reset_n && (state==FIRST_REQ || state==BODY_REQ);
 assign mem_address=pc+(state==BODY_REQ ? 32'd4:32'd0);
 assign mem_bus_signals=signals;
 assign rsp_valid=reset_n && state==REPLY;
 always @(posedge clk or negedge reset_n) begin
  if(!reset_n) begin
   state<=IDLE;pc<=0;signals<=0;rsp_pc<=0;rsp_next_pc<=0;rsp_prefix<=0;rsp_body<=0;
   rsp_wide<=0;rsp_misaligned<=0;rsp_bus_fault<=0;
  end else case(state)
   IDLE: if(req_valid && req_ready) begin
    pc<=req_pc;signals<=req_bus_signals;rsp_pc<=req_pc;
    rsp_misaligned<=req_pc[1:0]!=0;rsp_bus_fault<=0;rsp_wide<=0;
    if(req_pc[1:0]!=0) state<=REPLY;else state<=FIRST_REQ;
   end
   FIRST_REQ: if(mem_ready) state<=FIRST_WAIT;
   FIRST_WAIT: if(mem_rsp_valid) begin
    if(mem_rsp_fault!=0) begin rsp_bus_fault<=1;state<=REPLY;end
    else begin
     rsp_prefix<=instruction;
     if(instruction[23:18]==0) begin rsp_wide<=1;state<=BODY_REQ;end
     else begin rsp_body<=instruction;rsp_next_pc<=pc+32'd4;state<=REPLY;end
    end
   end
   BODY_REQ: if(mem_ready) state<=BODY_WAIT;
   BODY_WAIT: if(mem_rsp_valid) begin
    if(mem_rsp_fault!=0) rsp_bus_fault<=1;
    else begin rsp_body<=instruction;rsp_next_pc<=pc+32'd8;end
    state<=REPLY;
   end
   REPLY: if(rsp_ready) state<=IDLE;
  endcase
 end
endmodule
