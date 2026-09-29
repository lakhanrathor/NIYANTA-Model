
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import MissionHub from './pages/MissionHub';
import MissionOverview from './pages/MissionOverview';
import ProjectDashboard from './pages/ProjectDashboard';

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<MissionHub />} />
        <Route path="/mission/:missionId" element={<MissionOverview />} />
        <Route path="/mission/:missionId/project/:projectId" element={<ProjectDashboard />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}
