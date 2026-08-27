(function () {
  'use strict';

  const config = window.BUILDING_WORKFLOW_SUPABASE || {};
  const DEVICE_KEY = 'building-cloud-device-id-v1';
  const ATTACHMENT_DELETE_QUEUE_KEY = 'building-cloud-attachment-deletes-v1';
  const ATTACHMENT_DELETE_ITEM_PREFIX = 'building-cloud-attachment-delete-v2:';
  const AUTH_STORAGE_KEY = 'building-workflow-supabase-auth-v1';
  const SYNC_DEBOUNCE_MS = 900;
  const CHANGE_POLL_MS = 1600;

  const cloud = {
    client: null,
    user: null,
    session: null,
    deviceId: getOrCreateDeviceId(),
    applyingRemote: false,
    syncing: false,
    syncRequested: false,
    sessionEpoch: 0,
    initialized: false,
    syncTimer: null,
    pollTimer: null,
    remoteTimer: null,
    realtimeChannel: null,
    lastSyncedAt: null,
    conflictMessage: '',
    errorMessage: '',
    pendingAttachments: 0,
    deletedAttachmentIds: new Set(),
    updateAttachmentNote: null,
    originals: {}
  };

  class CloudConflictError extends Error {
    constructor(projectId) {
      super('Remote version changed');
      this.name = 'CloudConflictError';
      this.projectId = projectId;
    }
  }

  class StaleSyncError extends Error {
    constructor() {
      super('Authentication context changed during synchronization');
      this.name = 'StaleSyncError';
    }
  }

  function assertSyncContext(context) {
    if (!context || cloud.sessionEpoch !== context.epoch || cloud.user?.id !== context.userId) {
      throw new StaleSyncError();
    }
  }

  function currentSyncContext(context) {
    const resolved = context || (cloud.user ? { userId: cloud.user.id, epoch: cloud.sessionEpoch } : null);
    if (!resolved) return null;
    assertSyncContext(resolved);
    return resolved;
  }

  function isCurrentSyncContext(context) {
    return Boolean(context && cloud.sessionEpoch === context.epoch && cloud.user?.id === context.userId);
  }

  function getOrCreateDeviceId() {
    const fallback = globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID()
      : 'device-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    try {
      let id = sessionStorage.getItem(DEVICE_KEY);
      if (!id) {
        id = fallback;
        sessionStorage.setItem(DEVICE_KEY, id);
      }
      return id;
    } catch (error) {
      console.warn('Session storage is unavailable; using an in-memory device identifier.', error);
      return fallback;
    }
  }

  function knownProjectKeys() {
    try {
      return Array.from(new Set(PROJECT_DATA_KEYS));
    } catch (error) {
      return [];
    }
  }

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function projectCloud(project) {
    const value = project.cloud && typeof project.cloud === 'object' ? project.cloud : {};
    value.userId = value.userId || '';
    value.projectVersion = Math.max(0, Number(value.projectVersion) || 0);
    value.stateVersions = value.stateVersions && typeof value.stateVersions === 'object' ? value.stateVersions : {};
    value.dirtyKeys = Array.isArray(value.dirtyKeys) ? Array.from(new Set(value.dirtyKeys)) : [];
    value.metaDirty = Boolean(value.metaDirty);
    value.cloudName = value.cloudName || '';
    value.lastSyncedAt = value.lastSyncedAt || '';
    project.cloud = value;
    return value;
  }

  function projectEligibleForUser(project, userId = cloud.user?.id) {
    const owner = projectCloud(project).userId;
    return !owner || owner === userId;
  }

  function differenceKeys(before, after) {
    const keys = new Set([...knownProjectKeys(), ...Object.keys(before || {}), ...Object.keys(after || {})]);
    return [...keys].filter(key => (before || {})[key] !== (after || {})[key]);
  }

  function saveRegistryQuietly(registry) {
    saveProjectRegistry(registry);
  }

  function updateLocalProject(projectId, updater) {
    const registry = getProjectRegistry();
    const project = registry.projects.find(item => item.id === projectId);
    if (!project) return null;
    updater(project, projectCloud(project));
    saveRegistryQuietly(registry);
    return project;
  }

  function markCurrentProjectUsed() {
    const registry = getProjectRegistry();
    const currentId = localStorage.getItem(CURRENT_PROJECT_KEY);
    const project = registry.projects.find(item => item.id === currentId);
    if (!project?.isBootstrap) return;
    project.isBootstrap = false;
    saveRegistryQuietly(registry);
  }

  function markProjectDirty(projectId, keys, metaDirty) {
    if (cloud.applyingRemote) return;
    const updated = updateLocalProject(projectId, (project, metadata) => {
      metadata.dirtyKeys = Array.from(new Set([...metadata.dirtyKeys, ...(keys || [])])).filter(key => knownProjectKeys().includes(key));
      metadata.metaDirty = metadata.metaDirty || Boolean(metaDirty) || (metadata.cloudName && metadata.cloudName !== project.name);
      metadata.lastLocalChangeAt = new Date().toISOString();
    });
    if (updated && cloud.user && projectEligibleForUser(updated)) scheduleCloudSync();
    updateCloudUi();
  }

  function captureLiveProjectChanges() {
    if (cloud.applyingRemote || typeof getCurrentProject !== 'function') return [];
    const current = getCurrentProject();
    if (!current) return [];
    const before = current.data || {};
    const live = captureProjectState();
    const changed = differenceKeys(before, live);
    if (changed.length) {
      cloud.originals.saveCurrentProject(false);
      markProjectDirty(current.id, changed, false);
    }
    const refreshed = getCurrentProject();
    if (refreshed) {
      const metadata = projectCloud(refreshed);
      if (!metadata.metaDirty && ((!metadata.cloudName && !metadata.userId) || (metadata.cloudName && metadata.cloudName !== refreshed.name))) {
        markProjectDirty(refreshed.id, [], true);
      }
    }
    return changed;
  }

  function formatSyncTime(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('zh-TW', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  }

  function ui() {
    return {
      panel: document.querySelector('#cloudSyncPanel'),
      user: document.querySelector('#cloudUserLabel'),
      status: document.querySelector('#cloudSyncStatus'),
      time: document.querySelector('#cloudSyncTime'),
      primary: document.querySelector('#cloudPrimaryAction'),
      signOut: document.querySelector('#cloudSignOut'),
      dialog: document.querySelector('#cloudAuthDialog'),
      form: document.querySelector('#cloudAuthForm'),
      email: document.querySelector('#cloudAuthEmail'),
      password: document.querySelector('#cloudAuthPassword'),
      error: document.querySelector('#cloudAuthError'),
      help: document.querySelector('#cloudAuthHelp')
    };
  }

  function setCloudStatus(kind, message, actionLabel) {
    const elements = ui();
    if (!elements.panel) return;
    elements.panel.dataset.syncState = kind;
    elements.panel.setAttribute('aria-busy', kind === 'syncing' ? 'true' : 'false');
    elements.status.textContent = message;
    elements.primary.textContent = actionLabel || (cloud.user ? '立即同步' : '登入同步');
    elements.primary.disabled = kind === 'syncing';
    elements.signOut.hidden = !cloud.user;
    elements.signOut.disabled = kind === 'syncing';
    if (cloud.user && cloud.lastSyncedAt) {
      elements.time.hidden = false;
      elements.time.dateTime = cloud.lastSyncedAt;
      elements.time.textContent = '最後同步 ' + formatSyncTime(cloud.lastSyncedAt);
      elements.time.setAttribute('aria-label', '最後同步時間 ' + formatSyncTime(cloud.lastSyncedAt));
    } else {
      elements.time.hidden = true;
      elements.time.removeAttribute('datetime');
      elements.time.removeAttribute('aria-label');
      elements.time.textContent = '';
    }
  }

  function currentPendingCount() {
    const project = getCurrentProject?.();
    if (!project) return 0;
    const metadata = projectCloud(project);
    if (project.isBootstrap === true && !metadata.userId) return cloud.pendingAttachments;
    return metadata.dirtyKeys.length + (metadata.metaDirty ? 1 : 0) + cloud.pendingAttachments;
  }

  function updateCloudUi() {
    const elements = ui();
    if (!elements.panel) return;
    elements.user.textContent = cloud.user?.email || '未登入';
    elements.user.setAttribute('aria-label', cloud.user ? '已登入：' + (cloud.user.email || cloud.user.id) : '雲端同步未登入');
    cloud.updateAttachmentNote?.();
    if (!navigator.onLine) {
      setCloudStatus('offline', '離線，恢復連線後自動同步', cloud.user ? '稍後重試' : '登入同步');
      elements.primary.disabled = true;
      return;
    }
    if (cloud.syncing) {
      setCloudStatus('syncing', '同步中…', '同步中…');
      return;
    }
    if (cloud.errorMessage) {
      setCloudStatus('error', cloud.errorMessage, cloud.user ? '重試' : '重新登入');
      return;
    }
    if (!cloud.user) {
      setCloudStatus('local', '僅儲存在此裝置', '登入同步');
      return;
    }
    const currentProject = getCurrentProject?.();
    if (currentProject && !projectEligibleForUser(currentProject)) {
      setCloudStatus('error', '目前專案已連結其他雲端帳號', '無法同步');
      elements.primary.disabled = true;
      return;
    }
    if (cloud.conflictMessage) {
      setCloudStatus('conflict', cloud.conflictMessage, '立即同步');
      return;
    }
    const pending = currentPendingCount();
    if (pending) {
      setCloudStatus('pending', '待同步 ' + pending + ' 項', '立即同步');
      return;
    }
    setCloudStatus('synced', cloud.lastSyncedAt ? '已同步' : '已連線，等待同步', '立即同步');
  }

  function showCloudError(error, prefix) {
    console.warn(prefix || 'Supabase sync error', error);
    cloud.conflictMessage = '';
    const message = prefix ? prefix + '：' + (error?.message || String(error)) : (error?.message || String(error));
    cloud.errorMessage = message;
    setCloudStatus('error', message, cloud.user ? '重試' : '重新登入');
  }

  function openAuthDialog() {
    const elements = ui();
    if (!elements.dialog) return;
    elements.error.textContent = '';
    elements.help.textContent = location.protocol === 'file:'
      ? '本機檔案可登入，但註冊確認信會回到公開網站；正式同步建議使用 HTTPS 公開版。'
      : '使用相同帳號登入其他筆電，即可同步專案與會議附件。';
    elements.dialog.showModal();
    requestAnimationFrame(() => elements.email.focus());
  }

  function closeAuthDialog() {
    const elements = ui();
    if (elements.dialog?.open) elements.dialog.close();
  }

  async function runAuth(mode, submitter) {
    const elements = ui();
    const email = elements.email.value.trim();
    const password = elements.password.value;
    elements.error.textContent = '';
    elements.error.classList.remove('success');
    if (!email || password.length < 8) {
      elements.error.textContent = '請輸入有效的電子郵件與至少 8 個字元的密碼。';
      return;
    }
    if (!cloud.client) {
      elements.error.textContent = '雲端元件尚未就緒，請重新整理頁面後再試。';
      return;
    }
    const controls = [...elements.form.querySelectorAll('input, button')];
    const originalLabel = submitter?.textContent || '';
    elements.form.setAttribute('aria-busy', 'true');
    controls.forEach(control => { control.disabled = true; });
    if (submitter) submitter.textContent = mode === 'signup' ? '建立中…' : '登入中…';
    try {
      if (mode === 'signup') {
        const { data, error } = await cloud.client.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: config.publicSiteUrl }
        });
        if (error) throw error;
        if (!data.session) {
          elements.error.classList.add('success');
          elements.error.textContent = '註冊完成，請到信箱點擊確認連結後再登入。';
          return;
        }
      } else {
        const { error } = await cloud.client.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      closeAuthDialog();
    } catch (error) {
      elements.error.classList.remove('success');
      elements.error.textContent = error?.message || '登入失敗，請稍後重試。';
    } finally {
      elements.form.setAttribute('aria-busy', 'false');
      controls.forEach(control => { control.disabled = false; });
      if (submitter) submitter.textContent = originalLabel;
    }
  }

  function submitAuth(event) {
    event.preventDefault();
    return runAuth(event.submitter?.dataset.authMode || 'signin', event.submitter || null);
  }

  function scheduleCloudSync(delay = SYNC_DEBOUNCE_MS) {
    if (!cloud.user || cloud.applyingRemote) return;
    if (cloud.syncing) {
      cloud.syncRequested = true;
      return;
    }
    clearTimeout(cloud.syncTimer);
    cloud.syncTimer = setTimeout(() => syncAllProjects({ source: 'local' }), delay);
  }

  function remoteStateBundle(rows) {
    const data = {};
    const versions = {};
    const known = new Set(knownProjectKeys());
    (rows || []).forEach(row => {
      versions[row.state_key] = Number(row.version) || 0;
      if (!known.has(row.state_key)) return;
      if (row.is_deleted) delete data[row.state_key];
      else data[row.state_key] = String(row.state_value ?? '');
    });
    return { data, versions };
  }

  function groupStateRows(rows) {
    return (rows || []).reduce((map, row) => {
      if (!map.has(row.project_id)) map.set(row.project_id, []);
      map.get(row.project_id).push(row);
      return map;
    }, new Map());
  }

  async function fetchRemoteProjectRows(userId) {
    const rows = [];
    for (let from = 0; ; from += 1000) {
      const result = await cloud.client.from(config.projectTable)
        .select('user_id,project_id,name,schema_version,version,device_id,created_at,updated_at')
        .eq('user_id', userId)
        .order('updated_at', { ascending: true })
        .order('project_id', { ascending: true })
        .range(from, from + 999);
      if (result.error) throw result.error;
      rows.push(...(result.data || []));
      if ((result.data || []).length < 1000) return rows;
    }
  }

  async function fetchRemoteStateRows(userId) {
    const rows = [];
    for (let from = 0; ; from += 1000) {
      const result = await cloud.client.from(config.stateTable)
        .select('user_id,project_id,state_key,state_value,is_deleted,version,device_id,updated_at')
        .eq('user_id', userId)
        .order('project_id', { ascending: true })
        .order('state_key', { ascending: true })
        .range(from, from + 999);
      if (result.error) throw result.error;
      rows.push(...(result.data || []));
      if ((result.data || []).length < 1000) return rows;
    }
  }

  async function fetchRemoteProjects(userId = cloud.user.id) {
    const [projects, states] = await Promise.all([
      fetchRemoteProjectRows(userId),
      fetchRemoteStateRows(userId)
    ]);
    return { projects, states: groupStateRows(states) };
  }

  function createConflictBackup(registry, localProject) {
    const now = new Date();
    const id = createProjectId();
    const name = localProject.name + '（同步衝突備份 ' + now.toLocaleString('zh-TW', { hour12: false }) + '）';
    const data = clone(localProject.data || {});
    const backup = {
      id,
      name,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      data,
      cloud: {
        userId: '',
        projectVersion: 0,
        stateVersions: {},
        dirtyKeys: Object.keys(data),
        metaDirty: true,
        cloudName: '',
        lastSyncedAt: ''
      }
    };
    registry.projects.push(backup);
    return backup;
  }

  function replaceWithRemote(localProject, remoteProject, remoteRows, userId) {
    const bundle = remoteStateBundle(remoteRows);
    localProject.name = remoteProject.name;
    localProject.createdAt = remoteProject.created_at || localProject.createdAt || new Date().toISOString();
    localProject.updatedAt = remoteProject.updated_at || new Date().toISOString();
    localProject.data = bundle.data;
    localProject.cloud = {
      userId,
      projectVersion: Number(remoteProject.version) || 1,
      stateVersions: bundle.versions,
      dirtyKeys: [],
      metaDirty: false,
      cloudName: remoteProject.name,
      lastSyncedAt: new Date().toISOString()
    };
  }

  function mergeRemoteIntoLinked(localProject, remoteProject, remoteRows, userId) {
    const metadata = projectCloud(localProject);
    const bundle = remoteStateBundle(remoteRows);
    const dirty = new Set(metadata.dirtyKeys);
    const remoteRowsByKey = new Map((remoteRows || []).map(row => [row.state_key, row]));
    let conflict = metadata.metaDirty && Number(remoteProject.version) !== Number(metadata.projectVersion);
    dirty.forEach(key => {
      const expected = Number(metadata.stateVersions[key]) || 0;
      const remoteVersion = Number(remoteRowsByKey.get(key)?.version) || 0;
      if (expected !== remoteVersion) conflict = true;
    });
    if (conflict) return false;

    if (!metadata.metaDirty && Number(remoteProject.version) >= Number(metadata.projectVersion)) {
      localProject.name = remoteProject.name;
      metadata.cloudName = remoteProject.name;
      metadata.projectVersion = Number(remoteProject.version) || 1;
    }
    (remoteRows || []).forEach(row => {
      const key = row.state_key;
      if (dirty.has(key) || !knownProjectKeys().includes(key)) return;
      const localVersion = Number(metadata.stateVersions[key]) || 0;
      if (Number(row.version) < localVersion) return;
      if (row.is_deleted) delete localProject.data[key];
      else localProject.data[key] = String(row.state_value ?? '');
      metadata.stateVersions[key] = Number(row.version) || 1;
    });
    Object.keys(localProject.data || {}).forEach(key => {
      if (!knownProjectKeys().includes(key)) return;
      if (!remoteRowsByKey.has(key) && !(Number(metadata.stateVersions[key]) > 0)) dirty.add(key);
    });
    metadata.dirtyKeys = [...dirty];
    metadata.userId = userId;
    metadata.lastSyncedAt = new Date().toISOString();
    return true;
  }

  function hydrateCurrentProject(message) {
    const current = getCurrentProject();
    if (!current) return;
    cloud.applyingRemote = true;
    try {
      restoreProjectState(current.data || {});
      refreshProjectWorkspace();
      cloud.originals.saveCurrentProject(false);
      renderProjectManager(message || '已套用雲端最新資料。', true);
    } finally {
      cloud.applyingRemote = false;
    }
  }

  async function reconcileRemoteBundle(remote, context) {
    assertSyncContext(context);
    const userId = context.userId;
    const registry = getProjectRegistry();
    const currentId = localStorage.getItem(CURRENT_PROJECT_KEY);
    const remoteById = new Map(remote.projects.map(row => [row.project_id, row]));
    let currentChanged = false;
    let conflictCreated = false;
    const attachmentBackups = [];

    remote.projects.forEach(remoteProject => {
      const rows = remote.states.get(remoteProject.project_id) || [];
      let localProject = registry.projects.find(item => item.id === remoteProject.project_id);
      if (!localProject) {
        localProject = {
          id: remoteProject.project_id,
          name: remoteProject.name,
          createdAt: remoteProject.created_at,
          updatedAt: remoteProject.updated_at,
          data: {}
        };
        replaceWithRemote(localProject, remoteProject, rows, userId);
        registry.projects.push(localProject);
        return;
      }

      const metadata = projectCloud(localProject);
      if (metadata.userId && metadata.userId !== userId) return;
      if (!metadata.userId) {
        const remoteData = remoteStateBundle(rows).data;
        const same = localProject.name === remoteProject.name && JSON.stringify(localProject.data || {}) === JSON.stringify(remoteData);
        if (!same) {
          const backup = createConflictBackup(registry, localProject);
          projectCloud(backup).userId = userId;
          attachmentBackups.push({ sourceProjectId: localProject.id, targetProjectId: backup.id });
          conflictCreated = true;
        }
        replaceWithRemote(localProject, remoteProject, rows, userId);
        if (localProject.id === currentId && !same) currentChanged = true;
        return;
      }

      const beforeName = localProject.name;
      const beforeData = JSON.stringify(localProject.data || {});
      if (!mergeRemoteIntoLinked(localProject, remoteProject, rows, userId)) {
        const backup = createConflictBackup(registry, localProject);
        projectCloud(backup).userId = userId;
        attachmentBackups.push({ sourceProjectId: localProject.id, targetProjectId: backup.id });
        replaceWithRemote(localProject, remoteProject, rows, userId);
        conflictCreated = true;
        if (localProject.id === currentId && (beforeName !== localProject.name || beforeData !== JSON.stringify(localProject.data || {}))) currentChanged = true;
      } else if (localProject.id === currentId) {
        currentChanged = beforeName !== localProject.name || beforeData !== JSON.stringify(localProject.data || {});
      }
    });

    if (remote.projects.length) {
      let attachmentProjectIds = new Set();
      let attachmentInspectionFailed = false;
      try {
        attachmentProjectIds = new Set((await getAllLocalAttachmentRecords()).map(record => record.projectId));
        assertSyncContext(context);
      } catch (error) {
        if (error instanceof StaleSyncError) throw error;
        attachmentInspectionFailed = true;
        console.warn('Unable to inspect local attachments before bootstrap cleanup', error);
      }
      let discardedCurrentBootstrap = false;
      registry.projects = registry.projects.filter(project => {
        const metadata = projectCloud(project);
        const discard = project.isBootstrap === true && !metadata.userId && !remoteById.has(project.id) && !attachmentInspectionFailed && !attachmentProjectIds.has(project.id);
        if (discard && project.id === currentId) discardedCurrentBootstrap = true;
        return !discard;
      });
      if (discardedCurrentBootstrap) {
        const replacement = registry.projects.find(project => projectCloud(project).userId === userId && remoteById.has(project.id));
        if (replacement) {
          localStorage.setItem(CURRENT_PROJECT_KEY, replacement.id);
          currentChanged = true;
        }
      }
    }

    registry.projects.forEach(project => {
      if (!projectEligibleForUser(project, userId)) return;
      const metadata = projectCloud(project);
      const remoteProject = remoteById.get(project.id);
      if (!remoteProject) {
        if (project.isBootstrap === true && !metadata.userId) return;
        metadata.userId = userId;
        metadata.projectVersion = 0;
        metadata.stateVersions = {};
        metadata.dirtyKeys = Array.from(new Set([...metadata.dirtyKeys, ...Object.keys(project.data || {})]));
        metadata.metaDirty = true;
      }
    });

    assertSyncContext(context);
    saveRegistryQuietly(registry);
    for (const pair of attachmentBackups) {
      try {
        await copyProjectAttachments(pair.sourceProjectId, pair.targetProjectId, userId);
        assertSyncContext(context);
      } catch (error) {
        if (error instanceof StaleSyncError) throw error;
        console.warn('Unable to copy local attachments into conflict backup', error);
      }
    }
    assertSyncContext(context);
    if (currentChanged) hydrateCurrentProject(conflictCreated ? '偵測到其他裝置更新；本機工作資料已另存為衝突備份。' : '已載入雲端最新資料。');
    else renderProjectManager('', false);
    if (conflictCreated) cloud.conflictMessage = '偵測到其他裝置更新；已保留本機工作資料備份';
  }

  async function insertRemoteProject(project, context) {
    assertSyncContext(context);
    const payload = {
      user_id: context.userId,
      project_id: project.id,
      name: project.name,
      schema_version: Number(config.schemaVersion) || 1,
      version: 1,
      device_id: cloud.deviceId,
      created_at: project.createdAt || new Date().toISOString()
    };
    const { data, error } = await cloud.client.from(config.projectTable).insert(payload).select().single();
    assertSyncContext(context);
    if (error) {
      if (error.code === '23505') throw new CloudConflictError(project.id);
      throw error;
    }
    return data;
  }

  async function updateRemoteProjectName(project, context) {
    assertSyncContext(context);
    const metadata = projectCloud(project);
    if (!metadata.metaDirty) return null;
    const expected = Number(metadata.projectVersion) || 0;
    if (!expected) return insertRemoteProject(project, context);
    const { data, error } = await cloud.client.from(config.projectTable)
      .update({ name: project.name, version: expected + 1, device_id: cloud.deviceId })
      .eq('user_id', context.userId)
      .eq('project_id', project.id)
      .eq('version', expected)
      .select()
      .maybeSingle();
    assertSyncContext(context);
    if (error) throw error;
    if (!data) throw new CloudConflictError(project.id);
    return data;
  }

  async function pushProjectStateKey(project, key, context) {
    assertSyncContext(context);
    const metadata = projectCloud(project);
    const expected = Number(metadata.stateVersions[key]) || 0;
    const hasValue = Object.prototype.hasOwnProperty.call(project.data || {}, key);
    const payload = {
      user_id: context.userId,
      project_id: project.id,
      state_key: key,
      state_value: hasValue ? String(project.data[key]) : '',
      is_deleted: !hasValue,
      version: expected + 1,
      device_id: cloud.deviceId
    };
    let result;
    if (!expected) {
      result = await cloud.client.from(config.stateTable).insert(payload).select().single();
      if (result.error?.code === '23505') throw new CloudConflictError(project.id);
    } else {
      result = await cloud.client.from(config.stateTable)
        .update({
          state_value: payload.state_value,
          is_deleted: payload.is_deleted,
          version: payload.version,
          device_id: payload.device_id
        })
        .eq('user_id', context.userId)
        .eq('project_id', project.id)
        .eq('state_key', key)
        .eq('version', expected)
        .select()
        .maybeSingle();
    }
    assertSyncContext(context);
    if (result.error) throw result.error;
    if (!result.data) throw new CloudConflictError(project.id);
    return {
      row: result.data,
      expected,
      hadValue: hasValue,
      sentValue: payload.state_value
    };
  }

  async function pushProjectById(projectId, context) {
    assertSyncContext(context);
    let project = getProjectRegistry().projects.find(item => item.id === projectId);
    if (!project || !projectEligibleForUser(project, context.userId)) return;
    let metadata = projectCloud(project);
    if (!metadata.projectVersion) {
      const sentName = project.name;
      const data = await insertRemoteProject(project, context);
      updateLocalProject(projectId, (fresh, freshMetadata) => {
        freshMetadata.userId = context.userId;
        freshMetadata.projectVersion = Number(data.version) || 1;
        freshMetadata.cloudName = data.name;
        freshMetadata.metaDirty = fresh.name !== sentName;
      });
    }

    project = getProjectRegistry().projects.find(item => item.id === projectId);
    metadata = projectCloud(project);
    if (metadata.metaDirty) {
      const sentName = project.name;
      const data = await updateRemoteProjectName(project, context);
      if (data) {
        updateLocalProject(projectId, (fresh, freshMetadata) => {
          freshMetadata.userId = context.userId;
          freshMetadata.projectVersion = Number(data.version) || freshMetadata.projectVersion + 1;
          freshMetadata.cloudName = data.name;
          freshMetadata.metaDirty = fresh.name !== sentName;
        });
      }
    }

    project = getProjectRegistry().projects.find(item => item.id === projectId);
    metadata = projectCloud(project);
    for (const key of [...metadata.dirtyKeys]) {
      project = getProjectRegistry().projects.find(item => item.id === projectId);
      if (!project) return;
      const result = await pushProjectStateKey(project, key, context);
      updateLocalProject(projectId, (fresh, freshMetadata) => {
        freshMetadata.userId = context.userId;
        freshMetadata.stateVersions[key] = Number(result.row.version) || result.expected + 1;
        const hasCurrentValue = Object.prototype.hasOwnProperty.call(fresh.data || {}, key);
        const unchanged = hasCurrentValue === result.hadValue && (!hasCurrentValue || String(fresh.data[key]) === result.sentValue);
        if (unchanged) freshMetadata.dirtyKeys = freshMetadata.dirtyKeys.filter(item => item !== key);
        else freshMetadata.dirtyKeys = Array.from(new Set([...freshMetadata.dirtyKeys, key]));
      });
    }
    const syncedAt = new Date().toISOString();
    updateLocalProject(projectId, (fresh, freshMetadata) => {
      freshMetadata.userId = context.userId;
      freshMetadata.lastSyncedAt = syncedAt;
      fresh.updatedAt = fresh.updatedAt || syncedAt;
    });
  }

  async function recoverProjectConflict(projectId, context) {
    assertSyncContext(context);
    const [projectResult, statesResult] = await Promise.all([
      cloud.client.from(config.projectTable).select('*').eq('user_id', context.userId).eq('project_id', projectId).maybeSingle(),
      cloud.client.from(config.stateTable).select('*').eq('user_id', context.userId).eq('project_id', projectId).limit(200)
    ]);
    assertSyncContext(context);
    if (projectResult.error) throw projectResult.error;
    if (statesResult.error) throw statesResult.error;
    if (!projectResult.data) return;
    const registry = getProjectRegistry();
    const project = registry.projects.find(item => item.id === projectId);
    if (!project) return;
    createConflictBackup(registry, project);
    const backup = registry.projects[registry.projects.length - 1];
    projectCloud(backup).userId = context.userId;
    replaceWithRemote(project, projectResult.data, statesResult.data || [], context.userId);
    saveRegistryQuietly(registry);
    try {
      await copyProjectAttachments(projectId, backup.id, context.userId);
    } catch (error) {
      console.warn('Unable to copy local attachments into conflict backup', error);
    }
    if (localStorage.getItem(CURRENT_PROJECT_KEY) === projectId) hydrateCurrentProject('同步衝突已處理；本機工作資料另存為備份，並載入雲端版本。');
    cloud.conflictMessage = '同步衝突已保留本機工作資料備份';
    cloud.syncRequested = true;
  }

  async function syncAllProjects(options = {}) {
    if (!cloud.user || cloud.applyingRemote) return;
    if (cloud.syncing) {
      cloud.syncRequested = true;
      return;
    }
    if (!navigator.onLine) {
      updateCloudUi();
      return;
    }
    const context = { userId: cloud.user.id, epoch: cloud.sessionEpoch };
    captureLiveProjectChanges();
    cloud.syncing = true;
    cloud.syncRequested = false;
    cloud.conflictMessage = '';
    cloud.errorMessage = '';
    updateCloudUi();
    try {
      const remote = await fetchRemoteProjects(context.userId);
      assertSyncContext(context);
      await reconcileRemoteBundle(remote, context);
      assertSyncContext(context);
      const registry = getProjectRegistry();
      for (const project of registry.projects) {
        assertSyncContext(context);
        if (!projectEligibleForUser(project, context.userId)) continue;
        const metadata = projectCloud(project);
        if (project.isBootstrap === true && !metadata.userId) continue;
        if (!metadata.projectVersion || metadata.metaDirty || metadata.dirtyKeys.length) {
          try {
            await pushProjectById(project.id, context);
          } catch (error) {
            if (error instanceof CloudConflictError) await recoverProjectConflict(error.projectId, context);
            else throw error;
          }
        }
      }
      assertSyncContext(context);
      const deletionResult = await flushAttachmentDeleteQueue(context);
      assertSyncContext(context);
      const uploadResult = await flushLocalAttachments(context);
      assertSyncContext(context);
      cloud.pendingAttachments = Number(deletionResult?.pendingDeletes || 0) + Number(uploadResult?.pendingUploads || 0);
      cloud.lastSyncedAt = new Date().toISOString();
      const current = getCurrentProject();
      if (current?.isBootstrap && !projectCloud(current).userId) cloud.lastSyncedAt = null;
      else if (current) updateLocalProject(current.id, (project, metadata) => { metadata.lastSyncedAt = cloud.lastSyncedAt; });
      if (!cloud.conflictMessage && !cloud.pendingAttachments) setCloudStatus('synced', '已同步', '立即同步');
    } catch (error) {
      if (error instanceof StaleSyncError) cloud.syncRequested = true;
      else showCloudError(error, options.source === 'manual' ? '同步失敗' : '自動同步失敗');
    } finally {
      cloud.syncing = false;
      updateCloudUi();
      if (cloud.syncRequested && cloud.user && navigator.onLine) {
        cloud.syncRequested = false;
        scheduleCloudSync(50);
      }
    }
  }

  function scheduleRemoteRefresh() {
    if (!cloud.user || cloud.applyingRemote) return;
    if (cloud.syncing) {
      cloud.syncRequested = true;
      return;
    }
    clearTimeout(cloud.remoteTimer);
    cloud.remoteTimer = setTimeout(() => syncAllProjects({ source: 'realtime' }), 450);
  }

  async function subscribeRealtime(contextArgument) {
    if (!cloud.user || !cloud.client) return;
    const context = currentSyncContext(contextArgument);
    const previousChannel = cloud.realtimeChannel;
    if (previousChannel) {
      await cloud.client.removeChannel(previousChannel);
      assertSyncContext(context);
      if (cloud.realtimeChannel === previousChannel) cloud.realtimeChannel = null;
    }
    const filter = 'user_id=eq.' + context.userId;
    const channel = cloud.client.channel('workflow-sync-' + context.userId)
      .on('postgres_changes', { event: '*', schema: 'public', table: config.projectTable, filter }, payload => {
        if (!isCurrentSyncContext(context) || (payload.new || payload.old)?.device_id === cloud.deviceId) return;
        scheduleRemoteRefresh();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: config.stateTable, filter }, payload => {
        if (!isCurrentSyncContext(context) || (payload.new || payload.old)?.device_id === cloud.deviceId) return;
        scheduleRemoteRefresh();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: config.attachmentTable, filter }, payload => {
        if (!isCurrentSyncContext(context)) return;
        const refreshAttachments = async () => {
          if (payload.eventType === 'DELETE' && payload.old?.id) {
            cloud.deletedAttachmentIds.add(payload.old.id);
            await deleteLocalAttachmentRecord(payload.old.id);
          }
          if (!isCurrentSyncContext(context)) return;
          if (typeof practiceMode !== 'undefined' && practiceMode === 'meetings' && typeof renderMeetingAttachments === 'function') {
            renderMeetingAttachments(activeMeetingId);
          }
        };
        refreshAttachments().catch(error => console.warn('Unable to refresh realtime attachments', error));
      });
    cloud.realtimeChannel = channel;
    channel.subscribe(status => {
      if (!isCurrentSyncContext(context) || cloud.realtimeChannel !== channel) return;
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        cloud.errorMessage = '即時同步連線中斷，將自動重試';
        updateCloudUi();
      }
    });
  }

  async function handleSession(session) {
    const previousUserId = cloud.user?.id || '';
    const nextUserId = session?.user?.id || '';
    if (previousUserId !== nextUserId) {
      cloud.sessionEpoch += 1;
      cloud.deletedAttachmentIds.clear();
    }
    cloud.session = session || null;
    cloud.user = session?.user || null;
    readAttachmentDeleteQueue()
      .filter(item => !cloud.user || item.userId === cloud.user.id)
      .forEach(item => cloud.deletedAttachmentIds.add(item.id));
    if (!cloud.user) {
      cloud.conflictMessage = '';
      cloud.errorMessage = '';
      cloud.lastSyncedAt = null;
      cloud.pendingAttachments = 0;
      const channelToRemove = cloud.realtimeChannel;
      if (channelToRemove) {
        await cloud.client.removeChannel(channelToRemove);
        if (cloud.realtimeChannel === channelToRemove) cloud.realtimeChannel = null;
      }
      updateCloudUi();
      return;
    }
    const context = { userId: cloud.user.id, epoch: cloud.sessionEpoch };
    if (previousUserId !== cloud.user.id) {
      const current = getCurrentProject?.();
      const metadata = current ? projectCloud(current) : null;
      cloud.lastSyncedAt = metadata?.userId === cloud.user.id ? metadata.lastSyncedAt || null : null;
      cloud.pendingAttachments = 0;
    }
    cloud.errorMessage = '';
    try {
      if (previousUserId !== cloud.user.id || !cloud.realtimeChannel) await subscribeRealtime(context);
      assertSyncContext(context);
    } catch (error) {
      if (error instanceof StaleSyncError) return;
      throw error;
    }
    updateCloudUi();
    await syncAllProjects({ source: 'session' });
  }

  function bindExistingProjectFunctions() {
    cloud.originals.saveCurrentProject = saveCurrentProject;
    cloud.originals.registerNewProject = registerNewProject;
    cloud.originals.renameCurrentProject = renameCurrentProject;
    cloud.originals.switchProject = switchProject;
    cloud.originals.getMeetingAttachments = getMeetingAttachments;
    cloud.originals.saveMeetingAttachments = saveMeetingAttachments;
    cloud.originals.deleteMeetingAttachment = deleteMeetingAttachment;
    cloud.originals.deleteMeetingAttachmentsForMeeting = deleteMeetingAttachmentsForMeeting;
    cloud.originals.downloadMeetingAttachment = downloadMeetingAttachment;
    cloud.originals.shareMeetingSchedule = shareMeetingSchedule;

    saveCurrentProject = function (showMessage = true) {
      if (cloud.applyingRemote) return cloud.originals.saveCurrentProject(showMessage);
      if (showMessage) markCurrentProjectUsed();
      const before = clone(getCurrentProject()?.data || {});
      const result = cloud.originals.saveCurrentProject(showMessage);
      const afterProject = getCurrentProject();
      if (afterProject) markProjectDirty(afterProject.id, differenceKeys(before, afterProject.data || {}), false);
      return result;
    };

    registerNewProject = async function () {
      const previousProject = getCurrentProject();
      const disposableBootstrapId = previousProject?.isBootstrap ? previousProject.id : '';
      await cloud.originals.registerNewProject();
      const project = getCurrentProject();
      if (disposableBootstrapId && project?.id !== disposableBootstrapId) {
        const registry = getProjectRegistry();
        registry.projects = registry.projects.filter(item => item.id !== disposableBootstrapId);
        saveRegistryQuietly(registry);
        renderProjectManager('', false);
      }
      cloud.lastSyncedAt = null;
      if (project) markProjectDirty(project.id, Object.keys(project.data || {}), true);
    };

    renameCurrentProject = async function () {
      const before = getCurrentProject()?.name;
      await cloud.originals.renameCurrentProject();
      const project = getCurrentProject();
      if (project && project.name !== before) {
        markCurrentProjectUsed();
        markProjectDirty(project.id, [], true);
      }
    };

    switchProject = function (projectId) {
      captureLiveProjectChanges();
      cloud.originals.switchProject(projectId);
      const project = getCurrentProject();
      const metadata = project ? projectCloud(project) : null;
      cloud.lastSyncedAt = metadata && (!metadata.userId || metadata.userId === cloud.user?.id) ? metadata.lastSyncedAt || null : null;
      updateCloudUi();
      scheduleCloudSync(250);
    };
  }

  function bindCloudUi() {
    const elements = ui();
    elements.primary?.addEventListener('click', () => {
      if (!cloud.client) {
        location.reload();
        return;
      }
      if (cloud.user) syncAllProjects({ source: 'manual' });
      else openAuthDialog();
    });
    elements.signOut?.addEventListener('click', async () => {
      try {
        await cloud.client.auth.signOut({ scope: 'local' });
      } catch (error) {
        showCloudError(error, '登出失敗');
      }
    });
    elements.form?.addEventListener('submit', submitAuth);
    document.querySelector('#cloudAuthSignup')?.addEventListener('click', event => runAuth('signup', event.currentTarget));
    document.querySelector('#cloudAuthCancel')?.addEventListener('click', closeAuthDialog);
    document.querySelector('#textEntryForm')?.addEventListener('submit', () => {
      if (document.querySelector('#textEntryTitle')?.textContent !== '新案登錄') markCurrentProjectUsed();
    }, true);
    document.querySelector('#applyScenario')?.addEventListener('click', markCurrentProjectUsed, true);
    document.querySelectorAll('[data-scenario]').forEach(button => button.addEventListener('click', markCurrentProjectUsed, true));
    elements.dialog?.addEventListener('close', () => {
      elements.error.textContent = '';
      elements.error.classList.remove('success');
      elements.password.value = '';
    });
    const recordProjectInput = () => {
      setTimeout(() => {
        const changed = captureLiveProjectChanges();
        if (changed.length) markCurrentProjectUsed();
      }, 0);
    };
    document.addEventListener('input', recordProjectInput, true);
    document.addEventListener('change', recordProjectInput, true);
    document.addEventListener('click', event => {
      if (event.target.closest('#cloudSyncPanel,#cloudAuthDialog,.controls,.project-manager,#textEntryModal')) return;
      setTimeout(() => {
        const changed = captureLiveProjectChanges();
        if (changed.length) markCurrentProjectUsed();
      }, 0);
    }, true);
    window.addEventListener('online', () => {
      updateCloudUi();
      scheduleCloudSync(100);
    });
    window.addEventListener('offline', updateCloudUi);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') captureLiveProjectChanges();
      else if (cloud.user) scheduleCloudSync(100);
    });
  }

  async function initializeCloudSync() {
    bindCloudUi();
    if (!config.url || !config.publishableKey || !window.supabase?.createClient) {
      cloud.errorMessage = '雲端同步元件載入失敗';
      setCloudStatus('error', cloud.errorMessage, '重試');
      return;
    }
    bindExistingProjectFunctions();
    installAttachmentOverrides();
    cloud.client = window.supabase.createClient(config.url, config.publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: AUTH_STORAGE_KEY
      },
      realtime: { params: { eventsPerSecond: 5 } }
    });
    cloud.client.auth.onAuthStateChange((_event, session) => {
      setTimeout(() => handleSession(session).catch(error => {
        if (!(error instanceof StaleSyncError)) showCloudError(error, '登入狀態更新失敗');
      }), 0);
    });
    cloud.pollTimer = setInterval(captureLiveProjectChanges, CHANGE_POLL_MS);
    const { data, error } = await cloud.client.auth.getSession();
    if (error) showCloudError(error, '登入狀態讀取失敗');
    else {
      try {
        await handleSession(data.session);
      } catch (sessionError) {
        if (!(sessionError instanceof StaleSyncError)) showCloudError(sessionError, '登入狀態更新失敗');
      }
    }
    cloud.initialized = true;
    updateCloudUi();
  }

  window.BuildingWorkflowCloud = {
    syncNow: () => syncAllProjects({ source: 'manual' }),
    openLogin: openAuthDialog,
    getStatus: () => ({
      signedIn: Boolean(cloud.user),
      email: cloud.user?.email || '',
      syncing: cloud.syncing,
      lastSyncedAt: cloud.lastSyncedAt,
      deviceId: cloud.deviceId
    }),
    flushAttachments: () => flushLocalAttachments()
  };

  initializeCloudSync().catch(error => showCloudError(error, '雲端同步初始化失敗'));

  function openAttachmentStore(mode) {
    return openMeetingAttachmentDB().then(db => ({
      db,
      transaction: db.transaction(MEETING_ATTACHMENT_STORE, mode)
    }));
  }

  async function getLocalAttachmentRecord(attachmentId) {
    const { db, transaction } = await openAttachmentStore('readonly');
    return new Promise((resolve, reject) => {
      const request = transaction.objectStore(MEETING_ATTACHMENT_STORE).get(attachmentId);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => db.close();
    });
  }

  async function getAllLocalAttachmentRecords() {
    const { db, transaction } = await openAttachmentStore('readonly');
    return new Promise((resolve, reject) => {
      const request = transaction.objectStore(MEETING_ATTACHMENT_STORE).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => db.close();
    });
  }

  async function putLocalAttachmentRecord(record) {
    const { db, transaction } = await openAttachmentStore('readwrite');
    return new Promise((resolve, reject) => {
      transaction.objectStore(MEETING_ATTACHMENT_STORE).put(record);
      transaction.oncomplete = () => {
        db.close();
        resolve(record);
      };
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  async function copyProjectAttachments(sourceProjectId, targetProjectId, userId) {
    const records = await getAllLocalAttachmentRecords();
    const sourceRecords = records.filter(record => record.projectId === sourceProjectId && record.blob instanceof Blob);
    for (const record of sourceRecords) {
      const id = crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2);
      await putLocalAttachmentRecord({
        ...record,
        id,
        projectId: targetProjectId,
        uploadedAt: new Date().toISOString(),
        remotePath: '',
        cloudUserId: userId,
        cloudSynced: false,
        cloudError: ''
      });
    }
    return sourceRecords.length;
  }

  async function deleteLocalAttachmentRecord(attachmentId) {
    const { db, transaction } = await openAttachmentStore('readwrite');
    return new Promise((resolve, reject) => {
      transaction.objectStore(MEETING_ATTACHMENT_STORE).delete(attachmentId);
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  function attachmentPathSegment(value, label) {
    const segment = String(value || '');
    if (!segment || segment.includes('/') || segment.includes('\\')) throw new Error(label + '格式不適合雲端附件路徑。');
    return segment;
  }

  function safeAttachmentName(name) {
    const cleaned = String(name || 'attachment')
      .replace(/[\\/\u0000-\u001f\u007f]+/g, '_')
      .replace(/^\.+/, '')
      .slice(0, 180);
    return cleaned || 'attachment';
  }

  function remoteAttachmentToRecord(row) {
    return {
      id: row.id,
      projectId: row.project_id,
      meetingId: row.meeting_id,
      name: row.original_name,
      type: row.mime_type || 'application/octet-stream',
      size: Number(row.size_bytes) || 0,
      uploadedAt: row.uploaded_at,
      remotePath: row.object_path,
      cloudUserId: row.user_id,
      cloudCreatedAt: row.created_at || '',
      cloudSeenAt: Date.now(),
      cloudSynced: true
    };
  }

  async function fetchRemoteAttachments(projectId, meetingId, contextArgument) {
    const context = currentSyncContext(contextArgument);
    if (!context) return { records: [], scanStartedAt: Date.now() };
    const scanStartedAt = Date.now();
    const rows = [];
    let lastId = '';
    while (true) {
      assertSyncContext(context);
      let query = cloud.client.from(config.attachmentTable)
        .select('user_id,id,project_id,meeting_id,object_path,original_name,mime_type,size_bytes,uploaded_at,created_at')
        .eq('user_id', context.userId)
        .eq('project_id', projectId)
        .order('id', { ascending: true })
        .limit(500);
      if (meetingId) query = query.eq('meeting_id', meetingId);
      if (lastId) query = query.gt('id', lastId);
      const { data, error } = await query;
      assertSyncContext(context);
      if (error) throw error;
      rows.push(...(data || []));
      if ((data || []).length < 500) return { records: rows.map(remoteAttachmentToRecord), scanStartedAt };
      lastId = data[data.length - 1].id;
    }
  }

  async function fetchRemoteAttachmentById(attachmentId, contextArgument) {
    const context = currentSyncContext(contextArgument);
    if (!context) return null;
    const { data, error } = await cloud.client.from(config.attachmentTable)
      .select('user_id,id,project_id,meeting_id,object_path,original_name,mime_type,size_bytes,uploaded_at,created_at')
      .eq('user_id', context.userId)
      .eq('id', attachmentId)
      .maybeSingle();
    assertSyncContext(context);
    if (error) throw error;
    return data ? remoteAttachmentToRecord(data) : null;
  }

  async function ensureAttachmentBlob(record, contextArgument) {
    if (record?.id && cloud.deletedAttachmentIds.has(record.id)) throw new Error('此附件已刪除。');
    const context = currentSyncContext(contextArgument);
    if (record?.cloudUserId && (!context || record.cloudUserId !== context.userId)) throw new Error('請登入此附件所屬的雲端帳號。');
    if (record?.blob instanceof Blob) {
      if (context && navigator.onLine && record.cloudSynced && record.remotePath) {
        const confirmed = await fetchRemoteAttachmentById(record.id, context);
        if (!confirmed || cloud.deletedAttachmentIds.has(record.id)) throw new Error('此附件已從雲端刪除。');
        const cached = { ...record, ...confirmed, blob: record.blob };
        await putLocalAttachmentRecord(cached);
        assertSyncContext(context);
        if (cloud.deletedAttachmentIds.has(record.id)) {
          await deleteLocalAttachmentRecord(record.id);
          throw new Error('此附件已刪除。');
        }
        return cached;
      }
      return record;
    }
    if (!record?.remotePath || !context) throw new Error('找不到附件的雲端檔案。');
    const { data, error } = await cloud.client.storage.from(config.attachmentBucket).download(record.remotePath);
    assertSyncContext(context);
    if (error) throw error;
    if (cloud.deletedAttachmentIds.has(record.id)) throw new Error('此附件已刪除。');
    const confirmed = await fetchRemoteAttachmentById(record.id, context);
    if (!confirmed || cloud.deletedAttachmentIds.has(record.id)) throw new Error('此附件已從雲端刪除。');
    const cached = { ...record, ...confirmed, blob: data, cloudSynced: true, cloudUserId: context.userId };
    await putLocalAttachmentRecord(cached);
    assertSyncContext(context);
    if (cloud.deletedAttachmentIds.has(record.id)) {
      await deleteLocalAttachmentRecord(record.id);
      throw new Error('此附件已刪除。');
    }
    return cached;
  }

  async function ensureRemoteProjectBeforeAttachment(projectId, contextArgument) {
    const context = currentSyncContext(contextArgument);
    if (!context) throw new Error('請先登入雲端同步。');
    const project = getProjectRegistry().projects.find(item => item.id === projectId);
    if (!project || !projectEligibleForUser(project, context.userId)) throw new Error('此專案尚未連結目前的雲端帳號。');
    if (!projectCloud(project).projectVersion) {
      try {
        await pushProjectById(projectId, context);
      } catch (error) {
        if (error instanceof CloudConflictError) await recoverProjectConflict(projectId, context);
        else throw error;
      }
      assertSyncContext(context);
    }
  }

  async function uploadLocalAttachment(record, contextArgument) {
    const context = currentSyncContext(contextArgument);
    if (!context || !(record.blob instanceof Blob)) return record;
    if (record.cloudSynced && record.cloudUserId === context.userId && record.remotePath) return record;
    await ensureRemoteProjectBeforeAttachment(record.projectId, context);
    assertSyncContext(context);

    const existing = await fetchRemoteAttachmentById(record.id, context);
    if (existing) {
      const linked = { ...record, ...existing, blob: record.blob, remotePath: existing.remotePath, cloudUserId: context.userId, cloudSynced: true, cloudError: '' };
      const saved = await putLocalAttachmentRecord(linked);
      assertSyncContext(context);
      return saved;
    }

    const userSegment = attachmentPathSegment(context.userId, '使用者');
    const projectSegment = attachmentPathSegment(record.projectId, '專案編號');
    const meetingSegment = attachmentPathSegment(record.meetingId, '會議編號');
    const attachmentSegment = attachmentPathSegment(record.id, '附件編號');
    const objectPath = [userSegment, projectSegment, meetingSegment, attachmentSegment, safeAttachmentName(record.name)].join('/');
    const { error: uploadError } = await cloud.client.storage.from(config.attachmentBucket).upload(objectPath, record.blob, {
      contentType: record.type || 'application/octet-stream',
      cacheControl: '3600',
      upsert: true
    });
    assertSyncContext(context);
    if (uploadError) throw uploadError;

    const metadata = {
      user_id: context.userId,
      id: record.id,
      project_id: record.projectId,
      meeting_id: record.meetingId,
      object_path: objectPath,
      original_name: record.name,
      mime_type: record.type || 'application/octet-stream',
      size_bytes: Number(record.size) || record.blob.size || 0,
      uploaded_at: record.uploadedAt || new Date().toISOString()
    };
    const { data: metadataRow, error: metadataError } = await cloud.client.from(config.attachmentTable)
      .upsert(metadata, { onConflict: 'user_id,id' })
      .select('created_at')
      .single();
    assertSyncContext(context);
    if (metadataError) throw metadataError;
    const synced = {
      ...record,
      remotePath: objectPath,
      cloudUserId: context.userId,
      cloudCreatedAt: metadataRow?.created_at || '',
      cloudSeenAt: Date.now(),
      cloudSynced: true,
      cloudError: ''
    };
    const saved = await putLocalAttachmentRecord(synced);
    assertSyncContext(context);
    return saved;
  }

  async function flushLocalAttachments(contextArgument) {
    const context = currentSyncContext(contextArgument);
    if (!context) return { pendingUploads: 0 };
    let records = [];
    try {
      records = await getAllLocalAttachmentRecords();
      assertSyncContext(context);
    } catch (error) {
      if (error instanceof StaleSyncError) throw error;
      console.warn('Unable to read local attachment queue', error);
      return { pendingUploads: 1 };
    }
    const registry = getProjectRegistry();
    const shouldUpload = record => {
      const project = registry.projects.find(item => item.id === record.projectId);
      if (!project || !projectEligibleForUser(project, context.userId)) return false;
      return !(record.cloudSynced && record.cloudUserId === context.userId && record.remotePath);
    };
    if (!navigator.onLine) return { pendingUploads: records.filter(shouldUpload).length };
    let pendingUploads = 0;
    for (const record of records) {
      if (!shouldUpload(record)) continue;
      if (!(record.blob instanceof Blob)) {
        pendingUploads += 1;
        continue;
      }
      try {
        await uploadLocalAttachment(record, context);
      } catch (error) {
        if (error instanceof StaleSyncError) throw error;
        pendingUploads += 1;
        await putLocalAttachmentRecord({ ...record, cloudSynced: false, cloudError: error?.message || String(error) });
        console.warn('Attachment upload deferred', error);
      }
    }
    return { pendingUploads };
  }

  function readAttachmentDeleteQueue() {
    const items = new Map();
    try {
      const legacy = JSON.parse(localStorage.getItem(ATTACHMENT_DELETE_QUEUE_KEY) || '[]');
      if (Array.isArray(legacy)) {
        legacy.forEach(item => {
          if (!item?.userId || !item?.id) return;
          const key = attachmentDeleteStorageKey(item.userId, item.id);
          if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(item));
        });
      }
      localStorage.removeItem(ATTACHMENT_DELETE_QUEUE_KEY);
    } catch (error) {
      console.warn('Unable to migrate the legacy attachment delete queue', error);
    }
    const keys = [];
    try {
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (key?.startsWith(ATTACHMENT_DELETE_ITEM_PREFIX)) keys.push(key);
      }
      keys.forEach(key => {
        try {
          const item = JSON.parse(localStorage.getItem(key) || 'null');
          if (item?.userId && item?.id) items.set(item.userId + ':' + item.id, item);
          else localStorage.removeItem(key);
        } catch (error) {
          localStorage.removeItem(key);
        }
      });
    } catch (error) {
      console.warn('Unable to read the attachment delete queue', error);
    }
    return [...items.values()];
  }

  function attachmentDeleteStorageKey(userId, attachmentId) {
    return ATTACHMENT_DELETE_ITEM_PREFIX + encodeURIComponent(userId) + ':' + encodeURIComponent(attachmentId);
  }

  function queueAttachmentDelete(record) {
    const userId = record?.cloudUserId || cloud.user?.id || '';
    if (!userId || !record?.id) return false;
    const key = attachmentDeleteStorageKey(userId, record.id);
    if (localStorage.getItem(key)) return false;
    localStorage.setItem(key, JSON.stringify({ userId, id: record.id, objectPath: record.remotePath || '', queuedAt: new Date().toISOString() }));
    return true;
  }

  async function deleteRemoteAttachment(record, contextArgument) {
    const context = currentSyncContext(contextArgument);
    if (!context || !record) return;
    if (record.cloudUserId && record.cloudUserId !== context.userId) throw new Error('此附件屬於其他雲端帳號。');
    const existing = await fetchRemoteAttachmentById(record.id, context);
    const remote = existing || record;
    if (!remote) return;
    if (remote.remotePath) {
      const { error: storageError } = await cloud.client.storage.from(config.attachmentBucket).remove([remote.remotePath]);
      assertSyncContext(context);
      if (storageError && Number(storageError.statusCode) !== 404) throw storageError;
    }
    const { data, error } = await cloud.client.from(config.attachmentTable)
      .delete()
      .eq('user_id', context.userId)
      .eq('id', remote.id)
      .select('id');
    assertSyncContext(context);
    if (error) throw error;
    if (existing && !(data || []).some(row => row.id === existing.id)) throw new Error('附件雲端刪除尚未完成，將稍後重試。');
    cloud.deletedAttachmentIds.add(record.id);
  }

  async function flushAttachmentDeleteQueue(contextArgument) {
    const context = currentSyncContext(contextArgument);
    if (!context) return { pendingDeletes: 0 };
    const queue = readAttachmentDeleteQueue();
    if (!navigator.onLine) return { pendingDeletes: queue.filter(item => item.userId === context.userId).length };
    const completed = new Set();
    for (const item of queue) {
      if (item.userId !== context.userId) continue;
      try {
        await deleteRemoteAttachment({ id: item.id, remotePath: item.objectPath, cloudUserId: item.userId }, context);
        await deleteLocalAttachmentRecord(item.id);
        completed.add(attachmentDeleteStorageKey(item.userId, item.id));
      } catch (error) {
        if (error instanceof StaleSyncError) throw error;
        console.warn('Attachment deletion deferred', error);
      }
    }
    assertSyncContext(context);
    completed.forEach(storageKey => localStorage.removeItem(storageKey));
    const remaining = readAttachmentDeleteQueue();
    return { pendingDeletes: remaining.filter(item => item.userId === context.userId).length };
  }

  function installAttachmentOverrides() {
    getMeetingAttachments = async function (meetingId) {
      let local = [];
      try {
        local = await cloud.originals.getMeetingAttachments(meetingId);
      } catch (error) {
        console.warn(error);
      }
      local = local.filter(record => !cloud.deletedAttachmentIds.has(record.id));
      if (!cloud.user || !navigator.onLine) return local;
      const context = currentSyncContext();
      try {
        const remoteBundle = await fetchRemoteAttachments(currentMeetingProjectId(), meetingId, context);
        assertSyncContext(context);
        const remote = remoteBundle.records.filter(record => !cloud.deletedAttachmentIds.has(record.id));
        const remoteIds = new Set(remote.map(record => record.id));
        const staleRemoteCache = local.filter(record =>
          record.cloudSynced &&
          record.cloudUserId === context.userId &&
          record.remotePath &&
          record.cloudCreatedAt &&
          Number(record.cloudSeenAt) < remoteBundle.scanStartedAt &&
          !remoteIds.has(record.id)
        );
        if (staleRemoteCache.length) {
          staleRemoteCache.forEach(record => cloud.deletedAttachmentIds.add(record.id));
          await Promise.all(staleRemoteCache.map(record => deleteLocalAttachmentRecord(record.id)));
          const staleIds = new Set(staleRemoteCache.map(record => record.id));
          local = local.filter(record => !staleIds.has(record.id));
        }
        const merged = new Map(local.map(record => [record.id, record]));
        const cacheWrites = [];
        remote.forEach(record => {
          const cached = merged.get(record.id);
          if (cached) {
            const linked = { ...cached, ...record, blob: cached.blob, cloudUserId: context.userId, cloudSynced: true, cloudError: '' };
            merged.set(record.id, linked);
            if (linked.blob instanceof Blob) cacheWrites.push(putLocalAttachmentRecord(linked).catch(console.warn));
          } else merged.set(record.id, record);
        });
        await Promise.all(cacheWrites);
        assertSyncContext(context);
        return [...merged.values()].sort((a, b) => String(b.uploadedAt).localeCompare(String(a.uploadedAt)));
      } catch (error) {
        if (error instanceof StaleSyncError) return local;
        console.warn('Remote attachments unavailable; using local cache', error);
        return local;
      }
    };

    saveMeetingAttachments = async function (meetingId, fileList) {
      const before = await cloud.originals.getMeetingAttachments(meetingId).catch(() => []);
      await cloud.originals.saveMeetingAttachments(meetingId, fileList);
      const after = await cloud.originals.getMeetingAttachments(meetingId);
      const previousIds = new Set(before.map(record => record.id));
      const added = after.filter(record => !previousIds.has(record.id));
      if (added.length) markCurrentProjectUsed();
      if (!cloud.user || !navigator.onLine) {
        if (cloud.user) {
          cloud.pendingAttachments += added.length;
          setCloudStatus('pending', '附件待網路恢復後同步', '立即同步');
        }
        return;
      }
      const context = currentSyncContext();
      for (let index = 0; index < added.length; index += 1) {
        const record = added[index];
        try {
          await uploadLocalAttachment(record, context);
        } catch (error) {
          if (error instanceof StaleSyncError) {
            cloud.pendingAttachments += added.length - index;
            cloud.syncRequested = true;
            scheduleCloudSync(100);
            break;
          }
          cloud.pendingAttachments += 1;
          await putLocalAttachmentRecord({ ...record, cloudSynced: false, cloudError: error?.message || String(error) });
          showCloudError(error, '附件已保存在本機，但雲端上傳失敗');
        }
      }
    };

    deleteMeetingAttachment = async function (attachmentId) {
      const records = await getMeetingAttachments(activeMeetingId).catch(() => []);
      const record = records.find(item => item.id === attachmentId) || await getLocalAttachmentRecord(attachmentId);
      cloud.deletedAttachmentIds.add(attachmentId);
      if (cloud.user && record && (!record.cloudUserId || record.cloudUserId === cloud.user.id)) {
        const context = currentSyncContext();
        try {
          await deleteRemoteAttachment(record, context);
        } catch (error) {
          if (queueAttachmentDelete(record)) cloud.pendingAttachments += 1;
          setCloudStatus('pending', '附件刪除待同步', '立即同步');
        }
      } else if (record && queueAttachmentDelete(record)) cloud.pendingAttachments += 1;
      await cloud.originals.deleteMeetingAttachment(attachmentId);
    };

    deleteMeetingAttachmentsForMeeting = async function (meetingId) {
      const records = await getMeetingAttachments(meetingId).catch(() => []);
      records.forEach(record => cloud.deletedAttachmentIds.add(record.id));
      const context = cloud.user ? currentSyncContext() : null;
      for (const record of records) {
        if (context && (!record.cloudUserId || record.cloudUserId === context.userId)) {
          try {
            await deleteRemoteAttachment(record, context);
          } catch (error) {
            if (queueAttachmentDelete(record)) cloud.pendingAttachments += 1;
          }
        } else if (queueAttachmentDelete(record)) cloud.pendingAttachments += 1;
      }
      await cloud.originals.deleteMeetingAttachmentsForMeeting(meetingId);
    };

    downloadMeetingAttachment = async function (attachmentId) {
      try {
        const context = cloud.user ? currentSyncContext() : null;
        let record = await getLocalAttachmentRecord(attachmentId).catch(() => null);
        if (!record?.blob) record = await fetchRemoteAttachmentById(attachmentId, context);
        if (!record) return;
        record = await ensureAttachmentBlob(record, context);
        downloadMeetingAttachmentRecord(record);
      } catch (error) {
        alert('附件下載失敗，請確認網路連線後重試。');
        console.warn(error);
      }
    };

    shareMeetingSchedule = async function (meetingId, channel) {
      const meeting = allConstructionMeetings().find(item => item.id === meetingId);
      const record = getMeetingRecords()[meetingId] || {};
      if (!meeting) return;
      if (!record.scheduledAt) {
        alert('請先設定會議日期時間。');
        return;
      }
      const email = String(record.recipientEmail || '').trim();
      if (channel === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        alert('請輸入有效的收件人 e-mail。');
        return;
      }
      let attachments = await getMeetingAttachments(meetingId).catch(() => []);
      const text = buildMeetingShareText(meeting, record, attachments);
      const subject = '施工會議通知｜' + meeting.title + '｜' + formatMeetingDateTime(record.scheduledAt);
      if (channel === 'line') {
        window.location.href = getLineTargetPickerUrl(text);
        return;
      }
      try {
        const context = cloud.user ? currentSyncContext() : null;
        attachments = await Promise.all(attachments.map(record => ensureAttachmentBlob(record, context)));
      } catch (error) {
        alert('部分附件尚未從雲端下載完成，請確認網路後再使用 Gmail 附檔。');
        console.warn(error);
        return;
      }
      await shareMeetingEmail(email, subject, text, attachments);
    };

    const updateAttachmentNote = () => {
      const note = document.querySelector('.meeting-attachments small');
      if (!note) return;
      note.textContent = cloud.user
        ? '每個檔案上限 20 MB；附件會加密傳輸至私人雲端空間，並保留本機離線快取。'
        : '每個檔案上限 20 MB；目前保存在此瀏覽器，登入雲端同步後會自動上傳至私人空間。';
    };
    cloud.updateAttachmentNote = updateAttachmentNote;
    new MutationObserver(updateAttachmentNote).observe(document.querySelector('#practiceContent'), { childList: true, subtree: true });
    updateAttachmentNote();
  }
})();
