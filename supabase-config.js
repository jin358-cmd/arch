(function () {
  'use strict';

  // The publishable key is intentionally safe for browser use. Access control
  // is enforced by Supabase Row Level Security; never place a secret or
  // service-role key in this file.
  window.BUILDING_WORKFLOW_SUPABASE = Object.freeze({
    url: 'https://qmptlkgseffmeqnarwnb.supabase.co',
    publishableKey: 'sb_publishable_SmiisX78KNHQAStAe3lpfQ_kNog8XiJ',
    publicSiteUrl: 'https://jin358-cmd.github.io/arch/',
    projectTable: 'workflow_projects',
    stateTable: 'workflow_project_state',
    attachmentTable: 'workflow_meeting_attachments',
    attachmentBucket: 'workflow-meeting-attachments',
    schemaVersion: 1
  });
})();
