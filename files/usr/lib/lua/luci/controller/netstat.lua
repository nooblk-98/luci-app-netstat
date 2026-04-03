module("luci.controller.netstat", package.seeall)

function index()
    entry({"admin", "tools"}, firstchild(), _("Tools"), 50).dependent = false
    entry({"admin", "tools", "netstat"}, cbi("netstat/config"), _("Netstat"), 20).leaf = true
    entry({"admin", "tools", "netstat_config"}, alias("admin", "tools", "netstat")).dependent = true
    entry({"admin", "tools", "get_netdev_stats"}, call("getNetdevStats"), nil).sysauth = false
end

-- Reads /proc/net/dev and returns per-interface rx/tx byte counters.
function getNetdevStats()
    local f = io.open("/proc/net/dev", "r")
    if not f then
        luci.http.prepare_content("application/json")
        luci.http.write('{"stats":{},"ip":"N/A","status":"Disconnected"}')
        return
    end
    local content = f:read("*a")
    f:close()

    local stats = {}
    for line in content:gmatch("[^\n]+") do
        local iface, values = line:match("^%s*([^:]+):%s+(.*)$")
        if iface and values then
            local nums = {}
            for num in values:gmatch("%d+") do
                table.insert(nums, tonumber(num))
            end
            if #nums >= 9 then
                stats[iface] = { rx = nums[1], tx = nums[9] }
            end
        end
    end

    -- Quick connectivity check
    local status = "Disconnected"
    for iface, data in pairs(stats) do
        if iface ~= "lo" and (data.rx > 0 or data.tx > 0) then
            status = "Connected"
            break
        end
    end

    -- ── IP detection ─────────────────────────────────────────────────────────
    -- Strategy: try a single fast HTTP call first (2 s timeout), then fall
    -- back to local ubus/ifstatus which is instant.  The old code tried 11
    -- commands with 4 s timeouts each – worst-case 44 s of blocking.

    local function read_cmd(cmd)
        local p = io.popen(cmd)
        if not p then return nil end
        local line = p:read("*l")
        p:close()
        if not line then return nil end
        line = line:gsub("^%s+",""):gsub("%s+$","")
        return line ~= "" and line or nil
    end

    local function is_valid_ip(v)
        if not v then return false end
        local a,b,c,d = v:match("^(%d+)%.(%d+)%.(%d+)%.(%d+)$")
        if a and b and c and d then
            a,b,c,d = tonumber(a),tonumber(b),tonumber(c),tonumber(d)
            if a<=255 and b<=255 and c<=255 and d<=255 then return true end
        end
        if v:find(":",1,true) and v:match("^[%x:]+$") then return true end
        return false
    end

    local ip = "N/A"

    -- 1. Try public-IP APIs with a 2-second timeout (not 4)
    local public_cmds = {
        "curl -fsS --max-time 2 'https://api.ipify.org' 2>/dev/null",
        "curl -fsS --max-time 2 'http://api.ipify.org' 2>/dev/null",
        "uclient-fetch -qO- --timeout=2 'https://api.ipify.org' 2>/dev/null",
        "wget -qO- --timeout=2 'https://api.ipify.org' 2>/dev/null",
    }
    for _, cmd in ipairs(public_cmds) do
        local v = read_cmd(cmd)
        if is_valid_ip(v) then ip = v; break end
    end

    -- 2. Fall back to local WAN address (instant, no network needed)
    if ip == "N/A" then
        local local_cmds = {
            -- wan IPv4
            "ubus call network.interface.wan status 2>/dev/null | jsonfilter -e '@[\"ipv4-address\"][0].address'",
            "ifstatus wan 2>/dev/null | jsonfilter -e '@[\"ipv4-address\"][0].address'",
            -- wan IPv6
            "ubus call network.interface.wan status 2>/dev/null | jsonfilter -e '@[\"ipv6-address\"][0].address'",
            "ubus call network.interface.wan6 status 2>/dev/null | jsonfilter -e '@[\"ipv6-address\"][0].address'",
        }
        for _, cmd in ipairs(local_cmds) do
            local v = read_cmd(cmd)
            if is_valid_ip(v) then ip = v; break end
        end
    end

    luci.http.prepare_content("application/json")
    luci.http.write_json({ stats = stats, ip = ip, status = status })
end
