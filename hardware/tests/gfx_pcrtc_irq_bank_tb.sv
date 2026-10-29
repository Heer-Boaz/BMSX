`timescale 1ns/1ps
// Actual PCRTC event owner to actual CORE interrupt-pending bank. External
// event bits model named non-normal PCRTC producers, not automatic events.
module gfx_pcrtc_irq_bank_tb;
 reg clk=0;always #5 clk=~clk;reg reset_n=0;
 reg valid=0;reg [4:0] index=0;reg [31:0] word=0;reg [4:0] event_in=0;
 wire irq;wire [31:0] csr,imr;
 gfx_pcrtc_control gpu(.clk(clk),.reset_n(reset_n),.access_valid(valid),.access_write(1'b1),.access_index(index),.access_wdata(word),.access_rdata(),
  .other_events(event_in),.irq_raise(irq),.gpu_queue_action(),.gpu_reset_action(),.programmed_words(),.displayed_words(),
  .timing_restart(),.running(),.vblank_active(),.field(),.field_half_line(),.csr_word(csr),.imr_word(imr));
 reg local_valid=0,local_write=0;reg [31:0] local_address=0,local_wdata=0;wire local_ready,local_rsp_valid;
 wire [31:0] local_rdata,local_fault_code;
 core_local_dma_irq core(.clk(clk),.reset_n(reset_n),.local_valid(local_valid),.local_write(local_write),
  .local_address(local_address),.local_wdata(local_wdata),.local_access(32'd0),.local_be_n(4'd0),.local_bus_signals(8'd0),
  .local_ready(local_ready),.local_rsp_valid(local_rsp_valid),.local_rdata(local_rdata),.local_fault_code(local_fault_code),
  .other_valid(),.other_write(),.other_address(),.other_wdata(),.other_access(),.other_be_n(),.other_bus_signals(),
  .other_ready(1'b0),.other_rsp_valid(1'b0),.other_rdata(32'd0),.other_fault_code(32'd0),
  .system_valid(),.system_write(),.system_address(),.system_wdata(),.system_ready(1'b0),.system_rsp_valid(1'b0),
  .system_rdata(32'd0),.system_fault_code(32'd0),.external_irq_raise({30'd0,irq,1'b0}),.user_irq_raise(32'd0),.irq_line(),
  .trigger_inhibit(1'b0),.admission_inhibit(1'b1),.enter_supervisor(1'b0),.leave_supervisor(1'b0),
  .supervisor_boundary_ready(),.local_boundary_ready(),.request_lines(16'd0),.port_address(32'd0),
  .owns_read_port(),.owns_write_port(),.block_active(),.active_channel(),.active_read_address(),.active_write_address(),
  .transport_failed(),.transport_write_in_doubt(),.req_valid(),.req_write(),.req_hold(),.req_ready(1'b0),
  .req_address(),.req_wdata(),.req_access(),.req_size_bytes(),.req_be_n(),.req_bus_signals(),
  .req_data_timeout_enable(),.req_data_wait_last(),.rsp_valid(1'b0),.rsp_timeout(1'b0),.rsp_rdata(32'd0));
 task automatic write_pcrtc(input [4:0] reg_index,input [31:0] data);
  begin @(negedge clk);valid=1;index=reg_index;word=data;@(negedge clk);valid=0;end
 endtask
 task automatic central_ack;
  begin @(negedge clk);local_valid=1;local_write=1;local_address=32'h08000004;local_wdata=2;
   do @(posedge clk);while(!local_ready);@(negedge clk);local_valid=0;local_write=0;
   while(!local_rsp_valid)@(negedge clk);if(local_fault_code!==0)$fatal(1,"central ACK fault");end
 endtask
 initial begin repeat(2)@(negedge clk);reset_n=1;repeat(2)@(negedge clk);
  event_in=1;@(negedge clk);event_in=0;#1;
  if(csr[0]!==1 || core.pending[1]!==0)$fatal(1,"masked source");
  write_pcrtc(24,0);#1;if(core.pending[1]!==1 || csr[0]!==1)$fatal(1,"unmask delivery");
  central_ack();#1;if(core.pending[1]!==0 || csr[0]!==1)$fatal(1,"central ACK cleared local state");
  repeat(4)@(negedge clk);if(core.pending[1]!==0)$fatal(1,"pending local event reasserted central without edge");
  write_pcrtc(22,1);#1;if(csr[0]!==0)$fatal(1,"local ACK");
  @(negedge clk);event_in=1;@(negedge clk);event_in=0;#1;if(core.pending[1]!==1)$fatal(1,"new source edge");
  write_pcrtc(22,32'h200);#1;
  if(csr[4:0]!==0 || imr!==32'h7f00 || core.pending[1]!==1)$fatal(1,"PCRTC reset incorrectly cleared central IRQ");
  central_ack();#1;if(core.pending[1]!==0)$fatal(1,"central final ACK");
  $display("PASS PCRTC masked pending/unmask IRQ, central and local ACK independence, new event and reset independence");$finish;
 end
 initial begin #30000;$fatal(1,"timeout");end
endmodule
