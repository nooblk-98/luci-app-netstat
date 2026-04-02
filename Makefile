include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-netstat
PKG_VERSION:=1.0.8
PKG_RELEASE:=11

PKG_MAINTAINER:=NoobLK <liyanagelsofficial@g.com>
PKG_LICENSE:=GPL-3.0

LUCI_TITLE:=NET Stats
LUCI_DESCRIPTION:=This LuCI app provides net statistic functionality in a web interface.
LUCI_DEPENDS:=+vnstat

include $(TOPDIR)/feeds/luci/luci.mk

$(eval $(call BuildPackage,luci-app-netstat))
