import { BrowserRouter, Routes, Route, useParams } from 'react-router-dom';
import { HomePage } from '../pages/home-page';
import { ProjectPage } from '../pages/project-page';
import { SettingsPage } from '../pages/settings-page';
import { useGlobalCommands } from '../hooks/use-global-commands';

function ProjectPageKeyed() {
  const { projectId } = useParams<{ projectId: string }>();
  return <ProjectPage key={projectId} />;
}

export function App() {
  useGlobalCommands();

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/projects/:projectId" element={<ProjectPageKeyed />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
