`timescale 1ns/1ps
// Real SYS transport bound to the APU control owner's single command ingress.
// The binder, playback worker, live-update owner, sample store and system IRQ
// controller are separate external owners. Selected-window and status ports
// still require their own SYS decoder; this block only selects 08000120..174.
module apu_sys_control (
 input wire clk,reset_n,
 input wire cs_apu_n,input wire [31:0] bus_ad_in,
 input wire bus_as_n,bus_rd_n,bus_wr_n,input wire [3:0] bus_be_n,
 output wire [31:0] bus_ad_out,output wire bus_ad_oe,bus_ready_drive_low,
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
 wire ingress_valid,ingress_write,ingress_ready,ingress_response;
 wire [4:0] ingress_index;wire [31:0] ingress_wdata,ingress_rdata;
 apu_command_sys_endpoint endpoint(.clk(clk),.reset_n(reset_n),.cs_apu_n(cs_apu_n),.bus_ad_in(bus_ad_in),
  .bus_as_n(bus_as_n),.bus_rd_n(bus_rd_n),.bus_wr_n(bus_wr_n),.bus_be_n(bus_be_n),
  .bus_ad_out(bus_ad_out),.bus_ad_oe(bus_ad_oe),.bus_ready_drive_low(bus_ready_drive_low),
  .local_valid(ingress_valid),.local_write(ingress_write),.local_index(ingress_index),.local_wdata(ingress_wdata),
  .local_ready(ingress_ready),.local_response_valid(ingress_response),.local_response_data(ingress_rdata));
 apu_control_integration control(
  .clk(clk), .reset_n(reset_n), .ingress_valid(ingress_valid),
  .ingress_write(ingress_write), .ingress_index(ingress_index), .ingress_wdata(ingress_wdata),
  .ingress_ready(ingress_ready), .ingress_response(ingress_response), .ingress_rdata(ingress_rdata),
  .ingress_fault(ingress_fault), .ingress_fault_detail(ingress_fault_detail), .selected_valid(selected_valid),
  .selected_write(selected_write), .selected_index(selected_index), .selected_wdata(selected_wdata),
  .selected_ready(selected_ready), .selected_response(selected_response), .selected_rdata(selected_rdata),
  .selected_cartridge(selected_cartridge), .bind_valid(bind_valid), .bind_ready(bind_ready),
  .bind_parameters(bind_parameters), .bind_cartridge(bind_cartridge), .bind_rsp_valid(bind_rsp_valid),
  .bind_rsp_ready(bind_rsp_ready), .bind_rsp_ok(bind_rsp_ok), .cmd_effect_valid(cmd_effect_valid),
  .cmd_effect_ready(cmd_effect_ready), .cmd_effect_command(cmd_effect_command), .cmd_effect_slot(cmd_effect_slot),
  .cmd_effect_parameters(cmd_effect_parameters), .cmd_effect_phase(cmd_effect_phase), .cmd_effect_cartridge(cmd_effect_cartridge),
  .live_effect_valid(live_effect_valid), .live_effect_ready(live_effect_ready), .live_effect_success(live_effect_success),
  .live_effect_source_replace(live_effect_source_replace), .live_effect_slot(live_effect_slot), .live_effect_index(live_effect_index),
  .live_effect_word(live_effect_word), .live_effect_parameters(live_effect_parameters), .live_effect_cartridge(live_effect_cartridge),
  .cmd_fault_valid(cmd_fault_valid), .cmd_fault_ready(cmd_fault_ready), .cmd_fault_code(cmd_fault_code),
  .cmd_fault_detail(cmd_fault_detail), .live_fault_valid(live_fault_valid), .live_fault_ready(live_fault_ready),
  .live_fault_code(live_fault_code), .live_fault_detail(live_fault_detail), .snapshot_overflow(snapshot_overflow),
  .snapshot_history_lost(snapshot_history_lost), .frame_valid(frame_valid), .frame_ready(frame_ready),
  .frame_done(frame_done), .frame_tick(frame_tick), .sample_sequence(sample_sequence),
  .completed_sequence(completed_sequence), .pending_frames(pending_frames), .end_valid(end_valid),
  .end_ready(end_ready), .end_slot(end_slot), .event_kind(event_kind),
  .event_slot(event_slot), .event_source_address(event_source_address), .event_sequence(event_sequence),
  .user_irq_raise(user_irq_raise), .fetch_slot(fetch_slot), .fetch_parameters(fetch_parameters),
  .fetch_active(fetch_active), .fetch_cartridge(fetch_cartridge), .active_mask(active_mask),
  .render_mask(render_mask), .queued_count(queued_count));
endmodule
