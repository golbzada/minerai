import React from 'react';

export default function Chart({ history = [] }) {
  if (!history || !history.length) {
    return <div className="chart-empty">Sem histórico diário.</div>;
  }

  const counts = history.map((item) => Number(item.results_count));
  const maxVal = Math.max(...counts, 1);
  const minVal = Math.min(...counts, 0);
  const range = Math.max(maxVal - minVal, 1);

  // Generate SVG polyline points
  const pointsStr = history
    .map((item, idx) => {
      const x = history.length === 1 ? 50 : 8 + (idx / (history.length - 1)) * 84;
      const y = 82 - ((Number(item.results_count) - minVal) / range) * 64;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

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
          points={`8,88 ${pointsStr} 92,88`}
        />
        <polyline
          className="chart-line"
          points={pointsStr}
        />
        {history.map((item, idx) => {
          const [cx, cy] = pointList[idx].split(',');
          return (
            <circle
              key={item.result_date || idx}
              cx={cx}
              cy={cy}
              r="2.4"
            >
              <title>{`${item.result_date}: ${item.results_count} anúncios`}</title>
            </circle>
          );
        })}
      </svg>

      <div className="chart-labels">
        {history.slice(-5).map((item) => {
          let dateFormatted = item.result_date;
          try {
            dateFormatted = new Date(`${item.result_date}T12:00:00`).toLocaleDateString('pt-BR', {
              day: '2-digit',
              month: '2-digit'
            });
          } catch (e) {}

          return (
            <span key={item.result_date}>
              <b>{item.results_count}</b>
              {dateFormatted}
            </span>
          );
        })}
      </div>
    </div>
  );
}
