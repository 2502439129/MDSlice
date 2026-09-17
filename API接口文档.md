# 病迹小程序 · 云函数 API 接口文档

---
title: 病迹小程序 · 云函数 API 接口文档
version: V2.5.0
updated: 2026-09-10
scope: 基于路线图 2 数据库设计，面向小程序前端开发者
---

> [!INFO] **v2.5 说明**
> 本次以云函数**实际实现**为基准，校正了参数命名（嵌套对象）、返回值字段、默认值、排序规则与云函数清单。

## 〇、公共约定

### 0.1 集合与公共字段

本系统共 **5 个核心集合**，所有集合均包含以下公共字段，各接口不再重复说明：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `_id` | `string` | 云数据库自动生成的主键 |
| `_openid` | `string` | 微信用户唯一标识，由云函数自动注入，前端无需传递 |
| `createdAt` | `Date` | 云数据库 `db.serverDate()`，创建时间 |
| `updatedAt` | `Date` | 云数据库 `db.serverDate()`，更新时间（可选，创建时不填） |

> [!INFO] **鉴权约定**
> 所有数据读写操作严格按 `_openid` 隔离。`_openid` 由云函数内 `cloud.getWXContext().OPENID` 自动获取，前端**无需传参**；每个云函数在操作前均校验数据归属权（`doc._openid === OPENID`）。

### 0.2 统一响应格式

所有云函数返回以下 JSON 结构：

```json title="成功"
{ "code": 0, "message": "ok", "data": { ... } }
```

```json title="失败"
{ "code": -1, "message": "错误描述", "data": null }
```

> 列表查询类接口在成功时额外携带 `total` 字段（分页总量）。

### 0.3 分页规范

列表查询接口遵循统一分页规格：

| 字段 | 类型 | 必填 | 默认值 | 示例值 | 校验规则 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `page` | `number` | [[选填]] | `1` | `1` | 整数 ≥1 | 页码 |
| `pageSize` | `number` | [[选填]] | `20` | `20` | 整数 1–50 | 每页条数 |

返回格式：

```json
{ "code": 0, "message": "ok", "data": [ ... ], "total": 42 }
```

### 0.4 全局枚举常量

枚举定义在 `shared/enums.ts`（SSOT 源文件），前后端共用；云函数侧由 `cloudfunctionUtil/sync-utils.js`（`npm run sync:enums`）编译为 CommonJS 并分发到各云函数目录的 `enums.js`，因此仓库根 `shared/` 下只有 `enums.ts`。

> [!WARNING] **大小写敏感**
> 枚举值严格区分大小写，取值必须与下表完全一致。

| 枚举名 | 可选值 |
| --- | --- |
| `EVENT_TYPES` | `visit` \| `medication` \| `exam` \| `symptom` \| `report` \| `treatment` |
| `TODO_TYPES` | `visit` \| `medication` \| `exam` \| `symptom` \| `report` \| `treatment` \| `custom` |
| `TODO_STATUS` | `pending` \| `done` |
| `CLUE_STATUS` | `suspect` \| `diagnosed` \| `monitoring` \| `archived` |
| `DOSE_UNITS` | `粒` \| `片` \| `ml` \| `mg` \| `包` \| `支` |

### 0.5 前端调用方式

```typescript
import { callCloudFunction } from '@/utils/cloud';

// 示例：通用调用
const res = await callCloudFunction('云函数名', { 入参对象 });
// res: { code: 0 | -1, message: string, data: any, total?: number }
```

## 一、users 集合（用户）

### login

---
name: login
title: 用户登录/注册
collection: users
version: V2.5.0
operationType: [auth]
---

每次进入小程序调用，自动识别新老用户。新用户创建记录并写入默认 `settings`（`nickName` 默认 `'微信用户'`），老用户仅刷新 `lastLoginAt`。

> [!INFO] **设计决策（2026-09-10 确认）**
> `login` 仅保留登录/注册职责，**不读取任何入参、不更新昵称/头像**；昵称与头像统一通过 `updateUserSettings` 修改。

#### 请求参数

无（实现中不读取 `nickName` / `avatarUrl`）。

#### 调用示例

```typescript
const res = await callCloudFunction('login');
// → { code: 0, message: 'ok', data: { _id: 'xxx', nickName: '微信用户', settings: { notificationEnabled: false, theme: 'auto' }, ... } }
```

#### 返回结构

##### 返回字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `_id` | `string` | 用户 ID（云数据库 `_id`；`_openid` 已脱敏移除） |
| `nickName` | `string` | 昵称 |
| `avatarUrl` | `string` | 头像 URL |
| `settings` | `object` | 用户偏好设置（新用户默认值见下） |
| `createdAt` | `Date` | 首次注册时间 |
| `lastLoginAt` | `Date` | 本次登录时间 |

##### 对象类型 settings

新用户创建时写入的默认值：

```json
{ "notificationEnabled": false, "theme": "auto" }
```

### getUserProfile

---
name: getUserProfile
title: 获取用户完整档案
collection: users
version: V2.5.0
operationType: [get]
---

获取当前登录用户的完整档案（`_openid` 由云函数自动注入）。

#### 请求参数

无（`_openid` 自动注入）。

#### 调用示例

```typescript
const res = await callCloudFunction('getUserProfile');
// → { code: 0, data: { openid: 'oXXXX', nickName: '病迹用户', settings: { notificationEnabled: false, theme: 'auto' }, ... } }
```

#### 返回结构

> [!WARNING] **返回的是 `openid`，不是 `_id`**
> 本接口与 `login` 的字段名不同：`login` 返回 `_id`，本接口返回 `openid`，迁移代码时注意区分。

##### 返回字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `openid` | `string` | 用户 `_openid` |
| `nickName` | `string` | 昵称（兜底 `'微信用户'`） |
| `avatarUrl` | `string` | 头像 URL（兜底 `''`） |
| `settings` | `object` | 用户偏好设置（兜底为默认值 `{ notificationEnabled: false, theme: 'auto' }`） |
| `createdAt` | `Date` | 首次注册时间 |
| `lastLoginAt` | `Date` | 最近登录时间 |

##### 示例

```json title="成功响应"
{
  "code": 0,
  "message": "ok",
  "data": {
    "openid": "oXXXX",
    "nickName": "病迹用户",
    "avatarUrl": "https://thirdwx.qlogo.cn/...",
    "settings": {
      "notificationEnabled": false,
      "theme": "auto",
      "weekStartDay": 1
    },
    "createdAt": "2026-06-01T08:00:00.000Z",
    "lastLoginAt": "2026-07-01T12:00:00.000Z"
  }
}
```

### updateUserSettings

---
name: updateUserSettings
title: 更新用户偏好设置
collection: users
version: V2.5.0
operationType: [update]
---

增量更新当前用户的偏好设置、昵称、头像；`settings` 为**合并**更新，仅覆盖传入的子字段。

#### 请求参数

##### 通用字段

| 字段 | 类型 | 必填 | 默认值 | 示例值 | 校验规则 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `settings` | `object` | [[选填]] | — | `{ "notificationEnabled": false }` | 对象类型，见下 | 增量**合并**更新，仅覆盖传入的子字段 |
| `nickName` | `string` | [[选填]] | — | `"病迹用户"` | 字符串，自动 `trim()` | 更新昵称 |
| `avatarUrl` | `string` | [[选填]] | — | `"https://thirdwx.qlogo.cn/..."` | 字符串 | 更新头像 URL |

> [!WARNING] **至少传一个**
> 三个字段均可选，但至少要传一个，否则返回 `"没有可更新的字段"`。

##### 对象类型 settings

| 字段 | 类型 | 必填 | 默认值 | 示例值 | 校验规则 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `notificationEnabled` | `boolean` | [[选填]] | `true` | `false` | 布尔值 | 通知开关（`login` 创建新用户时写入的默认值为 `false`） |
| `theme` | `string` | [[选填]] | `'auto'` | `"auto"` | `light` \| `dark` \| `auto` | 主题 |
| `weekStartDay` | `number` | [[选填]] | `1` | `1` | `0`=周日，`1`=周一 | 周起始日 |

#### 调用示例

```typescript
const res = await callCloudFunction('updateUserSettings', {
  settings: { notificationEnabled: false },
});
// → { code: 0, message: '更新成功', data: { openid: 'oXXXX', nickName: '...', settings: { ... }, ... } }
```

#### 返回结构

返回更新后的完整用户对象（结构同 `getUserProfile`），不再返回 `{ updated: true }`。

```json
{
  "openid": "oXXXX",
  "nickName": "病迹用户",
  "avatarUrl": "https://thirdwx.qlogo.cn/...",
  "settings": { "notificationEnabled": false, "theme": "auto", "weekStartDay": 1 },
  "createdAt": "2026-06-01T08:00:00.000Z",
  "lastLoginAt": "2026-07-01T12:00:00.000Z"
}
```

## 二、events 集合（事件记录）

> 所有 6 种事件类型的 metadata 扩展字段，参见 [附录 A：events.metadata 字段表](#附录-a-eventsmetadata-字段表)。

### addEvent

---
name: addEvent
title: 新增事件
collection: events
version: V2.5.0
operationType: [add]
---

新增一条事件记录；前关联、线索关联与 `metadata` 扩展字段均在同一个 `eventData` 中传入。

#### 请求参数

##### 通用字段

| 字段 | 类型 | 必填 | 默认值 | 示例值 | 校验规则 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `eventData` | `object` | [[必填]] | — | `{ ... }` | 非空对象 | 事件主体，字段见下 |
| └ `type` | `string` | [[必填]] | — | `"visit"` | 必须在 `EVENT_TYPES` 中 | 事件类型 |
| └ `date` | `string` | [[必填]] | — | `"2026-06-23"` | 格式 `YYYY-MM-DD` | 发生日期 |
| └ `title` | `string` | [[必填]] | — | `"协和医院复诊"` | 非空字符串 | 事件标题 |
| └ `time` | `string` | [[选填]] | — | `"14:30"` | 格式 `HH:mm` | 发生时间 |
| └ `content` | `string` | [[选填]] | — | `"复查血常规"` | 任意字符串 | 详细描述/摘要 |
| └ `tags` | `string[]` | [[选填]] | — | `["复诊"]` | 字符串数组 | 自定义标签 |
| └ `clueIds` | `string[]` | [[选填]] | — | `["clue_id_123"]` | 元素为有效线索 `_id`，不存在则报错 | 关联线索 ID |
| └ `images` | `string[]` | [[选填]] | — | `[]` | fileID 数组，图片 + 文件合计 ≤3 个 | 图片附件 |
| └ `files` | `FileInfo[]` | [[选填]] | — | `[]` | 仅限 PDF，与图片合计 ≤3 个 | PDF 文件附件 |
| └ `prevEventId` | `string` | [[选填]] | — | `""` | 有效事件 `_id` | 前关联事件 ID |
| └ `metadata` | `object` | [[选填]] | — | `{ ... }` | 按 `type` 校验必填字段（见下） | 类型扩展字段 |

##### 对象类型 FileInfo

| 字段 | 类型 | 必填 | 默认值 | 示例值 | 校验规则 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `name` | `string` | [[必填]] | — | — | 非空字符串 | 文件名 |
| `fileID` | `string` | [[必填]] | — | — | 云存储 fileID | 文件地址 |

##### metadata 按类型必填字段

云函数实际校验逻辑见 `addEvent/index.js` 的 `REQUIRED_FIELDS`。

| type | 必填 metadata 字段 |
| --- | --- |
| `medication` | `drugName`、`dose`、`frequency`、`doseCount` |
| `exam` | `examName` |
| `report` | `reportType` |
| `treatment` | `treatmentType` |
| `visit` / `symptom` | 无额外必填字段 |

> [!WARNING] **通用必填字段**
> 上表**除 `title` / `date` 外**，所有类型均强制要求通用字段 `title` 与 `date`，缺失即返回 `缺少必填字段：xxx`。

> [!INFO] **medication 的校验为何能通过**
> 业务数据以 `metadata.newRegimen` / `oldRegimen`（数组）为准；前端 `useSaveHandler` 在保存用药事件时，会由 `newRegimen[0]` **冗余写入**扁平字段 `drugName` / `dose` / `frequency`，并以有效药品数量写入 `doseCount`，从而通过云函数的必填校验。这四个扁平字段是**过渡期兼容字段**，读取请一律使用数组字段，待校验规则同步为数组后可移除。

> [!WARNING] **文件体积云函数不校验**
> `images` / `files`（PDF）的**体积上限（单个 ≤ 10MB）云函数不校验**，前端 `useMediaUpload` 当前只限制总数 3 个，见该文件 `TODO(B-5)`。

#### 调用示例

```typescript
const res = await callCloudFunction('addEvent', {
  eventData: {
    type: 'visit',
    date: '2026-06-23',
    time: '14:30',
    title: '协和医院复诊',
    content: '复查血常规',
    clueIds: ['clue_id_123'],
    tags: ['复诊'],
    metadata: {
      hospital: '北京协和医院',
      department: '风湿免疫科',
      doctor: '张医生',
      diagnosis: '病情稳定',
    },
  },
});
// → { code: 0, data: { _id: 'event_new_001', prevEventId: '', event: { _id: 'event_new_001', type: 'visit', ... } } }
```

#### 返回结构

##### 返回字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `_id` | `string` | 新事件 ID |
| `prevEventId` | `string` | 前关联事件 ID，无关联时为 `''` |
| `event` | `object` | 新建事件的完整文档，结构同 [`getEvents`](#getevents) 的单条结构（供前端缓存） |

##### 示例

```json title="成功响应"
{
  "_id": "event_new_001",
  "prevEventId": "",
  "event": { /* 新建事件的完整文档，同 getEvents 单条结构 */ }
}
```

> [!DANGER] **FIXME（数据一致性）**
> `addEvent` 未使用事务——事件文档写入后，才更新前关联源事件的 `nextEventIds`；该步骤失败不会回滚，会残留「事件已创建但源事件未追加 `nextEventIds`」的不一致状态。详见 `cloudfunctions/addEvent/index.js` 中的 `FIXME(数据一致性)` 注释。

---

### getEvents

---
name: getEvents
title: 查询事件列表
collection: events
version: V2.5.0
operationType: [get]
---

按条件分页查询当前用户的事件列表。

#### 请求参数

##### 通用字段

| 字段 | 类型 | 必填 | 默认值 | 示例值 | 校验规则 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `page` | `number` | [[选填]] | `1` | `1` | 整数 ≥1 | 页码 |
| `pageSize` | `number` | [[选填]] | `20` | `20` | 整数 1–50，服务端不校验上限，由前端保证 | 每页条数 |
| `dateRange` | `object` | [[选填]] | — | `{ "start": "2026-06-01", "end": "2026-06-30" }` | `start` / `end` 为 `YYYY-MM-DD` | 日期范围（含边界） |
| `clueIds` | `string[]` | [[选填]] | — | `["clue_123"]` | 元素为有效线索 `_id` | 按多个线索 ID 筛选 |
| `types` | `string[]` | [[选填]] | — | `["visit", "exam"]` | 元素必须在 `EVENT_TYPES` 中，非法值自动过滤 | 按多个事件类型筛选 |
| `hospitals` | `string[]` | [[选填]] | — | `["协和"]` | 非空字符串数组 | 按医院关键词模糊匹配 `metadata.hospital`，不区分大小写 |
| `clueIdsEmpty` | `boolean` | [[选填]] | — | `true` | `true` 时生效，优先级高于 `clueIds` | 筛选**未关联任何线索**的事件 |

> [!INFO] **排序规则**
> 按 `date` 降序 → `createdAt` 降序。

> [!WARNING] **`openid` 参数不生效**
> 文档早前列出的 `openid` 调试参数在当前实现中**不生效**，云函数固定使用 `cloud.getWXContext().OPENID`。

#### 调用示例

:::tabs
:::tab 无筛选
```typescript
// 分页拉取全部
const res = await callCloudFunction('getEvents', { page: 1, pageSize: 20 });
// → { code: 0, data: [...], total: 42 }
```
:::
:::tab 组合筛选
```typescript
const res = await callCloudFunction('getEvents', {
  page: 1,
  pageSize: 20,
  dateRange: { start: '2026-06-01', end: '2026-06-30' },
  types: ['visit', 'exam', 'report'],
  clueIds: ['clue_123', 'clue_456'],
  hospitals: ['协和', '人民'],
});
```
:::
:::

#### 返回结构

##### 返回字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `data` | `object[]` | 事件数组，单条结构见下 |
| `total` | `number` | 满足条件的总条数（分页总量） |

##### 示例

```json title="成功响应"
{
  "code": 0,
  "message": "ok",
  "data": [ /* 事件数组 */ ],
  "total": 42
}
```

##### data 元素结构

与原数据库文档一致：

| 字段 | 类型 | 示例值 | 说明 |
| --- | --- | --- | --- |
| `_id` | `string` | `"evt_001"` | 事件 ID |
| `type` | `string` | `"visit"` | 事件类型 |
| `date` | `string` | `"2026-06-23"` | 发生日期 |
| `time` | `string` | `"14:30"` | 发生时间 |
| `title` | `string` | `"协和医院复诊"` | 事件标题 |
| `content` | `string` | `"复查血常规"` | 详细描述/摘要 |
| `tags` | `string[]` | `["复诊"]` | 自定义标签 |
| `clueIds` | `string[]` | `["clue_123"]` | 关联线索 ID |
| `images` | `string[]` | `[]` | 图片附件 |
| `files` | `FileInfo[]` | `[]` | PDF 文件附件 |
| `prevEventId` | `string` | `""` | 前关联事件 ID |
| `nextEventIds` | `string[]` | `[]` | 后关联事件 ID 数组 |
| `metadata` | `object` | `{ ... }` | 类型扩展字段 |
| `createdAt` | `Date` | `"2026-06-23T06:30:00.000Z"` | 创建时间 |
| `updatedAt` | `Date` | `null` | 更新时间（未更新时为 `null`） |

> [!WARNING] **列表接口未脱敏**
> `getEvents` / `getTodos` / `getClues` / `getMedicationHabits` 当前均**原样返回数据库文档（含 `_openid`）**，并未脱敏；只有 `getClueDetail` 会调用 `stripOpenid` / `stripOpenidList` 移除 `_openid`。如需统一脱敏，需修改对应云函数。

---

### getEventDetail

---
name: getEventDetail
title: 获取事件详情
collection: events
version: V2.5.0
operationType: [get]
---

获取单条事件的完整数据及其前后关联事件。

#### 请求参数

##### 通用字段

| 字段 | 类型 | 必填 | 默认值 | 示例值 | 校验规则 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `eventId` | `string` | [[必填]] | — | `"evt_001"` | 非空 | 事件 ID |

> [!INFO] **权限校验**
> 云函数校验 `event._openid === OPENID`，无权限返回 `{ code: -1, message: '无权访问该事件' }`。

#### 调用示例

```typescript
const res = await callCloudFunction('getEventDetail', {
  eventId: 'evt_001',
});
// → { code: 0, data: { event: {...}, prevEvent: {...}, nextEvents: [...] } }
```

#### 返回结构

##### 返回字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `event` | `object` | 事件完整数据，结构同 [`getEvents`](#getevents) 的 data 元素 |
| `prevEvent` | `object \| null` | 前关联事件摘要（`_id` / `title` / `date` / `type`），无关联时为 `null` |
| `nextEvents` | `object[]` | 后关联事件摘要数组，元素结构同上 |

##### 示例

```json title="成功响应"
{
  "event": { /* 事件完整数据，同 getEvents 单条结构 */ },
  "prevEvent": { "_id": "...", "title": "...", "date": "...", "type": "..." },
  "nextEvents": [
    { "_id": "...", "title": "...", "date": "...", "type": "..." }
  ]
}
```

---

### getEventAggregatedData

---
name: getEventAggregatedData
title: 聚合历史选项
collection: events
version: V2.5.0
operationType: [get]
---

聚合当前用户的历史选项（医院 / 科室 / 医生 / 检查 / 药品 / 指标），供前端输入框补全。

#### 请求参数

无（自动按当前用户 `_openid` 过滤）。

#### 调用示例

```typescript
const res = await callCloudFunction('getEventAggregatedData');
// → { code: 0, data: { hospitals: [...], departments: [...], doctors: [...], examNames: [...], drugNames: [...], metricNames: [...] } }
```

#### 返回结构

##### 返回字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `hospitals` | `object[]` | 医院，元素为 `{ name, count }` |
| `departments` | `object[]` | 科室，元素为 `{ name, count }` |
| `doctors` | `object[]` | 医生，元素为 `{ name, count }`；v2.5 起实际返回（原文档遗漏） |
| `examNames` | `object[]` | 检查项，元素为 `{ name, count }` |
| `drugNames` | `object[]` | 药品，元素为 `{ name, count }`；来源于 `metadata.newRegimen[].drugName`，**与 `addEvent` 校验的扁平字段不一致**（见 [`addEvent`](#addevent)） |
| `metricNames` | `object[]` | 指标，元素为 `{ metricName, unit, referenceRange, count }`；仅统计 `type === 'report'` 的事件 |

##### 示例

```json title="成功响应"
{
  "hospitals":   [ { "name": "北京协和医院", "count": 12 }, { "name": "301医院", "count": 5 } ],
  "departments": [ { "name": "风湿免疫科", "count": 8 }, { "name": "骨科", "count": 3 } ],
  "doctors":     [ { "name": "张医生", "count": 6 } ],
  "examNames":   [ { "name": "血常规", "count": 15 }, { "name": "尿常规", "count": 10 } ],
  "drugNames":   [ { "name": "甲氨蝶呤", "count": 20 }, { "name": "来氟米特", "count": 8 } ],
  "metricNames": [
    { "metricName": "总胆固醇", "unit": "mmol/L", "referenceRange": "2.8-5.2", "count": 4 }
  ]
}
```

##### 聚合逻辑

一次性拉取当前用户 events（`field` 仅取 `metadata` / `type`，**上限 500 条**），从 `metadata` 中提取 `hospital` / `department` / `doctor` / `examName`，Map 计数后按频次降序返回；`metricNames` 按 `metricName::unit::referenceRange` 三元组去重后按频次降序。

> [!WARNING] **已知限制（2026-09-10 确认可接受）**
> 聚合仅覆盖**最近 500 条**事件（`MAX = 500`，未分页遍历）。事件总数超过 500 的用户，其更早的医院 / 科室 / 检查 / 药品 / 指标不会出现在补全建议中；若后续数据量增长，需改为分页聚合或引入独立统计集合。

---

### updateEvent

---
name: updateEvent
title: 更新事件
collection: events
version: V2.5.0
operationType: [update]
---

增量更新事件；仅更新 `updateData` 中传入的字段。

#### 请求参数

##### 通用字段

| 字段 | 类型 | 必填 | 默认值 | 示例值 | 校验规则 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `eventId` | `string` | [[必填]] | — | `"evt_001"` | 非空 | 事件 ID |
| `updateData` | `object` | [[必填]] | — | `{ "title": "..." }` | 非空对象 | 增量更新字段，可更新字段见下 |

##### 对象类型 updateData

| 字段 | 类型 | 必填 | 默认值 | 示例值 | 校验规则 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `type` | `string` | [[选填]] | — | — | 必须在 `EVENT_TYPES` 中 | 事件类型 |
| `date` | `string` | [[选填]] | — | — | 格式 `YYYY-MM-DD` | 发生日期 |
| `time` | `string` | [[选填]] | — | — | 格式 `HH:mm` | 发生时间 |
| `title` | `string` | [[选填]] | — | `"协和医院复诊（已修改）"` | 非空 | 事件标题 |
| `content` | `string` | [[选填]] | — | `"更新后的备注"` | 任意 | 详细描述/摘要 |
| `tags` | `string[]` | [[选填]] | — | — | 字符串数组 | 自定义标签 |
| `clueIds` | `string[]` | [[选填]] | — | — | 关联线索 ID，无效 ID 报错 | 关联线索 ID |
| `images` | `string[]` | [[选填]] | — | — | fileID 数组 | 图片附件 |
| `files` | `FileInfo[]` | [[选填]] | — | — | 仅限 PDF | PDF 文件附件 |
| `prevEventId` | `string` | [[选填]] | — | `""` | 传 `''` 可取消前关联 | 前关联事件 ID |
| `metadata` | `object` | [[选填]] | — | — | 按 `type` 校验必填字段 | 类型扩展字段 |

#### 调用示例

```typescript
const res = await callCloudFunction('updateEvent', {
  eventId: 'evt_001',
  updateData: {
    title: '协和医院复诊（已修改）',
    content: '更新后的备注',
  },
});
// → { code: 0, data: { eventId: 'evt_001', prevEventChanged: false, cluesChanged: false, event: { _id: 'evt_001', ... } } }
```

#### 返回结构

##### 返回字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `eventId` | `string` | 事件 ID |
| `prevEventChanged` | `boolean` | 前关联是否发生变化，前端可据此决定是否刷新上下游页面 |
| `cluesChanged` | `boolean` | 线索关联是否发生变化，同上 |
| `event` | `object` | 更新后的完整事件文档（v2.4 新增），前端可直接写入本地缓存 |

##### 示例

```json title="成功响应"
{
  "eventId": "evt_001",
  "prevEventChanged": true,
  "cluesChanged": false,
  "event": { /* 更新后的完整事件文档，同 getEvents 单条结构 */ }
}
```

> [!DANGER] **FIXME（数据一致性）**
> `updateEvent` 未使用事务——事件本身先更新，之后再同步前关联 `nextEventIds` 与线索 `eventIds`；后续步骤失败时不会回滚，会残留不一致状态。详见 `cloudfunctions/updateEvent/index.js` 中的 `FIXME(数据一致性)` 注释。

---

### deleteEvent

---
name: deleteEvent
title: 删除事件
collection: events
version: V2.5.0
operationType: [delete]
deprecated: true
replacement: batchDeleteEvent
---

前端已全部切换至 [`batchDeleteEvent`](#batchdeleteevent)（事务性原子删除，避免多集合数据不一致）。本函数**暂时保留**在仓库中，以备后期调整，请勿在新逻辑中调用。

#### 请求参数

##### 通用字段

| 字段 | 类型 | 必填 | 默认值 | 示例值 | 校验规则 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `eventId` | `string` | [[必填]] | — | `"evt_001"` | 非空 | 事件 ID |

#### 行为

- 硬删除事件
- 更新前关联源事件的 `nextEventIds`（移除当前 ID）；源事件不存在时不阻断
- 更新关联线索的 `eventIds`（移除当前 ID）、`recordCount -1`；线索不存在时不阻断
- **删除云存储中的 `images` + `files[].fileID`**（失败不阻断主流程）
- **不删除**关联的 Todo
- **不删除**关联的 medication_habit

#### 调用示例

```typescript
const res = await callCloudFunction('deleteEvent', {
  eventId: 'evt_001',
});
// → { code: 0, data: { eventId: 'evt_001', prevEventId: 'prev_001', clueIds: ['clue_123'] } }
```

#### 返回结构

##### 返回字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `eventId` | `string` | 被删除的事件 ID |
| `prevEventId` | `string` | 前关联事件 ID（已同步移除 `nextEventIds`） |
| `clueIds` | `string[]` | 关联线索 ID（已同步更新 `eventIds` / `recordCount`） |

##### 示例

```json title="成功响应"
{
  "eventId": "evt_001",
  "prevEventId": "prev_event_id",
  "clueIds": ["clue_123"]
}
```

### batchDeleteEvent

---
name: batchDeleteEvent
title: 事务性删除事件及关联记录
collection: events
version: V2.5.0
operationType: [delete]
---

前端实际使用的删除入口。使用 `db.startTransaction()` 保证「事件 + 待办 + 用药打卡」的多集合原子删除。

#### 请求参数

##### 通用字段

| 字段 | 类型 | 必填 | 默认值 | 示例值 | 校验规则 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `eventId` | `string` | [[必填]] | — | `"evt_001"` | 非空 | 待删除事件 ID |
| `todoIds` | `string[]` | [[选填]] | `[]` | `["todo_001"]` | 元素为本人待办 ID | 需同步删除的关联待办 |
| `habitIds` | `string[]` | [[选填]] | `[]` | `["habit_001"]` | 元素为本人用药打卡 ID | 需同步删除的关联用药打卡 |

#### 行为

- **事务内**：删除事件 → 移除前关联源事件的 `nextEventIds` → 更新关联线索 `eventIds` / `recordCount -1` → 删除 `todoIds` → 删除 `habitIds`
- 事务内任一操作失败则整体回滚，返回 `{ code: -1, message: '删除失败，数据已回滚: ...' }`
- 事务前已完成归属权校验，以及源事件 / 线索的存在性预检（不存在则跳过对应更新）
- **事务外**：清理云存储 `images` + `files[].fileID`（失败不阻断，数据库已提交）

> [!DANGER] **事务外清理不可回滚（数据一致性）**
> 云存储文件的清理在事务提交之后执行，失败时不会回滚，会残留「数据库记录已删除、云存储文件仍在」的不一致状态。

#### 调用示例

```typescript
const res = await callCloudFunction('batchDeleteEvent', {
  eventId: 'evt_001',
  todoIds: ['todo_001'],
  habitIds: ['habit_001'],
});
// → { code: 0, message: '事件及关联记录已删除', data: { eventId: 'evt_001', ..., deletedTodoCount: 1, deletedHabitCount: 1 } }
```

#### 返回结构

##### 返回字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `eventId` | `string` | 被删除的事件 ID |
| `prevEventId` | `string` | 前关联事件 ID（已同步移除 `nextEventIds`） |
| `clueIds` | `string[]` | 关联线索 ID（已同步更新 `eventIds` / `recordCount`） |
| `deletedTodoCount` | `number` | 实际删除的待办数量 |
| `deletedHabitCount` | `number` | 实际删除的用药打卡数量 |

##### 示例

```json title="成功响应"
{
  "eventId": "evt_001",
  "prevEventId": "prev_event_id",
  "clueIds": ["clue_123"],
  "deletedTodoCount": 2,
  "deletedHabitCount": 1
}
```

## 三、todos 集合（待办）

### addTodo

---
name: addTodo
title: 新增待办
collection: todos
version: V2.5.0
operationType: [add]
---

新增一条待办。所有字段需包裹在 `todoData` 嵌套对象中，云函数只读取 `event.todoData`。

#### 请求参数

##### 通用字段

| 字段 | 类型 | 必填 | 默认值 | 示例值 | 校验规则 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `todoData` | `object` | [[必填]] | — | `{ ... }` | 非空对象 | 待办主体，字段见下 |
| └ `title` | `string` | [[必填]] | — | `"复查血常规"` | 非空字符串，自动 `trim()` | 待办标题 |
| └ `type` | `string` | [[选填]] | `custom` | `"exam"` | 必须在 `TODO_TYPES` 中 | 待办类型 |
| └ `dueDate` | `string` | [[必填]] | — | `"2026-07-22"` | 非空，ISO 日期格式 `YYYY-MM-DD` | 到期日 |
| └ `dueTime` | `string` | [[选填]] | `''` | `"14:30"` | `HH:mm` 格式 | 到期时间 |
| └ `desc` | `string` | [[选填]] | `''` | `"摘要: 协和医院复诊\n内容: 血常规复查，需空腹"` | 任意 | 描述，自动生成时包含摘要 + 内容 |
| └ `sourceEventId` | `string` | [[选填]] | — | `"evt_001"` | 有效事件 `_id`；仅存储，云函数不做存在性校验 | 来源事件 ID |
| └ `sourceEventTitle` | `string` | [[选填]] | — | `"协和医院复诊"` | 任意 | 来源事件标题（冗余展示） |
| └ `relatedClue` | `string` | [[选填]] | — | `"胃炎"` | 任意 | 关联线索名称 |
| └ `relatedData` | `object` | [[选填]] | `{}` | `{ "hospital": "协和医院", ... }` | 结构为 `{ hospital, department, doctor }` | 关联数据，完成时预填记一笔 |

> [!INFO] **云函数自动写入字段**
> 云函数自动写入 `status: 'pending'` 与 `createdAt`。

#### 调用示例

```typescript
const res = await callCloudFunction('addTodo', {
  todoData: {
    title: '复查血常规',
    type: 'exam',
    dueDate: '2026-07-22',
    dueTime: '14:30',
    desc: '摘要: 协和医院复诊\n内容: 血常规复查，需空腹',
    sourceEventId: 'evt_001',
    sourceEventTitle: '协和医院复诊',
    relatedClue: '胃炎',
    relatedData: { hospital: '协和医院', department: '消化内科', doctor: '张医生' },
  },
});
// → { code: 0, data: { _id: 'todo_new_001' } }
```

#### 返回结构

##### 返回字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `_id` | `string` | 新建待办 ID |

##### 示例

```json title="成功响应"
{ "_id": "todo_new_001" }
```

---

### getTodos

---
name: getTodos
title: 查询待办列表
collection: todos
version: V2.5.0
operationType: [get]
---

按条件分页查询当前用户的待办列表。

#### 请求参数

##### 通用字段

| 字段 | 类型 | 必填 | 默认值 | 示例值 | 校验规则 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `page` | `number` | [[选填]] | `1` | `1` | 整数 ≥1 | 页码 |
| `pageSize` | `number` | [[选填]] | `50` | `20` | 整数 1–50 | 每页条数 |
| `status` | `string` | [[选填]] | — | `"pending"` | `pending` \| `done` | 不传 = 全部 |
| `dueDateStart` | `string` | [[选填]] | — | — | ISO 日期 | 到期日范围起 |
| `dueDateEnd` | `string` | [[选填]] | — | — | ISO 日期 | 到期日范围止 |
| `type` | `string` | [[选填]] | — | `"visit"` | 必须在 `TODO_TYPES` 中 | 按类型筛选 |
| `sourceEventId` | `string` | [[选填]] | — | — | 有效事件 `_id` | 按来源事件筛选（事件详情页获取关联待办） |

> [!INFO] **排序规则**
> 按 `dueDate` 升序。

#### 调用示例

:::tabs
:::tab 查全部待办
```typescript
const res = await callCloudFunction('getTodos', { page: 1, pageSize: 20 });
// → { code: 0, data: [...], total: 5 }
```
:::
:::tab 按状态 + 类型
```typescript
// 只查未完成的 visit 类待办
const res = await callCloudFunction('getTodos', {
  status: 'pending',
  type: 'visit',
});
```
:::
:::

#### 返回结构

##### 返回字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `data` | `object[]` | 待办数组，单条结构见下 |
| `total` | `number` | 满足条件的总条数（分页总量） |

##### 示例

```json title="成功响应"
{
  "code": 0,
  "message": "ok",
  "data": [ /* 待办数组 */ ],
  "total": 5
}
```

##### data 元素结构

| 字段 | 类型 | 示例值 | 说明 |
| --- | --- | --- | --- |
| `_id` | `string` | `"todo_001"` | 待办 ID |
| `title` | `string` | `"复查血常规"` | 待办标题 |
| `desc` | `string` | `"协和医院 · 需空腹"` | 描述 |
| `dueDate` | `string` | `"2026-07-22"` | 到期日 |
| `dueTime` | `string` | `"14:30"` | 到期时间 |
| `status` | `string` | `"pending"` | 完成状态，`pending` \| `done` |
| `type` | `string` | `"exam"` | 待办类型 |
| `sourceEventId` | `string` | `"evt_001"` | 来源事件 ID |
| `sourceEventTitle` | `string` | `"协和医院复诊"` | 来源事件标题（冗余展示） |
| `relatedClue` | `string` | `"干燥综合征"` | 关联线索名称 |
| `relatedData` | `object` | `{ "hospital": "协和医院", ... }` | 关联数据 `{ hospital, department, doctor }` |
| `createdAt` | `Date` | `"2026-06-26T..."` | 创建时间 |
| `updatedAt` | `Date` | `null` | 更新时间（未更新时为 `null`） |

---

### updateTodo

---
name: updateTodo
title: 更新待办
collection: todos
version: V2.5.0
operationType: [update]
---

增量更新待办；`updateData` 中不在白名单内的字段会被忽略。

#### 请求参数

##### 通用字段

| 字段 | 类型 | 必填 | 默认值 | 示例值 | 校验规则 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `todoId` | `string` | [[必填]] | — | `"todo_001"` | 非空 | 待办 ID |
| `updateData` | `object` | [[必填]] | — | `{ "status": "done" }` | 非空对象，白名单外的字段忽略，不受支持 | 增量更新字段，可更新字段见下 |

##### 对象类型 updateData

| 字段 | 类型 | 必填 | 默认值 | 示例值 | 校验规则 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `status` | `string` | [[选填]] | — | `"done"` | `pending` \| `done`，**不支持 `done` 布尔参数** | 完成状态 |
| `title` | `string` | [[选填]] | — | — | 非空，自动 `trim()` | 待办标题 |
| `desc` | `string` | [[选填]] | — | — | 任意 | 描述 |
| `dueDate` | `string` | [[选填]] | — | `"2026-07-25"` | ISO 日期 | 到期日 |
| `dueTime` | `string` | [[选填]] | — | — | `HH:mm` | 到期时间 |
| `type` | `string` | [[选填]] | — | — | 必须在 `TODO_TYPES` 中 | 待办类型 |
| `relatedClue` | `string` | [[选填]] | — | — | 任意 | 关联线索名称 |

> [!WARNING] **切换完成状态的副作用**
> `status='done'` 时写入 `doneAt = db.serverDate()`（字段名为 **`doneAt`**，不是 `completedAt`）；`status='pending'` 时置 `doneAt = null`。每次更新都会刷新 `updatedAt`。

> [!INFO] **命名决策（2026-09-10 确认）**
> **保留 `doneAt`**，不改名为 `completedAt`。理由：该字段已是实际落库值，且前端不消费（完成态完全由 `status` 决定），改名只带来存量数据迁移成本。

#### 调用示例

:::tabs
:::tab 标记完成
```typescript
const res = await callCloudFunction('updateTodo', {
  todoId: 'todo_001',
  updateData: { status: 'done' },
});
// → { code: 0, message: '待办已更新', data: { todoId: 'todo_001', doneAt: '2026-07-22T...' } }
```
:::
:::tab 推迟到期日
```typescript
const res = await callCloudFunction('updateTodo', {
  todoId: 'todo_001',
  updateData: { dueDate: '2026-07-25' },
});
```
:::
:::

#### 返回结构

##### 返回字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `todoId` | `string` | 待办 ID |
| `doneAt` | `string \| null` | 状态切换为 `done` 时的时间；未发生状态切换时为 `null` |

##### 示例

```json title="成功响应"
{ "todoId": "todo_001", "doneAt": "2026-07-22T06:30:00.000Z" }
```

> [!WARNING] **不再返回 `{ updated: true }`**
> 未发生状态切换时 `doneAt` 返回 `null`；响应中**不再包含** `{ updated: true }`。

---

### deleteTodo

---
name: deleteTodo
title: 删除待办
collection: todos
version: V2.5.0
operationType: [delete]
---

硬删除待办。

#### 请求参数

##### 通用字段

| 字段 | 类型 | 必填 | 默认值 | 示例值 | 校验规则 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `todoId` | `string` | [[必填]] | — | `"todo_001"` | 非空 | 待办 ID |

#### 行为

- 硬删除待办
- **不影响**源事件的关联

> [!WARNING] **硬删除不可恢复**
> 该接口直接物理删除待办文档，删除后无法恢复。

#### 调用示例

```typescript
const res = await callCloudFunction('deleteTodo', {
  todoId: 'todo_001',
});
// → { code: 0, data: { todoId: 'todo_001', sourceEventId: 'evt_001' } }
```

#### 返回结构

##### 返回字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `todoId` | `string` | 被删除的待办 ID |
| `sourceEventId` | `string` | 来源事件 ID |

##### 示例

```json title="成功响应"
{ "todoId": "todo_001", "sourceEventId": "evt_001" }
```

## 四、medication_habits 集合（用药打卡）

### addMedicationHabit

---
name: addMedicationHabit
title: 新增用药打卡
collection: medication_habits
version: V2.5.0
operationType: [add]
---

新增一条用药打卡计划。所有字段需包裹在 `habitData` 嵌套对象中，云函数只读取 `event.habitData`。

#### 请求参数

##### 通用字段

| 字段 | 类型 | 必填 | 默认值 | 示例值 | 校验规则 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `habitData` | `object` | [[必填]] | — | `{ ... }` | 非空对象 | 用药计划主体，字段见下 |
| └ `medicationName` | `string` | [[必填]] | — | `"甲泼尼龙"` | 非空字符串，自动 `trim()` | 药品名称 |
| └ `dose` | `string \| number` | [[必填]] | — | `2` | 非空；字符串须可转为有效数值 | 剂量数值，入库统一为 number |
| └ `doseUnit` | `string` | [[必填]] | — | `"mg"` | 非空字符串 | 剂量单位 |
| └ `frequency` | `string` | [[必填]] | — | `"1"` | 正整数（`"1"` / `"2"` / `"7"`） | 服药周期（每 x 天） |
| └ `timing` | `string[]` | [[必填]] | — | `["08:00"]` | 非空数组，每项匹配 24 小时制 `HH:MM` 且**不得重复** | 每日服药时间（入库前去重 + 升序） |
| └ `startDate` | `string` | [[必填]] | — | `"2026-06-22"` | 非空 | 开始日期 |
| └ `spec` | `string` | [[选填]] | — | `"4mg/片"` | 字符串 | 规格 |
| └ `endDate` | `string` | [[选填]] | `''` | — | `YYYY-MM-DD` | 结束日期 |
| └ `relatedClue` | `string` | [[选填]] | — | — | 任意 | 关联线索名称 |
| └ `sourceEventId` | `string` | [[选填]] | — | — | 有效事件 `_id` | 来源事件 ID |
| └ `dailyRecords` | `object` | [[选填]] | `{}` | `{ "2026-06-28": [true] }` | `{ 'YYYY-MM-DD': boolean[] }` | 初始打卡记录 |

> [!INFO] **字段校验**
> `frequency` 必须为正整数；`timing` 每项必须匹配 24 小时制 `HH:MM`（正则为 `/^([01]\d|2[0-3]):([0-5]\d)$/`，即 `00:00`~`23:59`）且**不得有重复时间**；`dose` / `doseUnit` 非空。

> [!INFO] **云函数自动写入字段**
> 新建时云函数固定写入 `isActive: true`、`history: {}`、`createdAt`。

#### 调用示例

```typescript
const res = await callCloudFunction('addMedicationHabit', {
  habitData: {
    medicationName: '甲泼尼龙',
    dose: 2,
    doseUnit: 'mg',
    frequency: '1',
    timing: ['08:00'],
    startDate: '2026-06-22',
    spec: '4mg/片',
  },
});
// → { code: 0, message: '用药打卡已创建', data: { _id: 'habit_new_001' } }
```

#### 返回结构

##### 返回字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `_id` | `string` | 新建用药打卡 ID |

##### 示例

```json title="成功响应"
{ "_id": "habit_new_001" }
```

---

### getMedicationHabits

---
name: getMedicationHabits
title: 查询用药打卡列表
collection: medication_habits
version: V2.5.0
operationType: [get]
---

按条件分页查询当前用户的用药打卡列表。

#### 请求参数

##### 通用字段

| 字段 | 类型 | 必填 | 默认值 | 示例值 | 校验规则 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `page` | `number` | [[选填]] | `1` | `1` | 整数 ≥1 | 页码 |
| `pageSize` | `number` | [[选填]] | `50` | — | 整数 1–50 | 每页条数 |
| `isActive` | `boolean` | [[选填]] | — | `true` | 布尔值 | `true` = 仅激活 / `false` = 仅停用 / 不传 = 全部 |
| `keyword` | `string` | [[选填]] | — | `"甲泼尼龙"` | 非空 | 药品名称模糊匹配（不区分大小写） |
| `sourceEventId` | `string` | [[选填]] | — | — | 有效事件 `_id` | 按来源事件筛选（事件详情页 / 记一笔回填使用） |

> [!INFO] **排序规则**
> 按 `createdAt` 倒序。

#### 调用示例

:::tabs
:::tab 获取激活的用药打卡
```typescript
const res = await callCloudFunction('getMedicationHabits', { isActive: true });
// → { code: 0, data: [...], total: 3 }
```
:::
:::tab 按药品名搜索
```typescript
const res = await callCloudFunction('getMedicationHabits', { keyword: '甲泼尼龙' });
```
:::
:::

#### 返回结构

##### 返回字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `data` | `object[]` | 用药打卡数组，单条结构见下 |
| `total` | `number` | 满足条件的总条数（分页总量） |

##### 示例

```json title="成功响应"
{
  "code": 0,
  "message": "ok",
  "data": [ /* 用药打卡数组 */ ],
  "total": 3
}
```

##### data 元素结构

| 字段 | 类型 | 示例值 | 说明 |
| --- | --- | --- | --- |
| `_id` | `string` | `"habit_001"` | 用药打卡 ID |
| `medicationName` | `string` | `"甲泼尼龙"` | 药品名称 |
| `dose` | `number` | `2` | 剂量数值 |
| `doseUnit` | `string` | `"mg"` | 剂量单位 |
| `spec` | `string` | `"4mg/片"` | 规格 |
| `frequency` | `string` | `"1"` | 服药周期（每 x 天） |
| `timing` | `string[]` | `["08:00"]` | 每日服药时间（已去重 + 升序） |
| `startDate` | `string` | `"2026-06-22"` | 开始日期 |
| `endDate` | `string` | `""` | 结束日期，未设置时存 `''` |
| `isActive` | `boolean` | `true` | 是否激活，`false` 表示已软停用 |
| `dailyRecords` | `object` | `{ "2026-06-28": [true], ... }` | 打卡记录 `{ 'YYYY-MM-DD': boolean[] }`，数组下标对应 `timing` |
| `history` | `object` | `{}` | 方案变更留痕 `{ 'YYYY-MM-DD': 旧值快照 }` |
| `relatedClue` | `string` | `"干燥综合征"` | 关联线索名称 |
| `sourceEventId` | `string` | `"evt_001"` | 来源事件 ID |
| `createdAt` | `Date` | `"2026-06-22T..."` | 创建时间 |
| `updatedAt` | `Date` | `null` | 更新时间（未更新时为 `null`） |

---

### updateMedicationHabit

---
name: updateMedicationHabit
title: 更新用药打卡
collection: medication_habits
version: V2.5.0
operationType: [update]
---

增量更新用药计划；`updateData` 中不在白名单内的字段会被**静默忽略**。

#### 请求参数

##### 通用字段

| 字段 | 类型 | 必填 | 默认值 | 示例值 | 校验规则 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `habitId` | `string` | [[必填]] | — | `"habit_001"` | 非空 | 用药打卡 ID |
| `updateData` | `object` | [[必填]] | — | `{ "dose": 4 }` | 非空对象，白名单外的字段静默忽略 | 增量更新字段，可更新字段见下 |

##### 对象类型 updateData

| 字段 | 类型 | 必填 | 默认值 | 示例值 | 校验规则 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `medicationName` | `string` | [[选填]] | — | — | 非空 | 药品名称 |
| `dose` | `string \| number` | [[选填]] | — | `4` | 非空，字符串须为有效数值 | 剂量数值 |
| `doseUnit` | `string` | [[选填]] | — | — | 非空 | 剂量单位 |
| `spec` | `string` | [[选填]] | — | — | 字符串 | 规格 |
| `frequency` | `string` | [[选填]] | — | — | 正整数 | 服药周期（每 x 天） |
| `timing` | `string[]` | [[选填]] | — | — | 每项 `HH:MM` 且不得重复（入库前去重 + 升序） | 每日服药时间 |
| `startDate` | `string` | [[选填]] | — | — | 非空 | 开始日期 |
| `endDate` | `string` | [[选填]] | — | — | `YYYY-MM-DD` 或 `''` | 结束日期 |
| `relatedClue` | `string` | [[选填]] | — | — | 任意 | 关联线索名称 |
| `isActive` | `boolean` | [[选填]] | — | `false` | **仅支持 `true → false`（软停用），不支持重新激活** | 是否激活 |

> [!INFO] **方案变更自动留痕**
> 当 `dose` / `doseUnit` / `spec` / `frequency` / `timing` / `endDate` 任一字段被传入时，云函数会把**旧值快照**写入 `history[today]`，并清空当日 `dailyRecords[today]`。

> [!INFO] **结束日期提前**
> 若新 `endDate` 早于已有打卡记录日期，晚于 `endDate` 的 `dailyRecords` 记录会被清理。

> [!WARNING] **软停用规则**
> `isActive=false` 时自动写入 `endDate = 当天`（若未同时传 `endDate`），保留 `dailyRecords` 历史数据；云函数**拒绝** `isActive=false→true` 的反向操作。

#### 调用示例

:::tabs
:::tab 修改剂量
```typescript
const res = await callCloudFunction('updateMedicationHabit', {
  habitId: 'habit_001',
  updateData: { dose: 4 },
});
// → { code: 0, message: '用药打卡已更新', data: { habitId: 'habit_001' } }
```
:::
:::tab 软停用
```typescript
const res = await callCloudFunction('updateMedicationHabit', {
  habitId: 'habit_001',
  updateData: { isActive: false },
});
// → { code: 0, data: { habitId: 'habit_001', isActive: false } }
```
:::
:::

#### 返回结构

##### 返回字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `habitId` | `string` | 用药打卡 ID |
| `isActive` | `boolean` | 仅在本次更新涉及该字段时返回；响应中**不再包含** `{ updated: true }` |

##### 示例

```json title="成功响应"
// 软停用：涉及 isActive，返回该字段
{ "habitId": "habit_001", "isActive": false }

// 修改剂量：未涉及 isActive，不返回该字段
{ "habitId": "habit_001" }
```

> [!INFO] **无有效字段时返回错误**
> 若 `updateData` 内所有字段都不在白名单中，返回 `{ code: -1, message: 'updateData 中无有效字段' }`。

---

### checkMedication

---
name: checkMedication
title: 打卡操作
collection: medication_habits
version: V2.5.0
operationType: [update]
---

对指定的服药计划执行打卡或取消打卡。

#### 请求参数

##### 通用字段

| 字段 | 类型 | 必填 | 默认值 | 示例值 | 校验规则 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `habitId` | `string` | [[必填]] | — | `"habit_001"` | 非空 | 用药打卡 ID |
| `date` | `string` | [[必填]] | — | `"2026-07-01"` | 格式 `YYYY-MM-DD`，正则 `/^\d{4}-\d{2}-\d{2}$/` | 打卡日期 |
| `doseIndex` | `number` | [[必填]] | — | `0` | 非负整数，≤ `timing.length - 1` | 第几次服药（从 0 开始） |
| `done` | `boolean` | [[必填]] | — | `true` | 布尔值 | `true` = 打卡 / `false` = 取消打卡 |

> [!INFO] **打卡日期校验**
> 打卡日期是否在服药计划内（受 `frequency` 周期影响）由**前端控制**，云函数不校验。

> [!INFO] **`doseIndex` 由云函数校验**
> 必须为非负整数且 `≤ timing.length - 1`，越界返回 `doseIndex 超出范围（最大 N）`；已停用的打卡返回 `该用药打卡已停用，无法打卡`。

#### 调用示例

```typescript
const res = await callCloudFunction('checkMedication', {
  habitId: 'habit_001',
  date: '2026-07-01',
  doseIndex: 0,
  done: true,
});
// → { code: 0, data: { habitId: 'habit_001', date: '2026-07-01', doseIndex: 0, done: true }, message: '打卡成功' }
```

#### 返回结构

##### 返回字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `habitId` | `string` | 用药打卡 ID |
| `date` | `string` | 打卡日期 |
| `doseIndex` | `number` | 第几次服药（从 0 开始） |
| `done` | `boolean` | `true` = 已打卡 / `false` = 已取消打卡 |

##### 示例

```json title="成功响应"
{
  "habitId": "habit_001",
  "date": "2026-07-01",
  "doseIndex": 0,
  "done": true
}
```

---

### deleteMedicationHabit

---
name: deleteMedicationHabit
title: 删除用药打卡
collection: medication_habits
version: V2.5.0
operationType: [delete]
---

硬删除用药打卡及其所有 `dailyRecords`。

> [!INFO] **优先使用软停用**
> 前端优先推荐「软停用」（`updateMedicationHabit` 设置 `isActive=false`），此接口仅作为兜底。

#### 请求参数

##### 通用字段

| 字段 | 类型 | 必填 | 默认值 | 示例值 | 校验规则 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `habitId` | `string` | [[必填]] | — | `"habit_001"` | 非空 | 用药打卡 ID |

#### 行为

- 硬删除用药打卡及所有 `dailyRecords`
- **不影响**关联的用药事件

> [!WARNING] **硬删除不可恢复**
> 该接口直接物理删除用药打卡文档及其 `dailyRecords`，删除后无法恢复。

#### 调用示例

```typescript
const res = await callCloudFunction('deleteMedicationHabit', {
  habitId: 'habit_001',
});
// → { code: 0, message: '用药打卡已删除', data: { habitId: 'habit_001', sourceEventId: 'evt_001', medicationName: '甲泼尼龙' } }
```

#### 返回结构

##### 返回字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `habitId` | `string` | 被删除的用药打卡 ID |
| `sourceEventId` | `string` | 来源事件 ID |
| `medicationName` | `string` | 药品名称 |

##### 示例

```json title="成功响应"
{ "habitId": "habit_001", "sourceEventId": "evt_001", "medicationName": "甲泼尼龙" }
```

## 五、clues 集合（线索）

### addClue

---
name: addClue
title: 新增线索
collection: clues
version: V2.5.0
operationType: [add]
---

新增一条线索，初始化时自动写入记录计数与创建历史。

#### 请求参数

##### 通用字段

| 字段 | 类型 | 必填 | 默认值 | 示例值 | 校验规则 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `clueData` | `object` | [[必填]] | — | `{ ... }` | 非空对象 | 线索主体，字段见下 |
| └ `name` | `string` | [[必填]] | — | `"干燥综合征"` | 非空字符串，同一用户唯一 | 线索名称 |
| └ `icon` | `string` | [[选填]] | — | `"💧"` | 任意 | 图标（emoji 或文字） |
| └ `status` | `string` | [[选填]] | `suspect` | `"diagnosed"` | 必须在 `CLUE_STATUS` 中 | 状态 |
| └ `startDate` | `string` | [[选填]] | — | `"2024-03-01"` | 格式 `YYYY-MM-DD` | 起始日期 |

> [!INFO] **唯一性校验**
> 同一用户下 `name` 不允许重复，重复返回 `{ code: -1, message: '线索「XXX」已存在，请勿重复创建' }`。

> [!INFO] **必填字段**
> `name` 为唯一必填字段。`icon`、`status`、`startDate` 均支持默认值或为空。

> [!INFO] **初始化自动写入字段**
> 初始化时自动写入：`recordCount=0`、`eventIds=[]`、`settings={}`、`history=[{ date: 当天, title: '线索创建（{状态中文}）', note: '', tag: '创建' }]`、`historyUpdateAt=当天`。

> [!WARNING] **`history` 不是空数组**
> `tag` 字段实际会被写入（`创建` / `变更` / `合并`）；`historyUpdateAt` 为历史校准日期，见数据库描述文档。

#### 调用示例

```typescript
const res = await callCloudFunction('addClue', {
  clueData: {
    name: '干燥综合征',
    icon: '💧',
    status: 'diagnosed',
    startDate: '2024-03-01',
  },
});
// → { code: 0, data: { _id: 'clue_new_001' }, message: '线索已创建' }
```

#### 返回结构

##### 返回字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `_id` | `string` | 新建线索 ID |

##### 示例

```json title="成功响应"
{ "_id": "clue_new_001" }
```

---

### getClues

---
name: getClues
title: 查询线索列表
collection: clues
version: V2.5.0
operationType: [get]
---

按条件分页查询当前用户的线索列表。

#### 请求参数

##### 通用字段

| 字段 | 类型 | 必填 | 默认值 | 示例值 | 校验规则 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `page` | `number` | [[选填]] | `1` | `1` | 整数 ≥1 | 页码 |
| `pageSize` | `number` | [[选填]] | `50` | — | 整数 1–50 | 每页条数 |
| `status` | `string` | [[选填]] | — | — | 必须在 `CLUE_STATUS` 中，否则返回 `status 无效` | 状态筛选 |
| `keyword` | `string` | [[选填]] | — | — | 非空 | 名称模糊匹配 |

> [!INFO] **排序规则（已确认）**
> 状态优先级 **`suspect` > `diagnosed` > `monitoring` > `archived`**（按 `CLUE_STATUS_PRIORITY` 数值升序，缺省状态排最后）→ `createdAt` 倒序。`lastEventDate` 字段已移除。

#### 调用示例

```typescript
const res = await callCloudFunction('getClues', { page: 1 });
// → { code: 0, data: [...], total: 4 }
```

#### 返回结构

##### 返回字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `data` | `object[]` | 线索数组，单条结构见下 |
| `total` | `number` | 满足条件的总条数（分页总量） |

##### 示例

```json title="成功响应"
{
  "code": 0,
  "message": "ok",
  "data": [ /* 线索数组 */ ],
  "total": 4
}
```

##### data 元素结构

| 字段 | 类型 | 示例值 | 说明 |
| --- | --- | --- | --- |
| `_id` | `string` | `"clue_001"` | 线索 ID |
| `name` | `string` | `"干燥综合征"` | 线索名称 |
| `icon` | `string` | `"💧"` | 图标 |
| `status` | `string` | `"diagnosed"` | 状态，取值见 `CLUE_STATUS` |
| `startDate` | `string` | `"2024-03-01"` | 起始日期 |
| `recordCount` | `number` | `28` | 关联事件数量 |
| `eventIds` | `string[]` | `["evt_001", "evt_002"]` | 关联事件 ID 数组 |
| `history` | `object[]` | `[ { "date": "2024-03-01", "tag": "创建" } ]` | 诊断历程节点，见 `getClueDetail` |
| `historyUpdateAt` | `string` | `"2024-04-01"` | 历史校准日期 |
| `settings` | `object` | `{}` | 线索级设置 |
| `createdAt` | `Date` | `"2024-03-..."` | 创建时间 |
| `updatedAt` | `Date` | `null` | 更新时间（未更新时为 `null`） |

---

### getClueDetail

---
name: getClueDetail
title: 获取线索详情
collection: clues
version: V2.5.0
operationType: [get]
---

获取单条线索的完整数据，以及关联事件、指标时序与用药打卡。

#### 请求参数

##### 通用字段

| 字段 | 类型 | 必填 | 默认值 | 示例值 | 校验规则 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `clueId` | `string` | [[必填]] | — | `"clue_001"` | 非空 | 线索 ID |

#### 调用示例

```typescript
const res = await callCloudFunction('getClueDetail', {
  clueId: 'clue_001',
});
// → { code: 0, data: { clue: {...}, events: [...], metrics: [...], medications: [...] } }
```

#### 返回结构

##### 返回字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `clue` | `object` | 线索完整数据（含 `history`，已脱敏去除 `_openid`） |
| `events` | `object[]` | 通过 `clue.eventIds` 批量查询的关联事件，按日期倒序，元素为完整事件文档（脱敏） |
| `metrics` | `object[]` | 由 `type === 'report'` 事件的 `metadata.metrics` 按 `metricName::unit` 分组的时序数据（云函数计算，非数据库字段），元素结构见下 |
| `medications` | `object[]` | 关联线索下的激活用药打卡（`sourceEventId ∈ clue.eventIds` 且 `isActive = true`），原文档遗漏 |

##### 示例

```json title="成功响应"
{
  "clue": { /* 线索完整数据（含 history 字段，已脱敏去除 _openid） */ },
  "events": [
    { "_id": "...", "title": "...", "date": "...", "type": "...", "content": "..." }
  ],
  "metrics": [ /* 见下方 metrics 元素结构 */ ],
  "medications": [ /* 关联的激活用药打卡 */ ]
}
```

##### metrics 元素结构

| 字段 | 类型 | 示例值 | 说明 |
| --- | --- | --- | --- |
| `id` | `string` | `"总胆固醇::mmol/L"` | 分组键 `metricName::unit` |
| `metricName` | `string` | `"总胆固醇"` | 指标名称 |
| `unit` | `string` | `"mmol/L"` | 单位 |
| `normalRange` | `string` | `"2.8-5.2"` | 参考范围 |
| `latestValue` | `number` | `5.1` | 最新指标值 |
| `isNormal` | `boolean` | `true` | 最新值是否在参考范围内 |
| `data` | `object[]` | `[ { "date": "2026-06-01", "value": 6.2 } ]` | 时序点数组，元素为 `{ date, value, referenceRange }` |

> [!WARNING] **`clue.history` 由云函数读时校准**
> 实际由云函数**读时校准并写回**（`calibrateHistory`）——保留 `tag` 为 `创建` / `变更` / `合并` 的手动记录，其余节点从关联事件推导（首次症状 / 首次就诊 / 首次治疗 / 末次就诊），按日期升序合并。

> [!INFO] **不返回 `relatedEvents`**
> 云函数仅返回 `clue` / `events` / `metrics` / `medications`。前端页面原先依赖该字段的「相关事件」区块自上线起恒为空，已于 2026-09-10 随死分支一并移除（相关事件可改用上方 `events` 派生）。

---

### updateClue

---
name: updateClue
title: 更新线索
collection: clues
version: V2.5.0
operationType: [update]
---

更新线索的基本信息，可更新字段为 `name` / `icon` / `status` / `startDate`。

#### 请求参数

##### 通用字段

| 字段 | 类型 | 必填 | 默认值 | 示例值 | 校验规则 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `clueId` | `string` | [[必填]] | — | `"clue_001"` | 非空 | 线索 ID |
| `updateData` | `object` | [[选填]] | — | `{ "status": "archived" }` | 仅支持 `name` / `icon` / `status` / `startDate` | 更新字段，见下 |

##### 对象类型 updateData

| 字段 | 类型 | 必填 | 默认值 | 示例值 | 校验规则 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `name` | `string` | [[选填]] | — | — | 非空，同一用户唯一（排除自身） | 修改名称 |
| `icon` | `string` | [[选填]] | — | — | 任意 | 修改图标 |
| `status` | `string` | [[选填]] | — | `"archived"` | 必须在 `CLUE_STATUS` 中 | 修改状态（含归档：`status='archived'`） |
| `startDate` | `string` | [[选填]] | — | — | 格式 `YYYY-MM-DD` | 修改起始日期 |

> [!INFO] **2026-07-03 变更**
> 移除 `hospital`、`department` 参数。只能更新 `name` / `icon` / `status` / `startDate`。

#### 调用示例

```typescript
// 归档线索
const res = await callCloudFunction('updateClue', {
  clueId: 'clue_001',
  updateData: { status: 'archived' },
});
// → { code: 0, message: '线索已更新', data: { clueId: 'clue_001', nameChanged: false, clue: { ... } } }
```

#### 返回结构

##### 返回字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `clueId` | `string` | 线索 ID |
| `nameChanged` | `boolean` | 名称是否发生变化 |
| `clue` | `object` | 更新后的完整线索文档 |

##### 示例

```json title="成功响应"
{ "clueId": "clue_001", "nameChanged": false, "clue": { /* 更新后的完整线索文档 */ } }
```

> [!INFO] **状态变更自动追加 history**
> 当 `updateData.status` 与旧值不同时，云函数会自动向 `history` 追加一条记录（`tag: '变更'`，标题为 `线索变更（{新状态}）`，归档时为 `线索归档`），并刷新 `historyUpdateAt`。

---

### deleteClue

---
name: deleteClue
title: 删除线索
collection: clues
version: V2.5.0
operationType: [delete]
---

删除线索；默认受删除保护，可选择同时清除关联事件中的 `clueIds`。

> [!WARNING] **硬删除不可恢复**
> 该接口直接物理删除线索文档，删除后无法恢复。

#### 请求参数

##### 通用字段

| 字段 | 类型 | 必填 | 默认值 | 示例值 | 校验规则 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `clueId` | `string` | [[必填]] | — | `"clue_001"` | 非空 | 线索 ID |
| `removeFromEvents` | `boolean` | [[选填]] | `false` | `true` | 布尔值 | 是否同时清除关联 events 的 `clueIds` |

> [!INFO] **删除保护**
> 默认模式 `removeFromEvents=false`，如果该线索仍有 `eventIds` 不为空，返回 `{ code: -1, message: '线索「{名称}」关联了 {N} 个事件，请先解除关联或选择"同时清除关联"', data: { clueId, name, relatedEventCount } }`。

> [!INFO] **强制删除会反向查询 events**
> 强制删除时，云函数会**反向查询 `events` 集合**（`where({ clueIds: clueId })`）批量清除引用，而非仅依赖线索自身的 `eventIds`，避免数据漂移导致漏清理。

#### 调用示例

:::tabs
:::tab 默认模式（有事件则拒绝删除）
```typescript
const res = await callCloudFunction('deleteClue', {
  clueId: 'clue_001',
});
// → { code: -1, message: '线索「干燥综合征」关联了 3 个事件，请先解除关联或选择"同时清除关联"', data: { clueId: 'clue_001', name: '干燥综合征', relatedEventCount: 3 } }
```
:::
:::tab 强制删除（同时清除关联事件中的 clueIds）
```typescript
const res = await callCloudFunction('deleteClue', {
  clueId: 'clue_001',
  removeFromEvents: true,
});
// → { code: 0, message: '线索已删除', data: { clueId: 'clue_001', name: '干燥综合征', affectedEventCount: 3 } }
```
:::
:::

#### 返回结构

##### 返回字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `clueId` | `string` | 被删除的线索 ID |
| `name` | `string` | 线索名称 |
| `affectedEventCount` | `number` | 实际清理成功的事件数 |

##### 示例

```json title="成功响应"
{ "clueId": "clue_001", "name": "干燥综合征", "affectedEventCount": 3 }
```

> [!WARNING] **不再返回 `{ removedEvents: boolean }`**
> 清理结果改由 `affectedEventCount` 表达。

---

### mergeClue

---
name: mergeClue
title: 合并线索
collection: clues
version: V2.5.0
operationType: [update]
---

将源线索的事件全部迁移到目标线索，并删除源线索。前端线索页「合并」入口使用。

#### 请求参数

##### 通用字段

| 字段 | 类型 | 必填 | 默认值 | 示例值 | 校验规则 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `sourceClueId` | `string` | [[必填]] | — | `"clue_001"` | 非空，且不得等于 `targetClueId` | 被合并的线索 ID（将被删除） |
| `targetClueId` | `string` | [[必填]] | — | `"clue_002"` | 非空 | 目标线索 ID（保留） |

#### 行为

- 将源线索 `eventIds` 中每个事件的 `clueIds` 里的 `sourceClueId` 替换为 `targetClueId`（去重，分批 100 条查询）
- 目标线索：`eventIds` 合并去重、`recordCount` 重算、`startDate` 取两者最早日期
- 向目标线索 `history` 追加 `{ title: '合并{源名称}线索', tag: '合并' }`，并刷新 `historyUpdateAt`
- 删除源线索

#### 调用示例

```typescript
const res = await callCloudFunction('mergeClue', {
  sourceClueId: 'clue_001',
  targetClueId: 'clue_002',
});
// → { code: 0, message: '线索已合并', data: { targetClueId: 'clue_002' } }
```

#### 返回结构

##### 返回字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `targetClueId` | `string` | 合并后保留的目标线索 ID |

##### 示例

```json title="成功响应"
{ "targetClueId": "clue_002" }
```

---

## 六、seedData 与运维接口

### seedData

---
name: seedData
title: 种子数据生成
collection: 全部集合
version: V2.5.0
operationType: [add]
---

清空当前用户数据后重新生成一整套演示数据，供开发调试使用。

> [!DANGER] **仅开发环境使用**
> 此接口会**清空当前用户所有数据**后重新生成，请勿在生产环境调用。

#### 请求参数

无（`_openid` 自动注入）。云开发控制台测试时可手动传 `openid`。

#### 行为

- 确保 `users` 记录存在 → 清理当前用户云存储文件 → 清空 `clues` / `events` / `todos` / `medication_habits`（`metrics` 集合已从云环境移除）
- 生成 5 条线索、约 38 条事件（含 2 条事件链）、5 条用药打卡、5 条待办，并回写线索关联

#### 返回结构

##### 返回字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `cleared` | `object` | 各集合清理条数 `{ clues, events, todos, habits }` |
| `cloudStorageDeleted` | `number` | 清理的云存储文件数 |
| `clues` | `number` | 生成的线索数 |
| `events` | `number` | 生成的事件数 |
| `habits` | `number` | 生成的用药打卡数 |
| `todos` | `number` | 生成的待办数 |
| `chains` | `number` | 生成的事件链条数 |
| `dateRange` | `object` | 数据日期范围 `{ from, to }` |

##### 示例

```json title="成功响应"
{
  "cleared": { "clues": 0, "events": 0, "todos": 0, "habits": 0 },
  "cloudStorageDeleted": 0,
  "clues": 5,
  "events": 38,
  "habits": 5,
  "todos": 5,
  "chains": 2,
  "dateRange": { "from": "2026-07-17", "to": "2026-09-10" }
}
```

> [!WARNING] **本节待云函数更新后重写**
> `seedData/index.js` 中 `const metrics = await seedMetrics(...)` 已注释，但返回体仍引用 `metrics.length`，运行时会抛 `ReferenceError`，函数无法正常返回成功。上述字段结构仅供参考（`cleared` 不含 `metrics`，并新增 `cloudStorageDeleted`）；待云函数修复/重构后再重新核对本节。

---

### clearAllData

---
name: clearAllData
title: 清空当前用户数据
collection: 全部集合
version: V2.5.0
operationType: [delete]
---

运维 / 隐私清除用：删除当前 `openid` 下所有集合的数据，并清理其云存储文件。

> [!DANGER] **不可恢复**
> 该接口会**清空当前用户全部业务数据**（线索 / 事件 / 待办 / 用药打卡 / 用户记录）并删除其云存储文件，操作不可撤销，仅限运维与隐私清除场景调用。

#### 请求参数

##### 通用字段

| 字段 | 类型 | 必填 | 默认值 | 示例值 | 校验规则 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `openid` | `string` | [[选填]] | — | — | — | 控制台测试用；不传则使用上下文 `OPENID` |

#### 行为

- 先扫描 `events` 中的 `images` / `files[].fileID` 清理云存储（每批 50 个）
- 清空 `clues` / `events` / `todos` / `medication_habits` / `users`（每批 100 条、10 并发、最多 10 批/集合；`metrics` 集合已移除）
- 集合不存在时自动跳过

#### 返回结构

##### 返回字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `clues` | `number` | 清理的线索条数 |
| `events` | `number` | 清理的事件条数 |
| `todos` | `number` | 清理的待办条数 |
| `medication_habits` | `number` | 清理的用药打卡条数 |
| `users` | `number` | 清理的用户条数 |
| `total` | `number` | 清理总条数 |
| `cloudStorageDeleted` | `number` | 清理的云存储文件数 |

##### 示例

```json title="成功响应"
{
  "clues": 4,
  "events": 38,
  "todos": 5,
  "medication_habits": 5,
  "users": 1,
  "total": 53,
  "cloudStorageDeleted": 3
}
```

---

## 七、统一错误码与异常处理

### 7.1 错误码

| code | message 模式 | 场景 |
| --- | --- | --- |
| 0 | `'ok'` 或业务描述 | 成功 |
| -1 | 业务错误描述 | 参数校验失败 / 数据不存在 / 无权限 / 服务器错误 |

> [!INFO] **前端判断规则**
> `res.code === 0` 为成功，否则取 `res.message` 展示提示。

### 7.2 常见失败场景

| 场景 | message 示例 |
| --- | --- |
| 缺少必填参数 | `"缺少 eventId"` |
| 枚举值非法 | `"type 无效，可选值：visit/medication/..."` |
| 数据不存在 | `"事件不存在"` |
| 无权限 | `"无权修改该事件"` / `"无权访问该事件"` / `"无权删除该线索"` |
| 名称重复 | `"线索「干燥综合征」已存在，请勿重复创建"`（`updateClue` 为 `"线索名称「X」已存在"`） |
| 停用后操作 | `"该用药打卡已停用，无法打卡"` |
| 索引越界 | `"doseIndex 超出范围（最大 N）"` |
| 删除保护 | `线索「干燥综合征」关联了 3 个事件，请先解除关联或选择"同时清除关联"` |
| 无有效字段 | `"updateData 中无有效字段"` / `"没有可更新的字段"` |
| 事务回滚 | `"删除失败，数据已回滚: ..."` |
| 服务器异常 | `"保存失败"`（配合 `console.error` 日志） |

### 7.3 分页空结果

列表查询无数据时，返回 `{ code: 0, data: [], total: 0 }`，前端不应将其视为错误。

---

## 附录 A：events.metadata 字段表

### A.1 按 type 汇总

#### symptom

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `bodyParts` | `string[]` | [[选填]] | 部位（眼/口/鼻/关节/皮肤） |
| `symptoms` | `string[]` | [[选填]] | 症状标签（口干/眼干/疼痛/发热/疲劳/皮疹） |
| `intensity` | `number` | [[选填]] | 强度评分 1~4 |
| `duration` | `string` | [[选填]] | 持续时间（片刻/数小时/半天/全天/持续） |
| `treatment` | `string` | [[选填]] | 处理方式 |
| `result` | `string` | [[选填]] | 结果：`缓解` / `加重` / `无效` |
| `suggestion` | `string` | [[选填]] | 系统建议文案 |

#### visit

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `hospital` | `string` | [[选填]] | 医院名称 |
| `department` | `string` | [[选填]] | 科室 |
| `doctor` | `string` | [[选填]] | 医生 |
| `diagnosis` | `string` | [[选填]] | 诊断结论 |
| `nextVisitDate` | `string` | [[选填]] | 下次复查日期（`YYYY-MM-DD`） |

#### treatment

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `treatmentType` | `string` | [[必填]] | 物理治疗/输液/针灸/康复训练/其他（云函数强制必填） |
| `hospital` | `string` | [[选填]] | 医院/机构 |
| `department` | `string` | [[选填]] | 科室 |
| `doctor` | `string` | [[选填]] | 医生/治疗师 |
| `bodyPart` | `string[]` | [[选填]] | 治疗部位 |
| `effectiveness` | `string` | [[选填]] | 好转/无效/加重 |

#### medication

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `hospital` | `string` | [[选填]] | 医院 |
| `department` | `string` | [[选填]] | 科室 |
| `doctor` | `string` | [[选填]] | 医生 |
| `oldRegimen` | `MedicationInfo[]` | [[选填]] | 旧方案药品列表，元素结构见 [`MedicationInfo`](#medicationinfo) |
| `newRegimen` | `MedicationInfo[]` | [[选填]] | 新方案药品列表，元素结构见 [`MedicationInfo`](#medicationinfo) |

#### exam

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `examName` | `string` | [[必填]] | 检查项目名称 |
| `examType` | `string` | [[选填]] | 检查类型分类 |
| `hospital` | `string` | [[选填]] | 医院 |
| `department` | `string` | [[选填]] | 科室 |

#### report

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `reportType` | `string` | [[必填]] | 报告类型分类（云函数强制必填） |
| `hospital` | `string` | [[选填]] | 医院 |
| `department` | `string` | [[选填]] | 科室 |
| `relatedExamId` | `string` | [[选填]] | 关联检查事件 ID |
| `metrics` | `array` | [[选填]] | 已监控指标列表，元素结构见 [`MetricItem`](#metricitem) 与 A.2 |

#### MedicationInfo

`oldRegimen` / `newRegimen` 数组元素的字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `drugName` | `string` | [[必填]] | 药品名称 |
| `dose` | `string` | [[必填]] | 剂量 |
| `unit` | `string` | [[必填]] | 单位 |
| `frequency` | `string` | [[必填]] | 周期（如 `"1"`=每天） |
| `timing` | `string[]` | [[必填]] | 服用时间（HH:mm[]） |
| `habitId` | `string` | [[选填]] | 关联打卡 ID |

#### MetricItem

`report.metrics` 数组元素的字段（类型与 A.2 一致）：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `metricName` | `string` | [[必填]] | 指标名称 |
| `value` | `number` | [[必填]] | 指标值 |
| `unit` | `string` | [[必填]] | 单位（2026-07-17 起强制必填） |
| `referenceRange` | `string` | [[选填]] | 参考范围（如"60-100"、"<4"、">90"） |

> [!WARNING] **medication 实际校验差异**
> `addEvent` 当前校验的是**扁平字段** `metadata.drugName` / `dose` / `frequency` / `doseCount`，而非上表的 `newRegimen` 数组；但 `getEventAggregatedData` 与前端仍按 `newRegimen` 读取，两处不一致。详见文末「待完成变更」。

### A.2 metrics 元素结构（report 已监控指标）

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `metricName` | `string` | [[必填]] | 指标名称 |
| `value` | `number` | [[必填]] | 指标值 |
| `unit` | `string` | [[必填]] | 单位（展示于参考范围行；2026-07-17 起强制必填） |
| `referenceRange` | `string` | [[选填]] | 参考范围（如"60-100"、"<4"、">90"） |

---

## 附录 B：日期/时间格式速查

| 场景 | 格式 | 示例 |
| --- | --- | --- |
| events.date | `YYYY-MM-DD` | `"2026-06-23"` |
| events.time | `HH:mm` | `"14:30"` |
| todos.dueDate | `YYYY-MM-DD`（ISO） | `"2026-07-22"` |
| checkMedication date | `YYYY-MM-DD` | `"2026-07-01"` |
| medication_habits.timing[] | `HH:MM` | `"08:00"` |
| clues.startDate | `YYYY-MM-DD` | `"2024-03-01"` |

---

## 附录 C：云函数完整清单

| # | 云函数 | 集合 | 操作 | 类型 |
| --- | --- | --- | --- | --- |
| 1 | `login` | users | 登录/注册 | Upsert |
| 2 | `getUserProfile` | users | 查询 | Read |
| 3 | `updateUserSettings` | users | 更新（设置/昵称/头像） | Update |
| 4 | `addEvent` | events | 新增 | Create |
| 5 | `getEvents` | events | 分页查询 | Read |
| 6 | `getEventDetail` | events | 详情查询 | Read |
| 7 | `getEventAggregatedData` | events | 聚合历史选项 | Read |
| 8 | `updateEvent` | events | 更新 | Update |
| 9 | `deleteEvent` | events | 删除（已弃用） | Delete |
| 10 | `batchDeleteEvent` | events / todos / medication_habits | 事务性删除 + 级联清理 | Delete |
| 11 | `addTodo` | todos | 新增 | Create |
| 12 | `getTodos` | todos | 分页查询 | Read |
| 13 | `updateTodo` | todos | 更新 | Update |
| 14 | `deleteTodo` | todos | 删除 | Delete |
| 15 | `addMedicationHabit` | medication_habits | 新增 | Create |
| 16 | `getMedicationHabits` | medication_habits | 分页查询 | Read |
| 17 | `updateMedicationHabit` | medication_habits | 更新 | Update |
| 18 | `checkMedication` | medication_habits | 打卡操作 | Update |
| 19 | `deleteMedicationHabit` | medication_habits | 删除 | Delete |
| 20 | `addClue` | clues | 新增 | Create |
| 21 | `getClues` | clues | 分页查询 | Read |
| 22 | `getClueDetail` | clues | 详情查询（含 metrics/medications） | Read |
| 23 | `updateClue` | clues | 更新 | Update |
| 24 | `deleteClue` | clues | 删除 | Delete |
| 25 | `mergeClue` | clues / events | 合并线索 | Update |
| 26 | `seedData` | 全部 | 种子数据（当前存在缺陷） | Dev Only |
| 27 | `clearAllData` | 全部 | 清空当前用户数据 | Dev Only |

> 排除项：`getHomeModules` / `updateHomeModules`（首页模块配置，本次审查范围外）。

---

*本文档基于路线图 2 数据库设计，并以云函数实际实现为准校正，最后更新 2026-09-10*

---

## 变更历史

| 日期 | 变更内容 | 影响范围 | 状态 |
| --- | --- | --- | --- |
| 2026-09-10 | **评审结论落地**：① 明确 `medication` 扁平字段为**过渡期兼容字段**及其「双写」来源（§2.1）；② 线索排序确认为 `suspect > diagnosed > monitoring > archived`（§5.2）；③ `deleteEvent` 改述为「已事实弃用、暂时保留」（§2.6）；④ `addEvent` / `updateEvent` 补充 **FIXME（非事务导致的数据不一致风险）**；⑤ `getEventAggregatedData` 补充 `MAX = 500` 的 **NOTE**（§2.4）；⑥ `login` 明确「仅登录、不更新资料」为设计决策（§1.1）；⑦ `images` / `files` 体积上限未校验补充说明（§2.1）；⑧ §6 标注**待云函数更新后重写**；⑨ 待完成变更清理已确认项。 | 全文档 | ✅ |
| 2026-09-10 | **文档对齐实际实现（v2.5）**：按云函数实际代码校正 `login` / `getUserProfile` / `updateUserSettings` 的参数与返回；统一 `addTodo` / `addMedicationHabit` / `updateTodo` / `updateMedicationHabit` 的**嵌套参数对象**（`todoData` / `habitData` / `updateData`）；`updateTodo` 改用 `updateData.status` 并记录 `doneAt`（原文档误写 `done` / `completedAt`）；`getClues` 默认 `pageSize` 与排序规则、`getClueDetail` 的 `metrics`/`medications`、`updateClue` / `deleteClue` 返回值修正；`getEvents` 移除无效 `openid` 参数并补充 `clueIdsEmpty`；`getEventAggregatedData` 补充 `doctors` / `metricNames`；`deleteEvent` 标注弃用并新增 §2.7 `batchDeleteEvent`、§5.6 `mergeClue`、§6.2 `clearAllData`；枚举 SSOT 路径更正为 `shared/enums.ts`。 | 全文档 | ✅ |
| 2026-07-21 | **`addEvent` / `updateEvent` 返回完整事件**：新增 `event` 字段返回创建/更新后的完整事件文档，供前端 `recentEventsCache` 直接写入避免额外云函数调用。<br>**关联建议 P2-R01**：`useSuggestions` 匹配逻辑改为同线索 + 最近7天内上游事件（`useDataLoaders.loadRecentEvents`），未选线索时不展示建议。 | addEvent、updateEvent、useSuggestions、useDataLoaders、useSaveHandler、RecordSheet | ✅ |
| 2026-07-18 | **RecordSheet prefillData**：待办完成→建议横幅确认后，记一笔自动填充 type、date、time、hospital、department、doctor（从 todo.relatedData + dueDate/dueTime 读取）。<br>**content 解析增强**：`parseDateFromContent` 新增时间解析（x点/上下午）+ 类型关键词解析（复查→visit等），自动构建待办 type 和 dueTime。 | RecordSheet、TodoPreview、tab-index、todoList | ✅ |
| 2026-07-09 | **新增 `getEventAggregatedData`**：聚合用户历史医院/科室/检查/药品，按频次降序。供 RecordSheet AutocompleteInput 自动补全。云函数索引 §2.4，清单 #7 | 新云函数 + API 文档 | ✅ |
| 2026-07-03 | **clues Schema v2**：移除 `hospital`（初诊医院）、`department`（初诊科室）、`lastEventDate`（最近事件日期）字段；新增 `history` 诊断历程节点数组。`addClue`/`updateClue`/`getClues`/`getClueDetail` 返回格式同步调整（§5.1~§5.4） | 5 个云函数 + 前端 tab-clues | ✅ |
| — | — | — | — |

---

## 待完成变更

以下为已规划但尚未实施的 API 变更，按优先级排序：

| # | 任务 | 说明 | 优先级 |
| --- | --- | --- | --- |
| 1 | **修复 `seedData` 的 `metrics` 引用崩溃** | `seedMetrics` 调用已注释，但返回体仍引用 `metrics.length`，导致运行时 `ReferenceError`。已知悉，**待云函数更新后一并重写 [`seedData`](#seeddata) 一节** | P1 |
| 2 | **统一 medication metadata 校验** | 前端目前「双写」`newRegimen`/`oldRegimen` + 扁平兼容字段（`drugName`/`dose`/`frequency`/`doseCount`）以通过 `addEvent` 校验。建议将云函数校验改为 `newRegimen`（非空数组），随后移除四个扁平字段 | P1 |
| 3 | **`getClues` 不分页** | 线索数据量小（用户级），应移除分页直接返回全部（或按 `status` 筛选）的线索列表，减少前端多次调用 | P1 |
| 4 | 确认 `treatmentType` / `reportType` 必填性（已完成） | 已确认**必填**，两份文档均已按此校准 | ✅ |
| 5 | 确认线索排序规则（已完成） | 已确认以 `suspect > diagnosed > monitoring > archived` 为准，代码注释与两份文档均已校准 | ✅ |
| 6 | **`getEventAggregatedData` 聚合字段对齐** | `drugNames` 读取 `newRegimen`（与业务主结构一致，无需改动）；`MAX = 500` 截断已确认可接受，见 [`getEventAggregatedData`](#geteventaggregateddata) 的已知限制 | P3 |
| 7 | 补服务端 `pageSize` 上限校验（暂不处理） | 已确认暂不实现，继续由前端保证 `pageSize ≤ 50` | — |
| 8 | **新增 `updateClueHistory`** | 管理线索的 `history` 数组（action=add/update/delete），用于 MiniTimeline 诊断历程节点管理 | P3 |
