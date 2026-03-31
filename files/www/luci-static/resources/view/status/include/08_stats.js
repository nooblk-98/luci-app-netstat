'use strict';
'require baseclass';
'require uci';

let prev = {};
let last_time = Date.now();

(function loadDynamicCSS() {
	let lastLoadedCss = null;

	function isDarkMode() {
		try {
			const bgColor = getComputedStyle(document.body).backgroundColor;
			console.log('[NetStat] Body bg color:', bgColor);
			
			if (!bgColor || bgColor === 'transparent') return false;
			const rgb = bgColor.match(/\d+/g);
			if (!rgb || rgb.length < 3) return false;
			const [r, g, b] = rgb.map(Number);
			const luminance = (r * 299 + g * 587 + b * 114) / 1000;
			const isDark = luminance < 100;
			console.log('[NetStat] RGB:', r, g, b, 'Luminance:', luminance, 'isDark:', isDark);
			return isDark;
		} catch (e) {
			console.error('[NetStat] Error detecting dark mode:', e);
			return false;
		}
	}

	function loadCSS() {
		const dark = isDarkMode();
		const cssFile = dark ? 'netstat_dark.css' : 'netstat.css';
		
		console.log('[NetStat] loadCSS - current dark:', dark, 'last loaded:', lastLoadedCss);
		
		// Skip only if we just loaded this exact CSS
		if (lastLoadedCss === cssFile) {
			console.log('[NetStat] CSS already loaded, skipping');
			return;
		}
		
		console.log('[NetStat] Loading CSS:', cssFile);
		lastLoadedCss = cssFile;

		// Remove old CSS
		document.querySelectorAll('link[href*="netstat.css"]').forEach(link => {
			console.log('[NetStat] Removing old CSS:', link.href);
			if (link.parentNode) link.parentNode.removeChild(link);
		});

		// Load new CSS
		const link = document.createElement('link');
		link.rel = 'stylesheet';
		link.href = '/luci-static/resources/netstat/' + cssFile + '?t=' + Date.now();
		
		link.onload = function() {
			console.log('[NetStat] ✓ CSS loaded:', link.href);
		};
		link.onerror = function() {
			console.error('[NetStat] ✗ CSS failed to load:', link.href);
		};
		
		console.log('[NetStat] Adding link to head:', link.href);
		document.head.appendChild(link);
	}

	// Initial load with short delay
	setTimeout(() => {
		console.log('[NetStat] Initial load');
		loadCSS();
	}, 100);

	// Poll every 500ms
	setInterval(() => {
		loadCSS();
	}, 500);
	
	console.log('[NetStat] CSS loader initialized');
})();

function parseNetdev(raw) {
	const stats = {};
	const lines = raw.split('\n');
	
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim();
		if (!line || line.startsWith('face') || line.startsWith('|')) continue;
		
		const match = line.match(/^([^:]+):\s+(.*)$/);
		if (!match) continue;
		
		const iface = match[1].trim();
		const values = match[2].trim().split(/\s+/).map(v => parseInt(v) || 0);
		
		if (values.length >= 9) {
			stats[iface] = {
				rx: values[0],
				tx: values[8]
			};
		}
	}
	
	return stats;
}

function getBestWAN(stats, preferred) {
	for (const iface of preferred) {
		if (stats[iface]) return iface;
	}

	const dynamic = Object.keys(stats).find(i =>
		/^(wwan|usb|ppp|lte|qmi|modem)/.test(i) && i.includes('_')
	);
	if (dynamic) return dynamic;

	const fallback = ['pppoe-wan', 'lte0', 'usb0', 'wan', 'eth1', 'tun0', 'wg0'];
	for (const iface of fallback) {
		if (stats[iface]) return iface;
	}

	const nonLo = Object.keys(stats).filter(k => k !== 'lo');
	return nonLo[0] || 'wwan0_1';
}

function formatRate(bits) {
	const units = ['Bps', 'Kbps', 'Mbps', 'Gbps'];
	let i = 0;
	while (bits >= 1000 && i < units.length - 1) {
		bits /= 1000;
		i++;
	}
	return { number: bits.toFixed(i > 0 ? 1 : 0), unit: units[i] + '/s' };
}

function formatBytes(value) {
	if (value >= 1099511627776) return (value / 1099511627776).toFixed(2) + ' TB';
	if (value >= 1073741824) return (value / 1073741824).toFixed(2) + ' GB';
	if (value >= 1048576) return (value / 1048576).toFixed(2) + ' MB';
	if (value >= 1024) return (value / 1024).toFixed(2) + ' KB';
	return value + ' B';
}

function createStatBox(label, value, unit, extraClass) {
	const cls = extraClass ? 'netstat-box ' + extraClass : 'netstat-box';
	return E('div', { class: cls }, [
		E('div', { class: 'netstat-number' }, value),
		E('div', { class: 'netstat-unit' }, unit || ''),
		E('div', { class: 'netstat-label' }, label)
	]);
}

function createStatusCard(status, ip) {
	const isConnected = status === 'Connected';
	const statusText = isConnected ? _('Connected') : _('Disconnected');
	return E('div', { class: 'netstat-box netstat-center ' + (isConnected ? 'is-up' : 'is-down') }, [
		E('div', { class: 'netstat-center-title' }, _('Internet')),
		E('div', { class: 'netstat-center-status' }, statusText),
		E('div', { class: 'netstat-center-sep' }, ''),
		E('div', { class: 'netstat-center-title' }, _('IP')),
		E('div', { class: 'netstat-center-ip' }, ip)
	]);
}

return baseclass.extend({
	title: _(''),

	load: function () {
		// Direct call to getNetdevStats function via HTTP
		return L.resolveDefault(
			fetch('/cgi-bin/luci/admin/tools/get_netdev_stats')
				.then(res => res.json())
				.catch(() => ({ stats: {}, ip: 'N/A', status: 'Disconnected' })),
			{ stats: {}, ip: 'N/A', status: 'Disconnected' }
		).then(result => {
			const stats = (result && result.stats) || result || {};
			const ip = (result && result.ip) || 'N/A';
			const status = (result && result.status) || 'Disconnected';
			return {
				stats: stats,
				ip: ip,
				status: status,
				preferred: []
			};
		}).catch(() => {
			return {
				stats: {},
				ip: 'N/A',
				status: 'Disconnected',
				preferred: []
			};
		});
	},

	render: function (data) {
		const now = Date.now();
		const dt = Math.max(0.1, (now - last_time) / 1000);
		last_time = now;

		const stats = data.stats;
		if (!stats || typeof stats !== 'object' || Array.isArray(stats)) {
			return E('div', { style: 'padding: 20px; text-align: center; color: #999; font-size: 13px;' }, 
				_('Loading network stats...')
			);
		}

		const preferred = data.preferred || [];
		const iface = getBestWAN(stats, preferred);
		const curr = stats[iface] || { rx: 0, tx: 0 };
		
		// Ensure values are numbers
		curr.rx = parseInt(curr.rx) || 0;
		curr.tx = parseInt(curr.tx) || 0;
		
		const prevStat = prev[iface] || { rx: curr.rx, tx: curr.tx };

		let rxSpeed = Math.max(0, (curr.rx - prevStat.rx) / dt);
		let txSpeed = Math.max(0, (curr.tx - prevStat.tx) / dt);

		prev[iface] = { rx: curr.rx, tx: curr.tx };

		const rxRate = formatRate(rxSpeed * 8);
		const txRate = formatRate(txSpeed * 8);

		const totalRx = formatBytes(curr.rx);
		const totalTx = formatBytes(curr.tx);

		const container = E('div', { class: 'stats-grid netstat-wrap' });
		const row = E('div', { class: 'netstat-row' });

		row.appendChild(createStatBox(_('download'), rxRate.number, rxRate.unit, 'is-download'));
		row.appendChild(createStatBox(_('upload'), txRate.number, txRate.unit, 'is-upload'));
		const status = data.status || 'Disconnected';
		const ip = data.ip || 'N/A';
		row.appendChild(createStatusCard(status, ip));
		row.appendChild(createStatBox(_('downloaded'), totalRx.split(' ')[0], totalRx.split(' ')[1] || '', 'is-total'));
		row.appendChild(createStatBox(_('uploaded'), totalTx.split(' ')[0], totalTx.split(' ')[1] || '', 'is-total'));

		container.appendChild(row);

		// Set up polling for real-time updates
		L.Poll.add(() => {
			return L.resolveDefault(
				fetch('/cgi-bin/luci/admin/tools/get_netdev_stats')
					.then(res => res.json())
					.catch(() => ({ stats: {}, ip: 'N/A', status: 'Disconnected' })),
				{ stats: {}, ip: 'N/A', status: 'Disconnected' }
			).then(result => {
				const newStats = (result && result.stats) || {};
				const newIP = (result && result.ip) || 'N/A';
				const newStatus = (result && result.status) || 'Disconnected';
				return this.render({ stats: newStats, ip: newIP, status: newStatus, preferred: preferred });
			}).catch((e) => {
				console.error('Fetch error:', e);
				return container;
			});
		}, 1000);

		return container;
	}
});
