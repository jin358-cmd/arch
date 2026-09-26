(function (root, factory) {
  const domain = typeof module === 'object' && module.exports
    ? require('./project-domain.js')
    : root.AIEngineeringProjectDomain;
  const api = factory(domain);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AIEngineeringProjectLifecycle = api;
})(typeof globalThis === 'object' ? globalThis : this, function (domain) {
  'use strict';

  if (!domain) throw new Error('Project domain contract is required.');

  const DRAFT_STATUSES = Object.freeze(['DRAFT', 'PROMOTING', 'PROMOTION_FAILED', 'PROMOTED']);
  const TEMPLATE_STATUS = 'TEMPLATE';

  function requireUuidGenerator(generateUuid) {
    if (typeof generateUuid !== 'function') throw new TypeError('UUID_GENERATOR_REQUIRED');
    const value = generateUuid();
    if (!domain.isUuid(value)) throw new TypeError('UUID_GENERATOR_RETURNED_INVALID_UUID');
    return value;
  }

  function timestamp(now) {
    const value = typeof now === 'function' ? now() : new Date().toISOString();
    if (!Number.isFinite(Date.parse(value))) throw new TypeError('VALID_TIMESTAMP_REQUIRED');
    return value;
  }

  function createDraftProject(input, dependencies) {
    const name = domain.validateProjectName(input && input.name);
    if (!name.valid) throw new TypeError(name.error);
    const createdAt = timestamp(dependencies && dependencies.now);
    return Object.freeze({
      draftId: `draft-${requireUuidGenerator(dependencies && dependencies.generateUuid)}`,
      name: name.normalized,
      createdAt,
      updatedAt: createdAt,
      data: input && input.data ? input.data : {},
      status: 'DRAFT',
      promotion: null,
      promotedProjectId: null
    });
  }

  function createTemplate(input, dependencies) {
    const name = domain.validateProjectName(input && input.name);
    if (!name.valid) throw new TypeError(name.error);
    const createdAt = timestamp(dependencies && dependencies.now);
    return Object.freeze({
      templateId: `template-${requireUuidGenerator(dependencies && dependencies.generateUuid)}`,
      name: name.normalized,
      createdAt,
      updatedAt: createdAt,
      data: input && input.data ? input.data : {},
      status: TEMPLATE_STATUS
    });
  }

  function instantiateTemplate(template, dependencies) {
    if (!template || template.status !== TEMPLATE_STATUS || !/^template-/.test(template.templateId || '')) {
      throw new TypeError('VALID_TEMPLATE_REQUIRED');
    }
    return createDraftProject({ name: template.name, data: template.data }, dependencies);
  }

  function assertAuthenticated(auth) {
    if (!auth || auth.authenticated !== true || !domain.isUuid(auth.userId)) {
      throw new Error('AUTHENTICATION_REQUIRED_FOR_FORMAL_PROJECT');
    }
  }

  function createFormalProject(input, auth, dependencies) {
    assertAuthenticated(auth);
    const name = domain.validateProjectName(input && input.name);
    if (!name.valid) throw new TypeError(name.error);
    const id = input && input.id ? input.id : requireUuidGenerator(dependencies && dependencies.generateUuid);
    if (!domain.isUuid(id)) throw new TypeError('CANONICAL_UUID_REQUIRED');
    const createdAt = timestamp(dependencies && dependencies.now);
    const project = Object.freeze({
      id,
      name: name.normalized,
      ownerUserId: auth.userId,
      status: 'ACTIVE',
      createdAt,
      updatedAt: createdAt
    });
    const ownerMembership = Object.freeze({
      projectId: id,
      userId: auth.userId,
      role: 'OWNER',
      createdAt,
      updatedAt: createdAt
    });
    if (!domain.validateOwnerConsistency(project, [ownerMembership]).valid) throw new Error('OWNER_INTEGRITY_VIOLATION');
    return Object.freeze({ project, ownerMembership });
  }

  function beginDraftPromotion(draft, auth, request, dependencies) {
    assertAuthenticated(auth);
    if (!draft || !/^draft-/.test(draft.draftId || '')) throw new TypeError('VALID_DRAFT_REQUIRED');
    if (!request || typeof request.promotionKey !== 'string' || !request.promotionKey.trim()) {
      throw new TypeError('PROMOTION_KEY_REQUIRED');
    }
    if (draft.status === 'PROMOTED') {
      if (draft.promotion && draft.promotion.key === request.promotionKey) return draft;
      throw new Error('DRAFT_ALREADY_PROMOTED');
    }
    if (draft.promotion) {
      if (draft.promotion.key !== request.promotionKey) throw new Error('PROMOTION_KEY_CONFLICT');
      if (draft.status === 'PROMOTION_FAILED') {
        const { failureCode, ...promotion } = draft.promotion;
        return Object.freeze({
          ...draft,
          status: 'PROMOTING',
          updatedAt: timestamp(dependencies && dependencies.now),
          promotion: Object.freeze(promotion)
        });
      }
      return draft;
    }
    if (!['DRAFT', 'PROMOTION_FAILED'].includes(draft.status)) throw new Error('DRAFT_NOT_PROMOTABLE');
    const name = domain.validateProjectName(draft.name);
    if (!name.valid) throw new TypeError(name.error);
    const updatedAt = timestamp(dependencies && dependencies.now);
    return Object.freeze({
      ...draft,
      name: name.normalized,
      status: 'PROMOTING',
      updatedAt,
      promotion: Object.freeze({
        key: request.promotionKey,
        targetProjectId: requireUuidGenerator(dependencies && dependencies.generateUuid),
        ownerUserId: auth.userId,
        startedAt: updatedAt
      })
    });
  }

  function completeDraftPromotion(draft, formalBundle, dependencies) {
    if (!draft || draft.status !== 'PROMOTING' || !draft.promotion) throw new Error('PROMOTION_NOT_IN_PROGRESS');
    const project = formalBundle && formalBundle.project;
    const membership = formalBundle && formalBundle.ownerMembership;
    if (!project || project.id !== draft.promotion.targetProjectId) throw new Error('PROMOTION_PROJECT_MISMATCH');
    if (project.ownerUserId !== draft.promotion.ownerUserId) throw new Error('PROMOTION_OWNER_MISMATCH');
    if (!domain.validateOwnerConsistency(project, [membership]).valid) throw new Error('OWNER_INTEGRITY_VIOLATION');
    return Object.freeze({
      ...draft,
      status: 'PROMOTED',
      updatedAt: timestamp(dependencies && dependencies.now),
      promotedProjectId: project.id
    });
  }

  function markPromotionFailed(draft, reasonCode, dependencies) {
    if (!draft || draft.status !== 'PROMOTING' || !draft.promotion) throw new Error('PROMOTION_NOT_IN_PROGRESS');
    return Object.freeze({
      ...draft,
      status: 'PROMOTION_FAILED',
      updatedAt: timestamp(dependencies && dependencies.now),
      promotion: Object.freeze({ ...draft.promotion, failureCode: String(reasonCode || 'UNKNOWN') })
    });
  }

  function projectDisplayLabel(project) {
    const name = domain.validateProjectName(project && project.name);
    if (!name.valid) throw new TypeError(name.error);
    const detail = [project.displayCode, project.location, project.year]
      .filter(value => value !== null && value !== undefined && String(value).trim())
      .map(value => String(value).trim())
      .join(' · ');
    return Object.freeze({ primary: name.normalized, secondary: detail || null, projectId: project.id });
  }

  return Object.freeze({
    DRAFT_STATUSES,
    TEMPLATE_STATUS,
    createDraftProject,
    createTemplate,
    instantiateTemplate,
    createFormalProject,
    beginDraftPromotion,
    completeDraftPromotion,
    markPromotionFailed,
    projectDisplayLabel
  });
});
