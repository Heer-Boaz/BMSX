`timescale 1ns/1ps
// Typed value-store datapath for frame slots and image constants. A physical
// slot is a 4-bit value kind and an opaque 64-bit payload. The kind encoding
// is internal to this owner; Number is 3 and is distinct from every other
// kind, including when its payload is an IEEE binary64 NaN. Numeric writes
// replace both kind and payload in one accepted slot-memory operation.
//
// The frame/image owner supplies slot bases. Memory addresses below are slot
// indices in this internal memory, not guest byte addresses. The same owner
// must arbitrate all other accesses, reserve/initialize storage, and switch
// frames only after outstanding requests drain. Raw access is for the loader,
// value-copy/GC owner, or another execution path; it retains kind and payload
// exactly. This module does not define a public ABI or any collector policy.
//
// slot_mem implements atomic 68-bit writes and an ordered single-outstanding
// read with response backpressure. A read may respond on its admission edge.
// Reset must also cancel any response retained by that memory owner.
// The physical backing owner reports a fault on its currently held request.
// The corresponding source fault remains asserted until shared reset: it is
// not a successful admission, nor a guest-visible exception or a retry. A
// scheduler may use the source identity to quarantine its affected frame or
// loader; the VM fault policy and recovery owner are not yet established.
// Implementing that port using SRAM banks or a narrower physical bus, including
// reset, fault/atomicity and cross-master exclusion, is a separate requirement.
// No area, timing or one-instruction-cycle claim is made for this datapath.
// See the separately-owned storage and handshakes in PicoRV32:
// https://github.com/YosysHQ/picorv32/blob/main/picorv32.v
module cpu_value_store (
 input wire clk,reset_n,
 input wire [31:0] frame_base,constant_base,
 input wire slot_read_valid,output wire slot_read_ready,
 input wire slot_read_constant,input wire [14:0] slot_read_index,
 output wire slot_rsp_valid,input wire slot_rsp_ready,
 output wire slot_rsp_is_number,output wire [63:0] slot_rsp_payload,
 input wire slot_write_valid,output wire slot_write_ready,
 input wire [13:0] slot_write_index,input wire [63:0] slot_write_number,
 input wire raw_valid,output wire raw_ready,input wire raw_write,raw_constant,
 input wire [31:0] raw_index,input wire [3:0] raw_kind,input wire [63:0] raw_payload,
 output wire raw_rsp_valid,input wire raw_rsp_ready,
 output wire [3:0] raw_rsp_kind,output wire [63:0] raw_rsp_payload,
 output wire mem_valid,input wire mem_ready,output wire mem_write,
 output wire [31:0] mem_address,output wire [67:0] mem_wdata,
 input wire mem_rsp_valid,output wire mem_rsp_ready,input wire [67:0] mem_rsp_data,
 input wire mem_fault_valid,output wire raw_fault,slot_write_fault,slot_read_fault
);
 localparam [3:0] NUMBER_KIND=4'd3;
 localparam [1:0] RAW=0, NUMBER_WRITE=1, NUMERIC_READ=2;
 reg pending,pending_raw,held;
 reg [1:0] next_owner,winner;
 reg [1:0] held_owner;
 reg held_write;
 reg [31:0] held_address;
 reg [67:0] held_wdata;
 // Once presented to the memory port, a stalled request owns that port until
 // acceptance. Later, higher-priority arrivals cannot replace its address or
 // payload. The source retains its request until the corresponding ready.
 wire requesting=raw_valid || slot_write_valid || slot_read_valid;
 // A rotating grant orders the three distinct request owners. It bounds
 // contention in accepted operations, not elapsed clocks: an external memory
 // or response consumer may hold an accepted request indefinitely.
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
 assign mem_address=held ? held_address : choose_raw ? (raw_constant ? constant_base : frame_base)+raw_index :
                    choose_write ? frame_base+{18'd0,slot_write_index} :
                    (slot_read_constant ? constant_base : frame_base)+{17'd0,slot_read_index};
 assign mem_wdata=held ? held_wdata : choose_raw ? {raw_kind,raw_payload} : {NUMBER_KIND,slot_write_number};
 assign raw_ready=reset_n && choose_raw && mem_ready;
 assign slot_write_ready=reset_n && choose_write && mem_ready;
 assign slot_read_ready=reset_n && choose_read && mem_ready;
 assign raw_fault=reset_n && mem_fault_valid && choose_raw;
 assign slot_write_fault=reset_n && mem_fault_valid && choose_write;
 assign slot_read_fault=reset_n && mem_fault_valid && choose_read;
 assign mem_rsp_ready=reset_n && (choose_raw_response ? raw_rsp_ready : choose_read_response && slot_rsp_ready);
 assign raw_rsp_valid=reset_n && mem_rsp_valid && choose_raw_response;
 assign raw_rsp_kind=mem_rsp_data[67:64];
 assign raw_rsp_payload=mem_rsp_data[63:0];
 assign slot_rsp_valid=reset_n && mem_rsp_valid && choose_read_response;
 assign slot_rsp_is_number=mem_rsp_data[67:64]==NUMBER_KIND;
 assign slot_rsp_payload=mem_rsp_data[63:0];
 always @(posedge clk or negedge reset_n) begin
  if(!reset_n) begin pending<=0;pending_raw<=0;held<=0;held_owner<=RAW;held_write<=0;held_address<=0;held_wdata<=0;next_owner<=RAW;end
  else begin
   if(!held && mem_valid && !mem_ready) begin
    held<=1;held_owner<=choose_raw ? RAW : choose_write ? NUMBER_WRITE : NUMERIC_READ;
    held_write<=mem_write;held_address<=mem_address;held_wdata<=mem_wdata;
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
