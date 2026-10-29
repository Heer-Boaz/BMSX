`timescale 1ns/1ps
module cart_ram_physical_integration_tb;
    localparam real PERIOD=29.5257;
    reg clk=0;
    always #(PERIOD/2) clk=!clk;
    reg power_reset_n=0,reset_n=0,request=0;
    reg [1:0] cancel_req=0;
    reg [31:0] address=0,wdata=0;
    reg [2:0] size=1;
    wire [1:0] req_ready,rsp_valid,timed_out;
    wire [63:0] rsp_data,fault;
    tri [15:0] cad_core,cad_card,ram_data;
    wire [1:0] ready_n,present_n,be_n,cs_n,ram_be_n;
    wire cal_lo,cal_hi,cart_clk,rd_n,wr_n,dir,oe_n;
    wire drive_to_card,drive_to_core,ram_ce_n,ram_oe_n,ram_we_n,part_drive;
    wire [3:0] ram_address;
    wire card_init,card_busy;
    assign present_n=2'b10;
    assign ready_n[1]=1'b1;
    cart_rom_arbiter bridge (
        .clk(clk),.reset_n(reset_n),.req_valid({1'b0,request}),.req_cancel(cancel_req),
        .req_ready(req_ready),.req_address({32'b0,address}),.req_write(2'b01),
        .req_size_bytes({3'd4,size}),.req_wdata({32'b0,wdata}),.req_bus_signals(16'h0004),
        .selected_socket(1'b0),.req_data_timeout_enable(2'b00),.req_data_wait_last(36'b0),
        .rsp_valid(rsp_valid),.rsp_data(rsp_data),.rsp_fault_code(fault),.rsp_timeout(timed_out),
        .cad(cad_core),.cart_ready_n(ready_n),.cart_present_n(present_n),
        .cal_lo(cal_lo),.cal_hi(cal_hi),.cart_clk(cart_clk),.crd_n(rd_n),.cwr_n(wr_n),
        .cbe_n(be_n),.cs_cart_n(cs_n),.cart_dir(dir),.cart_oe_n(oe_n)
    );
    cart_bus_buffer_model u51 (.reset_n(reset_n),.oe_n(oe_n),.dir(dir),
        .cad_core(cad_core),.cad_card(cad_card),.drive_to_card(drive_to_card),.drive_to_core(drive_to_core));
    cart_ram_physical_peer #(.ADDRESS_WIDTH(4),.CAPACITY_BYTES(13)) card (
        .clk(clk),.power_reset_n(power_reset_n),.reset_n(reset_n),.cs_n(cs_n[0]),
        .cal_lo(cal_lo),.cal_hi(cal_hi),.rd_n(rd_n),.wr_n(wr_n),.be_n(be_n),
        .cad(cad_card),.ready_n(ready_n[0]),.init_done(card_init),.busy(card_busy),
        .mem_data(ram_data),.mem_address(ram_address),.mem_ce_n(ram_ce_n),
        .mem_oe_n(ram_oe_n),.mem_we_n(ram_we_n),.mem_be_n(ram_be_n)
    );
    issi_bll_pin_model #(.ADDRESS_WIDTH(4)) ram (
        .address(ram_address),.data(ram_data),.ce_n(ram_ce_n),.oe_n(ram_oe_n),
        .we_n(ram_we_n),.be_n(ram_be_n),.drive_active(part_drive)
    );
    integer pulses=0,responses=0;
    always @(negedge ram_we_n) if(power_reset_n) pulses=pulses+1;
    always @(posedge clk) begin
        if(reset_n && rsp_valid[0]) responses=responses+1;
        if(drive_to_card && drive_to_core) $fatal(1,"CAD buffer contention");
    end
    task automatic start(input [31:0] a,input [2:0] n,input [31:0] value);
        integer guard;
        begin
            @(negedge clk);address=32'h30000000+a;size=n;wdata=value;request=1;guard=0;
            do begin @(posedge clk);guard=guard+1;
                if(guard>100) $fatal(1,"CAD admission timeout");
            end while(!req_ready[0]);
            @(negedge clk);request=0;
        end
    endtask
    task automatic finish;
        integer guard;
        begin
            guard=0;
            do begin @(posedge clk);guard=guard+1;
                if(guard>250) $fatal(1,"CAD write completion timeout");
            end while(!rsp_valid[0]);
            if(fault[31:0]!==0 || timed_out[0]) $fatal(1,"unexpected fault");
            @(negedge clk);
        end
    endtask
    integer p,r;
    initial begin
        repeat(3) @(posedge clk);@(negedge clk);power_reset_n=1;
        wait(card_init);@(negedge clk);reset_n=1;repeat(5) @(posedge clk);
        p=pulses;start(1,4,32'h11223344);finish();
        if(pulses-p!=3 || ram.words[0][15:8]!==8'h44 ||
           ram.words[1]!==16'h2233 || ram.words[2][7:0]!==8'h11)
            $fatal(1,"CAD-to-SRAM odd word mapping or pulse count");
        p=pulses;start(11,4,32'hdeadbeef);finish();
        if(pulses!=p) $fatal(1,"tail write reached SRAM");
        // The first CAD half alone is staging, not a memory write.
        p=pulses;start(7,4,32'hcafebabe);
        wait(card.first_half);@(negedge clk);reset_n=0;
        repeat(2) @(posedge clk);@(negedge clk);reset_n=1;repeat(5) @(posedge clk);
        if(pulses!=p || ram.words[3][15:8]!==0 || ram.words[4]!==0 || ram.words[5][7:0]!==0)
            $fatal(1,"incomplete CAD scalar modified SRAM");
        // Last CAD portion has been accepted into the real SRAM owner. Reset
        // during its first SRAM pulse must not shorten or abandon the commit.
        p=pulses;r=responses;start(3,4,32'haabbccdd);
        wait(!ram_we_n);#1;reset_n=0;
        repeat(2) @(posedge clk);@(negedge clk);reset_n=1;
        wait(!card_busy);repeat(6) @(posedge clk);
        if(pulses-p!=3 || responses!=r || ram.words[1][15:8]!==8'hdd ||
           ram.words[2]!==16'hbbcc || ram.words[3][7:0]!==8'haa)
            $fatal(1,"CAD reset did not drain committed SRAM write");
        p=pulses;start(0,2,32'h000055aa);finish();
        if(pulses-p!=1 || ram.words[0]!==16'h55aa) $fatal(1,"post-reset card use");
        // Abort an accepted write; the next request competes with its drain.
        p=pulses; r=responses; start(1,4,32'h12345678);
        wait(!ram_we_n); #1; cancel_req[0]=1;
        repeat(2) @(posedge clk); @(negedge clk); cancel_req=0;
        start(7,4,32'h0a0b0c0d); finish();
        if(pulses-p!=6 || responses!=r+1 || ram.words[0][15:8]!==8'h78 ||
           ram.words[1]!==16'h3456 || ram.words[2][7:0]!==8'h12 ||
           ram.words[3][15:8]!==8'h0d || ram.words[4]!==16'h0b0c ||
           ram.words[5][7:0]!==8'h0a) $fatal(1,"cancel then new request");
        $display("PASS physical CAD to x16 SRAM: odd word, tail reject, pre-commit reset, commit drain, cancel and subsequent request");
        $finish;
    end
endmodule
