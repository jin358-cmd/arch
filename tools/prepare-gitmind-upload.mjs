import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outputsDir = path.join(projectDir, 'outputs');
const mindmapDir = path.join(outputsDir, 'gitmind');
const markdownPath = path.join(outputsDir, 'xmind', 'new-building-gantt-mindmap.md');
const fileGuid = '18qf38k6jk0dktks58qdh311abtbva62';
const markdown = fs.readFileSync(markdownPath, 'utf8');

fs.mkdirSync(mindmapDir, { recursive: true });
fs.writeFileSync(
  path.join(outputsDir, 'gitmind-markdown-to-json.payload.json'),
  `${JSON.stringify({
    markdown,
    root_text: '新建建築專案甘特圖心智圖',
    project_id: fileGuid,
    file_guid: fileGuid,
    layout: 'file-tree-down-rounded',
    colorTheme: 'classic-blue',
    output_dir: mindmapDir,
    basename: 'new-building-gantt-gitmind'
  })}\n`,
  'utf8'
);

fs.writeFileSync(
  path.join(outputsDir, 'gitmind-project-upload.payload.json'),
  `${JSON.stringify({
    file_guid: fileGuid,
    project_file_path: path.join(mindmapDir, 'new-building-gantt-gitmind.json'),
    filename: 'new-building-gantt-gitmind.json',
    auto_update_file: true,
    aigc_label: 0,
    language: 'zh'
  })}\n`,
  'utf8'
);

console.log('GitMind 轉換與上傳 payload 已準備完成。');
