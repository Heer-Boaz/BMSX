`timescale 1ns/1ps
// U1 closed-page controller for two x32 banks, each made from two
// IS41LV16100-50KI (non-B, Rev. L 2005) devices in parallel. Bank 0 is the
// existing public bank; bank 1 is proposed private VM backing. MA carries
// word-index[19:10] as row and [9:0] as column. CAS0..3 select four bytes.
// Each admitted request captures its bank; normal cycles select only its RAS
// and OE. EDO outputs may retain an earlier read while CAS is low even when
// RAS is high; an inactive bank's separate OE must remain high.
// CBR initialization and refresh assert both RAS outputs. The additional
// physical parts, loading, current and pin timing are not qualified here.
// There is one captured request, no payload FIFO and no open-page shortcut.
//
// At 33.8688 MHz: row setup 1T, row hold 1T, column setup 1T, CAS access
// 2T, CAS-high/RAS-low hold 2T (tRHCP>=37ns), RAS precharge 2T (>=30ns).
// Result publication is 9T after acceptance. The next acceptance can occur
// 10T after the previous one; refresh adds its own bounded interval.
// tRAD/tRCD maxima in that data sheet are access-time reference conditions,
// not prohibitions on a later column. Capture also covers tAA and tCAC.
//
// True ASIC power-on reset initializes the waveform owner. Board/system reset
// cancels admission and the old response, but finishes any legal active cycle
// and KEEPS REFRESH RUNNING. No reset clears RAM. Power loss promises no data
// retention. power_reset_n is an internal POR-cell boundary, not a PCB pin.
// Pin/pad/PCB skew, transition rates and capture setup still require closure.
module main_dram (
    input wire clk, power_reset_n, reset_n,
    input wire req_valid,
    output wire req_ready,
    input wire req_write, req_private,
    input wire [19:0] req_address,
    input wire [31:0] req_wdata,
    input wire [3:0] req_be_n,
    output wire rsp_valid,
    output reg [31:0] rsp_rdata,
    output reg init_done,
    output reg [9:0] ma,
    inout wire [31:0] md,
    output reg ras_n, ras_private_n,
    output reg [3:0] cas_n,
    output reg we_n, oe_n, oe_private_n
);
    localparam [3:0] POWER_WAIT=0, IDLE=1, ROW_SETUP=2, ROW_ACTIVE=3,
        COLUMN_SETUP=4, ACCESS=5, ROW_HOLD=6, PRECHARGE=7,
        REF_SETUP=8, REF_ACTIVE=9, REF_HOLD=10, REF_RECOVER=11;
    // 200us * 33,868,800 Hz = 6773.76; 6784 full clocks add oscillator margin.
    localparam [12:0] POWER_WAIT_LAST=13'd6783;
    // One CBR per 480 clocks plus <=10 clocks of active-cycle deferral.
    // Even a conservative 500T maximum gives 1024 rows in <15.12ms (<16ms).
    localparam [8:0] REFRESH_LAST=9'd479;
    reg [3:0] phase;
    reg [12:0] power_count;
    reg [8:0] refresh_count;
    reg [2:0] initial_refresh_count;
    reg hold_count;
    reg [19:0] address_word;
    reg [31:0] data_word;
    reg [3:0] byte_enables;
    reg write_access, private_access;
    reg reset_pending;
    reg response_valid;
    reg drive_data;
    wire requested_reset_n = power_reset_n && reset_n;
    (* async_reg = "true" *) reg [2:0] por_release;
    assign md=power_reset_n && drive_data ? data_word : 32'bz;
    assign req_ready=power_reset_n && reset_n && !reset_pending &&
        init_done && phase==IDLE && refresh_count!=0;
    assign rsp_valid=power_reset_n && reset_n && !reset_pending && response_valid;

    always @(posedge clk or negedge power_reset_n) begin
        if(!power_reset_n) por_release<=0;
        else por_release<={por_release[1:0],1'b1};
    end
    // Capture even an asynchronously asserted system reset without resetting
    // the DRAM waveform or shortening a RAS/CAS pulse. Release is clocked only
    // after the current operation has finished and an idle boundary is reached.
    always @(posedge clk or negedge requested_reset_n) begin
        if(!requested_reset_n) reset_pending<=1;
        else if(phase==IDLE) reset_pending<=0;
    end

    always @(posedge clk or negedge power_reset_n) begin
        if(!power_reset_n) begin
            phase<=POWER_WAIT; power_count<=POWER_WAIT_LAST;
            refresh_count<=REFRESH_LAST; initial_refresh_count<=0;
            hold_count<=0; address_word<=0; data_word<=0;
            byte_enables<=4'hf; write_access<=0;private_access<=0;
            response_valid<=0; rsp_rdata<=0; init_done<=0;
            ma<=0;ras_n<=1;ras_private_n<=1;cas_n<=4'hf;we_n<=1;oe_n<=1;oe_private_n<=1;drive_data<=0;
        end else begin
            response_valid<=0;
            if(init_done && refresh_count!=0) refresh_count<=refresh_count-1'b1;
            if(por_release[2]) case(phase)
                POWER_WAIT: if(power_count!=0) power_count<=power_count-1'b1;
                    else begin phase<=REF_SETUP;cas_n<=0;end
                IDLE: if(refresh_count==0) begin phase<=REF_SETUP;cas_n<=0;end
                    else if(req_valid && req_ready) begin
                        address_word<=req_address;data_word<=req_wdata;
                        byte_enables<=req_be_n;write_access<=req_write;private_access<=req_private;
                        ma<=req_address[19:10];we_n<=!req_write;
                        drive_data<=req_write;
                        phase<=ROW_SETUP;
                    end
                ROW_SETUP: begin phase<=ROW_ACTIVE;ras_n<=private_access;ras_private_n<=!private_access;end
                ROW_ACTIVE: begin phase<=COLUMN_SETUP;ma<=address_word[9:0];end
                COLUMN_SETUP: begin
                    phase<=ACCESS;hold_count<=1;
                    // Reads capture all32 bits. CORE owns scalar selection;
                    // byte enables mask writes only.
                    cas_n<=write_access ? byte_enables : 4'h0;
                    oe_n<=write_access || private_access;
                    oe_private_n<=write_access || !private_access;
                end
                ACCESS: if(hold_count) hold_count<=0;
                    else begin
                        if(!write_access) rsp_rdata<=md;
                        else rsp_rdata<=0;
                        cas_n<=4'hf;oe_n<=1;oe_private_n<=1;
                        phase<=ROW_HOLD;hold_count<=1;
                    end
                ROW_HOLD: if(hold_count) hold_count<=0;
                    else begin
                        phase<=PRECHARGE;hold_count<=1;
                        ras_n<=1;ras_private_n<=1;we_n<=1;drive_data<=0;
                    end
                PRECHARGE: if(hold_count) hold_count<=0;
                    else begin
                        response_valid<=reset_n && !reset_pending;
                        phase<=IDLE;
                    end
                REF_SETUP: begin
                    phase<=REF_ACTIVE;hold_count<=1;
                    ras_n<=0;ras_private_n<=0;
                    refresh_count<=REFRESH_LAST;
                end
                REF_ACTIVE: if(hold_count) hold_count<=0;
                    else begin phase<=REF_HOLD;ras_n<=1;ras_private_n<=1;end
                REF_HOLD: begin phase<=REF_RECOVER;hold_count<=1;cas_n<=4'hf;end
                REF_RECOVER: if(hold_count) hold_count<=0;
                    else if(!init_done && initial_refresh_count!=7) begin
                        initial_refresh_count<=initial_refresh_count+1'b1;
                        phase<=REF_SETUP;cas_n<=0;
                    end else begin
                        init_done<=1;phase<=IDLE;
                    end
            endcase
        end
    end
endmodule
