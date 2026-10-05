import { createRoot } from 'react-dom/client';
import { App } from './App';
import { connect } from './net';
import { useStore } from './store';
import './styles.css';

connect();
(window as unknown as Record<string, unknown>).__swarmStore = useStore;
createRoot(document.getElementById('root')!).render(<App />);
