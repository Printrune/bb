import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import './lobby.css';

const root = document.getElementById('root');
if (!root) throw new Error('The application root is missing.');
createRoot(root).render(<App />);
