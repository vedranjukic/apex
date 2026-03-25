import { create } from 'zustand';
import { projectsApi, type Project, type GitHubContextData } from '../api/client';

interface ProjectsState {
  projects: Project[];
  forks: Project[];
  loading: boolean;
  forksLoading: boolean;
  error: string | null;
  fetchProjects: () => Promise<void>;
  createProject: (data: {
    name: string;
    description?: string;
    agentType?: string;
    provider?: string;
    gitRepo?: string;
    gitBranch?: string;
    localDir?: string;
    githubContext?: GitHubContextData;
  }) => Promise<Project>;
  deleteProject: (id: string) => Promise<void>;
  setProjectStatus: (id: string, status: string) => void;
  fetchForks: (projectId: string) => Promise<void>;
  forkProject: (id: string, branchName: string) => Promise<Project>;
}

export const useProjectsStore = create<ProjectsState>((set, get) => ({
  projects: [],
  forks: [],
  loading: false,
  forksLoading: false,
  error: null,

  fetchProjects: async () => {
    set({ loading: true, error: null });
    try {
      const projects = await projectsApi.list();
      set({ projects, loading: false });
    } catch (err) {
      set({ error: String(err), loading: false });
    }
  },

  createProject: async (data) => {
    const project = await projectsApi.create(data);
    set({ projects: [project, ...get().projects] });
    return project;
  },

  deleteProject: async (id) => {
    get().setProjectStatus(id, 'deleting');
    try {
      await projectsApi.delete(id);
    } catch {
      // ignore – project may already be gone
    }
    set({ projects: get().projects.filter((p) => p.id !== id) });
  },

  setProjectStatus: (id, status) => {
    set({
      projects: get().projects.map((p) =>
        p.id === id ? { ...p, status } : p,
      ),
    });
  },

  fetchForks: async (projectId: string) => {
    set({ forksLoading: true });
    try {
      const forks = await projectsApi.getForks(projectId);
      set({ forks, forksLoading: false });
    } catch {
      set({ forks: [], forksLoading: false });
    }
  },

  forkProject: async (id: string, branchName: string) => {
    const project = await projectsApi.fork(id, branchName);
    set({ forks: [...get().forks, project] });
    return project;
  },
}));
