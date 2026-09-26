(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AIEngineeringProjectDomain = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  const PROJECT_NAME_MAX_LENGTH = 200;
  const FORMAL_PROJECT_STATUSES = Object.freeze(['ACTIVE', 'ARCHIVED']);
  const PROJECT_ROLES = Object.freeze(['OWNER', 'MANAGER', 'EDITOR', 'VIEWER']);
  const PROJECT_PERMISSIONS = Object.freeze([
    'VIEW_PROJECT',
    'EDIT_PROJECT',
    'MANAGE_MEMBERS',
    'EDIT_CONSTRUCTION',
    'EDIT_SCHEDULE',
    'MANAGE_RISK',
    'CREATE_MEETING',
    'EDIT_DOCUMENT',
    'UPLOAD_FILE',
    'DELETE_FILE',
    'VIEW_AI_REVIEW',
    'APPROVE_AI_ACTION',
    'MANAGE_NOTIFICATIONS'
  ]);

  const ALL_PERMISSIONS = Object.freeze([...PROJECT_PERMISSIONS]);
  const ROLE_PERMISSIONS = Object.freeze({
    OWNER: ALL_PERMISSIONS,
    MANAGER: Object.freeze([...PROJECT_PERMISSIONS]),
    EDITOR: Object.freeze([
      'VIEW_PROJECT',
      'EDIT_PROJECT',
      'EDIT_CONSTRUCTION',
      'EDIT_SCHEDULE',
      'MANAGE_RISK',
      'CREATE_MEETING',
      'EDIT_DOCUMENT',
      'UPLOAD_FILE',
      'VIEW_AI_REVIEW',
      'MANAGE_NOTIFICATIONS'
    ]),
    VIEWER: Object.freeze(['VIEW_PROJECT', 'VIEW_AI_REVIEW', 'MANAGE_NOTIFICATIONS'])
  });

  const EXCLUDED_PROJECT_IDS = new Set([
    'project-1790371979975-ne4klf',
    'project-navpilot',
    'project-construction-flow',
    'project-rental-data',
    'project-bamboo-street',
    'project-atlas',
    '00000000-0000-4000-8000-000000000001',
    'ffffffff-ffff-4fff-8fff-000000000001',
    'ffffffff-ffff-4fff-8fff-000000000010'
  ]);

  function isUuid(value) {
    return typeof value === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }

  function normalizeProjectName(value) {
    if (typeof value !== 'string') return '';
    return value.normalize('NFC').trim();
  }

  function validateProjectName(value) {
    const normalized = normalizeProjectName(value);
    if (!normalized) return { valid: false, normalized, error: 'PROJECT_NAME_REQUIRED' };
    if (Array.from(normalized).length > PROJECT_NAME_MAX_LENGTH) {
      return { valid: false, normalized, error: 'PROJECT_NAME_TOO_LONG' };
    }
    return { valid: true, normalized, error: null };
  }

  function validateRole(role) {
    return PROJECT_ROLES.includes(role);
  }

  function hasProjectPermission(role, permission) {
    return validateRole(role) &&
      PROJECT_PERMISSIONS.includes(permission) &&
      ROLE_PERMISSIONS[role].includes(permission);
  }

  function canManageMembership(actorRole, currentRole, nextRole) {
    if (!validateRole(actorRole) || !validateRole(currentRole) || !validateRole(nextRole)) return false;
    if (actorRole === 'OWNER') return true;
    if (actorRole !== 'MANAGER') return false;
    return currentRole !== 'OWNER' && nextRole !== 'OWNER';
  }

  function validateCanonicalProject(project) {
    if (!project || !isUuid(project.id)) return { valid: false, error: 'CANONICAL_UUID_REQUIRED' };
    if (!isUuid(project.ownerUserId)) return { valid: false, error: 'OWNER_UUID_REQUIRED' };
    const name = validateProjectName(project.name);
    if (!name.valid) return name;
    return { valid: true, normalizedName: name.normalized, error: null };
  }

  function validateOwnerConsistency(project, memberships) {
    if (!validateCanonicalProject(project).valid || !Array.isArray(memberships)) {
      return { valid: false, error: 'INVALID_OWNER_CONTEXT' };
    }
    const projectMemberships = memberships.filter(item => item && item.projectId === project.id);
    const owners = projectMemberships.filter(item => item.role === 'OWNER');
    if (owners.length !== 1) return { valid: false, error: 'EXACTLY_ONE_OWNER_MEMBERSHIP_REQUIRED' };
    if (owners[0].userId !== project.ownerUserId) {
      return { valid: false, error: 'OWNER_MEMBERSHIP_MISMATCH' };
    }
    return { valid: true, error: null };
  }

  function validateLegacyProjectIdentity(identity) {
    const valid = Boolean(
      identity &&
      isUuid(identity.canonicalProjectId) &&
      typeof identity.sourceSystem === 'string' && identity.sourceSystem.trim() &&
      typeof identity.legacyProjectId === 'string' && identity.legacyProjectId.trim()
    );
    return { valid, error: valid ? null : 'INVALID_LEGACY_PROJECT_IDENTITY' };
  }

  function preserveCanonicalIdentity(currentProject, incomingProject) {
    if (!validateCanonicalProject(currentProject).valid) throw new TypeError('Current project is not canonical.');
    if (!incomingProject || incomingProject.id !== currentProject.id) {
      throw new Error('CANONICAL_ID_IMMUTABLE');
    }
    return Object.freeze({ ...incomingProject, id: currentProject.id });
  }

  function canonicalProjectRoute(projectId, suffix = 'overview') {
    if (!isUuid(projectId)) throw new TypeError('Canonical project UUID is required for routing.');
    const safeSuffix = String(suffix).replace(/^\/+|\/+$/g, '');
    if (!safeSuffix || !/^[a-z0-9/-]+$/i.test(safeSuffix)) throw new TypeError('Invalid project route suffix.');
    return `/projects/${projectId}/${safeSuffix}`;
  }

  function classifyLegacyProject(project) {
    const id = project && typeof project.id === 'string' ? project.id : '';
    if (EXCLUDED_PROJECT_IDS.has(id) || /^ffffffff-ffff-4fff-8fff-/.test(id)) return 'EXCLUDED_TEST_FIXTURE';
    if (isUuid(id)) return 'CANONICAL_UUID';
    if (id) return 'LEGACY_TEXT_ID';
    return 'INVALID';
  }

  return Object.freeze({
    PROJECT_NAME_MAX_LENGTH,
    FORMAL_PROJECT_STATUSES,
    PROJECT_ROLES,
    PROJECT_PERMISSIONS,
    ROLE_PERMISSIONS,
    EXCLUDED_PROJECT_IDS: Object.freeze([...EXCLUDED_PROJECT_IDS]),
    isUuid,
    normalizeProjectName,
    validateProjectName,
    validateRole,
    hasProjectPermission,
    canManageMembership,
    validateCanonicalProject,
    validateOwnerConsistency,
    validateLegacyProjectIdentity,
    preserveCanonicalIdentity,
    canonicalProjectRoute,
    classifyLegacyProject
  });
});
