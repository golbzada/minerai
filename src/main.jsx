import React from 'react';
import ReactDOM from 'react-dom/client';
import { aguardarSessaoDaExtensao } from './utils/extensaoSessao';
import './index.css';
import './menu.css';
import './sidebar.css';
import './boards.css';
import './garimpo.css';

// O App (e com ele o Supabase) só carrega depois que a extensão, se houver,
// entregou a sessão mais nova. Sem extensão isso não espera nada.
aguardarSessaoDaExtensao()
  .then(() => import('./App'))
  .then(({ default: App }) => {
    ReactDOM.createRoot(document.getElementById('root')).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  });
