'use strict';

const assert = require('node:assert/strict');
const domain = require('../src/project-domain.js');
const adapter = require('../src/legacy-project-adapter.js');
const lifecycle = require('../src/project-lifecycle.js');

const UUID_A = '123e4567-e89b-42d3-a456-426614174000';
const UUID_B = '123e4567-e89b-42d3-a456-426614174001';
const UUID_C = '123e4567-e89b-42d3-a456-426614174002';
const UUID_D = '123e4567-e89b-42d3-a456-426614174003';
const NOW = '2026-09-26T00:00:00.000Z';
const deps = uuid => ({ generateUuid: () => uuid, now: () => NOW });

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
assert.equal(domain.validateProjectName('e\u0301').normalized, 'é');

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
assert.equal(domain.validateCanonicalProject({ ...canonical, id: UUID_C, name: canonical.name }).valid, true);
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

const draft = lifecycle.createDraftProject({ name: '  同名工程  ', data: { safe: true } }, deps(UUID_C));
assert.equal(draft.draftId, `draft-${UUID_C}`);
assert.equal(draft.name, '同名工程');
assert.equal(draft.status, 'DRAFT');
assert.equal(domain.isUuid(draft.draftId), false);
assert.equal(adapter.classifyLifecycleIdentity(draft), 'LEGACY_LOCAL');

const template = lifecycle.createTemplate({ name: '施工範本' }, deps(UUID_D));
assert.equal(template.templateId, `template-${UUID_D}`);
assert.equal(domain.isUuid(template.templateId), false);
assert.equal(adapter.classifyLifecycleIdentity(template), 'TEMPLATE');
const draftFromTemplate = lifecycle.instantiateTemplate(template, deps(UUID_C));
assert.notEqual(draftFromTemplate.draftId, template.templateId);
assert.equal(draftFromTemplate.status, 'DRAFT');

assert.throws(
  () => lifecycle.createFormalProject({ name: '正式工程' }, { authenticated: false }, deps(UUID_A)),
  /AUTHENTICATION_REQUIRED/
);
const auth = { authenticated: true, userId: UUID_B };
const formalA = lifecycle.createFormalProject({ name: '同名工程' }, auth, deps(UUID_A));
const formalB = lifecycle.createFormalProject({ name: '同名工程' }, auth, deps(UUID_D));
assert.equal(formalA.project.name, formalB.project.name);
assert.notEqual(formalA.project.id, formalB.project.id);
assert.equal(formalA.ownerMembership.role, 'OWNER');
assert.equal(domain.validateOwnerConsistency(formalA.project, [formalA.ownerMembership]).valid, true);
assert.equal(domain.validateOwnerConsistency(formalA.project, []).error, 'EXACTLY_ONE_OWNER_MEMBERSHIP_REQUIRED');
assert.equal(domain.validateOwnerConsistency(formalA.project, [{ ...formalA.ownerMembership, userId: UUID_C }]).error, 'OWNER_MEMBERSHIP_MISMATCH');

const promotion = lifecycle.beginDraftPromotion(
  draft,
  auth,
  { promotionKey: 'promote-draft-once' },
  deps(UUID_A)
);
assert.equal(promotion.status, 'PROMOTING');
assert.equal(promotion.promotion.targetProjectId, UUID_A);
assert.equal(
  lifecycle.beginDraftPromotion(promotion, auth, { promotionKey: 'promote-draft-once' }, deps(UUID_D)).promotion.targetProjectId,
  UUID_A
);
assert.throws(
  () => lifecycle.beginDraftPromotion(promotion, auth, { promotionKey: 'different-request' }, deps(UUID_D)),
  /PROMOTION_KEY_CONFLICT/
);
const failedPromotion = lifecycle.markPromotionFailed(promotion, 'IMPORT_FAILED', deps(UUID_D));
assert.equal(failedPromotion.status, 'PROMOTION_FAILED');
const resumedPromotion = lifecycle.beginDraftPromotion(
  failedPromotion,
  auth,
  { promotionKey: 'promote-draft-once' },
  deps(UUID_D)
);
assert.equal(resumedPromotion.status, 'PROMOTING');
assert.equal(resumedPromotion.promotion.targetProjectId, UUID_A);
assert.equal('failureCode' in resumedPromotion.promotion, false);
const promotedBundle = lifecycle.createFormalProject({ id: UUID_A, name: draft.name }, auth, deps(UUID_D));
const promoted = lifecycle.completeDraftPromotion(resumedPromotion, promotedBundle, deps(UUID_D));
assert.equal(promoted.status, 'PROMOTED');
assert.equal(promoted.promotedProjectId, UUID_A);
assert.equal(
  lifecycle.beginDraftPromotion(promoted, auth, { promotionKey: 'promote-draft-once' }, deps(UUID_D)).promotedProjectId,
  UUID_A
);

assert.deepEqual(lifecycle.projectDisplayLabel({ id: UUID_A, name: '竹林街案' }), {
  primary: '竹林街案',
  secondary: null,
  projectId: UUID_A
});
assert.deepEqual(lifecycle.projectDisplayLabel({ id: UUID_A, name: '竹林街案', location: '台南北區', year: 2026 }), {
  primary: '竹林街案',
  secondary: '台南北區 · 2026',
  projectId: UUID_A
});
assert.equal(domain.canonicalProjectRoute(UUID_A).includes('同名工程'), false);
assert.equal(adapter.classifyLifecycleIdentity({ id: 'project-1790371979975-ne4klf' }), 'TEST');
assert.equal(adapter.classifyLifecycleIdentity({ id: 'project-navpilot' }), 'TEST');
assert.equal(adapter.classifyLifecycleIdentity({ id: UUID_A }), 'FORMAL_CANONICAL');

console.log('Project identity and lifecycle contract tests: PASS');
