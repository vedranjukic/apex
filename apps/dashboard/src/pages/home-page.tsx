import { useCallback, useEffect } from 'react';
import { AppShell } from '../components/layout/app-shell';
import { ProjectList } from '../components/projects/project-list';
import { openProject } from '../lib/open-project';
import { resetProjectStores } from '../lib/reset-project-stores';

export function HomePage() {
  useEffect(() => {
    resetProjectStores();
  }, []);

  const handleOpenProject = useCallback((id: string) => {
    openProject(id);
  }, []);

  return (
    <AppShell topBarTitle="Apex" showLayoutToggles={false}>
      <ProjectList onOpenProject={handleOpenProject} />
    </AppShell>
  );
}
