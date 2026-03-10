import { BrowserRouter, Route, Routes } from 'react-router-dom';
import ControlPanel from './ControlPanel';
import LoginScreen from './LoginScreen';
import ProjectorView from './ProjectorView';
import { useAuth } from './lib/auth-context';

function App() {
  const { authReady, user } = useAuth();

  if (!authReady) {
    return <div className="app-loading-screen">Connecting...</div>;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={user ? <ControlPanel /> : <LoginScreen />} />
        <Route path="/projector" element={<ProjectorView />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
