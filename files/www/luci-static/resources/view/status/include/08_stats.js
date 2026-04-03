'use strict';
'require baseclass';
'require uci';

// ─── State ────────────────────────────────────────────────────────────────────
let prev        = {};
let last_time   = Date.now();
let _pollAdded  = false;
let _container  = null;

// Peak speeds per direction (bits/s)
let peakRx = 0;
let peakTx = 0;

// Previous speeds for trending arrows
let lastRxSpeed = 0;
let lastTxSpeed = 0;

// Sparkline history – last 30 samples (~60 s at 2 s poll)
const SPARK_LEN = 30;
let sparkRx = new Array(SPARK_LEN).fill(0);
let sparkTx = new Array(SPARK_LEN).fill(0);

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

	requestAnimationFrame(() => setTimeout(applyCSS, 50));

	if (window.matchMedia) {
		window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyCSS);
	}

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

function formatUptime(sec) {
	const d = Math.floor(sec / 86400);
	const h = Math.floor((sec % 86400) / 3600);
	const m = Math.floor((sec % 3600) / 60);
	if (d > 0) return d + 'd ' + h + 'h';
	if (h > 0) return h + 'h ' + m + 'm';
	return m + 'm ' + (sec % 60) + 's';
}

// trend arrow: +1 = rising, -1 = falling, 0 = stable
function trendArrow(current, previous) {
	const ratio = previous > 0 ? current / previous : 1;
	if (ratio > 1.10) return { char: '▲', cls: 'ns-trend-up' };
	if (ratio < 0.90) return { char: '▼', cls: 'ns-trend-down' };
	return { char: '●', cls: 'ns-trend-flat' };
}

// ─── Sparkline SVG ────────────────────────────────────────────────────────────
function drawSparkline(values, colorVar) {
	const W = 90, H = 28;
	const max = Math.max(...values, 1);
	const step = W / (values.length - 1);

	const points = values.map((v, i) => {
		const x = i * step;
		const y = H - (v / max) * (H - 2) - 1;
		return x.toFixed(1) + ',' + y.toFixed(1);
	}).join(' ');

	// filled area path
	const areaPoints =
		'0,' + H + ' ' + points + ' ' + (W) + ',' + H;

	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('width', W);
	svg.setAttribute('height', H);
	svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
	svg.style.display = 'block';
	svg.style.overflow = 'visible';

	const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
	const grad = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
	grad.setAttribute('id', 'sg-' + colorVar.replace(/[^a-z]/gi,''));
	grad.setAttribute('x1', '0'); grad.setAttribute('y1', '0');
	grad.setAttribute('x2', '0'); grad.setAttribute('y2', '1');

	const s1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
	s1.setAttribute('offset', '0%');
	s1.setAttribute('stop-color', 'var(' + colorVar + ')');
	s1.setAttribute('stop-opacity', '0.35');
	const s2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
	s2.setAttribute('offset', '100%');
	s2.setAttribute('stop-color', 'var(' + colorVar + ')');
	s2.setAttribute('stop-opacity', '0.03');

	grad.appendChild(s1); grad.appendChild(s2);
	defs.appendChild(grad); svg.appendChild(defs);

	const area = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
	area.setAttribute('points', areaPoints);
	area.setAttribute('fill', 'url(#sg-' + colorVar.replace(/[^a-z]/gi,'') + ')');
	svg.appendChild(area);

	const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
	line.setAttribute('points', points);
	line.setAttribute('fill', 'none');
	line.setAttribute('stroke', 'var(' + colorVar + ')');
	line.setAttribute('stroke-width', '1.5');
	line.setAttribute('stroke-linejoin', 'round');
	line.setAttribute('stroke-linecap', 'round');
	svg.appendChild(line);

	return svg;
}

// Replace sparkline SVG inside a container (identified by class)
function updateSparkline(container, cls, values, colorVar) {
	const box = container.querySelector('.' + cls);
	if (!box) return;
	const wrap = box.querySelector('.ns-spark');
	if (!wrap) return;
	wrap.innerHTML = '';
	wrap.appendChild(drawSparkline(values, colorVar));
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
function createRateBox(label, value, unit, extraClass, colorVar, sparkValues, peak) {
	const cls = 'netstat-box ' + extraClass;
	const peakFmt = formatRate(peak * 8);

	const box = E('div', { class: cls }, [
		E('div', { class: 'ns-spark' }),   // sparkline goes here
		E('div', { class: 'ns-rate-row' }, [
			E('div', { class: 'netstat-number' }, value),
			E('div', { class: 'netstat-unit' }, unit)
		]),
		E('div', { class: 'ns-peak' }, _('Peak') + ': ' + peakFmt.number + ' ' + peakFmt.unit),
		E('div', { class: 'netstat-label' }, label)
	]);

	// draw initial sparkline
	const wrap = box.querySelector('.ns-spark');
	wrap.appendChild(drawSparkline(sparkValues, colorVar));

	return box;
}

function createStatBox(label, value, unit, extraClass) {
	const cls = 'netstat-box' + (extraClass ? ' ' + extraClass : '');
	return E('div', { class: cls }, [
		E('div', { class: 'netstat-number' }, value),
		unit ? E('div', { class: 'netstat-unit' }, unit) : null,
		E('div', { class: 'netstat-label' }, label)
	].filter(Boolean));
}

function createStatusCard(status, ip, uptime) {
	const up = status === 'Connected';
	return E('div', { class: 'netstat-box netstat-center ' + (up ? 'is-up' : 'is-down') }, [
		E('div', { class: 'netstat-center-title' }, _('Internet')),
		E('div', { class: 'netstat-center-status' }, up ? _('Connected') : _('Disconnected')),
		E('div', { class: 'netstat-center-sep' }),
		E('div', { class: 'netstat-center-title' }, _('IP')),
		E('div', { class: 'netstat-center-ip' }, ip || 'N/A'),
		E('div', { class: 'netstat-center-sep' }),
		E('div', { class: 'ns-uptime-row' }, [
			iconUptime(),
			E('span', { class: 'ns-uptime-text', id: 'ns-uptime-val' }, uptime)
		])
	]);
}

// ─── Inline SVG icons ─────────────────────────────────────────────────────────
function svgIcon(path, color) {
	const ns = 'http://www.w3.org/2000/svg';
	const svg = document.createElementNS(ns, 'svg');
	svg.setAttribute('viewBox', '0 0 24 24');
	svg.setAttribute('width', '16');
	svg.setAttribute('height', '16');
	svg.setAttribute('fill', 'none');
	svg.setAttribute('stroke', color || 'currentColor');
	svg.setAttribute('stroke-width', '2');
	svg.setAttribute('stroke-linecap', 'round');
	svg.setAttribute('stroke-linejoin', 'round');
	svg.style.flexShrink = '0';
	svg.innerHTML = path;
	return svg;
}

// clock icon
function iconUptime() {
	return svgIcon('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>', 'var(--ns-muted)');
}
// cpu/chip icon
function iconCPU() {
	return svgIcon('<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/>', 'var(--ns-cpu-color)');
}
// database/memory icon
function iconMem() {
	return svgIcon('<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3"/>', 'var(--ns-mem-color)');
}

function makeBar(pct, id) {
	const fill = E('div', { class: 'ns-bar-fill', id: id });
	fill.style.width = Math.min(100, Math.max(0, pct)) + '%';
	return E('div', { class: 'ns-bar-wrap' }, [fill]);
}

function createInfoCard(cpuPct, memPct, memUsed, memTotal) {
	const card = E('div', { class: 'netstat-box netstat-info-card' });

	// CPU row
	const cpuRow = E('div', { class: 'ns-info-row' });
	cpuRow.appendChild(iconCPU());
	const cpuBlock = E('div', { class: 'ns-info-block ns-info-block-grow' });
	const cpuTopRow = E('div', { class: 'ns-info-top-row' });
	cpuTopRow.appendChild(E('div', { class: 'ns-info-value', id: 'ns-cpu-val' }, cpuPct + '%'));
	cpuTopRow.appendChild(E('div', { class: 'ns-info-label' }, _('CPU')));
	cpuBlock.appendChild(cpuTopRow);
	cpuBlock.appendChild(makeBar(cpuPct, 'ns-cpu-bar'));
	cpuRow.appendChild(cpuBlock);
	card.appendChild(cpuRow);

	card.appendChild(E('div', { class: 'netstat-center-sep' }));

	// Memory row
	const memRow = E('div', { class: 'ns-info-row' });
	memRow.appendChild(iconMem());
	const memBlock = E('div', { class: 'ns-info-block ns-info-block-grow' });
	const memTopRow = E('div', { class: 'ns-info-top-row' });
	memTopRow.appendChild(E('div', { class: 'ns-info-value', id: 'ns-mem-val' }, memPct + '%'));
	memTopRow.appendChild(E('div', { class: 'ns-info-sublabel', id: 'ns-mem-sub' },
		memUsed + '/' + memTotal + ' MB'));
	memBlock.appendChild(memTopRow);
	memBlock.appendChild(makeBar(memPct, 'ns-mem-bar'));
	memRow.appendChild(memBlock);
	card.appendChild(memRow);

	return card;
}

// ─── In-place DOM patch ───────────────────────────────────────────────────────
function patchText(el, sel, val) {
	const n = el && el.querySelector(sel);
	if (n && n.textContent !== val) n.textContent = val;
}

function updateContainer(container, data, dt) {
	const stats     = data.stats || {};
	const preferred = data.preferred || [];
	const iface     = getBestWAN(stats, preferred);
	const curr      = stats[iface] || { rx: 0, tx: 0 };
	curr.rx = parseInt(curr.rx) || 0;
	curr.tx = parseInt(curr.tx) || 0;

	const ps       = prev[iface] || { rx: curr.rx, tx: curr.tx };
	const rxSpeed  = Math.max(0, (curr.rx - ps.rx) / dt);
	const txSpeed  = Math.max(0, (curr.tx - ps.tx) / dt);
	prev[iface]    = { rx: curr.rx, tx: curr.tx };

	// peaks
	if (rxSpeed > peakRx) peakRx = rxSpeed;
	if (txSpeed > peakTx) peakTx = txSpeed;

	// sparkline ring buffers
	sparkRx.push(rxSpeed); if (sparkRx.length > SPARK_LEN) sparkRx.shift();
	sparkTx.push(txSpeed); if (sparkTx.length > SPARK_LEN) sparkTx.shift();

	// trend
	const tRx = trendArrow(rxSpeed, lastRxSpeed);
	const tTx = trendArrow(txSpeed, lastTxSpeed);
	lastRxSpeed = rxSpeed;
	lastTxSpeed = txSpeed;

	const rxRate  = formatRate(rxSpeed * 8);
	const txRate  = formatRate(txSpeed * 8);
	const totalRx = formatBytes(curr.rx).split(' ');
	const totalTx = formatBytes(curr.tx).split(' ');
	const peakRxFmt = formatRate(peakRx * 8);
	const peakTxFmt = formatRate(peakTx * 8);

	const boxes = container.querySelectorAll('.netstat-box');
	if (boxes.length < 6) return false; // stale, rebuild

	// download rate box
	patchText(container, '.is-download .netstat-number', rxRate.number);
	patchText(container, '.is-download .netstat-unit',   rxRate.unit);
	patchText(container, '.is-download .ns-peak',
		_('Peak') + ': ' + peakRxFmt.number + ' ' + peakRxFmt.unit);

	// trend on download
	const dlTrend = container.querySelector('.is-download .ns-trend');
	if (dlTrend) { dlTrend.textContent = tRx.char; dlTrend.className = 'ns-trend ' + tRx.cls; }

	// upload rate box
	patchText(container, '.is-upload .netstat-number', txRate.number);
	patchText(container, '.is-upload .netstat-unit',   txRate.unit);
	patchText(container, '.is-upload .ns-peak',
		_('Peak') + ': ' + peakTxFmt.number + ' ' + peakTxFmt.unit);

	// trend on upload
	const ulTrend = container.querySelector('.is-upload .ns-trend');
	if (ulTrend) { ulTrend.textContent = tTx.char; ulTrend.className = 'ns-trend ' + tTx.cls; }

	// sparklines
	updateSparkline(container, 'is-download', sparkRx, '--ns-dl-color');
	updateSparkline(container, 'is-upload',   sparkTx, '--ns-ul-color');

	// center status card
	const center = container.querySelector('.netstat-center');
	if (center) {
		const up = (data.status || '') === 'Connected';
		center.className = 'netstat-box netstat-center ' + (up ? 'is-up' : 'is-down');
		patchText(center, '.netstat-center-status', up ? _('Connected') : _('Disconnected'));
		patchText(center, '.netstat-center-ip',     data.ip || 'N/A');
	}

	// totals
	const totals = container.querySelectorAll('.is-total');
	if (totals[0]) {
		patchText(totals[0], '.netstat-number', totalRx[0]);
		patchText(totals[0], '.netstat-unit',   totalRx[1] || '');
	}
	if (totals[1]) {
		patchText(totals[1], '.netstat-number', totalTx[0]);
		patchText(totals[1], '.netstat-unit',   totalTx[1] || '');
	}

	// uptime in status card, cpu+mem in info card
	patchText(container, '#ns-uptime-val', formatUptime(data.uptime || 0));
	patchText(container, '#ns-cpu-val',    (data.cpu_pct || 0) + '%');
	patchText(container, '#ns-mem-val',    (data.mem_pct || 0) + '%');
	patchText(container, '#ns-mem-sub',    (data.mem_used || 0) + '/' + (data.mem_total || 0) + ' MB');

	// update bar widths via stable ids
	const cpuFill = container.querySelector('#ns-cpu-bar');
	if (cpuFill) cpuFill.style.width = Math.min(100, Math.max(0, data.cpu_pct || 0)) + '%';

	const memFill = container.querySelector('#ns-mem-bar');
	if (memFill) memFill.style.width = Math.min(100, Math.max(0, data.mem_pct || 0)) + '%';

	return true;
}

// ─── Main baseclass ───────────────────────────────────────────────────────────
return baseclass.extend({
	title: _(''),

	load() {
		return fetchWithTimeout('/cgi-bin/luci/admin/tools/get_netdev_stats', 5000)
			.then(r => ({
				stats:     (r && r.stats)      || {},
				ip:        (r && r.ip)         || 'N/A',
				status:    (r && r.status)     || 'Disconnected',
				uptime:    (r && r.uptime)     || 0,
				cpu_pct:   (r && r.cpu_pct)    || 0,
				mem_pct:   (r && r.mem_pct)    || 0,
				mem_used:  (r && r.mem_used)   || 0,
				mem_total: (r && r.mem_total)  || 0,
				preferred: []
			}))
			.catch(() => ({ stats: {}, ip: 'N/A', status: 'Disconnected',
			                uptime: 0, cpu_pct: 0, mem_pct: 0, mem_used: 0, mem_total: 0, preferred: [] }));
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

		if (rxSpeed > peakRx) peakRx = rxSpeed;
		if (txSpeed > peakTx) peakTx = txSpeed;

		sparkRx.push(rxSpeed); if (sparkRx.length > SPARK_LEN) sparkRx.shift();
		sparkTx.push(txSpeed); if (sparkTx.length > SPARK_LEN) sparkTx.shift();

		const tRx = trendArrow(rxSpeed, lastRxSpeed);
		const tTx = trendArrow(txSpeed, lastTxSpeed);
		lastRxSpeed = rxSpeed;
		lastTxSpeed = txSpeed;

		const rxRate  = formatRate(rxSpeed * 8);
		const txRate  = formatRate(txSpeed * 8);
		const totalRx = formatBytes(curr.rx).split(' ');
		const totalTx = formatBytes(curr.tx).split(' ');

		// Build download box manually to inject trend badge
		const dlBox = createRateBox(_('download'), rxRate.number, rxRate.unit,
			'is-download', '--ns-dl-color', [...sparkRx], peakRx);
		const dlTrend = E('span', { class: 'ns-trend ' + tRx.cls }, tRx.char);
		dlBox.querySelector('.ns-rate-row').appendChild(dlTrend);

		const ulBox = createRateBox(_('upload'), txRate.number, txRate.unit,
			'is-upload', '--ns-ul-color', [...sparkTx], peakTx);
		const ulTrend = E('span', { class: 'ns-trend ' + tTx.cls }, tTx.char);
		ulBox.querySelector('.ns-rate-row').appendChild(ulTrend);

		const row = E('div', { class: 'netstat-row' }, [
			dlBox,
			ulBox,
			createStatusCard(data.status || 'Disconnected', data.ip, formatUptime(data.uptime || 0)),
			createStatBox(_('downloaded'), totalRx[0], totalRx[1], 'is-total'),
			createStatBox(_('uploaded'),   totalTx[0], totalTx[1], 'is-total'),
			createInfoCard(data.cpu_pct || 0, data.mem_pct || 0,
				data.mem_used || 0, data.mem_total || 0),
		]);

		const container = E('div', { class: 'stats-grid netstat-wrap' }, row);
		_container = container;

		if (!_pollAdded) {
			_pollAdded = true;
			L.Poll.add(() =>
				fetchWithTimeout('/cgi-bin/luci/admin/tools/get_netdev_stats', 5000)
					.then(r => {
						const now2 = Date.now();
						const dt2  = Math.max(0.1, (now2 - last_time) / 1000);
						last_time  = now2;

						if (_container && _container.isConnected) {
							const ok = updateContainer(_container, {
								stats:     (r && r.stats)      || {},
								ip:        (r && r.ip)         || 'N/A',
								status:    (r && r.status)     || 'Disconnected',
								uptime:    (r && r.uptime)     || 0,
								cpu_pct:   (r && r.cpu_pct)    || 0,
								mem_pct:   (r && r.mem_pct)    || 0,
								mem_used:  (r && r.mem_used)   || 0,
								mem_total: (r && r.mem_total)  || 0,
								preferred: []
							}, dt2);
							if (ok) return;
						}
					})
					.catch(() => {})
			, 2);
		}

		return container;
	}
});
