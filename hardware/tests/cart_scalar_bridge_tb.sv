`timescale 1ns/1ps
module cart_scalar_bridge_tb;
    localparam real PERIOD=29.5257;
    reg clk=0;
    always #(PERIOD/2) clk=!clk;
    reg reset_n=0, req_valid=0, cancel=0, write=0, stall0=0, stall1=0;
    reg [2:0] size_bytes=4;
    reg [31:0] address=0, wdata=0;
    reg [7:0] bus_signals=0;
    reg timeout_enable=0;
    reg [17:0] wait_last=0;
    wire [1:0] ready, valid, timed_out;
    wire [63:0] rdata, fault;
    tri [15:0] cad, card_cad;
    wire cal_lo, cal_hi, cart_clk, rd_n, wr_n, dir, oe_n;
    wire [1:0] be_n, cs_n, card_ready;
    wire drive_to_card, drive_to_core;
    wire [1:0] irq_n, dreq_r, dreq_w;
    cart_bus_buffer_model buffer_model(.reset_n(reset_n),.oe_n(oe_n),.dir(dir),
        .cad_core(cad),.cad_card(card_cad),.drive_to_card(drive_to_card),.drive_to_core(drive_to_core));
    cart_rom_arbiter dut(.clk(clk),.reset_n(reset_n),.req_valid({1'b0,req_valid}),
        .req_cancel({1'b0,cancel}),.req_ready(ready),.req_address({32'd0,address}),
        .req_write({1'b0,write}),.req_size_bytes({3'd4,size_bytes}),.req_wdata({32'd0,wdata}),
        .req_bus_signals({8'd0,bus_signals}),.selected_socket(1'b0),
        .req_data_timeout_enable({1'b0,timeout_enable}),.req_data_wait_last({18'd0,wait_last}),
        .rsp_valid(valid),.rsp_data(rdata),.rsp_fault_code(fault),.rsp_timeout(timed_out),
        .cad(cad),.cart_ready_n(card_ready),.cart_present_n(2'b00),.cal_lo(cal_lo),.cal_hi(cal_hi),
        .cart_clk(cart_clk),.crd_n(rd_n),.cwr_n(wr_n),.cbe_n(be_n),.cs_cart_n(cs_n),.cart_dir(dir),.cart_oe_n(oe_n));
    cart_scalar_card_peer card0(.clk(clk),.reset_n(reset_n),.cs_n(cs_n[0]),.cal_lo(cal_lo),.cal_hi(cal_hi),
        .rd_n(rd_n),.wr_n(wr_n),.be_n(be_n),.stall(stall0),.cad(card_cad),.ready_n(card_ready[0]),
        .irq_n(irq_n[0]),.dreq_read(dreq_r[0]),.dreq_write(dreq_w[0]));
    cart_scalar_card_peer card1(.clk(clk),.reset_n(reset_n),.cs_n(cs_n[1]),.cal_lo(cal_lo),.cal_hi(cal_hi),
        .rd_n(rd_n),.wr_n(wr_n),.be_n(be_n),.stall(stall1),.cad(card_cad),.ready_n(card_ready[1]),
        .irq_n(irq_n[1]),.dreq_read(dreq_r[1]),.dreq_write(dreq_w[1]));
    always @(posedge clk) if(reset_n && drive_to_card && drive_to_core) $fatal(1,"bus contention");
    integer transactions=0;
    reg oracle_record=0;
    task automatic start(input bit w,input [2:0] s,input [31:0] a,input [31:0] d,input bit socket,
                         input bit timed,input [17:0] last);
        integer cycles;
        begin
            @(negedge clk);write=w;size_bytes=s;address=a;wdata=d;
            bus_signals=socket ? 8'h0c : 8'h04;timeout_enable=timed;wait_last=last;req_valid=1;
            cycles=0;
            do begin @(posedge clk);cycles=cycles+1;if(cycles>100) $fatal(1,"admission timeout");end while(!ready[0]);
            @(negedge clk);req_valid=0;
        end
    endtask
    task automatic finish(input [31:0] expected,input bit timeout_expected);
        integer cycles;
        begin
            cycles=0;
            do begin @(posedge clk);cycles=cycles+1;if(cycles>1000) $fatal(1,"response timeout");end while(!valid[0]);
            if(timed_out[0]!==timeout_expected || fault[31:0]!==0 || (!timeout_expected && rdata[31:0]!==expected))
                $fatal(1,"response addr=%h width=%d write=%b actual=%h timeout=%b expected=%h/%b",address,size_bytes,write,rdata[31:0],timed_out[0],expected,timeout_expected);
            transactions=transactions+1;@(negedge clk);
        end
    endtask
    task automatic xfer(input bit w,input [2:0] s,input [31:0] a,input [31:0] d,input bit socket,input [31:0] expected);
        begin
            start(w,s,a,d,socket,0,0);finish(expected,0);
            if(!w && oracle_record) $display("ORACLE %08x",rdata[31:0]);
        end
    endtask
    integer c, beat;
    initial begin
        repeat(4) @(posedge clk);@(negedge clk);reset_n=1;repeat(5) @(posedge clk);
        // The extended card must also serve the original two-address ROM path.
        xfer(0,4,32'h10000000,0,0,32'h13121110);
        xfer(0,4,32'h10000004,0,0,32'h00000014);
        xfer(1,4,32'h30000001,32'h11223344,0,0);
        if(card0.ram[1]!==8'h44 || card0.ram[2]!==8'h33 || card0.ram[3]!==8'h22 || card0.ram[4]!==8'h11)
            $fatal(1,"unaligned little endian write");
        oracle_record=1;
        xfer(0,4,32'h30000001,0,0,32'h11223344);
        xfer(0,2,32'h30000003,0,0,32'h1122);
        xfer(0,1,32'h30000004,0,0,32'h11);
        oracle_record=0;
        c=card0.commits;
        xfer(1,4,32'h30000002,32'hff00ff00,0,0);
        if(card0.commits!=c || card0.ram[2]!==8'h33 || card0.ram[4]!==8'h11) $fatal(1,"partial tail modified RAM");
        oracle_record=1;
        xfer(0,4,32'h30000003,0,0,32'h1122);
        xfer(0,4,32'h10000003,0,0,32'h1413);
        oracle_record=0;
        xfer(1,4,32'h30f00000,32'h89abcdef,0,0);
        oracle_record=1;
        xfer(0,4,32'h30f00001,0,0,32'h89abcdef);
        xfer(0,2,32'h30f00001,0,0,32'hcdef);
        xfer(0,1,32'h30f00001,0,0,32'hcd);
        oracle_record=0;
        c=card0.commits;
        xfer(1,4,32'h30f00001,32'h11223344,0,0);
        xfer(1,2,32'h30f00000,32'h1122,0,0);
        if(card0.commits!=c || card0.data_word!==32'h89abcdef) $fatal(1,"unaligned/partial MMIO write changed DATA");
        oracle_record=1;xfer(0,4,32'h30f00000,0,0,32'h89abcdef);oracle_record=0;
        xfer(1,4,32'h30f00004,32'h80000007,0,0);
        if(irq_n[0]!==0 || dreq_r[0]!==1 || dreq_w[0]!==1) $fatal(1,"mailbox outputs");
        xfer(1,4,32'h30f00004,32'h80000007,0,0);
        if(card0.irq_edges!=1) $fatal(1,"repeated trigger generated another edge");
        oracle_record=1;
        xfer(0,4,32'h30f00004,0,0,32'h80000006);
        xfer(0,4,32'h30f00008,0,0,1);
        oracle_record=0;
        xfer(1,4,32'h30f0000c,0,0,0);
        if(irq_n[0]!==0) $fatal(1,"zero ACK cleared pending");
        oracle_record=1;xfer(0,4,32'h30f00008,0,0,1);oracle_record=0;
        xfer(1,4,32'h30f0000c,1,0,0);
        if(irq_n[0]!==1) $fatal(1,"ACK did not clear pending");
        oracle_record=1;xfer(0,4,32'h30f00008,0,0,0);oracle_record=0;
        xfer(1,4,32'h30f00004,32'h00000001,0,0);
        if(card0.irq_edges!=2 || irq_n[0]!==0) $fatal(1,"ACK did not rearm edge");
        xfer(1,4,32'h30000001,32'h55667788,1,0);
        xfer(0,4,32'h30000001,0,1,32'h55667788);
        xfer(0,4,32'h30000001,0,0,32'h11223344);
        // Timeout before last write sample: staged first half must not commit.
        c=card0.commits;stall0=1;
        start(1,4,32'h30000001,32'hdeadbeef,0,1,15);finish(0,1);stall0=0;
        if(card0.commits!=c || card0.ram[1]!==8'h44) $fatal(1,"first-half timeout committed");
        repeat(8) @(posedge clk);
        // Board reset after the first sample discards only the uncommitted staging.
        c=card0.commits;beat=card0.write_beats;stall0=1;
        start(1,4,32'h30000001,32'hfedcba98,0,0,0);
        wait(card0.write_beats==beat+1);@(negedge clk);reset_n=0;
        repeat(3) @(posedge clk);@(negedge clk);reset_n=1;stall0=0;repeat(6) @(posedge clk);
        if(card0.commits!=c || card0.ram[1]!==8'h44) $fatal(1,"reset committed an incomplete write");
        // Timeout after final sample may have a committed effect; do not roll it back.
        beat=card0.write_beats;c=card0.commits;
        start(1,4,32'h30000001,32'haabbccdd,0,1,20);
        wait(card0.write_beats==beat+2);@(negedge clk);stall0=1;finish(0,1);stall0=0;
        if(card0.commits!=c+1 || card0.ram[1]!==8'hdd || card0.ram[4]!==8'haa) $fatal(1,"last-sample commit lost");
        repeat(8) @(posedge clk);
        // Reset after the final accepted portion cannot undo the card commit.
        beat=card0.write_beats;c=card0.commits;
        start(1,4,32'h30000001,32'ha1b2c3d4,0,0,0);
        wait(card0.write_beats==beat+2);@(negedge clk);reset_n=0;
        repeat(3) @(posedge clk);@(negedge clk);reset_n=1;repeat(5) @(posedge clk);
        if(card0.commits!=c+1 || card0.ram[1]!==8'hd4 || card0.ram[4]!==8'ha1 ||
           card0.data_word!==0 || card0.control_word!==0) $fatal(1,"post-sample reset effects");
        xfer(0,4,32'h30000001,0,0,32'ha1b2c3d4);
        $display("PASS scalar CAD: %0d transactions, unaligned, tails, mailbox, two sockets and timeout commit",transactions);
        $finish;
    end
endmodule
