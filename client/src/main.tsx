import { createRoot } from 'react-dom/client';
import { App } from './App';
import { connect } from './net';
import { useStore } from './store';
import './styles.css';

connect();
const isLocalOrTest =
  import.meta.env.DEV ||
  (typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1' ||
      Boolean((window as unknown as Record<string, unknown>).__TEST_MODE__)));
if (isLocalOrTest) {
  (window as unknown as Record<string, unknown>).__swarmStore = useStore;
}
createRoot(document.getElementById('root')!).render(<App />);
