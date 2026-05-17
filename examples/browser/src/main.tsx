// React entry. Mounts the playground shell — boots almostnode lazily
// inside the runtime store on first access.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PlaygroundPage } from './ui/PlaygroundPage.js';
import './styles/global.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root mount missing from index.html');

createRoot(root).render(
  <StrictMode>
    <PlaygroundPage />
  </StrictMode>,
);
