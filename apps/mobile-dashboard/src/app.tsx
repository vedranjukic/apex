import { useState, useEffect } from 'react';
import { getToken } from './api';
import { AuthScreen } from './views/auth';
import { ProjectList } from './views/project-list';
import { ThreadList } from './views/thread-list';
import { ThreadView } from './views/thread-view';

type Route =
  | { view: 'auth' }
  | { view: 'projects' }
  | { view: 'threads'; projectId: string; projectName: string }
  | { view: 'thread'; threadId: string; projectId: string; projectName: string; threadTitle: string };

function parseHash(): Route {
  const hash = window.location.hash.slice(1) || '/';
  if (hash.startsWith('/thread/')) {
    const params = new URLSearchParams(hash.split('?')[1] || '');
    return {
      view: 'thread',
      threadId: hash.split('/')[2]?.split('?')[0] || '',
      projectId: params.get('pid') || '',
      projectName: params.get('pname') || '',
      threadTitle: params.get('title') || '',
    };
  }
  if (hash.startsWith('/project/')) {
    const params = new URLSearchParams(hash.split('?')[1] || '');
    return {
      view: 'threads',
      projectId: hash.split('/')[2]?.split('?')[0] || '',
      projectName: params.get('name') || '',
    };
  }
  if (hash === '/auth') return { view: 'auth' };
  return { view: 'projects' };
}

export function App() {
  const [route, setRoute] = useState<Route>(parseHash);

  useEffect(() => {
    if (!getToken() && route.view !== 'auth') {
      window.location.hash = '#/auth';
    }
  }, [route]);

  useEffect(() => {
    const onChange = () => setRoute(parseHash());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  if (!getToken() || route.view === 'auth') {
    return <AuthScreen />;
  }

  switch (route.view) {
    case 'projects':
      return <ProjectList />;
    case 'threads':
      return <ThreadList projectId={route.projectId} projectName={route.projectName} />;
    case 'thread':
      return (
        <ThreadView
          threadId={route.threadId}
          projectId={route.projectId}
          projectName={route.projectName}
          threadTitle={route.threadTitle}
        />
      );
    default:
      return <ProjectList />;
  }
}
