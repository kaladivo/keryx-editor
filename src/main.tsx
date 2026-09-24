import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { EvoluRoot } from './components/EvoluRoot.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <EvoluRoot>
      <App />
    </EvoluRoot>
  </StrictMode>,
)
