`timescale 1ns/1ps
// Physical owner of the current Book I 16 x 21 raw-word live slot banks.
// A successful PLAY's already validated source binding is committed by INSTALL;
// a failed PLAY never sends INSTALL. CLEAR is used for explicit stop and ended
// voices; PHASE changes activity without erasing retained words (e.g. a failed
// live source rebind); WRITE commits an executor-originated live word update.
//
// The selected-window decoder supplies a legal 0..20 index and the low four
// bits of the staging SLOT word. Both selected reads and writes wait until the
// external audio timeline has rendered all frames due through that access.
// A commit has priority over selected-window admission on the same edge. An
// active live write presents its complete *new* bank at update_valid and may
// be accepted only when the playback/source owner accepts the update. It is not
// a complete audio controller: source validation, actual playback state, fault
// latching, command sequencing, event emission and the timeline are external.
// update_valid is an arbitrated request, not a reserved transaction: the
// owner samples its fields only on update_valid && update_ready, and a pending
// commit can supersede an unaccepted selected-window request. The controller
// must withhold timeline_ready and competing commits while an accepted update's
// binding or playback effects are still unresolved. INSTALL also commits the
// socket captured by the command executor at PLAY execution. A successful
// live source replacement publishes its access-time socket through rebind_*;
// the source owner must retain that socket while the bind is pending. A failed
// live replacement does not publish, and the external owner deactivates the
// slot and raises SOURCE_RANGE without clearing its raw parameter words.
// The playback memory request uses fetch_slot independently of MMIO selection.
// The reservation owner must prevent competing INSTALL/CLEAR and rebind of the
// same slot; neither this bank nor this register is a cartridge size oracle.
//
// Packed per-slot retained banks implement an explicitly resettable register
// file, not a selected ASIC macro or an area/power/timing estimate. Resettable
// flip-flop register-file practice: OpenHW CVA6 ariane_regfile_ff.sv
// https://github.com/openhwgroup/cva6/blob/master/core/ariane_regfile_ff.sv
module apu_slot_bank (
 input wire clk,reset_n,
 input wire [3:0] selected_slot,
 input wire access_valid,access_write,input wire [4:0] access_index,
 input wire [31:0] access_wdata,input wire timeline_ready,
 output wire access_ready,output reg response_valid,output reg [31:0] response_data,
 input wire commit_valid,output wire commit_ready,input wire [1:0] commit_action,
 input wire [3:0] commit_slot,input wire [671:0] commit_parameters,
 input wire [2:0] commit_phase,input wire [4:0] commit_index,input wire [31:0] commit_word,
 input wire commit_cartridge,
 input wire rebind_valid,input wire [3:0] rebind_slot,input wire rebind_cartridge,
 input wire [3:0] fetch_slot,output wire fetch_active,fetch_cartridge,
 output wire [671:0] fetch_parameters,output wire [15:0] render_mask,
 input wire [3:0] event_slot,output wire [31:0] event_source_address,
 output wire update_valid,input wire update_ready,
 output wire [3:0] update_slot,output wire [4:0] update_index,
 output wire [31:0] update_word,output reg [671:0] update_parameters,
 output wire [2:0] selected_phase,output wire selected_active,
 output wire [31:0] selected_source_address,output wire [15:0] active_mask
);
 localparam [1:0] INSTALL=0,CLEAR=1,PHASE=2,WRITE=3;
 reg [671:0] banks [0:15];
 reg [2:0] phases [0:15];
 reg [15:0] active;
 reg [15:0] cartridge_socket;
 integer i;
 wire selected_write=access_valid && access_write && timeline_ready && !commit_valid;
 wire commit_update=commit_valid && commit_action==WRITE && phases[commit_slot]!=0;
 wire selected_update=selected_write && phases[selected_slot]!=0;
 assign update_valid=commit_update || selected_update;
 assign update_slot=commit_update ? commit_slot : selected_slot;
 assign update_index=commit_update ? commit_index : access_index;
 assign update_word=commit_update ? commit_word : access_wdata;
 always_comb begin
  update_parameters=banks[update_slot];
  update_parameters[update_index*32 +:32]=update_word;
 end
 assign commit_ready=!commit_update || update_ready;
 assign access_ready=timeline_ready && !commit_valid && (!selected_update || update_ready);
 assign active_mask=active;
 assign fetch_active=active[fetch_slot];
 assign fetch_cartridge=cartridge_socket[fetch_slot];
 assign fetch_parameters=banks[fetch_slot];
 // The end-event source read is independent of the playback fetch port.
 // A stalled end must not retarget an unrelated playback descriptor.
 assign event_source_address=banks[event_slot][31:0];
 genvar render_slot;
 generate for(render_slot=0;render_slot<16;render_slot=render_slot+1) begin: render_slots
  assign render_mask[render_slot]=active[render_slot] && !phases[render_slot][2];
 end endgenerate
 assign selected_phase=phases[selected_slot];
 assign selected_active=active[selected_slot];
 assign selected_source_address=active[selected_slot] ? banks[selected_slot][31:0] : 32'd0;
 always @(posedge clk or negedge reset_n) begin
  if(!reset_n) begin
   active<=0;cartridge_socket<=0;response_valid<=0;response_data<=0;
   for(i=0;i<16;i=i+1) begin banks[i]<=0;phases[i]<=0;end
  end else begin
   response_valid<=access_valid && access_ready;
   if(access_valid && access_ready) begin
    response_data<=banks[selected_slot][access_index*32 +:32];
    if(access_write) banks[selected_slot][access_index*32 +:32]<=access_wdata;
   end
   if(commit_valid && commit_ready) begin
    case(commit_action)
     INSTALL: begin banks[commit_slot]<=commit_parameters;phases[commit_slot]<=1;active[commit_slot]<=1;cartridge_socket[commit_slot]<=commit_cartridge;end
     CLEAR: begin banks[commit_slot]<=0;phases[commit_slot]<=0;active[commit_slot]<=0;cartridge_socket[commit_slot]<=0;end
     PHASE: begin phases[commit_slot]<=commit_phase;active[commit_slot]<=commit_phase!=0;end
     WRITE: banks[commit_slot][commit_index*32 +:32]<=commit_word;
    endcase
   end
   if(rebind_valid) cartridge_socket[rebind_slot]<=rebind_cartridge;
  end
 end
endmodule
