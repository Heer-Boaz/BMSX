`timescale 1ns/1ps
// Compact frame/image value owner. This is an alternative to cpu_value_store,
// not a conversion of its 68-bit raw slots. Raw clients supply and receive the
// complete 64-bit compact representation, including all otherwise unusual
// patterns. Number writeback is a distinct producer operation; the compact
// storage owner canonicalizes NaNs only for that operation. Number reads return
// the storage owner's classification and raw bits to the execution owner.
//
// Frame and image owners provide slot bases and must reserve the private region,
// retain objects and switch frames only with operations drained. The single
// memory port arbitrates raw, numeric-write and numeric-read requests by a
// rotating priority and retains each request and source until completion.
// A backing fault holds the selected source in fail-stop until shared reset;
// it is neither a successful writeback nor a guest-visible exception policy.
// No allocator, object-handle producer, loader, GC, instruction charge or
// silicon timing is implied. Raw slot copying and Number canonicalization
// correspond to distinct operations in the project's C++ Value owner.
// Production reference for register arbitration/handshake ownership:
// https://github.com/YosysHQ/picorv32/blob/main/picorv32.v
// https://github.com/WebKit/WebKit/blob/main/Source/JavaScriptCore/runtime/JSCJSValue.h
module cpu_compact_value_store (
 input wire clk,reset_n,
 input wire [31:0] frame_base,constant_base,
 input wire slot_read_valid,output wire slot_read_ready,
 input wire slot_read_constant,input wire [14:0] slot_read_index,
 output wire slot_rsp_valid,input wire slot_rsp_ready,
 output wire slot_rsp_is_number,output wire [63:0] slot_rsp_payload,
 input wire slot_write_valid,output wire slot_write_ready,
 input wire [13:0] slot_write_index,input wire [63:0] slot_write_number,
 input wire raw_valid,output wire raw_ready,input wire raw_write,raw_constant,
 input wire [31:0] raw_index,input wire [63:0] raw_wdata,
 output wire raw_rsp_valid,input wire raw_rsp_ready,output wire [63:0] raw_rsp_data,
 output wire mem_valid,input wire mem_ready,output wire mem_write,mem_number,
 output wire [31:0] mem_address,output wire [63:0] mem_wdata,
 input wire mem_rsp_valid,output wire mem_rsp_ready,input wire [63:0] mem_rsp_data,
 input wire mem_rsp_is_number,input wire mem_fault_valid,
 output wire raw_fault,slot_write_fault,slot_read_fault
);
 localparam [1:0] RAW=0, NUMBER_WRITE=1, NUMERIC_READ=2;
 reg pending,pending_raw,held;
 reg [1:0] next_owner,winner,held_owner;
 reg held_write,held_number;
 reg [31:0] held_address;
 reg [63:0] held_wdata;
 wire requesting=raw_valid || slot_write_valid || slot_read_valid;
 always @* begin
  case(next_owner)
   RAW: winner=raw_valid ? RAW : slot_write_valid ? NUMBER_WRITE : NUMERIC_READ;
   NUMBER_WRITE: winner=slot_write_valid ? NUMBER_WRITE : slot_read_valid ? NUMERIC_READ : RAW;
   default: winner=slot_read_valid ? NUMERIC_READ : raw_valid ? RAW : NUMBER_WRITE;
  endcase
 end
 wire choose_raw=!pending && (held ? held_owner==RAW : requesting && winner==RAW);
 wire choose_write=!pending && (held ? held_owner==NUMBER_WRITE : requesting && winner==NUMBER_WRITE);
 wire choose_read=!pending && (held ? held_owner==NUMERIC_READ : requesting && winner==NUMERIC_READ);
 wire choose_read_response=pending ? !pending_raw : choose_read;
 wire choose_raw_response=pending ? pending_raw : (choose_raw && !mem_write);
 assign mem_valid=reset_n && (choose_raw || choose_write || choose_read);
 assign mem_write=held ? held_write : choose_raw ? raw_write : choose_write;
 assign mem_number=held ? held_number : choose_write;
 assign mem_address=held ? held_address : choose_raw ? (raw_constant ? constant_base : frame_base)+raw_index :
                    choose_write ? frame_base+{18'd0,slot_write_index} :
                    (slot_read_constant ? constant_base : frame_base)+{17'd0,slot_read_index};
 assign mem_wdata=held ? held_wdata : choose_raw ? raw_wdata : slot_write_number;
 assign raw_ready=reset_n && choose_raw && mem_ready;
 assign slot_write_ready=reset_n && choose_write && mem_ready;
 assign slot_read_ready=reset_n && choose_read && mem_ready;
 assign raw_fault=reset_n && mem_fault_valid && choose_raw;
 assign slot_write_fault=reset_n && mem_fault_valid && choose_write;
 assign slot_read_fault=reset_n && mem_fault_valid && choose_read;
 assign mem_rsp_ready=reset_n && (choose_raw_response ? raw_rsp_ready : choose_read_response && slot_rsp_ready);
 assign raw_rsp_valid=reset_n && mem_rsp_valid && choose_raw_response;
 assign raw_rsp_data=mem_rsp_data;
 assign slot_rsp_valid=reset_n && mem_rsp_valid && choose_read_response;
 assign slot_rsp_is_number=mem_rsp_is_number;
 assign slot_rsp_payload=mem_rsp_data;
 always @(posedge clk or negedge reset_n) begin
  if(!reset_n) begin
   pending<=0;pending_raw<=0;held<=0;held_owner<=RAW;held_write<=0;held_number<=0;
   held_address<=0;held_wdata<=0;next_owner<=RAW;
  end else begin
   if(!held && mem_valid && !mem_ready) begin
    held<=1;held_owner<=choose_raw ? RAW : choose_write ? NUMBER_WRITE : NUMERIC_READ;
    held_write<=mem_write;held_number<=mem_number;held_address<=mem_address;held_wdata<=mem_wdata;
   end else if(held && mem_ready) held<=0;
   if(mem_valid && mem_ready) begin
    if(choose_raw) next_owner<=NUMBER_WRITE;
    else if(choose_write) next_owner<=NUMERIC_READ;
    else next_owner<=RAW;
   end
   if(pending) begin
    if(mem_rsp_valid && mem_rsp_ready) pending<=0;
   end else if(mem_valid && mem_ready && !mem_write && !(mem_rsp_valid && mem_rsp_ready)) begin
    pending<=1;pending_raw<=choose_raw;
   end
  end
 end
endmodule
