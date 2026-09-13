import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { initConsoleCapture } from './lib/consoleCapture'

initConsoleCapture();

createRoot(document.getElementById("root")!).render(<App />);
