module("luci.controller.netstat", package.seeall)

function index()
    entry({"admin", "tools"}, firstchild(), _("Tools"), 50).dependent = false
    entry({"admin", "tools", "netstat"}, cbi("netstat/config"), _("Netstat"), 20).leaf = true
    entry({"admin", "tools", "netstat_config"}, alias("admin", "tools", "netstat")).dependent = true
    entry({"admin", "tools", "vnstat"}, alias("admin", "tools", "netstat")).dependent = true
    entry({"admin", "tools", "get_netdev_stats"}, call("getNetdevStats"), nil).sysauth = false
end

function getNetdevStats()
    local f = io.open("/proc/net/dev", "r")
    if not f then
        luci.http.prepare_content("application/json")
        luci.http.write('{"stats":{}, "ip":"N/A", "status":"Disconnected"}')
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
                stats[iface] = {
                    rx = nums[1],
                    tx = nums[9]
                }
            end
        end
    end
    
    -- Quick connectivity check - just check if we have packets flowing
    local status = "Disconnected"
    for iface, data in pairs(stats) do
        if iface ~= "lo" and (data.rx > 0 or data.tx > 0) then
            status = "Connected"
            break
        end
    end
    
    -- Get public IP from api.ipify.org (real internet-facing address)
    local function read_cmd_line(cmd)
        local p = io.popen(cmd)
        if not p then
            return nil
        end

        local line = p:read("*l")
        p:close()

        if not line then
            return nil
        end

        line = line:gsub("^%s+", ""):gsub("%s+$", "")
        if line == "" then
            return nil
        end

        return line
    end

    local function is_valid_ip(value)
        if not value then
            return false
        end

        -- Simple IPv4 validation
        local a, b, c, d = value:match("^(%d+)%.(%d+)%.(%d+)%.(%d+)$")
        if a and b and c and d then
            a, b, c, d = tonumber(a), tonumber(b), tonumber(c), tonumber(d)
            if a <= 255 and b <= 255 and c <= 255 and d <= 255 then
                return true
            end
        end

        -- Basic IPv6 check (contains ':' and only hex/colon chars)
        if value:find(":", 1, true) and value:match("^[%x:]+$") then
            return true
        end

        return false
    end

    local ip = "N/A"

    -- Try ipify first using whichever HTTP client is available on the router
    local ip_cmds = {
        "curl -fsS --max-time 4 'https://api.ipify.org' 2>/dev/null",
        "curl -fsS --max-time 4 'http://api.ipify.org' 2>/dev/null",
        "uclient-fetch -qO- --timeout=4 'https://api.ipify.org' 2>/dev/null",
        "uclient-fetch -qO- --timeout=4 'http://api.ipify.org' 2>/dev/null",
        "wget -qO- --timeout=4 'https://api.ipify.org' 2>/dev/null",
        "wget -qO- --timeout=4 'http://api.ipify.org' 2>/dev/null",

        -- Fallback to local WAN address if public IP lookup fails
        "ubus call network.interface.wan status 2>/dev/null | jsonfilter -e '@[\"ipv4-address\"][0].address'",
        "ifstatus wan 2>/dev/null | jsonfilter -e '@[\"ipv4-address\"][0].address'",
        "ubus call network.interface.wan status 2>/dev/null | jsonfilter -e '@[\"ipv6-address\"][0].address'",
        "ubus call network.interface.wan6 status 2>/dev/null | jsonfilter -e '@[\"ipv6-address\"][0].address'",
        "ifstatus wan6 2>/dev/null | jsonfilter -e '@[\"ipv6-address\"][0].address'"
    }

    for _, cmd in ipairs(ip_cmds) do
        local detected = read_cmd_line(cmd)
        if detected and is_valid_ip(detected) then
            ip = detected
            break
        end
    end
    
    local response = {
        stats = stats,
        ip = ip,
        status = status
    }
    
    luci.http.prepare_content("application/json")
    luci.http.write_json(response)
end
