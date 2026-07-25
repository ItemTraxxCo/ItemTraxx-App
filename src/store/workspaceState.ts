import { reactive } from "vue";

export type WorkspaceState = {
  host: string | null;
  slug: string | null;
  isWorkspaceHost: boolean;
  baseHost: string | null;
  workspaceId: string | null;
  workspaceName: string | null;
  isKnownWorkspace: boolean;
  hostMismatch: boolean;
};

const defaultState: WorkspaceState = {
  host: null,
  slug: null,
  isWorkspaceHost: false,
  baseHost: null,
  workspaceId: null,
  workspaceName: null,
  isKnownWorkspace: false,
  hostMismatch: false,
};

const workspaceState = reactive<WorkspaceState>({ ...defaultState });

export const getWorkspaceState = () => workspaceState;
export const setWorkspaceState = (next: Partial<WorkspaceState>) => Object.assign(workspaceState, next);
export const clearWorkspaceState = () => Object.assign(workspaceState, defaultState);
