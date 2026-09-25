(function (root, factory) {
  const domain = typeof module === 'object' && module.exports
    ? require('./project-domain.js')
    : root.AIEngineeringProjectDomain;
  const api = factory(domain);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AIEngineeringLegacyProjectAdapter = api;
})(typeof globalThis === 'object' ? globalThis : this, function (domain) {
  'use strict';

  if (!domain) throw new Error('Project domain contract is required.');

  function inspectLegacyProject(project) {
    const classification = domain.classifyLegacyProject(project);
    const name = domain.validateProjectName(project && project.name);
    return Object.freeze({
      legacyProjectId: project && typeof project.id === 'string' ? project.id : null,
      name: name.normalized,
      classification,
      eligibleForAutomaticMigration: false,
      requiresExplicitMapping: classification === 'LEGACY_TEXT_ID',
      exclusionReason: classification === 'EXCLUDED_TEST_FIXTURE' ? 'TEST_OR_ATLAS_FIXTURE' : null
    });
  }

  function createCompatibilityReference(project, mapping) {
    const inspection = inspectLegacyProject(project);
    if (inspection.classification === 'EXCLUDED_TEST_FIXTURE') {
      throw new Error('EXCLUDED_PROJECT_CANNOT_MIGRATE');
    }
    if (inspection.classification === 'CANONICAL_UUID') {
      return Object.freeze({ canonicalProjectId: project.id, legacyProjectId: null });
    }
    const canonicalProjectId = mapping && mapping.canonicalProjectId;
    if (!domain.isUuid(canonicalProjectId)) throw new Error('EXPLICIT_CANONICAL_MAPPING_REQUIRED');
    return Object.freeze({ canonicalProjectId, legacyProjectId: inspection.legacyProjectId });
  }

  return Object.freeze({ inspectLegacyProject, createCompatibilityReference });
});
