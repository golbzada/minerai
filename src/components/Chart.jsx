import React from 'react';

export default function Chart({ history = [] }) {
  if (!history || !history.length) {
    return <div className="chart-empty">Sem histórico diário.</div>;
  }

  // Normaliza os dados do histórico com segurança total contra undefined/NaN/Invalid Date
  const normalizedHistory = history.map((item, idx) => {
    const count = Number(item.count ?? item.ads_count ?? item.results_count ?? 0);
    let rawDate = item.date || item.result_date || item.created_at;
    let dateFormatted = '';

    if (!rawDate) {
      const today = new Date();
      dateFormatted = today.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    } else if (typeof rawDate === 'string') {
      if (rawDate.includes('T')) {
        try {
          const d = new Date(rawDate);
          dateFormatted = !isNaN(d.getTime())
            ? d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
            : rawDate.slice(0, 10);
        } catch (e) {
          dateFormatted = rawDate.slice(0, 10);
        }
      } else if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
        const parts = rawDate.split('-');
        dateFormatted = `${parts[2]}/${parts[1]}`;
      } else {
        dateFormatted = rawDate;
      }
    } else {
      dateFormatted = 'Hoje';
    }

    return {
      id: idx,
      count: isNaN(count) ? 0 : count,
      dateFormatted: dateFormatted || 'Hoje'
    };
  });

  const counts = normalizedHistory.map((item) => item.count);
  const maxVal = Math.max(...counts, 1);
  const minVal = Math.min(...counts, 0);
  const range = Math.max(maxVal - minVal, 1);

  // Quando tem 1 medição (ou todas iguais), gera a pirâmide dourada que culmina no halo central (como na imagem 2)
  let pointsStr = '';
  if (normalizedHistory.length === 1) {
    pointsStr = '50,24';
  } else {
    pointsStr = normalizedHistory
      .map((item, idx) => {
        const x = 8 + (idx / (normalizedHistory.length - 1)) * 84;
        const y = 82 - ((item.count - minVal) / range) * 58;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }

  const pointList = pointsStr.split(' ');

  return (
    <div className="chart-wrap">
      <svg
        className="chart"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-label="Evolução dos resultados"
      >
        <polyline
          className="chart-area"
          points={normalizedHistory.length === 1 ? '8,88 50,24 92,88' : `8,88 ${pointsStr} 92,88`}
        />
        <polyline
          className="chart-line"
          points={normalizedHistory.length === 1 ? '8,88 50,24 92,88' : pointsStr}
        />
        {normalizedHistory.map((item, idx) => {
          const coords = pointList[idx] || (normalizedHistory.length === 1 ? '50,24' : '50,50');
          const [cx, cy] = coords.split(',');
          return (
            <circle
              key={item.id}
              cx={cx}
              cy={cy}
              r="2.6"
            >
              <title>{`${item.dateFormatted}: ${item.count} anúncios`}</title>
            </circle>
          );
        })}
      </svg>

      <div className="chart-labels">
        {normalizedHistory.slice(-5).map((item) => (
          <span key={item.id}>
            <b>{item.count}</b>
            {item.dateFormatted}
          </span>
        ))}
      </div>
    </div>
  );
}
