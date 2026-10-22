import {createRoot} from 'react-dom/client';
import App from './App.tsx';
// @ts-expect-error CSS imports are handled by the bundler.
import './index.css';

createRoot(document.getElementById('root')!).render(<App />);
