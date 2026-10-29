`timescale 1ns/1ps
// Two programmed channel banks and block-boundary arbitration. This is the
// register/scheduler owner around dma_block_transfer, not the CPU I/O decoder,
// IRQ pending bank, SYSTEM sequencer, or the complete ASIC. The retained
// cartridge register bank and its atomic supervisor exchange live here.
// Request bits are the native selector numbers; FORCE and DISABLED are decoded
// here. An admitted block snapshots all four words in dma_block_transfer.
// Register writes are serialized against result writeback; no bus request is
// replayed after transport timeout. A reset is required for transport recovery.
// Production reference: LiteX DMA request/stream handshake ownership:
// https://github.com/enjoy-digital/litex/blob/master/litex/soc/cores/dma.py
module dma_channel_controller (
    input wire clk, reset_n,
    input wire access_valid, access_write, access_channel,
    input wire [2:0] access_index,
    input wire [31:0] access_wdata,
    output wire access_ready,
    output reg [31:0] access_rdata,
    output wire [31:0] access_fault,
    input wire trigger_inhibit, admission_inhibit,
    input wire enter_supervisor, leave_supervisor,
    output wire supervisor_boundary_ready,
    input wire [15:0] request_lines,
    output reg [1:0] irq_raise,
    output wire block_active, active_channel,
    output wire [31:0] active_read_address, active_write_address,
    input wire [31:0] port_address,
    output wire owns_read_port, owns_write_port,
    output reg transport_failed, transport_write_in_doubt,
    output wire req_valid, req_write, req_hold,
    input wire req_ready,
    output wire [31:0] req_address, req_wdata, req_access,
    output wire [2:0] req_size_bytes,
    output wire [3:0] req_be_n,
    output wire [7:0] req_bus_signals,
    output wire req_data_timeout_enable,
    output wire [17:0] req_data_wait_last,
    input wire rsp_valid, rsp_timeout,
    input wire [31:0] rsp_rdata
);
    reg [31:0] read_address[0:1], write_address[0:1], count[0:1], control[0:1], status[0:1];
    reg active, owner, next_channel, finish_pending;
    reg [31:0] captured_read, captured_write;
    reg [1:0] pending_irq;
    wire result_valid, result_timeout, result_write_in_doubt, block_ready;
    wire context_load, context_next_channel;
    wire [63:0] context_read_address, context_write_address;
    wire [63:0] context_count, context_control, context_status;
    dma_supervisor_context context_bank (
        .clk(clk), .reset_n(reset_n),
        .control_quiesce(trigger_inhibit), .block_quiesce(admission_inhibit),
        .block_active(active), .completion_pending((|pending_irq) || (|irq_raise)),
        .trigger_inhibit(), .admission_inhibit(), .boundary_ready(supervisor_boundary_ready),
        .enter_context(enter_supervisor), .leave_context(leave_supervisor),
        .live_read_address({read_address[1],read_address[0]}),
        .live_write_address({write_address[1],write_address[0]}),
        .live_count({count[1],count[0]}), .live_control({control[1],control[0]}),
        .live_status({status[1],status[0]}), .live_next_channel(next_channel),
        .load_live(context_load), .load_read_address(context_read_address),
        .load_write_address(context_write_address), .load_count(context_count),
        .load_control(context_control), .load_status(context_status),
        .load_next_channel(context_next_channel)
    );
    wire [31:0] result_read, result_write, result_count;
    wire write_access = access_valid && access_write && access_ready;
    wire block_result = active && result_valid;
    wire trigger_wait = access_write && access_index==5 && trigger_inhibit;
    // A single register port arbitrates against same-channel block publication.
    assign access_ready = !context_load && !trigger_wait && !((block_result || finish_pending) && access_write && access_channel==owner);
    assign access_fault = access_write && access_index==4 ? 32'd3 : 32'd0;
    assign block_active=active;
    assign active_channel=owner;
    assign active_read_address=captured_read;
    assign active_write_address=captured_write;
    wire [31:0] owned_read0 = active && !owner ? captured_read : read_address[0];
    wire [31:0] owned_read1 = active && owner ? captured_read : read_address[1];
    wire [31:0] owned_write0 = active && !owner ? captured_write : write_address[0];
    wire [31:0] owned_write1 = active && owner ? captured_write : write_address[1];
    assign owns_read_port = (status[0][0] && owned_read0==port_address) || (status[1][0] && owned_read1==port_address);
    assign owns_write_port = (status[0][0] && owned_write0==port_address) || (status[1][0] && owned_write1==port_address);
    function automatic request_asserted(input [3:0] selector, input [15:0] lines);
        case(selector)
            0: request_asserted=1'b1;
            15: request_asserted=1'b0;
            default: request_asserted=lines[selector];
        endcase
    endfunction
    wire eligible0=status[0][0] && count[0]!=0 && request_asserted(control[0][5:2],request_lines) && request_asserted(control[0][9:6],request_lines);
    wire eligible1=status[1][0] && count[1]!=0 && request_asserted(control[1][5:2],request_lines) && request_asserted(control[1][9:6],request_lines);
    wire select_channel = next_channel ? (eligible1 ? 1'b1 : 1'b0) : (eligible0 ? 1'b0 : 1'b1);
    // Accepted writes take effect before admission samples channel words.
    wire admit = !active && !transport_failed && !admission_inhibit && !context_load && !write_access && (eligible0 || eligible1);
    dma_block_transfer datapath (
        .clk(clk), .reset_n(reset_n), .block_valid(admit), .block_ready(block_ready),
        .block_read_address(read_address[select_channel]), .block_write_address(write_address[select_channel]),
        .block_transfer_count(count[select_channel]), .block_control(control[select_channel]),
        .result_valid(result_valid), .result_read_address(result_read), .result_write_address(result_write),
        .result_transfer_count(result_count), .result_timeout(result_timeout), .result_write_in_doubt(result_write_in_doubt),
        .req_valid(req_valid), .req_ready(req_ready), .req_write(req_write), .req_hold(req_hold),
        .req_address(req_address), .req_wdata(req_wdata), .req_access(req_access),
        .req_size_bytes(req_size_bytes), .req_be_n(req_be_n), .req_bus_signals(req_bus_signals),
        .req_data_timeout_enable(req_data_timeout_enable), .req_data_wait_last(req_data_wait_last),
        .rsp_valid(rsp_valid), .rsp_timeout(rsp_timeout), .rsp_rdata(rsp_rdata)
    );
    always @* begin
        case(access_index)
            0: access_rdata=read_address[access_channel];
            1: access_rdata=write_address[access_channel];
            2: access_rdata=count[access_channel];
            3: access_rdata=control[access_channel];
            4: access_rdata=status[access_channel];
            default: access_rdata=0;
        endcase
    end
    integer i;
    always @(posedge clk or negedge reset_n) begin
        if(!reset_n) begin
            for(i=0;i<2;i=i+1) begin
                read_address[i]<=0;write_address[i]<=0;count[i]<=0;control[i]<=0;status[i]<=0;
            end
            active<=0;owner<=0;next_channel<=0;finish_pending<=0;captured_read<=0;captured_write<=0;
            irq_raise<=0;pending_irq<=0;transport_failed<=0;transport_write_in_doubt<=0;
        end else begin
            irq_raise<=pending_irq;
            pending_irq<=0;
            if(context_load) begin
                for(i=0;i<2;i=i+1) begin
                    read_address[i]<=context_read_address[i*32 +:32];
                    write_address[i]<=context_write_address[i*32 +:32];
                    count[i]<=context_count[i*32 +:32];
                    control[i]<=context_control[i*32 +:32];
                    status[i]<=context_status[i*32 +:32];
                end
                active<=0;owner<=0;next_channel<=context_next_channel;finish_pending<=0;
                captured_read<=0;captured_write<=0;irq_raise<=0;pending_irq<=0;
            end else begin
            if(write_access) case(access_index)
                0: read_address[access_channel]<=access_wdata;
                1: write_address[access_channel]<=access_wdata;
                2: count[access_channel]<=access_wdata;
                3: control[access_channel]<=access_wdata;
                5: if(access_wdata[0] && !status[access_channel][0]) begin
                    if(count[access_channel]==0) begin
                        status[access_channel]<=2;pending_irq[access_channel]<=1;
                    end else status[access_channel]<=1;
                end
                default: begin end
            endcase
            if(admit && block_ready) begin
                active<=1;owner<=select_channel;next_channel<=!select_channel;
                captured_read<=read_address[select_channel];captured_write<=write_address[select_channel];
            end
            if(block_result) begin
                if(result_timeout) begin
                    active<=0;transport_failed<=1;transport_write_in_doubt<=result_write_in_doubt;
                end else begin
                    read_address[owner]<=result_read;write_address[owner]<=result_write;count[owner]<=result_count;
                    if(result_count==0) finish_pending<=1;
                    else active<=0;
                end
            end
            // The final address/count publication precedes DONE; the IRQ
            // pulse is published on a later clock than DONE.
            if(finish_pending) begin
                status[owner]<=2;pending_irq[owner]<=1;finish_pending<=0;active<=0;
            end
            // A busy channel with a rewritten zero count completes at an idle
            // block boundary regardless of its request gates.
            if(!active && !admission_inhibit && !transport_failed && !write_access) begin
                for(i=0;i<2;i=i+1) if(status[i][0] && count[i]==0) begin
                    status[i]<=2;pending_irq[i]<=1;
                end
            end
            end
        end
    end
endmodule
