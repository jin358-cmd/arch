import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.dirname(scriptDir);
const sourcePath = path.join(projectDir, 'index.html');
const outputDir = path.join(projectDir, 'outputs', 'xmind');
const source = fs.readFileSync(sourcePath, 'utf8');

function extractInitializer(name) {
  const marker = `const ${name}=`;
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) throw new Error(`找不到資料：${name}`);
  const start = markerIndex + marker.length;
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character;
      continue;
    }
    if ('([{'.includes(character)) depth += 1;
    else if (')]}'.includes(character)) depth -= 1;
    else if (character === ';' && depth === 0) return source.slice(start, index).trim();
  }
  throw new Error(`資料未完整結束：${name}`);
}

function evaluate(name, context = {}) {
  return vm.runInNewContext(`(${extractInitializer(name)})`, context, { filename: sourcePath });
}

const phaseDisplayNames = evaluate('phaseDisplayNames');
const context = { phaseDisplayNames };
const phases = evaluate('phases', context);
const standardGateGroups = evaluate('standardGateGroups', context);
const practiceSyncMap = evaluate('practiceSyncMap');
const vendorFlow = evaluate('vendorFlow');
const vendorItems = vendorFlow.flatMap(group => group.items);
const vendorById = new Map(vendorItems.map(item => [String(item[0]), item]));
const gates = standardGateGroups.flatMap(group => group.items);
const mainItemCount = phases.reduce((sum, phase) => sum + phase.steps.length, 0);

if (phases.length !== 4 || mainItemCount !== 12 || gates.length !== 33 || vendorItems.length !== 52) {
  throw new Error(`流程數量不符：${phases.length} 階段、${mainItemCount} 主項目、${gates.length} 流程、${vendorItems.length} 廠商`);
}

function clean(value) {
  return String(value ?? '').replace(/\r?\n/g, ' ').trim();
}

function xml(value) {
  return clean(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function indent(level) {
  return '  '.repeat(level);
}

function mdLine(level, text) {
  return `${indent(level)}- ${clean(text)}`;
}

function outline(text, children = [], note = '') {
  const noteAttribute = note ? ` _note="${xml(note)}"` : '';
  if (!children.length) return `<outline text="${xml(text)}"${noteAttribute}/>`;
  return `<outline text="${xml(text)}"${noteAttribute}>${children.join('')}</outline>`;
}

const markdown = [
  '# 新建建築專案甘特圖心智圖',
  '',
  '> 來源：新建建築專案工作流程。結構：4 階段 → 12 工作項目 → 33 流程 → 對應協作廠商／工種。',
  ''
];
const phaseOutlines = [];
let stepNumber = 0;

phases.forEach(phase => {
  const phaseLabel = `PHASE ${String(phase.id).padStart(2, '0')}｜${phase.title}`;
  markdown.push(mdLine(0, phaseLabel));
  markdown.push(mdLine(1, `階段主責｜${phase.lead}`));
  markdown.push(mdLine(1, `階段目的｜${phase.purpose}`));
  markdown.push(mdLine(1, `管制關卡｜${phase.gate}`));
  const phaseChildren = [
    outline(`階段主責｜${phase.lead}`),
    outline(`階段目的｜${phase.purpose}`),
    outline(`管制關卡｜${phase.gate}`)
  ];

  phase.steps.forEach(step => {
    stepNumber += 1;
    const stepId = `step-${stepNumber}`;
    const stepLabel = `工作項目 ${String(stepNumber).padStart(2, '0')}｜${step[0]}`;
    markdown.push(mdLine(1, stepLabel));
    markdown.push(mdLine(2, `主責｜${step[1]}`));
    markdown.push(mdLine(2, `協作角色｜${step[2]}`));
    markdown.push(mdLine(2, `必要交付｜${step[3]}`));
    markdown.push(mdLine(2, `完成判準｜${step[4]}`));
    const stepChildren = [
      outline(`主責｜${step[1]}`),
      outline(`協作角色｜${step[2]}`),
      outline(`必要交付｜${step[3]}`),
      outline(`完成判準｜${step[4]}`)
    ];

    const gateRecords = standardGateGroups
      .flatMap(group => group.items.map(item => ({ group, item })))
      .filter(record => practiceSyncMap[record.item[0]]?.step === stepId);

    gateRecords.forEach(({ group, item }) => {
      const [gateId, title, owner, output, risk, period] = item;
      const gateLabel = `流程 ${gateId}｜${title}`;
      markdown.push(mdLine(2, gateLabel));
      markdown.push(mdLine(3, `主責／會簽｜${owner}`));
      markdown.push(mdLine(3, `預定期間｜${period}`));
      markdown.push(mdLine(3, `必要產出｜${output}`));
      markdown.push(mdLine(3, `主要風險｜${risk}`));
      markdown.push(mdLine(3, `階段管制｜${group.gate}`));
      const gateChildren = [
        outline(`主責／會簽｜${owner}`),
        outline(`預定期間｜${period}`),
        outline(`必要產出｜${output}`),
        outline(`主要風險｜${risk}`),
        outline(`階段管制｜${group.gate}`)
      ];

      const linkedVendors = (practiceSyncMap[gateId]?.vendors || [])
        .map(id => vendorById.get(String(id)))
        .filter(Boolean);
      const vendorChildren = [];
      linkedVendors.forEach(vendor => {
        const [id, name, work, handoff, days] = vendor;
        markdown.push(mdLine(3, `協作廠商／工種 ${String(id).padStart(2, '0')}｜${name}`));
        markdown.push(mdLine(4, `主要工作｜${work}`));
        markdown.push(mdLine(4, `前置與交接｜${handoff}`));
        markdown.push(mdLine(4, `建議工作日｜${days} 日`));
        vendorChildren.push(outline(
          `協作廠商／工種 ${String(id).padStart(2, '0')}｜${name}`,
          [
            outline(`主要工作｜${work}`),
            outline(`前置與交接｜${handoff}`),
            outline(`建議工作日｜${days} 日`)
          ]
        ));
      });
      if (vendorChildren.length) gateChildren.push(outline('施工協作廠商／工種', vendorChildren));
      stepChildren.push(outline(gateLabel, gateChildren));
    });

    phaseChildren.push(outline(stepLabel, stepChildren));
  });
  phaseOutlines.push(outline(phaseLabel, phaseChildren));
});

const opml = `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0"><head><title>新建建築專案甘特圖心智圖</title></head><body>${outline('新建建築專案甘特圖心智圖', phaseOutlines)}</body></opml>\n`;
const readme = `# XMind 匯入檔\n\n- \`new-building-gantt-mindmap.opml\`：建議優先使用，完整保留階層。\n- \`new-building-gantt-mindmap.md\`：可由 XMind 的「檔案 → 匯入 → Markdown」開啟，也可直接編輯文字後再次匯入。\n\n內容由根目錄 \`index.html\` 自動產生，目前包含 4 階段、12 個工作項目、33 道流程，以及每道流程對應的協作廠商／工種。\n`;

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, 'new-building-gantt-mindmap.md'), `${markdown.join('\n')}\n`, 'utf8');
fs.writeFileSync(path.join(outputDir, 'new-building-gantt-mindmap.opml'), opml, 'utf8');
fs.writeFileSync(path.join(outputDir, 'README.md'), readme, 'utf8');

console.log(`已產生 XMind 匯入檔：${outputDir}`);
console.log(`4 階段／${mainItemCount} 工作項目／${gates.length} 流程／${vendorItems.length} 協作廠商`);
