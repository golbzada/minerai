import React from 'react';

/** Nota de 1 a 5 estrelas. Clicar na mesma nota de novo zera. */
export default function StarRating({ value = 0, onChange, size = 'sm', readOnly = false, title = 'Nota da oferta' }) {
  const stars = [1, 2, 3, 4, 5];
  return (
    <span className={`star-rating ${size} ${readOnly ? 'readonly' : ''}`} title={title} role="img" aria-label={`${value} de 5 estrelas`}>
      {stars.map((n) => (
        <button
          key={n}
          type="button"
          className={`star ${n <= value ? 'on' : ''}`}
          disabled={readOnly}
          aria-label={`${n} ${n === 1 ? 'estrela' : 'estrelas'}`}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (onChange) onChange(n === value ? 0 : n);
          }}
        >
          ★
        </button>
      ))}
    </span>
  );
}
