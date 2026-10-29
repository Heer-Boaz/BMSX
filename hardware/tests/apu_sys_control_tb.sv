`timescale 1ns/1ps
// SYS request -> APU command transport -> the single control ingress, with
// actual executor reservation. The binder deliberately holds its response;
// SRAM, playback and DAC are tested by the separate serial integration test.
module apu_sys_control_tb;
 reg clk=0;always #5 clk=~clk;
 reg reset_n=0,req_valid=0,req_write=0;reg [31:0] req_address=0,req_data=0;
 wire req_ready,rsp_valid,rsp_timeout;wire [31:0] rsp_data,rsp_fault;
 wire [31:0] master_out,apu_out;wire master_oe,apu_oe,as_n,rd_n,wr_n,ready_low;wire [3:0] be_n;
 tri [31:0] ad;tri1 ready_n;
 assign ad=master_oe ? master_out : 32'bz;
 assign ad=apu_oe ? apu_out : 32'bz;
 assign ready_n=ready_low ? 1'b0 : 1'bz;
 system_bus_master master(.clk(clk),.reset_n(reset_n),.req_valid(req_valid),.req_ready(req_ready),
  .req_write(req_write),.req_addr(req_address),.req_wdata(req_data),.req_be_n(4'b0000),.req_header_be_n(4'hf),
  .bus_busy(),.req_meta(32'd0),.req_data_timeout_enable(1'b0),.req_data_wait_last(18'd0),
  .rsp_valid(rsp_valid),.rsp_rdata(rsp_data),.rsp_fault_code(rsp_fault),.rsp_timeout(rsp_timeout),
  .bus_ad_in(ad),.bus_ad_out(master_out),.bus_ad_oe(master_oe),.bus_as_n(as_n),.bus_rd_n(rd_n),.bus_wr_n(wr_n),.bus_be_n(be_n),.bus_ready_n(ready_n));
 wire bind_valid,bind_cartridge;wire [671:0] bind_params;
 apu_sys_control dut(.clk(clk),.reset_n(reset_n),.cs_apu_n(1'b0),.bus_ad_in(ad),
  .bus_as_n(as_n),.bus_rd_n(rd_n),.bus_wr_n(wr_n),.bus_be_n(be_n),.bus_ad_out(apu_out),.bus_ad_oe(apu_oe),.bus_ready_drive_low(ready_low),
  .ingress_fault(),.ingress_fault_detail(),.selected_valid(1'b0),.selected_write(1'b0),.selected_index(5'd0),.selected_wdata(32'd0),
  .selected_ready(),.selected_response(),.selected_rdata(),.selected_cartridge(1'b0),
  .bind_valid(bind_valid),.bind_ready(1'b0),.bind_parameters(bind_params),.bind_cartridge(bind_cartridge),
  .bind_rsp_valid(1'b0),.bind_rsp_ready(),.bind_rsp_ok(1'b0),.cmd_effect_valid(),.cmd_effect_ready(1'b0),
  .cmd_effect_command(),.cmd_effect_slot(),.cmd_effect_parameters(),.cmd_effect_phase(),.cmd_effect_cartridge(),
  .live_effect_valid(),.live_effect_ready(1'b0),.live_effect_success(),.live_effect_source_replace(),.live_effect_slot(),.live_effect_index(),
  .live_effect_word(),.live_effect_parameters(),.live_effect_cartridge(),.cmd_fault_valid(),.cmd_fault_ready(1'b1),.cmd_fault_code(),.cmd_fault_detail(),
  .live_fault_valid(),.live_fault_ready(1'b1),.live_fault_code(),.live_fault_detail(),.snapshot_overflow(1'b0),.snapshot_history_lost(),
  .frame_valid(),.frame_ready(1'b0),.frame_done(1'b0),.frame_tick(),.sample_sequence(),.completed_sequence(),.pending_frames(),
  .end_valid(1'b0),.end_ready(),.end_slot(4'd0),.event_kind(),.event_slot(),.event_source_address(),.event_sequence(),.user_irq_raise(),
  .fetch_slot(4'd0),.fetch_parameters(),.fetch_active(),.fetch_cartridge(),.active_mask(),.render_mask(),.queued_count());
 always @(posedge clk) if(reset_n && master_oe && apu_oe) $fatal(1,"SYS contention");
 task transfer(input bit write,input [31:0] addr,input [31:0] value,input [31:0] expected);
  begin @(negedge clk);while(!req_ready)@(negedge clk);
   req_valid=1;req_write=write;req_address=addr;req_data=value;
   @(negedge clk);req_valid=0;while(!rsp_valid)@(negedge clk);
   if(rsp_timeout || rsp_fault!=0 || (!write && rsp_data!==expected))
    $fatal(1,"SYS transfer address=%h got=%h expected=%h fault=%h",addr,rsp_data,expected,rsp_fault);
  end
 endtask
 initial begin
  repeat(3)@(negedge clk);reset_n=1;
  transfer(0,32'h08000150,0,32'h1000);
  transfer(1,32'h08000120,32'h40000190,0);
  transfer(0,32'h08000120,0,32'h40000190);
  transfer(1,32'h08000124,2,0);
  transfer(1,32'h08000134,1,0);
  transfer(1,32'h08000148,2,0);
  transfer(1,32'h08000174,1,0);
  wait(bind_valid);@(negedge clk);
  if(bind_params[0+:32]!==32'h40000190 || bind_params[32+:32]!==2 || bind_params[10*32+:32]!==2 || bind_cartridge)
   $fatal(1,"PLAY command snapshot was not reserved for binding");
  transfer(0,32'h08000120,0,0);
  repeat(10)@(negedge clk);
  if(!bind_valid || bind_params[0+:32]!==32'h40000190) $fatal(1,"stalled bind request changed");
  $display("PASS SYS control: default/readback, PLAY snapshot, staging reset and held binder request");$finish;
 end
 initial begin #100000;$fatal(1,"watchdog");end
endmodule
