<template>
  <section class="pipe-import-panel">
    <header class="pipe-import-panel__header">
      <h2>数据导入</h2>
      <button type="button" @click="downloadTemplates">下载导入模板</button>
    </header>

    <div class="pipe-import-panel__tabs">
      <button
        type="button"
        :class="{ 'pipe-import-panel__tab--active': importType === 'excel' }"
        @click="importType = 'excel'"
      >
        Excel
      </button>
      <button
        type="button"
        :class="{ 'pipe-import-panel__tab--active': importType === 'csv' }"
        @click="importType = 'csv'"
      >
        CSV
      </button>
    </div>

    <div class="pipe-import-panel__form">
      <p class="pipe-import-panel__hint">
        推荐使用 Excel 模板填写，CSV 适合系统导出或批处理。管点优先填写地面高程和埋深，系统会自动推导三维高程。
      </p>

      <label v-if="importType === 'excel'">
        <span>Excel 文件（.xlsx）</span>
        <input type="file" accept=".xlsx" @change="onExcelFileChange" />
      </label>

      <template v-else>
        <label>
          <span>points.csv</span>
          <input type="file" accept=".csv,text/csv" @change="onPointsCsvChange" />
        </label>
        <label>
          <span>lines.csv</span>
          <input type="file" accept=".csv,text/csv" @change="onLinesCsvChange" />
        </label>
      </template>

      <label>
        <span>提交方式</span>
        <select v-model="mode">
          <option value="append">追加导入</option>
          <option value="replace">清空当前项目后导入</option>
        </select>
      </label>

      <label class="pipe-import-panel__check">
        <input v-model="autoGenerate" type="checkbox" />
        <span>导入后自动生成精细模型</span>
      </label>

      <div class="pipe-import-panel__actions">
        <button type="button" :disabled="isPreviewDisabled || loading" @click="preview">
          {{ loading ? "正在校验" : "字段映射/预览" }}
        </button>
        <button
          type="button"
          :disabled="!previewResult || previewResult.errorCount > 0 || loading"
          @click="commit"
        >
          确认提交
        </button>
        <button type="button" :disabled="loading" @click="$emit('generate-project')">
          生成当前项目
        </button>
      </div>
    </div>

    <p v-if="message" class="pipe-import-panel__message">{{ message }}</p>

    <div v-if="previewResult" class="pipe-import-panel__summary">
      <strong>预览结果</strong>
      <span>管点 {{ previewResult.totalPoints }} 个</span>
      <span>管线 {{ previewResult.totalLines }} 条</span>
      <span>错误 {{ previewResult.errorCount }} 条</span>
    </div>

    <div v-if="previewResult?.errors.length" class="pipe-import-panel__errors">
      <article v-for="(error, index) in previewResult.errors.slice(0, 12)" :key="index">
        <strong>{{ error.sheetName }} 第 {{ error.rowNumber || "-" }} 行</strong>
        <span>{{ error.fieldName || "row" }}：{{ error.message }}</span>
      </article>
    </div>

    <div v-if="previewResult" class="pipe-import-panel__preview">
      <h3>points</h3>
      <table>
        <thead>
          <tr>
            <th v-for="header in pointHeaders" :key="header">{{ header }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, index) in previewResult.pointPreview.slice(0, 6)" :key="index">
            <td v-for="header in pointHeaders" :key="header">{{ row[header] ?? "" }}</td>
          </tr>
        </tbody>
      </table>

      <h3>lines</h3>
      <table>
        <thead>
          <tr>
            <th v-for="header in lineHeaders" :key="header">{{ header }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, index) in previewResult.linePreview.slice(0, 6)" :key="index">
            <td v-for="header in lineHeaders" :key="header">{{ row[header] ?? "" }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import {
  commitPipelineImport,
  previewCsvPipelineImport,
  previewExcelPipelineImport,
} from "../../api/pipeline";
import type { PipelineImportPreview, PipelineMutationPayload } from "../../types/pipeline";

const emit = defineEmits<{
  (event: "committed", payload: PipelineMutationPayload, autoGenerate: boolean): void;
  (event: "generate-project"): void;
  (event: "message", message: string): void;
}>();

const importType = ref<"excel" | "csv">("excel");
const excelFile = ref<File | null>(null);
const pointsCsv = ref<File | null>(null);
const linesCsv = ref<File | null>(null);
const mode = ref<"append" | "replace">("append");
const autoGenerate = ref(true);
const loading = ref(false);
const message = ref("");
const previewResult = ref<PipelineImportPreview | null>(null);

type TemplateFile = {
  path: string;
  content: string | Uint8Array;
};

const pointTemplateHeaders = [
  "point_code",
  "lon",
  "lat",
  "ground_height",
  "maishen",
  "height",
  "relative_height",
  "business_type",
  "layer_code",
  "name",
  "remark",
];

const lineTemplateHeaders = [
  "line_code",
  "start_point_code",
  "end_point_code",
  "business_type",
  "outer_diameter_mm",
  "wall_thickness_mm",
  "model_id",
  "layer_code",
  "material_name",
  "pressure_level",
  "install_year",
  "owner",
  "remark",
];

const pointTemplateRows = [
  pointTemplateHeaders,
  ["P0001", "116.2991000", "39.9741000", "50.20", "1.60", "", "", "给水", "default", "示例管点A", "height 可留空"],
  ["P0002", "116.2995200", "39.9741000", "50.15", "1.60", "", "", "给水", "default", "示例管点B", "系统推导 height=ground_height-maishen"],
];

const lineTemplateRows = [
  lineTemplateHeaders,
  ["L0001", "P0001", "P0002", "给水", "600", "20", "ductile-iron-epoxy", "default", "球墨铸铁", "", "2026", "", "示例管线"],
];

const readmeText = [
  "# 地下管网批量导入模板说明",
  "",
  "## 推荐填写方式",
  "- Excel 模板包含 points、lines、字段说明、选项字典四个工作表。",
  "- CSV 导入需要同时上传 points.csv 和 lines.csv。",
  "- 管点推荐填写 ground_height（地面高程）和 maishen（埋深），height 可留空，由系统按 height = ground_height - maishen 推导。",
  "- 如果同时填写 height 和 ground_height/maishen，二者必须一致，否则预览会提示错误。",
  "",
  "## points 必填或推荐必填",
  "- point_code：管点编码，项目内唯一，例如 P0001。",
  "- lon：WGS84 经度，例如 116.2991000。",
  "- lat：WGS84 纬度，例如 39.9741000。",
  "- ground_height：地面高程，单位米。",
  "- maishen：埋深，单位米，地下管线填写正数。",
  "",
  "## lines 必填",
  "- line_code：管线编码，项目内唯一，例如 L0001。",
  "- start_point_code/end_point_code：起终点管点编码，必须能在 points 表或已有数据库中找到。",
  "- business_type：给水/water、排水/drainage、燃气/gas。",
  "- outer_diameter_mm：外径，单位毫米。",
  "- wall_thickness_mm：壁厚，单位毫米，必须小于外半径。",
  "",
  "## 模型风格选项",
  "- 给水：ductile-iron-epoxy、pipe-pp-pvc、galvanized-steel、coated-matte。",
  "- 排水：frp-sand-pipe、pipe-pp-pvc、coated-matte。",
  "- 燃气：hdpe-black-gas、carbon-steel-new、straight-9-metal、carbon-steel-heavy-rust。",
].join("\n");

const isPreviewDisabled = computed(() => {
  return importType.value === "excel"
    ? !excelFile.value
    : !pointsCsv.value || !linesCsv.value;
});

const pointHeaders = computed(() => headersOf(previewResult.value?.pointPreview ?? []));
const lineHeaders = computed(() => headersOf(previewResult.value?.linePreview ?? []));

function headersOf(rows: Array<Record<string, unknown>>) {
  const headers = new Set<string>();
  rows.slice(0, 10).forEach((row) => {
    Object.keys(row).forEach((key) => headers.add(key));
  });
  return Array.from(headers);
}

function onExcelFileChange(event: Event) {
  excelFile.value = (event.target as HTMLInputElement).files?.[0] ?? null;
  previewResult.value = null;
}

function onPointsCsvChange(event: Event) {
  pointsCsv.value = (event.target as HTMLInputElement).files?.[0] ?? null;
  previewResult.value = null;
}

function onLinesCsvChange(event: Event) {
  linesCsv.value = (event.target as HTMLInputElement).files?.[0] ?? null;
  previewResult.value = null;
}

async function preview() {
  loading.value = true;
  message.value = "";

  try {
    previewResult.value = importType.value === "excel"
      ? await previewExcelPipelineImport(excelFile.value as File)
      : await previewCsvPipelineImport(pointsCsv.value as File, linesCsv.value as File);
    message.value = previewResult.value.errorCount > 0
      ? "预览存在错误，请修正表格后重新上传"
      : "预览校验通过，可以提交导入";
    emit("message", message.value);
  } catch (error) {
    message.value = error instanceof Error ? error.message : String(error);
    emit("message", message.value);
  } finally {
    loading.value = false;
  }
}

async function commit() {
  if (!previewResult.value) {
    return;
  }

  loading.value = true;
  message.value = "";

  try {
    const payload = await commitPipelineImport(previewResult.value.jobId, {
      mode: mode.value,
      autoGenerate: autoGenerate.value,
    });
    message.value = "导入已提交";
    emit("committed", payload, autoGenerate.value);
  } catch (error) {
    message.value = error instanceof Error ? error.message : String(error);
    emit("message", message.value);
  } finally {
    loading.value = false;
  }
}

function downloadTemplates() {
  const files: TemplateFile[] = [
    {
      path: "pipeline-import-template.xlsx",
      content: createXlsxTemplate(),
    },
    {
      path: "points-template.csv",
      content: rowsToCsv(pointTemplateRows),
    },
    {
      path: "lines-template.csv",
      content: rowsToCsv(lineTemplateRows),
    },
    {
      path: "字段说明.md",
      content: readmeText,
    },
  ];
  downloadBlob("pipeline-import-template-pack.zip", createZip(files), "application/zip");
}

function downloadBlob(filename: string, blob: Blob, _type: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function createXlsxTemplate() {
  const files: TemplateFile[] = [
    {
      path: "[Content_Types].xml",
      content: xmlDeclaration(`\
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet4.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`),
    },
    {
      path: "_rels/.rels",
      content: xmlDeclaration(`\
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`),
    },
    {
      path: "xl/workbook.xml",
      content: xmlDeclaration(`\
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="points" sheetId="1" r:id="rId1"/>
    <sheet name="lines" sheetId="2" r:id="rId2"/>
    <sheet name="字段说明" sheetId="3" r:id="rId3"/>
    <sheet name="选项字典" sheetId="4" r:id="rId4"/>
  </sheets>
</workbook>`),
    },
    {
      path: "xl/_rels/workbook.xml.rels",
      content: xmlDeclaration(`\
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/>
  <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet4.xml"/>
  <Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`),
    },
    {
      path: "xl/styles.xml",
      content: xmlDeclaration(`\
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts>
  <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F6F8B"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`),
    },
    {
      path: "xl/worksheets/sheet1.xml",
      content: worksheetXml(pointTemplateRows, [16, 13, 13, 16, 12, 12, 16, 16, 12, 18, 28], {
        validations: [
          { range: "H2:H200", formula: '"给水,排水,燃气,water,drainage,gas"' },
          { range: "I2:I200", formula: '"default"' },
        ],
      }),
    },
    {
      path: "xl/worksheets/sheet2.xml",
      content: worksheetXml(lineTemplateRows, [16, 18, 18, 16, 18, 18, 24, 12, 16, 16, 12, 16, 28], {
        validations: [
          { range: "D2:D200", formula: '"给水,排水,燃气,water,drainage,gas"' },
          { range: "G2:G200", formula: '"ductile-iron-epoxy,pipe-pp-pvc,galvanized-steel,coated-matte,frp-sand-pipe,hdpe-black-gas,carbon-steel-new,straight-9-metal,carbon-steel-heavy-rust"' },
          { range: "H2:H200", formula: '"default"' },
        ],
      }),
    },
    {
      path: "xl/worksheets/sheet3.xml",
      content: worksheetXml(fieldDescriptionRows(), [20, 16, 42, 36, 48], {}),
    },
    {
      path: "xl/worksheets/sheet4.xml",
      content: worksheetXml(optionRows(), [18, 30, 36], {}),
    },
  ];
  return zipBytes(files);
}

function fieldDescriptionRows() {
  return [
    ["工作表", "字段", "含义", "填写要求", "示例/选项"],
    ["points", "point_code", "管点编码", "必填，项目内唯一", "P0001"],
    ["points", "lon", "WGS84 经度", "必填，-180 到 180", "116.2991000"],
    ["points", "lat", "WGS84 纬度", "必填，-90 到 90", "39.9741000"],
    ["points", "ground_height", "地面高程，单位米", "推荐必填，用于推导 height", "50.20"],
    ["points", "maishen", "埋深，单位米，地下为正数", "推荐必填，用于推导 height", "1.60"],
    ["points", "height", "管点三维高程，单位米", "可留空；留空时按 ground_height - maishen 推导", "48.60"],
    ["points", "relative_height", "相对地面高度，地下为负数", "可留空；系统可按 height - ground_height 推导", "-1.60"],
    ["points", "business_type", "业务类型", "选填；缺失按给水处理", "给水/water、排水/drainage、燃气/gas"],
    ["points", "layer_code", "图层编码", "选填；默认 default", "default"],
    ["lines", "line_code", "管线编码", "必填，项目内唯一", "L0001"],
    ["lines", "start_point_code", "起点管点编码", "必填，必须存在", "P0001"],
    ["lines", "end_point_code", "终点管点编码", "必填，必须存在且不能等于起点", "P0002"],
    ["lines", "business_type", "业务类型", "必填，必须与连接点同业务规则一致", "给水/water"],
    ["lines", "outer_diameter_mm", "管道外径，单位毫米", "必填，必须大于 0", "600"],
    ["lines", "wall_thickness_mm", "管道壁厚，单位毫米", "必填，必须大于 0 且小于外半径", "20"],
    ["lines", "model_id", "模型风格", "选填；留空按业务默认模型", "ductile-iron-epoxy"],
  ];
}

function optionRows() {
  return [
    ["类别", "代码/可填值", "说明"],
    ["业务类型", "给水 / water", "给水业务，默认模型 ductile-iron-epoxy"],
    ["业务类型", "排水 / drainage", "排水业务，默认模型 frp-sand-pipe"],
    ["业务类型", "燃气 / gas", "燃气业务，默认模型 hdpe-black-gas"],
    ["图层", "default", "默认图层"],
    ["给水模型", "ductile-iron-epoxy", "球墨铸铁环氧涂层"],
    ["给水模型", "pipe-pp-pvc", "PP/PVC 管"],
    ["给水模型", "galvanized-steel", "镀锌钢管"],
    ["给水模型", "coated-matte", "哑光涂层管"],
    ["排水模型", "frp-sand-pipe", "玻璃钢夹砂管"],
    ["排水模型", "pipe-pp-pvc", "PP/PVC 管"],
    ["排水模型", "coated-matte", "哑光涂层管"],
    ["燃气模型", "hdpe-black-gas", "黑色燃气 HDPE 管"],
    ["燃气模型", "carbon-steel-new", "新碳钢管"],
    ["燃气模型", "straight-9-metal", "金属直管风格"],
    ["燃气模型", "carbon-steel-heavy-rust", "重锈蚀碳钢管"],
  ];
}

function worksheetXml(
  rows: Array<Array<string | number>>,
  widths: number[],
  options: { validations?: Array<{ range: string; formula: string }> },
) {
  const cols = widths
    .map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`)
    .join("");
  const data = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((value, colIndex) => cellXml(rowIndex + 1, colIndex + 1, value, rowIndex === 0 ? 1 : 2))
        .join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");
  const validations = options.validations?.length
    ? `<dataValidations count="${options.validations.length}">${options.validations
      .map((item) => `<dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="${item.range}"><formula1>${escapeXml(item.formula)}</formula1></dataValidation>`)
      .join("")}</dataValidations>`
    : "";
  return xmlDeclaration(`\
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <cols>${cols}</cols>
  <sheetData>${data}</sheetData>
  ${validations}
</worksheet>`);
}

function cellXml(row: number, col: number, value: string | number, style: number) {
  const ref = `${columnName(col)}${row}`;
  if (typeof value === "number") {
    return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
  }
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
}

function rowsToCsv(rows: Array<Array<string | number>>) {
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

function csvCell(value: string | number) {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll("\"", "\"\"")}"` : text;
}

function createZip(files: TemplateFile[]) {
  return new Blob([zipBytes(files)], { type: "application/zip" });
}

function zipBytes(files: TemplateFile[]) {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  files.forEach((file) => {
    const nameBytes = encoder.encode(file.path.replaceAll("\\", "/"));
    const contentBytes = typeof file.content === "string" ? encoder.encode(file.content) : file.content;
    const crc = crc32(contentBytes);
    const local = concatBytes(
      u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
      u32(crc), u32(contentBytes.length), u32(contentBytes.length), u16(nameBytes.length), u16(0), nameBytes,
    );
    chunks.push(local, contentBytes);
    central.push(concatBytes(
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
      u32(crc), u32(contentBytes.length), u32(contentBytes.length), u16(nameBytes.length), u16(0), u16(0),
      u16(0), u16(0), u32(0), u32(offset), nameBytes,
    ));
    offset += local.length + contentBytes.length;
  });

  const centralOffset = offset;
  const centralBytes = concatBytes(...central);
  const end = concatBytes(
    u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(centralBytes.length), u32(centralOffset), u16(0),
  );
  return concatBytes(...chunks, centralBytes, end);
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function concatBytes(...arrays: Uint8Array[]) {
  const length = arrays.reduce((sum, item) => sum + item.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  arrays.forEach((array) => {
    result.set(array, offset);
    offset += array.length;
  });
  return result;
}

function u16(value: number) {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
}

function u32(value: number) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
  return bytes;
}

function columnName(index: number) {
  let name = "";
  let current = index;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    current = Math.floor((current - 1) / 26);
  }
  return name;
}

function xmlDeclaration(xml: string) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${xml}`;
}

function escapeXml(value: string | number) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}
</script>

<style scoped>
.pipe-import-panel {
  width: 430px;
  max-height: calc(100vh - 160px);
  overflow: auto;
  color: #e8f4fb;
  background: rgba(16, 24, 32, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 6px;
  backdrop-filter: blur(8px);
}

.pipe-import-panel__header,
.pipe-import-panel__tabs,
.pipe-import-panel__form,
.pipe-import-panel__summary,
.pipe-import-panel__errors,
.pipe-import-panel__preview {
  padding: 12px 14px;
}

.pipe-import-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

h2,
h3 {
  margin: 0;
  font-size: 15px;
}

h3 {
  margin-top: 10px;
  margin-bottom: 6px;
  font-size: 13px;
}

.pipe-import-panel__tabs,
.pipe-import-panel__actions,
.pipe-import-panel__summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.pipe-import-panel__form,
.pipe-import-panel__errors {
  display: grid;
  gap: 10px;
}

label {
  display: grid;
  gap: 5px;
  color: rgba(232, 244, 251, 0.76);
  font-size: 12px;
}

.pipe-import-panel__check {
  display: flex;
  align-items: center;
  gap: 8px;
}

input,
select {
  min-width: 0;
  min-height: 30px;
  color: #ffffff;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 4px;
}

select {
  color-scheme: light;
}

select option {
  color: #10202d;
}

button {
  height: 30px;
  padding: 0 10px;
  color: #ffffff;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 4px;
  background: rgba(0, 133, 160, 0.68);
  cursor: pointer;
}

button:disabled {
  color: rgba(255, 255, 255, 0.48);
  cursor: not-allowed;
  background: rgba(255, 255, 255, 0.08);
}

.pipe-import-panel__tab--active {
  border-color: rgba(255, 228, 92, 0.8);
  background: rgba(160, 123, 0, 0.54);
}

.pipe-import-panel__message {
  margin: 0 14px 10px;
  color: #ffd166;
  font-size: 12px;
}

.pipe-import-panel__hint {
  margin: 0;
  color: rgba(232, 244, 251, 0.72);
  font-size: 12px;
  line-height: 1.5;
}

.pipe-import-panel__summary {
  color: rgba(232, 244, 251, 0.78);
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.pipe-import-panel__errors article {
  display: grid;
  gap: 4px;
  padding: 8px;
  color: #ffd7d7;
  background: rgba(170, 38, 38, 0.22);
  border: 1px solid rgba(255, 120, 120, 0.2);
  border-radius: 4px;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

th,
td {
  max-width: 150px;
  padding: 5px 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

th {
  color: #ffffff;
  background: rgba(255, 255, 255, 0.08);
}
</style>
