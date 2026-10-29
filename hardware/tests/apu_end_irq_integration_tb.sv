`timescale 1ns/1ps
// Two consecutive physical slot ends through the real bank, retained event
// registers and CORE interrupt controller, including an independent IRQ ACK.
module apu_end_irq_integration_tb;
 reg clk=0; always #5 clk=~clk;
 reg reset_n=0, end_valid=0;
 reg [3:0] end_slot=0, install_slot=0;
 reg install=0;
 reg [671:0] install_words=0;
 wire end_ready, event_commit, bank_ready;
 wire [3:0] event_slot_commit;
 wire [671:0] fetch_words;
 wire [15:0] active;
 wire [31:0] kind,slot,source,seq_word,user_raise;
 apu_end_event event_unit(.clk(clk),.reset_n(reset_n),.end_valid(end_valid),.end_ready(end_ready),
  .end_slot(end_slot),.end_source_address(fetch_words[0+:32]),.commit_valid(event_commit),
  .commit_ready(bank_ready),.commit_slot(event_slot_commit),.event_kind(kind),.event_slot(slot),
  .event_source_address(source),.event_sequence(seq_word),.user_irq_raise(user_raise));
 apu_slot_bank bank(.clk(clk),.reset_n(reset_n),.selected_slot(4'd0),
  .access_valid(1'b0),.access_write(1'b0),.access_index(5'd0),.access_wdata(32'd0),.timeline_ready(1'b0),
  .access_ready(),.response_valid(),.response_data(),.commit_valid(install || event_commit),.commit_ready(bank_ready),
  .commit_action(event_commit ? 2'd1 : 2'd0),.commit_slot(event_commit ? event_slot_commit : install_slot),
  .commit_parameters(install_words),.commit_phase(3'd0),.commit_index(5'd0),.commit_word(32'd0),.commit_cartridge(1'b0),
  .rebind_valid(1'b0),.rebind_slot(4'd0),.rebind_cartridge(1'b0),.fetch_slot(end_slot),.fetch_active(),.fetch_cartridge(),.event_slot(4'd0),.event_source_address(),
  .fetch_parameters(fetch_words),.render_mask(),.update_valid(),.update_ready(1'b1),.update_slot(),.update_index(),
  .update_word(),.update_parameters(),.selected_phase(),.selected_active(),.selected_source_address(),.active_mask(active));
 reg local_valid=0,local_write=0;
 reg [31:0] local_address=0,local_wdata=0;
 wire local_ready,local_rsp_valid,irq_line;
 wire [31:0] local_rdata,local_fault;
 core_local_dma_irq core(.clk(clk),.reset_n(reset_n),.local_valid(local_valid),.local_write(local_write),
  .local_address(local_address),.local_wdata(local_wdata),.local_access(32'd0),.local_be_n(4'd0),.local_bus_signals(8'd0),
  .local_ready(local_ready),.local_rsp_valid(local_rsp_valid),.local_rdata(local_rdata),.local_fault_code(local_fault),
  .other_valid(),.other_write(),.other_address(),.other_wdata(),.other_access(),.other_be_n(),.other_bus_signals(),
  .other_ready(1'b0),.other_rsp_valid(1'b0),.other_rdata(32'd0),.other_fault_code(32'd0),
  .system_valid(),.system_write(),.system_address(),.system_wdata(),.system_ready(1'b0),.system_rsp_valid(1'b0),
  .system_rdata(32'd0),.system_fault_code(32'd0),.external_irq_raise(32'd0),.user_irq_raise(user_raise),.irq_line(irq_line),
  .trigger_inhibit(1'b0),.admission_inhibit(1'b1),.enter_supervisor(1'b0),.leave_supervisor(1'b0),
  .supervisor_boundary_ready(),.local_boundary_ready(),.request_lines(16'd0),.port_address(32'd0),
  .owns_read_port(),.owns_write_port(),.block_active(),.active_channel(),.active_read_address(),.active_write_address(),
  .transport_failed(),.transport_write_in_doubt(),.req_valid(),.req_write(),.req_hold(),.req_ready(1'b0),
  .req_address(),.req_wdata(),.req_access(),.req_size_bytes(),.req_be_n(),.req_bus_signals(),
  .req_data_timeout_enable(),.req_data_wait_last(),.rsp_valid(1'b0),.rsp_timeout(1'b0),.rsp_rdata(32'd0));
 task automatic bus_write(input [31:0] addr, input [31:0] word);
  begin @(negedge clk);local_valid=1;local_write=1;local_address=addr;local_wdata=word;
   @(negedge clk);local_valid=0;local_write=0;end
 endtask
 task automatic install_bank(input [3:0] number,input [31:0] addr);
  begin @(negedge clk);install_slot=number;install_words=0;install_words[31:0]=addr;install=1;
   @(negedge clk);install=0;end
 endtask
 initial begin
  repeat(2)@(negedge clk);reset_n=1;
  bus_write(32'h08000008,32'h20);
  install_bank(0,32'h12345678);install_bank(1,32'h87654321);
  @(negedge clk);end_valid=1;end_slot=0;
  @(negedge clk);
  if(seq_word!==1 || slot!==0 || source!==32'h12345678 || active!==2 || user_raise!==0 || irq_line!==0)
   $fatal(1,"first end must precede IRQ");
  end_slot=1;
  @(negedge clk);
  if(seq_word!==2 || slot!==1 || source!==32'h87654321 || active!==0 || user_raise!==32'h20 || irq_line!==0)
   $fatal(1,"back-to-back end publication");
  end_valid=0;
  @(negedge clk);
  if(user_raise!==32'h20 || !irq_line || seq_word!==2)$fatal(1,"back-to-back IRQ request");
  @(negedge clk);
  if(user_raise!==0 || !irq_line || seq_word!==2)$fatal(1,"IRQ pending retention");
  bus_write(32'h08000004,32'h20);
  if(irq_line || kind!==1 || slot!==1 || source!==32'h87654321 || seq_word!==2)$fatal(1,"IRQ ACK changed event payload");
  repeat(3)@(negedge clk);
  if(irq_line || seq_word!==2)$fatal(1,"duplicate end or IRQ");
  $display("PASS back-to-back APU slot clears, event ordering, CORE user IRQ, ACK and retained latest event");$finish;
 end
 initial begin #10000;$fatal(1,"watchdog");end
endmodule
