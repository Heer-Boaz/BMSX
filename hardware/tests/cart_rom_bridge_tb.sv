`timescale 1ns/1ps
// Physical cartridge peers are defined once in cart_rom_model.sv.
module cart_rom_bridge_tb;
    localparam real PERIOD=29.5257;
    reg clk=0;
    always #(PERIOD/2) clk=!clk;
    reg reset_n=1, cancel=0, use_sys=0;
    reg req_valid=0, selected_socket=0, req_data_timeout_enable=0;
    wire req_ready, rsp_valid;
    reg [31:0] req_address=0;
    reg [7:0] req_bus_signals=0;
    reg [17:0] req_data_wait_last=0;
    wire [31:0] rsp_data, rsp_fault_code;
    wire rsp_timeout;
    tri [15:0] cad, card_cad;
    wire cal_lo, cal_hi, cart_clk, crd_n, cwr_n, cart_dir, cart_oe_n;
    wire [1:0] cbe_n, cs_cart_n, cart_ready_n;
    reg [1:0] cart_present_n=0, stalled=0;
    // Actual selected transceiver/OR timing limits, not an ideal direct wire.
    wire drive_to_card, drive_to_core;
    cart_bus_buffer_model buffer_model (
        .reset_n(reset_n),.oe_n(cart_oe_n),.dir(cart_dir),.cad_core(cad),.cad_card(card_cad),
        .drive_to_card(drive_to_card),.drive_to_core(drive_to_core)
    );
    wire cart_valid, cart_ready;
    wire [31:0] cart_address;
    wire [7:0] cart_bus_signals;
    wire cart_cancel;
    reg [31:0] inject_fault=0;
    wire [1:0] owner_ready, owner_rsp, owner_timeout;
    wire [63:0] owner_data, owner_fault;
    assign req_ready=owner_ready[0];
    assign cart_ready=owner_ready[1];
    assign rsp_valid=owner_rsp[0];
    assign rsp_data=owner_data[31:0];
    assign rsp_fault_code=owner_fault[31:0];
    assign rsp_timeout=owner_timeout[0];
    cart_rom_arbiter arbiter (
        .clk(clk),.reset_n(reset_n),.req_cancel({cart_cancel,cancel}),
        .req_valid({cart_valid,req_valid}),.req_ready(owner_ready),
        .req_address({cart_address,req_address}),
        .req_write(2'b00),.req_size_bytes({3'd4,3'd4}),.req_wdata(64'd0),
        .req_bus_signals({cart_bus_signals,req_bus_signals}),
        .selected_socket(selected_socket),
        .req_data_timeout_enable({1'b0,req_data_timeout_enable}),
        .req_data_wait_last({18'd0,req_data_wait_last}),.rsp_valid(owner_rsp),
        .rsp_data(owner_data),.rsp_fault_code(owner_fault),.rsp_timeout(owner_timeout),
        .cad(cad),.cart_ready_n(cart_ready_n),.cart_present_n(cart_present_n),
        .cal_lo(cal_lo),.cal_hi(cal_hi),.cart_clk(cart_clk),.crd_n(crd_n),.cwr_n(cwr_n),
        .cbe_n(cbe_n),.cs_cart_n(cs_cart_n),.cart_dir(cart_dir),.cart_oe_n(cart_oe_n)
    );
    cart_rom_card_peer #(.SOCKET(0)) card0 (
        .reset_n(reset_n),.cs_n(cs_cart_n[0]),.cal_lo(cal_lo),.cal_hi(cal_hi),
        .rd_n(crd_n),.wr_n(cwr_n),.be_n(cbe_n),.stalled(stalled[0]),.cad(card_cad),.ready_n(cart_ready_n[0])
    );
    cart_rom_card_peer #(.SOCKET(1)) card1 (
        .reset_n(reset_n),.cs_n(cs_cart_n[1]),.cal_lo(cal_lo),.cal_hi(cal_hi),
        .rd_n(crd_n),.wr_n(cwr_n),.be_n(cbe_n),.stalled(stalled[1]),.cad(card_cad),.ready_n(cart_ready_n[1])
    );
    reg master_valid=0, master_write=0, master_timeout_enable=1;
    reg [31:0] master_addr=0, master_wdata=0, master_meta=0;
    reg [3:0] master_be=0, master_header=4'hf;
    reg [17:0] master_wait_last=1023;
    wire master_ready, master_rsp, master_timeout, master_oe;
    wire [31:0] master_rdata, master_fault, master_ad;
    tri [31:0] sys_ad;
    wire sys_as_n, sys_rd_n, sys_wr_n;
    wire [3:0] sys_be_n;
    tri1 sys_ready_n;
    wire [31:0] endpoint_ad;
    wire endpoint_oe, endpoint_ready;
    assign sys_ad=master_oe ? master_ad : 32'bz;
    assign sys_ad=endpoint_oe ? endpoint_ad : 32'bz;
    assign sys_ready_n=endpoint_ready ? 1'b0 : 1'bz;
    system_bus_master master (
        .clk(clk),.reset_n(reset_n),.req_valid(master_valid),.req_ready(master_ready),
        .req_write(master_write),.req_addr(master_addr),.req_wdata(master_wdata),
        .req_meta(master_meta),.req_be_n(master_be),.req_header_be_n(master_header),.bus_busy(),
        .req_data_timeout_enable(master_timeout_enable),.req_data_wait_last(master_wait_last),
        .rsp_valid(master_rsp),.rsp_rdata(master_rdata),.rsp_fault_code(master_fault),.rsp_timeout(master_timeout),
        .bus_ad_in(sys_ad),.bus_ad_out(master_ad),.bus_ad_oe(master_oe),
        .bus_as_n(sys_as_n),.bus_rd_n(sys_rd_n),.bus_wr_n(sys_wr_n),.bus_be_n(sys_be_n),.bus_ready_n(sys_ready_n)
    );
    cart_sys_endpoint endpoint (
        .clk(clk),.reset_n(reset_n),.cs_cart_n(!use_sys),
        .bus_ad_in(sys_ad),.bus_as_n(sys_as_n),.bus_rd_n(sys_rd_n),.bus_wr_n(sys_wr_n),.bus_be_n(sys_be_n),
        .bus_ad_out(endpoint_ad),.bus_ad_oe(endpoint_oe),.bus_ready_drive_low(endpoint_ready),
        .cart_valid(cart_valid),.cart_ready(cart_ready),.cart_address(cart_address),
        .cart_bus_signals(cart_bus_signals),.cart_cancel(cart_cancel),.cart_rsp_valid(owner_rsp[1]),
        .cart_rdata(owner_data[63:32]),.cart_fault_code(inject_fault | owner_fault[63:32])
    );
    integer clocks=0, admission_clock=0, first_word_clocks=0;
    reg measure_word=1, throughput_core=0, throughput_sys=0;
    realtime word_start, sys_start;
    integer word_period_clocks=0, sys_period_clocks=0;
    always @(posedge clk) begin
        clocks=clocks+1;
        if(reset_n && req_valid && req_ready && measure_word) admission_clock=clocks;
        if(reset_n && throughput_core && rsp_valid &&
           (rsp_data!==word_at(32'h1234fffc,0) || rsp_fault_code!=0 || rsp_timeout))
            $fatal(1,"Continuous CORE word corrupted");
        if(reset_n && throughput_sys && master_rsp &&
           (master_rdata!==word_at(32'h10305070,0) || master_fault!=0 || master_timeout))
            $fatal(1,"Continuous SYS word corrupted");
        if(reset_n && rsp_valid && measure_word) begin first_word_clocks=clocks-admission_clock;measure_word=0;end
    end
    integer responses=0, sys_responses=0, read_clocks=0, measured_read_clocks=0;
    integer current_read_clocks=0, first_read0, first_read1, before_reads;
    reg was_read=0, watch_order=0;
    integer admission_order[0:7];
    integer admissions=0;
    always @(posedge clk) if(reset_n && watch_order) begin
        if(owner_ready[0] && req_valid) begin admission_order[admissions]=0;admissions=admissions+1;end
        if(owner_ready[1] && cart_valid) begin admission_order[admissions]=1;admissions=admissions+1;end
        if(owner_ready==3) $fatal(1,"Two owners admitted to one CAD bridge");
    end
    always @(posedge clk) if(reset_n) begin
        if(rsp_valid) responses=responses+1;
        if(master_rsp) sys_responses=sys_responses+1;
        if(!crd_n) current_read_clocks=current_read_clocks+1;
        if(was_read && crd_n) begin
            measured_read_clocks=current_read_clocks;current_read_clocks=0;
        end
        was_read=!crd_n;
        if(cs_cart_n==0) $fatal(1,"Both cartridge sockets selected");
        if(!cwr_n) $fatal(1,"ROM read bridge generated write");
        if(!crd_n && (cart_oe_n || cart_dir)) $fatal(1,"Read did not use receive direction");
        if((cal_lo || cal_hi) && (cart_oe_n || !cart_dir)) $fatal(1,"Address did not use transmit direction");
    end
    always @(cart_dir) if(reset_n && (!cart_oe_n || drive_to_card || drive_to_core)) $fatal(1,"U51 DIR changed while OE active");
    function automatic [31:0] word_at(input [31:0] address,input socket);
        reg [31:0] next_address;
        reg [15:0] salt;
        begin
            salt=socket ? 16'hb137 : 16'h42a5;next_address=address+2;
            word_at={next_address[15:0]^next_address[31:16]^salt,address[15:0]^address[31:16]^salt};
        end
    endfunction
    task automatic launch(input [31:0] address,input [7:0] signals,input socket,
                          input timed,input [17:0] last);
        begin
            @(negedge clk);req_address=address;req_bus_signals=signals;selected_socket=socket;
            req_data_timeout_enable=timed;req_data_wait_last=last;req_valid=1;
            @(posedge clk);while(!req_ready) @(posedge clk);
            @(negedge clk);req_valid=0;
        end
    endtask
    task automatic finish(input [31:0] expected,input timeout_expected);
        begin
            while(!rsp_valid) @(negedge clk);
            if(rsp_data!==expected || rsp_fault_code!==0 || rsp_timeout!==timeout_expected)
                $fatal(1,"Bridge reply %h/%h/%b, expected%h/%b",rsp_data,rsp_fault_code,rsp_timeout,expected,timeout_expected);
            if(cs_cart_n!==3 || !crd_n || !cart_oe_n || cad!==16'bz)
                $fatal(1,"Bridge replied before physical release");
            @(negedge clk);
        end
    endtask
    task automatic sys_transfer(input [31:0] address,input [7:0] signals,input writing,
                                input [3:0] mask,input [3:0] operation,input [31:0] expected,
                                input [31:0] fault_expected,input timeout_expected);
        begin
            @(negedge clk);master_addr=address;master_meta={24'hfedcba,signals};master_write=writing;
            master_be=mask;master_header=operation;master_wdata=32'h12345678;master_valid=1;
            @(posedge clk);while(!master_ready) @(posedge clk);
            @(negedge clk);master_valid=0;
            while(!master_rsp) @(negedge clk);
            if(master_rdata!==expected || master_fault!==fault_expected || master_timeout!==timeout_expected)
                $fatal(1,"SYS cartridge reply %h/%h/%b expected%h/%h/%b",master_rdata,master_fault,master_timeout,expected,fault_expected,timeout_expected);
            @(negedge clk);
        end
    endtask
    initial begin #2000000;$fatal(1,"Cartridge test watchdog");end
    initial begin
        #2;reset_n=0;repeat(3) @(negedge clk);reset_n=1;repeat(4) @(negedge clk);
        launch(32'h1234fffc,0,0,0,0);first_read0=card0.reads;
        // Source selection and address are fixed at acceptance, not re-read for half2.
        req_address=32'hdead0000;req_bus_signals=8'h0c;selected_socket=1;
        finish(word_at(32'h1234fffc,0),0);
        if(card0.read_addresses[0]!==32'h1234fffc || card0.read_addresses[1]!==32'h1234fffe)
            $fatal(1,"Card0 did not receive complete BYTE address pairs");
        read_clocks=measured_read_clocks;
        // Measure real continuous-valid accept-to-accept spacing, not a
        // throughput inferred from the command's response-latency count.
        @(negedge clk);req_valid=1;req_address=32'h1234fffc;
        req_bus_signals=8'h04;selected_socket=0;throughput_core=1;
        @(posedge clk);while(!req_ready) @(posedge clk);word_start=$realtime;
        @(posedge clk);while(!req_ready) @(posedge clk);
        word_period_clocks=$rtoi(($realtime-word_start)/PERIOD+0.5);
        @(negedge clk);req_valid=0;finish(word_at(32'h1234fffc,0),0);throughput_core=0;
        launch(32'h2fffffb0,0,1,0,0);finish(word_at(32'h2fffffb0,1),0);
        launch(32'h10020000,8'hf4,1,0,0);finish(word_at(32'h10020000,0),0);
        launch(32'h10fffefc,8'hbd,0,0,0);finish(word_at(32'h10fffefc,1),0);
        before_reads=card0.reads+card1.reads;cart_present_n=2'b10;repeat(3) @(negedge clk);
        launch(32'h10000000,8'h0c,0,0,0);finish(0,0);
        if(card0.reads+card1.reads!=before_reads) $fatal(1,"Empty socket generated CAD access");
        cart_present_n=0;repeat(3) @(negedge clk);
        // Untimed access remains pending for hundreds of clocks, then resumes.
        stalled=1;launch(32'h1000fffc,0,0,0,0);wait(!crd_n);
        repeat(400) begin @(negedge clk);if(rsp_valid || crd_n) $fatal(1,"Untimed READY wait expired");end
        stalled=0;finish(word_at(32'h1000fffc,0),0);
        // ACK on the final diagnostic sample wins over the raw deadline.
        launch(32'h10001000,0,0,1,read_clocks-1);finish(word_at(32'h10001000,0),0);
        stalled=1;launch(32'h10002000,0,0,1,0);finish(0,1);stalled=0;
        // Cancellation withdraws pins immediately and never emits a stale reply.
        use_sys=1;stalled=2;launch(32'h10003000,8'h0c,0,0,0);wait(!crd_n);
        fork
            sys_transfer(32'h10003200,8'h04,0,0,4'hf,word_at(32'h10003200,0),0,0);
            begin
                wait(cart_valid);#3;cancel=1;#1;
                if(!crd_n || !cart_oe_n || cs_cart_n!==3) $fatal(1,"Cancel failed to release physical read");
                repeat(2) begin
                    @(negedge clk);
                    if(owner_ready!=0 || !cart_oe_n) $fatal(1,"Cancelled owner skipped quiet clocks");
                end
                @(negedge clk);cancel=0;stalled=0;
                repeat(8) begin @(negedge clk);if(rsp_valid) $fatal(1,"Stale cancelled reply");end
            end
        join
        launch(32'h20000000,8'h0c,0,0,0);finish(word_at(32'h20000000,1),0);
        // Both front ends contend for the same real CAD datapath. The waiting
        // SYS word receives the next turn before CORE's subsequent word.
        watch_order=1;stalled=1;
        launch(32'h10101010,8'h04,0,0,0);
        fork
            sys_transfer(32'h20202020,8'h0c,0,0,4'hf,word_at(32'h20202020,1),0,0);
            begin
                wait(!crd_n);repeat(25) @(negedge clk);stalled=0;
                finish(word_at(32'h10101010,0),0);
                launch(32'h10303030,8'h04,0,0,0);finish(word_at(32'h10303030,0),0);
            end
        join
        watch_order=0;
        if(admissions!=3 || admission_order[0]!=0 || admission_order[1]!=1 || admission_order[2]!=0)
            $fatal(1,"CAD word-boundary arbitration was not fair");
        @(negedge clk);master_addr=32'h10305070;master_meta=32'h76543204;
        master_write=0;master_be=0;master_header=4'hf;master_valid=1;throughput_sys=1;
        @(posedge clk);while(!master_ready) @(posedge clk);sys_start=$realtime;
        @(posedge clk);while(!master_ready) @(posedge clk);
        sys_period_clocks=$rtoi(($realtime-sys_start)/PERIOD+0.5);
        @(negedge clk);master_valid=0;
        while(!master_rsp) @(negedge clk);
        @(negedge clk);throughput_sys=0;
        sys_transfer(32'h10203040,8'hac,0,0,4'hf,word_at(32'h10203040,1),0,0);
        inject_fault=32'h9abc5432;
        sys_transfer(32'h12345678,8'h04,0,0,4'hf,word_at(32'h12345678,0),32'h9abc5432,0);
        inject_fault=0;before_reads=card0.reads+card1.reads;
        sys_transfer(32'h30000000,8'h04,0,0,4'hf,0,1,0);
        sys_transfer(32'h10000000,8'h04,1,0,4'hf,0,1,0);
        sys_transfer(32'h10000002,8'h04,0,0,4'hf,0,2,0);
        sys_transfer(32'h10000000,8'h04,0,4'h1,4'hf,0,2,0);
        sys_transfer(32'h10000000,8'h04,0,0,4'he,0,1,0);
        if(card0.reads+card1.reads!=before_reads) $fatal(1,"Rejected SYS request reached card");
        // External SYS diagnostic times out and cancels a real, untimed CAD read.
        stalled=2;master_wait_last=31;
        sys_transfer(32'h10005000,8'h0c,0,0,4'hf,0,0,1);
        repeat(5) @(negedge clk);
        if(!crd_n || !cart_oe_n || cs_cart_n!==3) $fatal(1,"SYS withdrawal left CAD active");
        stalled=0;master_wait_last=1023;
        sys_transfer(32'h10006000,8'h04,0,0,4'hf,word_at(32'h10006000,0),0,0);
        // Shared reset also aborts a physical read without replaying its owner.
        stalled=1;launch(32'h10007000,8'h04,0,0,0);wait(!crd_n);#5;reset_n=0;#1;
        if(!crd_n || !cart_oe_n || cs_cart_n!==3) $fatal(1,"Reset left CAD pins active");
        repeat(3) @(negedge clk);reset_n=1;stalled=0;
        repeat(8) begin @(negedge clk);if(owner_rsp!=0) $fatal(1,"Reset replayed an old owner");end
        launch(32'h10008000,8'h04,0,0,0);finish(word_at(32'h10008000,0),0);
        $display("BRIDGE word acceptance-to-response=%0d clocks; measured continuous-valid word period=%0d clocks (%0f words/s)",first_word_clocks,word_period_clocks,33868800.0/word_period_clocks);
        $display("SYS measured continuous-valid word period=%0d clocks (%0f words/s), exclusive of CORE/APU ownership handover",sys_period_clocks,33868800.0/sys_period_clocks);
        $display("PASS cartridge ROM + 2-owner fair arbitration: BYTE-address CAL pairs, two real halfwords, both sockets/raw overrides/bound selection/absent zero, selected U51/U53 delays, READY synchronisation+unbounded wait, diagnostic deadline/cancel, real SYS target/full32 faults; bridge replies=%0d SYS replies=%0d read clocks=%0d",responses,sys_responses,read_clocks);
        $finish;
    end
endmodule
