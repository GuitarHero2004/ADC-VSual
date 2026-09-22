import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import '../../../../packages/voice-ui/src/styles.css';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Desktop root element is missing.');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
