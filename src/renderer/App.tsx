import { MemoryRouter as Router, Routes, Route } from 'react-router-dom';
import LogViewer from './components/LogViewer';
import './App.css';

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<LogViewer />} />
      </Routes>
    </Router>
  );
}
