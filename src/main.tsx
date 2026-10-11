import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import './jv-base.css';
import './jv-center.css';
import './jv-left.css';
import './jv-right.css';
import './jv-town.css';
import './themes.css'; // last: theme variables override the defaults
import './theme'; // applies the saved theme before first paint

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
