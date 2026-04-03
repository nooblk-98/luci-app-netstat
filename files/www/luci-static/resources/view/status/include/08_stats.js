'use strict';
'require baseclass';
'require uci';

// ─── State ────────────────────────────────────────────────────────────────────
let prev        = {};
let last_time   = Date.now();
let _pollAdded  = false;   // guard: only register one poll handler
let _container  = null;    // reference to the live DOM node

// ─── CSS Loader (theme-aware, no busy-poll) ───────────────────────────────────
(function loadDynamicCSS() {
	let loadedCss = null;

	function isDarkMode() {
		try {
			const bg  = getComputedStyle(document.body).backgroundColor;
			if (!bg || bg === 'transparent') return false;
			const rgb = bg.match(/\d+/g);
			if (!rgb || rgb.length < 3) return false;
			const [r, g, b] = rgb.map(Number);
			return (r * 299 + g * 587 + b * 114) / 1000 < 100;
		} catch (_) { return false; }
	}

	function applyCSS() {
		const file = isDarkMode() ? 'netstat_dark.css' : 'netstat.css';
		if (loadedCss === file) return;
		loadedCss = file;

		document.querySelectorAll('link[data-netstat-css]').forEach(l => l.remove());

		const link       = document.createElement('link');
		link.rel         = 'stylesheet';
		link.dataset.netstatssCss = '1';
		link.setAttribute('data-netstat-css', '1');
		link.href        = '/luci-static/resources/netstat/' + file + '?t=' + Date.now();
		document.head.appendChild(link);
	}

	// Initial load after paint
	requestAnimationFrame(() => setTimeout(applyCSS, 50));

	// Watch for system theme changes via matchMedia (zero polling cost)
	if (window.matchMedia) {
		window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyCSS);
	}

	// Fallback: MutationObserver on body background instead of setInterval
	const mo = new MutationObserver(applyCSS);
	const waitForBody = setInterval(() => {
		if (!document.body) return;
		clearInterval(waitForBody);
		mo.observe(document.body, { attributes: true, attributeFilter: ['style', 'class'] });
		applyCSS();
	}, 50);
})();

// ─── Helpers ──────────────────────────────────────────────────────────────────
function parseNetdev(raw) {
	const stats = {};
	for (const line of raw.split('\n')) {
		const m = line.trim().match(/^([^:]+):\s+(.*)$/);
		if (!m) continue;
		const vals = m[2].trim().split(/\s+/).map(v => parseInt(v) || 0);
		if (vals.length >= 9)
			stats[m[1].trim()] = { rx: vals[0], tx: vals[8] };
	}
	return stats;
}

function getBestWAN(stats, preferred) {
	for (const i of preferred) if (stats[i]) return i;

	const dynamic = Object.keys(stats).find(i =>
		/^(wwan|usb|ppp|lte|qmi|modem)/.test(i) && i.includes('_'));
	if (dynamic) return dynamic;

	for (const i of ['pppoe-wan','lte0','usb0','wan','eth1','tun0','wg0'])
		if (stats[i]) return i;

	return Object.keys(stats).find(k => k !== 'lo') || '';
}

function formatRate(bps) {
	const units = ['Bps','Kbps','Mbps','Gbps'];
	let i = 0;
	while (bps >= 1000 && i < units.length - 1) { bps /= 1000; i++; }
	return { number: bps.toFixed(i > 0 ? 1 : 0), unit: units[i] + '/s' };
}

function formatBytes(v) {
	if (v >= 1099511627776) return (v / 1099511627776).toFixed(2) + ' TB';
	if (v >= 1073741824)   return (v / 1073741824).toFixed(2) + ' GB';
	if (v >= 1048576)      return (v / 1048576).toFixed(2) + ' MB';
	if (v >= 1024)         return (v / 1024).toFixed(2) + ' KB';
	return v + ' B';
}

// ─── Fetch with timeout ───────────────────────────────────────────────────────
function fetchWithTimeout(url, ms) {
	const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
	const tid   = ctrl ? setTimeout(() => ctrl.abort(), ms) : null;
	return fetch(url, ctrl ? { signal: ctrl.signal } : {})
		.then(r => r.json())
		.finally(() => tid && clearTimeout(tid));
}

// ─── DOM builders ─────────────────────────────────────────────────────────────
function createStatBox(label, value, unit, extraClass) {
	const cls = 'netstat-box' + (extraClass ? ' ' + extraClass : '');
	return E('div', { class: cls }, [
		E('div', { class: 'netstat-number' }, value),
		unit ? E('div', { class: 'netstat-unit' }, unit) : null,
		E('div', { class: 'netstat-label' }, label)
	].filter(Boolean));
}

function createStatusCard(status, ip) {
	const up = status === 'Connected';
	return E('div', { class: 'netstat-box netstat-center ' + (up ? 'is-up' : 'is-down') }, [
		E('div', { class: 'netstat-center-title' }, _('Internet')),
		E('div', { class: 'netstat-center-status' }, up ? _('Connected') : _('Disconnected')),
		E('div', { class: 'netstat-center-sep' }),
		E('div', { class: 'netstat-center-title' }, _('IP')),
		E('div', { class: 'netstat-center-ip' }, ip || 'N/A')
	]);
}

// Update existing DOM nodes in-place to avoid reflowing the whole widget
function patchText(el, sel, val) {
	const n = el && el.querySelector(sel);
	if (n && n.textContent !== val) n.textContent = val;
}

function updateContainer(container, data, dt) {
	const stats    = data.stats || {};
	const preferred = data.preferred || [];
	const iface    = getBestWAN(stats, preferred);
	const curr     = stats[iface] || { rx: 0, tx: 0 };
	curr.rx = parseInt(curr.rx) || 0;
	curr.tx = parseInt(curr.tx) || 0;

	const ps       = prev[iface] || { rx: curr.rx, tx: curr.tx };
	const rxSpeed  = Math.max(0, (curr.rx - ps.rx) / dt);
	const txSpeed  = Math.max(0, (curr.tx - ps.tx) / dt);
	prev[iface]    = { rx: curr.rx, tx: curr.tx };

	const rxRate   = formatRate(rxSpeed * 8);
	const txRate   = formatRate(txSpeed * 8);
	const totalRx  = formatBytes(curr.rx).split(' ');
	const totalTx  = formatBytes(curr.tx).split(' ');

	// In-place DOM patches (no full re-render)
	const boxes = container.querySelectorAll('.netstat-box');
	if (boxes.length < 5) return false; // stale node, rebuild

	// box 0 – download rate
	patchText(container, '.is-download .netstat-number', rxRate.number);
	patchText(container, '.is-download .netstat-unit',   rxRate.unit);
	// box 1 – upload rate
	patchText(container, '.is-upload .netstat-number',   txRate.number);
	patchText(container, '.is-upload .netstat-unit',     txRate.unit);
	// center – status / IP
	const center = container.querySelector('.netstat-center');
	if (center) {
		const up = (data.status || '') === 'Connected';
		center.className = 'netstat-box netstat-center ' + (up ? 'is-up' : 'is-down');
		patchText(center, '.netstat-center-status', up ? _('Connected') : _('Disconnected'));
		patchText(center, '.netstat-center-ip',     data.ip || 'N/A');
	}
	// box 3 – downloaded total
	const totals = container.querySelectorAll('.is-total');
	if (totals[0]) {
		patchText(totals[0], '.netstat-number', totalRx[0]);
		patchText(totals[0], '.netstat-unit',   totalRx[1] || '');
	}
	if (totals[1]) {
		patchText(totals[1], '.netstat-number', totalTx[0]);
		patchText(totals[1], '.netstat-unit',   totalTx[1] || '');
	}
	return true;
}

// ─── Main baseclass ───────────────────────────────────────────────────────────
return baseclass.extend({
	title: _(''),

	load() {
		return fetchWithTimeout('/cgi-bin/luci/admin/tools/get_netdev_stats', 5000)
			.then(r => ({
				stats:     (r && r.stats)  || {},
				ip:        (r && r.ip)     || 'N/A',
				status:    (r && r.status) || 'Disconnected',
				preferred: []
			}))
			.catch(() => ({ stats: {}, ip: 'N/A', status: 'Disconnected', preferred: [] }));
	},

	render(data) {
		const now  = Date.now();
		const dt   = Math.max(0.1, (now - last_time) / 1000);
		last_time  = now;

		const stats     = data.stats || {};
		const preferred = data.preferred || [];

		if (!stats || typeof stats !== 'object' || Array.isArray(stats))
			return E('div', { style: 'padding:20px;text-align:center;color:#999;font-size:13px' },
				_('Loading network stats...'));

		const iface    = getBestWAN(stats, preferred);
		const curr     = stats[iface] || { rx: 0, tx: 0 };
		curr.rx = parseInt(curr.rx) || 0;
		curr.tx = parseInt(curr.tx) || 0;

		const ps       = prev[iface] || { rx: curr.rx, tx: curr.tx };
		const rxSpeed  = Math.max(0, (curr.rx - ps.rx) / dt);
		const txSpeed  = Math.max(0, (curr.tx - ps.tx) / dt);
		prev[iface]    = { rx: curr.rx, tx: curr.tx };

		const rxRate   = formatRate(rxSpeed * 8);
		const txRate   = formatRate(txSpeed * 8);
		const totalRx  = formatBytes(curr.rx).split(' ');
		const totalTx  = formatBytes(curr.tx).split(' ');

		const row = E('div', { class: 'netstat-row' }, [
			createStatBox(_('download'),   rxRate.number, rxRate.unit,   'is-download'),
			createStatBox(_('upload'),     txRate.number, txRate.unit,   'is-upload'),
			createStatusCard(data.status || 'Disconnected', data.ip),
			createStatBox(_('downloaded'), totalRx[0],    totalRx[1],   'is-total'),
			createStatBox(_('uploaded'),   totalTx[0],    totalTx[1],   'is-total'),
		]);

		const container = E('div', { class: 'stats-grid netstat-wrap' }, row);
		_container = container;

		// ── Single poll handler (registered only once) ────────────────────────
		if (!_pollAdded) {
			_pollAdded = true;
			L.Poll.add(() =>
				fetchWithTimeout('/cgi-bin/luci/admin/tools/get_netdev_stats', 5000)
					.then(r => {
						const now2 = Date.now();
						const dt2  = Math.max(0.1, (now2 - last_time) / 1000);
						last_time  = now2;

						// Try cheap in-place update first
						if (_container && _container.isConnected) {
							const ok = updateContainer(_container, {
								stats:     (r && r.stats)  || {},
								ip:        (r && r.ip)     || 'N/A',
								status:    (r && r.status) || 'Disconnected',
								preferred: []
							}, dt2);
							if (ok) return;
						}
					})
					.catch(() => {})
			, 2);  // poll every 2 s (was 1 s – halves request rate)
		}

		return container;
	}
});
