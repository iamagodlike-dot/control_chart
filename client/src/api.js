const BASE = 'http://localhost:4000/api';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export const api = {
  posts: {
    list: () => request('/posts'),
    create: (data) => request('/posts', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => request(`/posts/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id) => request(`/posts/${id}`, { method: 'DELETE' }),
  },
  masters: {
    list: () => request('/masters'),
    create: (data) => request('/masters', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => request(`/masters/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id) => request(`/masters/${id}`, { method: 'DELETE' }),
  },
  jobs: {
    list: () => request('/jobs'),
    get: (id) => request(`/jobs/${id}`),
    create: (data) => request('/jobs', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => request(`/jobs/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id) => request(`/jobs/${id}`, { method: 'DELETE' }),
  },
  stages: {
    create: (jobId, data) => request(`/jobs/${jobId}/stages`, { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => request(`/stages/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id) => request(`/stages/${id}`, { method: 'DELETE' }),
  },
  gantt: () => request('/gantt'),
};
