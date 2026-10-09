import ReactDOM from 'react-dom/client';
import App from './App';
import { initMetrics } from './metrics';
import 'react-calendar-timeline/dist/style.css';
import './app.css';

initMetrics();
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<App />);
