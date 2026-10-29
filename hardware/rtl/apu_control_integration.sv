`timescale 1ns/1ps
// APU control-plane integration. The playback action, source binder, frame
// worker, sample snapshots, fault latch and MMIO decoder are external owners.
// In particular, a binder must share reset or cancel/drain any accepted
// untagged request before the control plane is released from reset.
//
// The slot bank may accept an active WRITE before its live playback effect is
// complete. write_started prevents a second bank write while the executor's
// action remains reserved, and completion waits for the live owner to finish.
// No frame or selected-window access may overtake either reservation.
// A frame worker must retain its natural ends and issue frame_done only after
// every corresponding end handshake. The timeline blocks later commands for
// the whole frame; a late end after frame_done could otherwise clear a newer
// voice in the same slot. The external frame worker owns this invariant.
// Timing synchronization follows the stream-before-register-mutation approach
// in MAME's SPU; ownership and handshakes here are specific to BMSX.
// https://github.com/mamedev/mame/blob/master/src/devices/sound/spu.cpp
module apu_control_integration (
 input wire clk,reset_n,
 input wire ingress_valid,ingress_write,input wire [4:0] ingress_index,input wire [31:0] ingress_wdata,
 output wire ingress_ready,ingress_response,output wire [31:0] ingress_rdata,
 output wire ingress_fault,output wire [31:0] ingress_fault_detail,
 input wire selected_valid,selected_write,input wire [4:0] selected_index,input wire [31:0] selected_wdata,
 output wire selected_ready,selected_response,output wire [31:0] selected_rdata,
 input wire selected_cartridge,
 output wire bind_valid,input wire bind_ready,output wire [671:0] bind_parameters,output wire bind_cartridge,
 input wire bind_rsp_valid,output wire bind_rsp_ready,input wire bind_rsp_ok,
 output wire cmd_effect_valid,input wire cmd_effect_ready,output wire [31:0] cmd_effect_command,
 output wire [3:0] cmd_effect_slot,output wire [671:0] cmd_effect_parameters,
 output wire [2:0] cmd_effect_phase,output wire cmd_effect_cartridge,
 output wire live_effect_valid,input wire live_effect_ready,output wire live_effect_success,live_effect_source_replace,
 output wire [3:0] live_effect_slot,output wire [4:0] live_effect_index,output wire [31:0] live_effect_word,
 output wire [671:0] live_effect_parameters,output wire live_effect_cartridge,
 output wire cmd_fault_valid,input wire cmd_fault_ready,output wire [31:0] cmd_fault_code,cmd_fault_detail,
 output wire live_fault_valid,input wire live_fault_ready,output wire [31:0] live_fault_code,live_fault_detail,
 input wire snapshot_overflow,output wire snapshot_history_lost,
 output wire frame_valid,input wire frame_ready,input wire frame_done,output wire frame_tick,
 output wire [31:0] sample_sequence,completed_sequence,output wire [63:0] pending_frames,
 input wire end_valid,output wire end_ready,input wire [3:0] end_slot,
 output wire [31:0] event_kind,event_slot,event_source_address,event_sequence,user_irq_raise,
 input wire [3:0] fetch_slot,output wire [671:0] fetch_parameters,output wire fetch_active,fetch_cartridge,
 output wire [15:0] active_mask,render_mask,output wire [4:0] queued_count
);
 wire timeline_ready,capture_ready,exec_busy,reservation,command_valid,command_consume,live_busy;
 wire [3:0] selected_slot,query_slot;wire [2:0] selected_phase;
 wire [31:0] command_word;wire [671:0] command_parameters;
 wire exec_bind_valid,exec_bind_rsp_ready,live_bind_valid,live_bind_rsp_ready;
 wire [671:0] exec_bind_parameters,live_bind_parameters;wire exec_bind_cartridge,live_bind_cartridge;
 wire exec_action_valid,exec_action_ready;wire [1:0] exec_action_op;
 wire [31:0] exec_action_command,exec_action_word;wire [3:0] exec_action_slot;
 wire [671:0] exec_action_parameters;wire [2:0] exec_action_phase;wire [4:0] exec_action_index;wire exec_action_cartridge;
 wire update_valid,update_ready;wire [3:0] update_slot;wire [4:0] update_index;wire [31:0] update_word;wire [671:0] update_parameters;
 wire live_action_ready,rebind_valid,rebind_cartridge;wire [3:0] rebind_slot;
 wire end_commit,end_commit_ready;wire [3:0] end_commit_slot;
 wire bank_commit_ready;wire [671:0] bank_fetch_parameters;wire bank_fetch_active,bank_fetch_cartridge;
 wire [31:0] bank_event_source_address;
 reg write_started;
 wire control_busy=exec_busy || live_busy || write_started;
 apu_frame_timeline timeline(.clk(clk),.reset_n(reset_n),.executor_busy(control_busy),
  .snapshot_overflow(snapshot_overflow),.snapshot_history_lost(snapshot_history_lost),.timeline_ready(timeline_ready),.capture_ready(capture_ready),
  .frame_valid(frame_valid),.frame_ready(frame_ready),.frame_done(frame_done),.sample_sequence(sample_sequence),
  .completed_sequence(completed_sequence),.pending_frames(pending_frames),.frame_tick(frame_tick));
 apu_command_ingress ingress(.clk(clk),.reset_n(reset_n),.access_valid(ingress_valid),.access_write(ingress_write),
  .access_index(ingress_index),.access_wdata(ingress_wdata),.timeline_ready(capture_ready),
  .access_ready(ingress_ready),.response_valid(ingress_response),.response_data(ingress_rdata),
  .fault_raise(ingress_fault),.fault_detail(ingress_fault_detail),.selected_slot(selected_slot),.queued_count(queued_count),
  .command_valid(command_valid),.command_consume(command_consume),.command_word(command_word),.command_parameters(command_parameters));
 apu_command_executor executor(.clk(clk),.reset_n(reset_n),.service_ready(timeline_ready),.command_valid(command_valid),
  .command_consume(command_consume),.command_word(command_word),.command_parameters(command_parameters),
  .selected_cartridge(selected_cartridge),.busy(exec_busy),.reservation_valid(reservation),.query_slot(query_slot),.slot_phase(selected_phase),
  .bind_valid(exec_bind_valid),.bind_ready(bind_ready && exec_bind_valid),.bind_parameters(exec_bind_parameters),.bind_cartridge(exec_bind_cartridge),
  .bind_rsp_valid(bind_rsp_valid && !live_busy),.bind_rsp_ready(exec_bind_rsp_ready),.bind_rsp_ok(bind_rsp_ok),
  .action_valid(exec_action_valid),.action_ready(exec_action_ready),.action_bank_op(exec_action_op),.action_command(exec_action_command),
  .action_slot(exec_action_slot),.action_parameters(exec_action_parameters),.action_phase(exec_action_phase),
  .action_index(exec_action_index),.action_word(exec_action_word),.action_cartridge(exec_action_cartridge),
  .fault_valid(cmd_fault_valid),.fault_ready(cmd_fault_ready),.fault_code(cmd_fault_code),.fault_detail(cmd_fault_detail));
 apu_live_source_update live(.clk(clk),.reset_n(reset_n),.update_valid(update_valid),.update_ready(update_ready),
  .update_slot(update_slot),.update_index(update_index),.update_word(update_word),.update_parameters(update_parameters),
  .selected_cartridge(selected_cartridge),.busy(live_busy),.bind_valid(live_bind_valid),.bind_ready(bind_ready && live_bind_valid),
  .bind_parameters(live_bind_parameters),.bind_cartridge(live_bind_cartridge),
  .bind_rsp_valid(bind_rsp_valid && live_busy),.bind_rsp_ready(live_bind_rsp_ready),.bind_rsp_ok(bind_rsp_ok),
  .action_valid(live_effect_valid),.action_ready(live_action_ready),.action_success(live_effect_success),
  .action_source_replace(live_effect_source_replace),.action_slot(live_effect_slot),.action_index(live_effect_index),
  .action_word(live_effect_word),.action_parameters(live_effect_parameters),.action_cartridge(live_effect_cartridge),
  .rebind_valid(rebind_valid),.rebind_slot(rebind_slot),.rebind_cartridge(rebind_cartridge),
  .fault_valid(live_fault_valid),.fault_ready(live_fault_ready),.fault_code(live_fault_code),.fault_detail(live_fault_detail));
 // Executor WRITE transfers the binder to the live owner while retaining the
 // executor reservation, so routing uses the live owner's active state.
 assign bind_valid=live_bind_valid || exec_bind_valid;
 assign bind_parameters=live_busy ? live_bind_parameters : exec_bind_parameters;
 assign bind_cartridge=live_busy ? live_bind_cartridge : exec_bind_cartridge;
 assign bind_rsp_ready=live_busy ? live_bind_rsp_ready : exec_bind_rsp_ready;
 // Route response to the actual owner, including active executor WRITE.
 // (The executor cannot be in BIND while live_busy.)
 wire end_grant=end_commit && !reservation && !live_busy && !write_started;
 wire live_failure=live_effect_valid && !live_effect_success && live_effect_ready && !end_grant;
 wire command_write=exec_action_valid && exec_action_op==2'd3;
 wire command_commit=exec_action_valid && !write_started && !end_grant && !live_failure &&
  (command_write || cmd_effect_ready);
 wire bank_commit_valid=end_grant || live_failure || command_commit;
 wire [1:0] bank_commit_op=end_grant ? 2'd1 : live_failure ? 2'd2 : exec_action_op;
 wire [3:0] bank_commit_slot=end_grant ? end_commit_slot : live_failure ? live_effect_slot : exec_action_slot;
 assign cmd_effect_valid=exec_action_valid && !command_write && !end_grant && !live_failure && bank_commit_ready;
 assign cmd_effect_command=exec_action_command;assign cmd_effect_slot=exec_action_slot;
 assign cmd_effect_parameters=exec_action_parameters;assign cmd_effect_phase=exec_action_phase;assign cmd_effect_cartridge=exec_action_cartridge;
 assign exec_action_ready=command_write ? (write_started && !live_busy) :
  (exec_action_valid && !end_grant && !live_failure && bank_commit_ready && cmd_effect_ready);
 assign live_action_ready=live_effect_ready && !end_grant && (live_effect_success || bank_commit_ready);
 always @(posedge clk or negedge reset_n) begin
  if(!reset_n) write_started<=0;
  else begin
   if(command_write && command_commit && bank_commit_ready) write_started<=1;
   if(exec_action_valid && exec_action_ready) write_started<=0;
  end
 end
 apu_slot_bank bank(.clk(clk),.reset_n(reset_n),.selected_slot(reservation ? query_slot : selected_slot),
  .access_valid(selected_valid),.access_write(selected_write),.access_index(selected_index),.access_wdata(selected_wdata),
  .timeline_ready(timeline_ready && !reservation && !live_busy),.access_ready(selected_ready),
  .response_valid(selected_response),.response_data(selected_rdata),.commit_valid(bank_commit_valid),.commit_ready(bank_commit_ready),
  .commit_action(bank_commit_op),.commit_slot(bank_commit_slot),.commit_parameters(exec_action_parameters),
  .commit_phase(live_failure ? 3'd0 : exec_action_phase),.commit_index(exec_action_index),.commit_word(exec_action_word),
  .commit_cartridge(exec_action_cartridge),.rebind_valid(rebind_valid),.rebind_slot(rebind_slot),.rebind_cartridge(rebind_cartridge),
  .fetch_slot(fetch_slot),.fetch_active(bank_fetch_active),.fetch_cartridge(bank_fetch_cartridge),
  .fetch_parameters(bank_fetch_parameters),.event_slot(end_slot),.event_source_address(bank_event_source_address),
  .render_mask(render_mask),.update_valid(update_valid),.update_ready(update_ready),
  .update_slot(update_slot),.update_index(update_index),.update_word(update_word),.update_parameters(update_parameters),
  .selected_phase(selected_phase),.selected_active(),.selected_source_address(),.active_mask(active_mask));
 assign fetch_parameters=bank_fetch_parameters;assign fetch_active=bank_fetch_active;assign fetch_cartridge=bank_fetch_cartridge;
 assign end_commit_ready=!reservation && !live_busy && !write_started && bank_commit_ready;
 apu_end_event events(.clk(clk),.reset_n(reset_n),.end_valid(end_valid),.end_ready(end_ready),.end_slot(end_slot),
  .end_source_address(bank_event_source_address),.commit_valid(end_commit),.commit_ready(end_commit_ready),.commit_slot(end_commit_slot),
  .event_kind(event_kind),.event_slot(event_slot),.event_source_address(event_source_address),.event_sequence(event_sequence),.user_irq_raise(user_irq_raise));
endmodule
