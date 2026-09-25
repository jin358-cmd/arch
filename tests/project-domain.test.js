'use strict';

const assert = require('node:assert/strict');
const domain = require('../src/project-domain.js');
const adapter = require('../src/legacy-project-adapter.js');

const UUID_A = '123e4567-e89b-42d3-a456-426614174000';
const UUID_B = '123e4567-e89b-42d3-a456-426614174001';

assert.equal(domain.isUuid(UUID_A), true);
assert.equal(domain.isUuid('project-123'), false);

assert.deepEqual(domain.validateProjectName('  建案Ａ  '), {
  valid: true,
  normalized: '建案Ａ',
  error: null
});
assert.equal(domain.validateProjectName('   ').error, 'PROJECT_NAME_REQUIRED');
assert.equal(domain.validateProjectName('x'.repeat(200)).valid, true);
assert.equal(domain.validateProjectName('x'.repeat(201)).error, 'PROJECT_NAME_TOO_LONG');

for (const role of ['OWNER', 'MANAGER', 'EDITOR', 'VIEWER']) assert.equal(domain.validateRole(role), true);
assert.equal(domain.validateRole('ADMIN'), false);
assert.equal(domain.hasProjectPermission('VIEWER', 'VIEW_PROJECT'), true);
assert.equal(domain.hasProjectPermission('VIEWER', 'EDIT_PROJECT'), false);
assert.equal(domain.hasProjectPermission('EDITOR', 'MANAGE_MEMBERS'), false);
assert.equal(domain.hasProjectPermission('MANAGER', 'MANAGE_MEMBERS'), true);
assert.equal(domain.canManageMembership('MANAGER', 'EDITOR', 'VIEWER'), true);
assert.equal(domain.canManageMembership('MANAGER', 'VIEWER', 'OWNER'), false);
assert.equal(domain.canManageMembership('MANAGER', 'OWNER', 'VIEWER'), false);

const canonical = {
  id: UUID_A,
  name: '松山集合住宅',
  ownerUserId: UUID_B,
  createdAt: '2026-09-26T00:00:00.000Z',
  updatedAt: '2026-09-26T00:00:00.000Z'
};
assert.equal(domain.validateCanonicalProject(canonical).valid, true);
assert.equal(domain.validateLegacyProjectIdentity({
  canonicalProjectId: UUID_A,
  sourceSystem: 'workflow',
  legacyProjectId: 'project-legacy',
  migratedAt: null
}).valid, true);
assert.equal(domain.preserveCanonicalIdentity(canonical, { ...canonical, name: '新名稱' }).id, UUID_A);
assert.throws(() => domain.preserveCanonicalIdentity(canonical, { ...canonical, id: UUID_B }), /CANONICAL_ID_IMMUTABLE/);

assert.equal(domain.canonicalProjectRoute(UUID_A), `/projects/${UUID_A}/overview`);
assert.throws(() => domain.canonicalProjectRoute('松山集合住宅'), /UUID/);

assert.equal(domain.classifyLegacyProject({ id: 'project-1790371979975-ne4klf' }), 'EXCLUDED_TEST_FIXTURE');
assert.equal(domain.classifyLegacyProject({ id: 'project-construction-flow' }), 'EXCLUDED_TEST_FIXTURE');
assert.equal(domain.classifyLegacyProject({ id: UUID_A }), 'CANONICAL_UUID');
assert.equal(domain.classifyLegacyProject({ id: 'project-real-legacy' }), 'LEGACY_TEXT_ID');
assert.equal(adapter.inspectLegacyProject({ id: 'project-1790371979975-ne4klf', name: '未命名專案' }).eligibleForAutomaticMigration, false);
assert.throws(
  () => adapter.createCompatibilityReference({ id: 'project-construction-flow', name: '建築施工流程' }, { canonicalProjectId: UUID_A }),
  /EXCLUDED_PROJECT_CANNOT_MIGRATE/
);
assert.throws(
  () => adapter.createCompatibilityReference({ id: 'project-real-legacy', name: '正式工程案' }),
  /EXPLICIT_CANONICAL_MAPPING_REQUIRED/
);
assert.deepEqual(
  adapter.createCompatibilityReference(
    { id: 'project-real-legacy', name: '正式工程案' },
    { canonicalProjectId: UUID_A }
  ),
  { canonicalProjectId: UUID_A, legacyProjectId: 'project-real-legacy' }
);

console.log('Phase 1 project-domain contract tests: PASS');
