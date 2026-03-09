import { BrowserRouter, Routes, Route } from 'react-router-dom';
import ControlPanel from './ControlPanel';
import ProjectorView from './ProjectorView';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ControlPanel />} />
        <Route path="/projector" element={<ProjectorView />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
