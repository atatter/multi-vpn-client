import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.tsx';
import { createAppStore } from './store/store.ts';
import './styles.css';

// One store per window, started here rather than in an effect, so StrictMode's double effects can't start it twice.
const store = createAppStore(window.main);
store.start(window);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App store={store} />
  </StrictMode>,
);
