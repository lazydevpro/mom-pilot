import ReactDOM from 'react-dom/client';
import App from './App';
import Tv from './Tv';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  location.pathname === '/tv' ? <Tv /> : <App />,
);
