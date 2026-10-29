`timescale 1ns/1ps

// Exercise observable pins and valid/ready edges, not FSM encodings.
module system_bus_tb;
    parameter integer MAX_WAIT = 16;
    reg clk = 0;
    always #5 clk = !clk;
    reg reset_n = 1;
    reg req_valid = 0;
    wire req_ready, rsp_valid;
    reg req_write = 0;
    reg [31:0] req_addr = 0, req_wdata = 0, req_meta = 0;
    reg [17:0] req_data_wait_last = MAX_WAIT - 1;
    reg req_data_timeout_enable = 1;
    reg [3:0] req_be_n = 4'hf;
    wire [31:0] rsp_rdata, bus_ad_out;
    wire [31:0] rsp_fault_code;
    wire rsp_timeout;
    wire bus_ad_oe, bus_as_n, bus_rd_n, bus_wr_n;
    wire [3:0] bus_be_n;
    reg [31:0] bus_ad_in = 0;
    reg bus_ready_n = 1;
    integer completed = 0;
    integer status;

    system_bus_master #(.RESPONSE_MAX_WAIT(MAX_WAIT)) dut (
        .req_header_be_n(4'hf), .bus_busy(),
        .req_data_timeout_enable(req_data_timeout_enable), .*);

    task automatic tick;
        @(posedge clk);
        #1;
    endtask

    task automatic quiet_bus;
        if ({bus_ad_oe,bus_as_n,bus_rd_n,bus_wr_n,bus_be_n} !== 8'b01111111)
            $fatal(1,"Bus is not released: oe/as/rd/wr/be=%b%b%b%b%b",
                bus_ad_oe,bus_as_n,bus_rd_n,bus_wr_n,bus_be_n);
    endtask

    task automatic data_bus(input bit write_access,input [31:0] word,input [3:0] be);
        if ({bus_as_n,bus_rd_n,bus_wr_n,bus_be_n} !== {1'b1,write_access,!write_access,be})
            $fatal(1,"DATA strobes/byte enables changed");
        if (bus_ad_oe !== write_access)
            $fatal(1,"Incorrect DATA bus owner");
        if (write_access && bus_ad_out !== word)
            $fatal(1,"Write operand was not latched");
        if (req_ready || rsp_valid)
            $fatal(1,"Active DATA must not accept or complete another request");
    endtask

    task automatic response_bus;
        if ({bus_ad_oe,bus_as_n,bus_rd_n,bus_wr_n,bus_be_n} !== 8'b01001111)
            $fatal(1,"Incorrect RESPONSE pins");
        if (req_ready || rsp_valid)
            $fatal(1,"Response transfer is not yet host completion");
    endtask

    task automatic header_to_data(input bit write_access,input [31:0] address,
                                  input [31:0] word,input [3:0] be,input [31:0] metadata);
        if ({bus_ad_oe,bus_as_n,bus_rd_n,bus_wr_n,bus_be_n} !== 8'b10111111 ||
            bus_ad_out !== metadata)
            $fatal(1,"HEADER did not preserve the raw metadata word");
        if (req_ready || rsp_valid) $fatal(1,"HEADER advertised another request or response");
        req_valid = 0;
        req_write = !write_access;
        req_addr = ~address;
        req_wdata = ~word;
        req_be_n = ~be;
        req_meta = ~metadata;
        req_data_wait_last = ~req_data_wait_last;
        req_data_timeout_enable = !req_data_timeout_enable;
        tick();
        if ({bus_ad_oe,bus_as_n,bus_rd_n,bus_wr_n,bus_be_n} !== {1'b1,1'b0,1'b1,1'b1,be} ||
            bus_ad_out !== address)
            $fatal(1,"ADDRESS/BE were not latched verbatim");
        if (req_ready || rsp_valid) $fatal(1,"ADDRESS advertised another request or response");
        tick(); quiet_bus();
        if (req_ready || rsp_valid) $fatal(1,"Turnaround accepted a request");
        tick(); data_bus(write_access,word,be);
    endtask

    task automatic launch(input bit write_access,input [31:0] address,
                          input [31:0] word,input [3:0] be,input [31:0] metadata,
                          input [17:0] data_wait_last);
        if (!req_ready) $fatal(1,"Launch without request-ready");
        req_valid=1; req_write=write_access; req_addr=address;
        req_wdata=word; req_be_n=be; req_meta=metadata;
        req_data_wait_last=data_wait_last;
        req_data_timeout_enable=1;
        tick();
        header_to_data(write_access,address,word,be,metadata);
    endtask

    task automatic completion(input [31:0] data,input [31:0] fault,input bit timeout);
        quiet_bus();
        if (!rsp_valid || !req_ready || rsp_rdata !== data || rsp_fault_code !== fault || rsp_timeout !== timeout)
            $fatal(1,"Completion mismatch valid/ready=%b%b data=%h fault=%h timeout=%b expected=%h/%h/%b",
                rsp_valid,req_ready,rsp_rdata,rsp_fault_code,rsp_timeout,data,fault,timeout);
        completed=completed+1;
    endtask

    task automatic acknowledge(input bit write_access,input [31:0] word,input [3:0] be,
                               input [31:0] read_word,input [31:0] response_word,
                               input integer data_wait,input integer response_wait);
        integer i;
        for (i=0;i<data_wait;i=i+1) begin
            bus_ad_in=32'hbaad0000+i;
            tick(); data_bus(write_access,word,be);
        end
        bus_ad_in=read_word; bus_ready_n=0;
        tick(); quiet_bus();
        if (rsp_valid || req_ready) $fatal(1,"Missing data-to-response turnaround");
        bus_ready_n=1; bus_ad_in=~read_word;
        tick(); quiet_bus(); tick(); response_bus();
        for (i=0;i<response_wait;i=i+1) begin
            bus_ad_in=32'hdead0000+i;
            tick(); response_bus();
        end
        bus_ad_in=response_word; bus_ready_n=0;
        tick(); quiet_bus();
        if (rsp_valid || req_ready) $fatal(1,"Missing release clock");
        bus_ready_n=1; bus_ad_in=0;
        tick(); completion(write_access ? 32'b0 : read_word,response_word,0);
    endtask

    task automatic data_timeout(input bit write_access,input [17:0] data_wait_last);
        integer i;
        launch(write_access,32'hfffffff3,32'h9abcdef0,4'b0101,32'hffffffff,data_wait_last);
        for (i=0;i<data_wait_last;i=i+1) begin tick(); data_bus(write_access,32'h9abcdef0,4'b0101); end
        tick(); quiet_bus();
        if (rsp_valid || req_ready) $fatal(1,"Timeout must release before completing");
        tick(); completion(0,0,1);
    endtask

    task automatic response_timeout(input bit write_access);
        integer i;
        launch(write_access,32'h13579bdf,32'h2468ace0,4'b1010,32'ha5a5f00d,MAX_WAIT-1);
        bus_ad_in=32'hc001d00d; bus_ready_n=0;
        tick(); quiet_bus();
        bus_ready_n=1;
        tick(); quiet_bus(); tick(); response_bus();
        for (i=0;i<MAX_WAIT-1;i=i+1) begin tick(); response_bus(); end
        tick(); quiet_bus();
        if (rsp_valid || req_ready) $fatal(1,"Response timeout skipped release");
        tick(); completion(write_access ? 32'b0 : 32'hc001d00d,0,1);
    endtask

    initial begin
        #5000000;
        $fatal(1,"Transport test watchdog expired");
    end

    initial begin
        #2; reset_n=0;
        #1; quiet_bus();
        if (req_ready || rsp_valid) $fatal(1,"Reset did not gate host handshake");
        tick(); tick();
        reset_n=1;
        tick(); quiet_bus();
        if (req_ready || rsp_valid) $fatal(1,"Reset released after only one clock");
        tick(); quiet_bus();
        if (!req_ready || rsp_valid) $fatal(1,"Two-clock reset release failed");

        launch(0,32'h1234567b,0,4'b1010,32'hdeadbeef,MAX_WAIT-1);
        acknowledge(0,0,4'b1010,32'h76543210,0,0,0);
        // DONE accepts the next operation without an idle bubble.
        launch(1,32'hcafebabd,32'h89abcdef,4'b0101,32'hffffffff,MAX_WAIT-1);
        acknowledge(1,32'h89abcdef,4'b0101,32'h11223344,0,MAX_WAIT-1,MAX_WAIT-1);
        for (status=0;status<4;status=status+1) begin
            launch(0,32'h80000003+status,0,4'b0011,32'hfe120000+status,MAX_WAIT-1);
            acknowledge(0,0,4'b0011,32'h01020300+status,32'hfffffff0+status,0,0);
        end
        launch(1,32'h08000068,32'hffffffff,4'b0000,0,MAX_WAIT-1);
        acknowledge(1,32'hffffffff,4'b0000,0,32'd3,0,0);
        data_timeout(0,MAX_WAIT-1);
        data_timeout(1,MAX_WAIT-1);
        response_timeout(0);
        response_timeout(1);

        // An owning device's READY edge is not bounded by a diagnostic DATA
        // budget. Live producer changes must not enable timeout after capture.
        req_valid=1;req_write=1;req_addr=32'h0800011c;
        req_wdata=32'h12345678;req_be_n=0;req_meta=32'hfedcba98;
        req_data_wait_last=0;req_data_timeout_enable=0;
        tick();
        header_to_data(1,32'h0800011c,32'h12345678,0,32'hfedcba98);
        acknowledge(1,32'h12345678,0,0,32'h87654321,MAX_WAIT+19,0);
        // Conversely, disabling the live producer after timed acceptance
        // must not suppress its latched one-clock diagnostic timeout.
        data_timeout(0,18'd0);

        // The pad link may be occupied by a complete wire frame. Its request
        // carries a long DATA budget; RESPONSE and ordinary accesses do not.
        if (MAX_WAIT == 16) begin
            launch(1,32'h0800011c,32'h00000001,4'b0000,32'h2468ace0,18'd81919);
            acknowledge(1,32'h00000001,4'b0000,0,0,81919,MAX_WAIT-1);
            data_timeout(1,18'd81919);
            // All 18 counter bits participate. No maximum-word normalization.
            launch(0,32'hffffffff,0,4'b1111,32'hffffffff,18'h3ffff);
            acknowledge(0,0,4'b1111,32'h80000001,32'hffffffff,262143,0);
            // A zero last-counter word means exactly one DATA clock.
            data_timeout(0,18'd0);
        end

        // Reset during an unacknowledged write aborts immediately, between edges.
        launch(1,32'hf0000001,32'hfeedface,4'b0000,32'h900000ff,MAX_WAIT-1);
        #2; reset_n=0;
        #1; quiet_bus();
        if (req_ready || rsp_valid || rsp_rdata !== 0 || rsp_fault_code !== 0 || rsp_timeout !== 0)
            $fatal(1,"Asynchronous reset failed to abort the active request");
        req_valid=1; req_write=0; req_addr=32'h00000007;
        req_wdata=0; req_be_n=4'b1100; req_meta=32'h13579bdf;
        req_data_wait_last=MAX_WAIT-1;
        req_data_timeout_enable=1;
        tick(); quiet_bus();
        reset_n=1;
        tick(); quiet_bus();
        if (req_ready || rsp_valid) $fatal(1,"Abort reset released too early");
        tick(); quiet_bus();
        if (!req_ready || rsp_valid) $fatal(1,"Pending request admitted during reset release");
        tick();
        header_to_data(0,32'h00000007,0,4'b1100,32'h13579bdf);
        acknowledge(0,0,4'b1100,32'h55aa33cc,32'hfffffff2,0,0);
        tick(); quiet_bus();
        if (!req_ready || rsp_valid) $fatal(1,"Response-valid was not one clock wide");
        $display("PASS system_bus MAX_WAIT=%0d completions=%0d",MAX_WAIT,completed);
        $finish;
    end
endmodule
