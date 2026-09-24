import type { Change, RepoFiles } from './keryx-api';
import { base64ToBytes, bytesToBase64 } from './bytes';

export interface RepoRef {
  repo: string;
  branch: string;
  token: string;
}

export interface Head {
  commit: string;
  tree: string;
}

export class RepoChangedError extends Error {
  constructor() {
    super('The repo changed since you loaded it; reload and retry.');
  }
}

export class GitHubError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function gh<T>(ref: RepoRef, path: string, init?: { method: string; body: unknown }): Promise<T> {
  const res = await fetch(`https://api.github.com/repos/${ref.repo}${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(ref.token ? { Authorization: `Bearer ${ref.token}` } : {}),
    },
    body: init ? JSON.stringify(init.body) : undefined,
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new GitHubError(res.status, `GitHub ${res.status}: ${body.message ?? res.statusText}`);
  }
  return (await res.json()) as T;
}

interface BranchResponse {
  commit: { sha: string; commit: { tree: { sha: string } } };
}

interface TreeResponse {
  truncated: boolean;
  tree: { path: string; type: string; sha: string }[];
}

export async function loadRepo(ref: RepoRef, dirs: string[]): Promise<{ head: Head; files: RepoFiles }> {
  const branch = await gh<BranchResponse>(ref, `/branches/${encodeURIComponent(ref.branch)}`);
  const head = { commit: branch.commit.sha, tree: branch.commit.commit.tree.sha };
  const tree = await gh<TreeResponse>(ref, `/git/trees/${head.tree}?recursive=1`);
  if (tree.truncated) throw new Error('The repository tree is too large to load.');

  const prefixes = dirs.map((d) => `${d.replace(/\/+$/, '')}/`);
  const blobs = tree.tree.filter((e) => e.type === 'blob' && prefixes.some((p) => e.path.startsWith(p)));
  const entries = await Promise.all(
    blobs.map(async (b) => {
      const blob = await gh<{ content: string }>(ref, `/git/blobs/${b.sha}`);
      return [b.path, base64ToBytes(blob.content)] as const;
    }),
  );
  return { head, files: Object.fromEntries(entries) };
}

export async function commitChange(ref: RepoRef, head: Head, change: Change, message: string): Promise<Head> {
  const written = await Promise.all(
    Object.entries(change.write).map(async ([path, bytes]) => {
      const blob = await gh<{ sha: string }>(ref, '/git/blobs', {
        method: 'POST',
        body: { content: bytesToBase64(bytes), encoding: 'base64' },
      });
      return { path, mode: '100644', type: 'blob', sha: blob.sha as string | null };
    }),
  );
  const removed = change.remove.map((path) => ({ path, mode: '100644', type: 'blob', sha: null }));

  const tree = await gh<{ sha: string }>(ref, '/git/trees', {
    method: 'POST',
    body: { base_tree: head.tree, tree: [...written, ...removed] },
  });
  const commit = await gh<{ sha: string }>(ref, '/git/commits', {
    method: 'POST',
    body: { message, tree: tree.sha, parents: [head.commit] },
  });
  try {
    await gh(ref, `/git/refs/heads/${ref.branch}`, {
      method: 'PATCH',
      body: { sha: commit.sha, force: false },
    });
  } catch (e) {
    if (e instanceof GitHubError && e.status === 422) throw new RepoChangedError();
    throw e;
  }
  return { commit: commit.sha, tree: tree.sha };
}
