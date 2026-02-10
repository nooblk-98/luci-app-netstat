local net = require "luci.model.network"
local sys = require "luci.sys"

local m = Map("netstats", translate("Netstat"),
    translate("Select your preferred primary WAN interface.")
)

local s = m:section(TypedSection, "config", translate("Settings"))
s.anonymous = true

local backend = s:option(ListValue, "backend", translate("Traffic Backend"))
backend.default = "normal"
backend:value("normal", translate("Normal (Real-time)"))
backend:value("vnstat", translate("vnStat (Historical, Delayed)"))

local mode = s:option(ListValue, "mode", translate("Display Mode"))
mode.default = "daily"
mode:depends("backend", "vnstat")
mode:value("daily", translate("Daily Usage"))
mode:value("monthly", translate("Monthly Usage"))

local iface = s:option(ListValue, "prefer", translate("WAN Interface"))
iface.description = translate(
    "Select the interface for tracking WAN traffic. Leave blank to auto-detect." ..
    "<br><br><b>Backend Mode Explanation:</b><br>" ..
    "<ul>" ..
    "<li><b>vnStat</b>: Uses the vnStat database. It provides daily/monthly usage, but traffic updates are delayed depending on vnStat interval.</li>" ..
    "<li><b>Normal</b>: Reads directly from system interfaces in real time (no delay), but does not keep history.</li>" ..
    "</ul>"
)
iface:value("", translate("Auto detect"))

local netm = net.init()
for _, dev in ipairs(netm:get_interfaces()) do
    local name = dev:shortname()
    if name and not name:match("^lo$") and not name:match("^br%-") then
        iface:value(name)
    end
end

local reset = s:option(Button, "_reset", translate("Reset vnStat Stats"))
reset.inputtitle = translate("Reset Database")
reset.inputstyle = "reset"

function reset.write(self, section)
    local dbdir = "/etc/vnstat"

    sys.call("/etc/init.d/vnstat stop")
    sys.call("rm -f " .. dbdir .. "/* >/dev/null 2>&1")

    local netm = net.init()
    for _, dev in ipairs(netm:get_interfaces()) do
        local name = dev:shortname()
        if name and not name:match("^lo$") and not name:match("^br%-") then
            sys.call("vnstat -u -i " .. name .. " >/dev/null 2>&1")
        end
    end

    sys.call("/etc/init.d/vnstat start")

    m.message = translate("vnStat database has been reset successfully for all interfaces.")
end

return m
