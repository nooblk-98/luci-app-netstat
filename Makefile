include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-netstat
PKG_VERSION:=1.0.8
PKG_RELEASE:=10

PKG_MAINTAINER:=NoobLK <liyanagelsofficial@g.com>
PKG_LICENSE:=GPL-3.0

LUCI_TITLE:=NET Stats
LUCI_DESCRIPTION:=This LuCI app provides net statistic functionality in a web interface.
LUCI_DEPENDS:=+vnstat

include $(TOPDIR)/feeds/luci/luci.mk

define Package/luci-app-netstat/install
	$(INSTALL_DIR) $(1)/usr/lib/lua/luci/i18n
	$(INSTALL_DATA) ./po/zh_Hans/netstat.po $(1)/usr/lib/lua/luci/i18n/netstat.zh_Hans.po
endef

$(eval $(call BuildPackage,luci-app-netstat))
