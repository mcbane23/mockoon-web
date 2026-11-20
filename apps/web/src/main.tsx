import './polyfills';
import './theme.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/*
      The URL selects what is being edited (environment, route, response). Without this the
      router updates in a low-priority transition, so the previous editor stays on screen and
      keeps accepting input for a moment after the selection changed, and that input would be
      saved to the wrong route.
    */}
    <BrowserRouter useTransitions={false}>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
