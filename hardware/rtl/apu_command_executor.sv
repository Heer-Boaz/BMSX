`timescale 1ns/1ps
// Command sequencer for the existing 21-word Book I APU command FIFO.
// service_ready admits the execution boundary after all audio edges due through
// that boundary. The FIFO head is captured only on command_consume: it may be
// replaced by an enqueue while full and must not be prefetched while stalled.
// The target and cartridge selection are captured at that boundary.
//
// For PLAY, the source owner must check the complete bound extent and retain
// the supplied socket. Nonzero generator kinds bypass source binding. The
// request/response is an external physical owner: this module does not invent
// cartridge capacity, ROM presence or actual memory access. A failed bind
// raises SOURCE_RANGE and never emits an install. A binder may complete on
// request acceptance or later; a delayed response remains valid until ready.
// Accepted untagged binder work must be cancelled/drained or reset together
// with this owner before another request is admitted after reset.
//
// action_valid is an atomic request to the *combined* slot/playback owner.
// That owner must accept both the specified bank action and its voice effect
// together, and reserve the target against live writes or natural ends whenever
// reservation_valid is high, including the admission edge. query_slot identifies
// the just-consumed head on that edge and the captured target afterward.
// slot_phase must describe query_slot while reserved. A timeline barrier must
// also preserve audio-frame order for the whole reservation, including a long
// bind or action stall; service_ready on its own does not supply this barrier.
// action_ready acknowledges the complete effect, not merely a register write. Timing, playback, source
// replacement, fade progress, events and the first-fault latch remain external.
// The ready/valid retention pattern follows the explicit state separation used
// by MiSTer SNES DSP and OpenTitan prim_fifo_sync; arithmetic is BMSX-specific.
// https://github.com/MiSTer-devel/SNES_MiSTer/blob/master/rtl/DSP.vhd
// https://github.com/lowRISC/opentitan/blob/master/hw/ip/prim/rtl/prim_fifo_sync.sv
module apu_command_executor (
 input wire clk,reset_n,
 input wire service_ready,input wire command_valid,output wire command_consume,
 input wire [31:0] command_word,input wire [671:0] command_parameters,
 input wire [0:0] selected_cartridge,
 output wire busy,reservation_valid,output wire [3:0] query_slot,input wire [2:0] slot_phase,
 output wire bind_valid,input wire bind_ready,output wire [671:0] bind_parameters,
 output wire [0:0] bind_cartridge,input wire bind_rsp_valid,output wire bind_rsp_ready,
 input wire bind_rsp_ok,
 output wire action_valid,input wire action_ready,
 output reg [1:0] action_bank_op,output wire [31:0] action_command,
 output wire [3:0] action_slot,output wire [671:0] action_parameters,
 output reg [2:0] action_phase,output wire [4:0] action_index,
 output wire [31:0] action_word,output wire [0:0] action_cartridge,
 output wire fault_valid,input wire fault_ready,output wire [31:0] fault_code,fault_detail
);
 localparam [2:0] IDLE=0,DECODE=1,BIND=2,BIND_WAIT=3,ACTION=4,FAULT=5;
 localparam [1:0] INSTALL=0,CLEAR=1,PHASE=2,WRITE=3;
 reg [2:0] state;
 reg [31:0] command;
 reg [671:0] parameters;
 reg cartridge;
 assign busy=state!=IDLE;
 assign command_consume=reset_n && state==IDLE && service_ready && command_valid;
 assign reservation_valid=busy || command_consume;
 assign query_slot=command_consume ? command_parameters[10*32 +:4] : parameters[10*32 +:4];
 assign bind_valid=reset_n && state==BIND;
 assign bind_parameters=parameters;
 assign bind_cartridge=cartridge;
 assign bind_rsp_ready=reset_n && (state==BIND_WAIT || state==BIND && bind_ready);
 assign action_valid=reset_n && state==ACTION;
 assign action_command=command;
 assign action_slot=query_slot;
 assign action_parameters=parameters;
 assign action_index=5'd12;
 assign action_word=parameters[12*32 +:32];
 assign action_cartridge=cartridge;
 assign fault_valid=reset_n && state==FAULT;
 assign fault_code=32'h00000102;
 assign fault_detail=parameters[0+:32];
 always @(posedge clk or negedge reset_n) begin
  if(!reset_n) begin
   state<=IDLE;command<=0;parameters<=0;cartridge<=0;
   action_bank_op<=INSTALL;action_phase<=0;
  end else case(state)
   IDLE: if(command_consume) begin
    command<=command_word;parameters<=command_parameters;
    cartridge<=selected_cartridge;state<=DECODE;
   end
   DECODE: case(command)
    1: if(parameters[19*32 +:32]!=0) begin
     action_bank_op<=INSTALL;action_phase<=1;state<=ACTION;
    end else state<=BIND;
    2: if(slot_phase==0 || parameters[18*32 +:32]==0) begin
     action_bank_op<=CLEAR;action_phase<=0;state<=ACTION;
    end else begin
     action_bank_op<=PHASE;action_phase<=3'b010 | (slot_phase & 3'b100);state<=ACTION;
    end
    3: begin action_bank_op<=WRITE;action_phase<=slot_phase;state<=ACTION;end
    4: if(slot_phase!=0 && (slot_phase & 3'b100)==0) begin
     action_bank_op<=PHASE;action_phase<=slot_phase | 3'b100;state<=ACTION;
    end else state<=IDLE;
    5: if((slot_phase & 3'b100)!=0) begin
     action_bank_op<=PHASE;action_phase<=slot_phase & 3'b011;state<=ACTION;
    end else state<=IDLE;
   endcase
   BIND: if(bind_ready) begin
    if(bind_rsp_valid) begin
     if(bind_rsp_ok) begin action_bank_op<=INSTALL;action_phase<=1;state<=ACTION;end
     else state<=FAULT;
    end else state<=BIND_WAIT;
   end
   BIND_WAIT: if(bind_rsp_valid) begin
    if(bind_rsp_ok) begin action_bank_op<=INSTALL;action_phase<=1;state<=ACTION;end
    else state<=FAULT;
   end
   ACTION: if(action_ready) state<=IDLE;
   FAULT: if(fault_ready) state<=IDLE;
  endcase
 end
endmodule
