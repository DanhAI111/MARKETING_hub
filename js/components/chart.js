/* ═══════════════════════════════════════════
   MARKETING HUB - Chart Component
   Canvas-based charts (Donut, Bar, Line)
   ═══════════════════════════════════════════ */

const Chart = (() => {

  // ── Donut Chart ──
  const drawDonut = (canvas, data, options = {}) => {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement.getBoundingClientRect();
    const size = Math.min(options.size || rect.width || 160, options.size || 160);

    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
    ctx.scale(dpr, dpr);

    const cx = size / 2;
    const cy = size / 2;
    const radius = (size / 2) - 4;
    const innerRadius = radius * 0.62;
    const total = data.reduce((s, d) => s + (d.value || 0), 0);

    if (total === 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.arc(cx, cy, innerRadius, 0, Math.PI * 2, true);
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      ctx.fill();
      ctx.fillStyle = '#999999';
      ctx.font = '13px "Inter Variable", Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Chưa có dữ liệu', cx, cy);
      return;
    }

    let startAngle = -Math.PI / 2;

    data.forEach((d, i) => {
      const sliceAngle = (d.value / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, startAngle, startAngle + sliceAngle);
      ctx.arc(cx, cy, innerRadius, startAngle + sliceAngle, startAngle, true);
      ctx.closePath();
      ctx.fillStyle = d.color || `hsl(${(i * 60) % 360}, 70%, 60%)`;
      ctx.fill();
      startAngle += sliceAngle;
    });

    // Center text
    if (options.centerText) {
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${Math.floor(size * 0.12)}px "JetBrains Mono", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(options.centerText, cx, cy - 6);
      if (options.centerSubtext) {
        ctx.fillStyle = '#999999';
        ctx.font = `${Math.floor(size * 0.07)}px "Inter Variable", Inter, sans-serif`;
        ctx.fillText(options.centerSubtext, cx, cy + 12);
      }
    }
  };

  // ── Bar Chart ──
  const drawBar = (canvas, data, options = {}) => {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement.getBoundingClientRect();
    const w = options.width || rect.width || 400;
    const h = options.height || rect.height || 220;

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.scale(dpr, dpr);

    const padding = {
      top: options.padding?.top ?? 20,
      right: options.padding?.right ?? 20,
      bottom: options.padding?.bottom ?? 40,
      left: options.padding?.left ?? 60
    };
    const chartW = w - padding.left - padding.right;
    const chartH = h - padding.top - padding.bottom;

    if (data.length === 0) {
      ctx.fillStyle = '#999999';
      ctx.font = '13px "Inter Variable", Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Chưa có dữ liệu', w / 2, h / 2);
      return;
    }

    const maxVal = Math.max(...data.map(d => d.value || 0)) * 1.15 || 1;
    const barWidth = Math.min(chartW / data.length * 0.6, 40);
    const gap = chartW / data.length;

    // Grid lines
    const gridLines = 5;
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#999999';
    ctx.font = `${w >= 900 ? 12 : 11}px "JetBrains Mono"`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    for (let i = 0; i <= gridLines; i++) {
      const y = padding.top + chartH - (chartH / gridLines) * i;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(w - padding.right, y);
      ctx.stroke();
      const val = (maxVal / gridLines) * i;
      const label = maxVal < 10
        ? (Math.round(val * 10) / 10).toLocaleString('vi-VN')
        : Utils.formatNumberCompact(val);
      ctx.fillText(label, padding.left - 8, y);
    }

    // Bars
    data.forEach((d, i) => {
      const barH = (d.value / maxVal) * chartH;
      const x = padding.left + gap * i + (gap - barWidth) / 2;
      const y = padding.top + chartH - barH;

      // Bar gradient
      const grad = ctx.createLinearGradient(x, y, x, padding.top + chartH);
      grad.addColorStop(0, d.color || '#6a4cf5');
      grad.addColorStop(1, (d.color || '#6a4cf5') + '40');

      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, barH, [4, 4, 0, 0]);
      ctx.fillStyle = grad;
      ctx.fill();

      // Label
      ctx.fillStyle = '#999999';
      ctx.font = `${w >= 900 ? 12 : 11}px "Inter Variable", Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(d.label || '', x + barWidth / 2, padding.top + chartH + 8);
    });
  };

  // ── Line Chart ──
  const drawLine = (canvas, datasets, options = {}) => {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement.getBoundingClientRect();
    const w = options.width || rect.width || 400;
    const h = options.height || rect.height || 220;

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.scale(dpr, dpr);

    const padding = {
      top: options.padding?.top ?? 20,
      right: options.padding?.right ?? 20,
      bottom: options.padding?.bottom ?? 40,
      left: options.padding?.left ?? 60
    };
    const chartW = w - padding.left - padding.right;
    const chartH = h - padding.top - padding.bottom;
    const labels = options.labels || [];

    // All values
    let allValues = [];
    datasets.forEach(ds => { allValues = allValues.concat(ds.data || []); });
    const maxVal = Math.max(...allValues, 1) * 1.1 || 1;

    if (allValues.length === 0) {
      ctx.fillStyle = '#999999';
      ctx.font = '13px "Inter Variable", Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Chưa có dữ liệu', w / 2, h / 2);
      return;
    }

    // Grid
    const gridLines = 5;
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#999999';
    ctx.font = `${w >= 900 ? 12 : 11}px "JetBrains Mono"`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    for (let i = 0; i <= gridLines; i++) {
      const y = padding.top + chartH - (chartH / gridLines) * i;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(w - padding.right, y);
      ctx.stroke();
      const val = (maxVal / gridLines) * i;
      const label = maxVal < 10
        ? (Math.round(val * 10) / 10).toLocaleString('vi-VN')
        : Utils.formatNumberCompact(val);
      ctx.fillText(label, padding.left - 8, y);
    }

    // X-axis labels
    const xStep = labels.length > 1 ? chartW / (labels.length - 1) : 0;
    ctx.fillStyle = '#999999';
    ctx.font = `${w >= 900 ? 12 : 11}px "Inter Variable", Inter, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    const targetLabelCount = w < 500 ? 5 : 10;
    const labelStep = Math.ceil(labels.length / targetLabelCount);
    labels.forEach((label, i) => {
      if (i % labelStep === 0 || i === labels.length - 1) {
        ctx.fillText(label, padding.left + xStep * i, padding.top + chartH + 8);
      }
    });

    // Lines
    datasets.forEach(ds => {
      const points = ds.data.map((val, i) => ({
        x: padding.left + xStep * i,
        y: padding.top + chartH - (val / maxVal) * chartH
      }));

      if (points.length === 0) return;

      // Single-point: just draw a dot
      if (points.length === 1) {
        ctx.beginPath();
        ctx.arc(points[0].x, points[0].y, 4, 0, Math.PI * 2);
        ctx.fillStyle = ds.color || '#6a4cf5';
        ctx.fill();
        return;
      }

      // Area fill
      if (ds.fill) {
        ctx.beginPath();
        ctx.moveTo(points[0].x, padding.top + chartH);
        points.forEach(p => ctx.lineTo(p.x, p.y));
        ctx.lineTo(points[points.length - 1].x, padding.top + chartH);
        ctx.closePath();
        const grad = ctx.createLinearGradient(0, padding.top, 0, padding.top + chartH);
        grad.addColorStop(0, (ds.color || '#6a4cf5') + '25');
        grad.addColorStop(1, (ds.color || '#6a4cf5') + '02');
        ctx.fillStyle = grad;
        ctx.fill();
      }

      // Line
      ctx.beginPath();
      ctx.strokeStyle = ds.color || '#6a4cf5';
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      points.forEach((p, i) => {
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();

      // Dots
      points.forEach((p, i) => {
        if (i === points.length - 1 || points.length <= 15) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
          ctx.fillStyle = ds.color || '#6a4cf5';
          ctx.fill();
          ctx.beginPath();
          ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
          ctx.fillStyle = '#090909';
          ctx.fill();
        }
      });
    });
  };

  // ── Sparkline (mini line) ──
  const drawSparkline = (canvas, data, color = '#6a4cf5') => {
    if (!canvas || !data || data.length < 2) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 100;
    const h = canvas.clientHeight || 40;

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.scale(dpr, dpr);

    const pad = 2;
    const maxVal = Math.max(...data) || 1;
    const minVal = Math.min(...data);
    const range = maxVal - minVal || 1;
    const step = (w - pad * 2) / (data.length - 1);

    const points = data.map((v, i) => ({
      x: pad + step * i,
      y: pad + (h - pad * 2) - ((v - minVal) / range) * (h - pad * 2)
    }));

    // Area
    ctx.beginPath();
    ctx.moveTo(points[0].x, h);
    points.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.lineTo(points[points.length - 1].x, h);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, color + '30');
    grad.addColorStop(1, color + '05');
    ctx.fillStyle = grad;
    ctx.fill();

    // Line
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();
  };

  return { drawDonut, drawBar, drawLine, drawSparkline };
})();
