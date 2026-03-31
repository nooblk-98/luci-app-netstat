local net = require "luci.model.network"
local sys = require "luci.sys"
local http = require "luci.http"

local m = Map("netstats", translate("Netstat"),
    translate("Configure traffic monitoring and view usage history from a single page.")
)

local active_tab = http.formvalue("tab") or "usage"

local tabs = m:section(SimpleSection)
tabs.template = "netstat/tabs"

if active_tab == "settings" then
    local s = m:section(TypedSection, "config", translate("Monitoring Settings"))
    s.anonymous = true
    s.addremove = false

    local backend = s:option(ListValue, "backend", translate("Traffic Backend"))
    backend.default = "normal"
    backend:value("normal", translate("Normal (Real-time)"))
    backend:value("vnstat", translate("vnStat (Historical, Delayed)"))

    local mode = s:option(ListValue, "mode", translate("View Mode"))
    mode.default = "daily"
    mode:value("daily", translate("Daily Usage"))
    mode:value("monthly", translate("Monthly Usage"))
    mode.description = translate("Used by the Network Usage tab.")

    local iface = s:option(ListValue, "prefer", translate("Interface"))
    iface.description = translate(
        "Track WAN traffic on this interface. Leave this empty to auto-detect." ..
        "<br><br><strong>Backend notes</strong>" ..
        "<br>- vnStat: stores daily and monthly history (updates may be delayed)." ..
        "<br>- Normal: real-time traffic only (no stored history)."
    )
    iface:value("", translate("Auto detect"))

    local netm = net.init()
    for _, dev in ipairs(netm:get_interfaces()) do
        local name = dev:shortname()
        if name and not name:match("^lo$") and not name:match("^br%-") then
            iface:value(name)
        end
    end

    local reset = s:option(Button, "_reset", translate("Reset Historical Data"))
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
elseif active_tab == "about" then
    local about = m:section(SimpleSection, translate("About"))
    about.template = "netstat/about"
else
    local usage = m:section(SimpleSection, translate("Network Usage"))
    usage.template = "netstat/usage"
end

return m
