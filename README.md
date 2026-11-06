# Building a Custom SAP CAP Plugin

A live session on the CAP plugin architecture, built on **CDS 10** (ESM, Node.js 22+).

Seeded by [exercise 04 of `SAP-samples/cap-tour-hands-on`][ex04] and grounded in the
official [CDS Plugin Packages][capire-plugins] documentation — but going considerably
further. The SAP exercise teaches *one* of the things a plugin can do. This session
walks all four extension points, then packages the result.

[ex04]: https://github.com/SAP-samples/cap-tour-hands-on/blob/main/exercises/04/README.md
[capire-plugins]: https://cap.cloud.sap/docs/node.js/cds-plugins

## What we build

`@clouddna/cds-plugin-soft-delete` — declarative soft delete. Annotate an entity and:

- `DELETE` marks the row instead of removing it
- `READ`, `$count`, navigation and `$expand` all hide marked rows
- a bound `restore()` action brings them back
- `deletedAt` / `deletedBy` are contributed by the plugin and are `@readonly`

Everything a CAP plugin can contribute, on one feature:

| Layer | Hook | Where |
|---|---|---|
| **Configuration** | `cds` section in the plugin's `package.json` | merged into `cds.env` |
| **Model** | `cds.requires.<x>.model` + `cds.on('loaded')` | ships CDS, patches CSN |
| **Runtime** | `cds.on('served')` + `srv.prepend()` | handlers |
| **Tooling** | `cds.add.register()` / `cds.build.register()` | `cds add` / `cds build` |

## Prerequisites

| What | Check |
|---|---|
| Node.js **22.12+** (24 recommended) | `node -v` — Node 20 is out of support; on 22 `@cap-js/sqlite` prints an `ExperimentalWarning` on every start, 24 is quiet |
| `@sap/cds-dk` 10 | `npm i -g @sap/cds-dk@10` then `cds -v` |
| `jq` | `jq --version` — used to read CSN output |

```bash
git clone <this-repo> && cd custom-plugins && npm install
```

> `npm install` reports one moderate advisory for `flags`. That is npm matching our local
> workspace package against an unrelated package of the same name on the public registry —
> nothing is downloaded from it. It is also a decent argument for scoping plugin names, which
> is what `@clouddna/cds-plugin-soft-delete` does.

## Session map

Each step is a branch. `main` is the finished result.

| Branch | What it adds |
|---|---|
| `00-base` | plain CAP 10 project: `Customers`, `Incidents`, sample data |
| `01-flags-warmup` | the 10-line plugin — discovery, workspaces, `served` |
| `02-skeleton` | the soft-delete package + auto-configuration |
| `03-model-declarative` | the plugin ships CDS (`index.cds` aspect) |
| `04-model-programmatic` | `cds.on('loaded')` CSN enhancement |
| `05-runtime` | `DELETE` → `UPDATE`, read filtering, `restore()` |
| `06-tooling-add` | `cds add soft-delete` |
| `07-tooling-build` | `cds build --for soft-delete` |
| `08-tests` | Vitest + `@cap-js/cds-test` |
| `09-publish` | `files`, `npm pack`, consumer smoke test |

```bash
git checkout 00-base && npm install
```

---

## 0 — The base project

👉 Look at what we start from:

```bash
cds watch
```

Two entities, five customers, six incidents, at <http://localhost:4004>.

Note `package.json`: CDS 10's `cds init` writes `"type": "module"`. **The project is ESM**,
which matters for everything that follows.

---

## 1 — How are plugins even found?

Before writing one, understand the machinery. Plugins are not magic and not registered
anywhere central — they are *dependencies that happen to contain a file*.

👉 Start the server with plugin debugging on:

```bash
DEBUG=plugins cds watch
```

<details>
<summary>Windows (PowerShell / cmd)</summary>

Windows shells don't support inline `VAR=value command`. Set it first — this applies to
every `DEBUG=...` in this walkthrough.

PowerShell:

```powershell
$env:DEBUG='plugins'; cds watch
```

cmd:

```cmd
set DEBUG=plugins && cds watch
```

</details>

```log
[cds.plugins] - fetched plugins in: 1.25ms
[cds.plugins] - loading @cap-js/sqlite: { impl: 'node_modules/@cap-js/sqlite/cds-plugin.js' }
[cds.plugins] - loading @sap/cds-fiori: { impl: 'node_modules/@sap/cds-fiori/cds-plugin.js' }
[cds.plugins] - loaded plugins in: 3.576ms
```

Two plugins already. **SQLite support is a plugin. Fiori support is a plugin.** The
extension mechanism *is* the framework's own building block.

👉 Find the file that makes a package a plugin:

```bash
find node_modules -name cds-plugin.js -maxdepth 3
```

<details>
<summary>Windows (PowerShell / cmd)</summary>

PowerShell:

```powershell
Get-ChildItem node_modules -Recurse -Depth 2 -Filter cds-plugin.js | ForEach-Object { $_.FullName }
```

cmd:

```cmd
dir /s /b node_modules\cds-plugin.js
```

</details>

👉 See where the loader looks. In `cds repl`:

```bash
cds repl
```

```js
cds.home   // the @sap/cds runtime in use
cds.root   // your project root
```

The loader ([`@sap/cds/lib/plugins.js`][plugins-src]) walks the `dependencies` and
`devDependencies` of exactly those two `package.json` files and tries to resolve
`<dependency>/cds-plugin` in each. That is the whole discovery algorithm.

[plugins-src]: https://cap.cloud.sap/docs/node.js/cds-plugins#cds-plugins

Three consequences worth knowing, none of them obvious:

- **`devDependencies` are skipped when `NODE_ENV=production`.** That is *why*
  `@cap-js/sqlite` sits in devDependencies — it disappears in production by design.
- **Plugins load in parallel** (`Promise.all`). Only three are loaded ahead of the pack:
  `@sap/cds-mtxs`, `@cap-js/sqlite` (since cds 10.2, so `@cap-js/ai` can override it) and
  `@cap-js/telemetry`. Never rely on load order between plugins.
- **`CDS_PLUGINS` can inject one** without touching `package.json` at all.

---

## 2 — The 10-line plugin

`git checkout 01-flags-warmup`

The warm-up from the SAP exercise: replace country names with flag emojis for elements
annotated `@flagify`. It exists to prove the mechanics, and to give us something to
criticise.

👉 Create the package as an npm **workspace**, so we can develop locally but still
depend on it by name:

```bash
npm init -y --workspace plugins/flags
```

This adds a `workspaces` entry to the root `package.json` and symlinks
`node_modules/flags` → `plugins/flags`. Local-first, no publishing needed.

👉 The whole plugin — `plugins/flags/cds-plugin.js`:

```js
import cds from '@sap/cds'
import flags from './flags.json' with { type: 'json' }

const LOG = cds.log('flags')
const isFlagified = element => element['@flagify']

cds.once('served', services => {
  for (const srv of services) {
    if (!(srv instanceof cds.ApplicationService)) continue
    for (const entity of srv.entities) {
      const targets = Object.values(entity.elements).filter(isFlagified)
      if (!targets.length) continue
      srv.after('READ', entity, rows => {
        for (const row of rows)
          for (const el of targets) row[el.name] = flags[row[el.name]] ?? row[el.name]
      })
    }
  }
})
```

Two things differ from the SAP original, both deliberate:

- **ESM, not CommonJS.** In CDS 10 the plugin loader uses dynamic `import()` whenever
  the project is ESM, so `import` works — including `with { type: 'json' }` instead of
  `require('./flags')`. Note that the *plugin's own* `package.json` needs
  `"type": "module"`; the host project's setting does not carry over.
- `srv instanceof cds.ApplicationService` instead of comparing `kind` strings — the
  idiom used by the SAP-maintained plugins.

👉 Start the server. Nothing happens:

```bash
DEBUG=plugins cds watch
```

The plugin is not in the log. **A `cds-plugin.js` on disk is not a plugin** — it has to
be a dependency.

👉 So declare it:

```bash
npm add flags
```

```log
[cds.plugins] - loading flags: { impl: 'plugins/flags/cds-plugin.js' }
[flags] - flagifying SupportService.Customers.{country}
```

👉 <http://localhost:4004/odata/v4/support/Customers>

```json
{ "name": "Alice Ackermann", "country": "🇦🇹" }
```

And it can be switched off at the dependency level — `npm remove flags`.

### Why this pattern is a design smell

It works, but it **overwrites the payload**. The model says `country : String(20)` and
promises a country name; the service returns an emoji. `$filter=country eq 'Austria'`
still filters on the stored value. Nothing in `$metadata` hints at any of it.

The plugin changed *behaviour* but lied about the *model*. Fixing that is the model layer.

---

## 3 — Skeleton and auto-configuration

`git checkout 02-skeleton`

👉 Create the real plugin:

```bash
npm init -y --workspace plugins/soft-delete
```

Rename it to `@clouddna/cds-plugin-soft-delete` in `plugins/soft-delete/package.json`
— the *package name* is what goes into dependencies; the folder name is irrelevant.

👉 A plugin can ship its own configuration. Add a `cds` section:

```jsonc
{
  "cds": {
    "requires": {
      "soft-delete": {
        "purgeAfter": "P90D",
        "[production]": { "purgeAfter": "P365D" }
      }
    }
  }
}
```

Step 3 of the plugin machinery merges every plugin's `cds` section into `cds.env`
*before* the project's own configuration. Consumers get working defaults and can
override anything.

👉 Prove it — without writing a line of configuration in the app:

```bash
npm add @clouddna/cds-plugin-soft-delete
cds env get requires.soft-delete
cds env get requires.soft-delete --for production
```

```log
{ purgeAfter: 'P90D' }
{ purgeAfter: 'P365D' }
```

**Profiles work in plugin configuration too.** This is how `@cap-js/sqlite` configures
itself as the `db` for development and stays out of the way in production.

---

## 4 — The plugin ships CDS

`git checkout 03-model-declarative`

A plugin is not limited to code. It can contribute **model**.

👉 `plugins/soft-delete/index.cds`:

```cds
namespace clouddna.softdelete;

aspect softDeleted @(softDelete) {

  /** When the row was soft-deleted. `null` means the row is live. */
  @readonly @UI.Hidden
  deletedAt : Timestamp;

  /** Who soft-deleted the row. */
  @readonly @UI.Hidden
  deletedBy : String(255);

} actions {

  /** Undo a soft delete. */
  action restore();

}
```

👉 One line in the plugin's `package.json` makes it part of **every** consuming
project's model:

```jsonc
"cds": { "requires": { "soft-delete": { "model": "@clouddna/cds-plugin-soft-delete" } } }
```

`cds.resolve` adds every `cds.requires.*.model` to the resolved model files. Watch the
startup log — `plugins/soft-delete/index.cds` is now loaded, and no one imported it.

👉 The consumer's entire opt-in, in `srv/soft-delete.cds`:

```cds
using { clouddna.softdelete.softDeleted } from '@clouddna/cds-plugin-soft-delete';

extend clouddna.support.Incidents with softDeleted;
```

👉 See what the compiler did with it:

```bash
cds compile '*' | jq '.definitions["SupportService.Incidents"] | {"@softDelete", elements: (.elements|keys), actions}'
```

<details>
<summary>Windows (PowerShell / cmd)</summary>

PowerShell:

```powershell
cds compile '*' | jq '.definitions[\"SupportService.Incidents\"] | {\"@softDelete\", elements: (.elements|keys), actions}'
```

cmd:

```cmd
cds compile * | jq ".definitions[\"SupportService.Incidents\"] | {\"@softDelete\", elements: (.elements|keys), actions}"
```

</details>

```json
{
  "@softDelete": true,
  "elements": ["ID","createdAt","createdBy","customer","deletedAt","deletedBy","modifiedAt","modifiedBy","status","title","urgency"],
  "actions": null
}
```

Three wins for free, straight from the compiler:

- the **elements** landed on the entity *and* on the service projection
- so did the **`@softDelete` annotation** — put it on the aspect, and every entity that
  includes it is marked, projections included. Consumers never annotate by hand.
- `@readonly` already works: `PATCH` with `{"deletedAt": ...}` is silently ignored.

👉 And one thing is missing. `"actions": null` — check `$metadata`:

```bash
curl -s 'localhost:4004/odata/v4/support/$metadata' | grep -c restore
```

Zero. **CDS propagates annotations and elements through `as projection on`, but not
actions.** The declarative road gets us 90% of the way and then stops.

---

## 5 — Patching the model at load time

`git checkout 04-model-programmatic`

`cds.on('loaded')` fires every time a model is loaded — and it is the **one point where a
change reaches everything at once**: the EDMX metadata, the runtime model and the database
schema are all derived from the CSN *after* it. Order from `@sap/cds/server.js`:

```
bootstrap → loaded → compile.to.edmx → compile.for.runtime → connect → serving → served → listening
```

Later hooks exist, but each one serves a single target: `compile.to.edmx`,
`compile.for.runtime` and `compile.to.dbx` are [events][compile-events] too, fired every
time *that* compilation runs. Patch on `loaded` and you do it once.

[compile-events]: https://cap.cloud.sap/docs/node.js/cds-compile#lifecycle-events

👉 `plugins/soft-delete/lib/model.js` — the whole model layer:

```js
export function enhanceModel (csn) {
  if (csn.meta?.[MARKER]) return                 // `loaded` fires per cds.load()
  const template = csn.definitions?.[TEMPLATE]
  if (!template) return                          // our model is not in play

  for (const name in csn.definitions) {
    const def = csn.definitions[name]
    if (!isEntity(def) || !isSoftDelete(def) || !def.elements) continue

    // (1) elements — for entities annotated but not extended
    for (const [key, element] of Object.entries(template.elements)) {
      if (def.elements[key]) continue
      def.elements[key] = { ...element }
    }

    // (2) actions — the projections need them, CDS won't propagate them
    if (isProjection(def) && !def.actions?.restore)
      def.actions = { ...def.actions, ...structuredClone(template.actions) }
  }

  if (csn.meta) csn.meta[MARKER] = true
}
```

```js
cds.on('loaded', enhanceModel)   // must be synchronous — `loaded` is not async-capable
```

Points worth pausing on:

- The **idempotency marker**. `loaded` fires for every `cds.load()`, and patching twice
  is a bug. `@cap-js/change-tracking` uses exactly this trick.
- The **template**. The shipped aspect doubles as the source of truth for what gets
  injected — no duplication between `index.cds` and the JavaScript.
- The **`!def.elements` guard** makes this correct for both CSN flavours. In an
  `inferred` CSN (what `cds.load` produces here) base entities *and* projections have
  `elements` and both carry the propagated annotation, so both get patched.
- Because this runs before `compile.to.edmx` and before `cds.deploy`, the injected
  elements reach the **OData metadata** and the **database table** with no extra hooks.

👉 The action is there now:

```bash
cds compile '*' | jq '.definitions["SupportService.Incidents"].actions'
curl -s 'localhost:4004/odata/v4/support/$metadata' | grep -o '<Action Name="restore"[^>]*'
```

```json
{ "restore": { "kind": "action" } }
```
```log
<Action Name="restore" IsBound="true"
```

👉 This also unlocks entities you *cannot* `extend` — from a reuse package, say. A bare
annotation is enough:

```cds
annotate support.Customers with @softDelete;   // elements injected by the hook
```

👉 Calling `restore()` now returns **501 Not Implemented**. The model is complete; the
behaviour is not.

---

## 6 — The runtime layer

`git checkout 05-runtime`

👉 `cds.on('served')` — every service is up, so we can introspect and register handlers
only where they are needed:

```js
export function registerHandlers (services) {
  for (const srv of services) {
    if (!(srv instanceof cds.ApplicationService)) continue

    const targets = [...srv.entities].filter(isSoftDeletable)
    if (!targets.length) continue

    srv.prepend(() => {
      for (const entity of targets) {
        srv.before('READ', entity, req => {
          if (req.query?.SELECT) req.query.where('deletedAt is null')
        })

        srv.on('DELETE', entity, async req => {
          const result = await UPDATE(req.subject)
            .set({ deletedAt: new Date().toISOString(), deletedBy: req.user.id })
            .where('deletedAt is null')
          if (!affected(result)) return req.reject(404, 'Record does not exist or was already deleted.')
        })

        srv.on('restore', entity, async req => {
          const result = await UPDATE(req.subject)
            .set({ deletedAt: null, deletedBy: null })
            .where('deletedAt is not null')   // restoring a live row is a 404, not a silent 204
          if (!affected(result)) return req.reject(404, 'Record does not exist or is not deleted.')
        })
      }
    })
  }
}
```

### `srv.prepend()` is not optional

This is the trap. `on` handlers run **instead of** the generic ones — but by the time
`served` fires, CAP's generic CRUD handlers are **already on the stack**. Register
`srv.on('DELETE', ...)` there and it never runs; you get a silent **hard delete**.

`before`/`after` handlers are listeners and can just be added. `on` handlers are
interceptors and must be [`prepend`][prepend]ed. `prepend()` must be synchronous.

[prepend]: https://cap.cloud.sap/docs/node.js/core-services#srv-prepend

> This is why `@cap-js/audit-logging` and `@cap-js/change-tracking` only ever register
> `before`/`after` in `served`.

### `$expand` is a separate code path

A `before READ` on `Incidents` never sees `GET Customers?$expand=incidents` — the
sub-select lives in the *parent* query's `columns`. Without handling it, the plugin
leaks deleted rows through the single most common Fiori access pattern:

```js
function filterExpands (columns, entity) {
  if (!Array.isArray(columns)) return
  for (const column of columns) {
    if (!column?.expand || !column.ref) continue
    const element = entity?.elements?.[column.ref.at(-1)]
    const target  = element?._target ?? cds.model.definitions[element?.target]
    if (!target) continue
    if (isSoftDeletable(target))
      column.where = column.where ? [...column.where, 'and', ...LIVE_CQN] : [...LIVE_CQN]
    filterExpands(column.expand, target)   // nested expands
  }
}
```

Registered once per service, on `'*'`, because *any* entity can expand into a
soft-deletable one.

### The reveal

First over HTTP, where the service behaves exactly as a client expects.

👉 Delete an incident:

```bash
curl -i -X DELETE 'localhost:4004/odata/v4/support/Incidents(aaaaaaaa-0000-0000-0000-000000000001)'
```

```log
HTTP/1.1 204 No Content
```

👉 It is gone from the service — `$count` drops from 6 to 5, the direct read gives 404,
`$expand` no longer shows it.

👉 And `restore()` brings it back:

```bash
curl -i -X POST 'localhost:4004/odata/v4/support/Incidents(aaaaaaaa-0000-0000-0000-000000000001)/SupportService.restore'
```

👉 `Customers` has no annotation, so `DELETE` there is still a real delete. The feature
is opt-in, per entity.

### Now prove the row never left the database

The interesting part is what the *table* looks like — and this has to happen in the
**same process** as the delete. `cds watch` runs SQLite in memory, so a second
`cds repl` would get its own fresh database and tell you nothing.

👉 So stop the server, and do both steps inside one REPL:

```bash
cds repl --run .
```

```js
const ID = 'aaaaaaaa-0000-0000-0000-000000000001'

await SELECT.from `clouddna.support.Incidents`       //> 6 rows

await SupportService.delete ('Incidents', ID)        //> soft delete, through the service
await SupportService.read ('Incidents')              //> 5 rows — hidden

await SELECT.from `clouddna.support.Incidents`       //> still 6 rows
```

`SupportService.delete()` is the same entry point the HTTP `DELETE` goes through — same
service, same handlers, no shortcut. The last line reads the table underneath the
service and finds **all six rows still there**:

```js
(await SELECT.from `clouddna.support.Incidents`).filter (r => r.deletedAt)
//> [{ ID: 'aaaaaaaa-…-000000000001', title: 'Printer on fire',
//>    deletedAt: '2026-09-01T09:12:33.187Z', deletedBy: 'anonymous', … }]
```

The service says the incident is gone. The database says it never moved, and now carries
`deletedAt` and `deletedBy`. That gap is the whole feature.

> To keep the HTTP flow *and* inspect the table from a second terminal, put the database
> in a file instead of memory: `cds deploy --to sqlite:db.sqlite`, then
> `CDS_REQUIRES_DB_CREDENTIALS_URL=db.sqlite cds watch`. Both processes then share one
> database — re-run `cds deploy` to reset between demos.

> **Two result shapes, one helper.** Since cds 10.0 *app-service* writes resolve to an
> array carrying `.affected` (opt out: `cds.env.features.legacy_srv_results`). A db-level
> `UPDATE` like ours still resolves to the plain number while
> `cds.env.features.legacy_db_results` is true — the default in cds 10.2, and marked for
> inversion in `@cap-js/db-service`. `affected = result => result?.affected ?? result`
> reads both, so the plugin survives that flip without a release.

---

## 7 — `cds add soft-delete`

`git checkout 06-tooling-add`

Plugins can extend the **CLI**. `cds add <facet>` writes project configuration.

```js
cds.add?.register?.('soft-delete', addPlugin())
```

👉 The plugin implements `options()`, `run()` and `combine()`:

```js
export const addPlugin = () => class extends cds.add.Plugin {
  options () {
    return { entity: { type: 'string', short: 'e', help: 'Entity to make soft-deletable.' } }
  }
  async run () {
    await cds.add.merge({ dependencies: { [PACKAGE]: '^1' } }).into('package.json')
    // ...scaffold srv/soft-delete.cds for the project's own entities
  }
  async combine () {
    const { hasHana, hasMultitenancy } = cds.add.readProject()
    if (hasHana) console.log('...review the HDI table migration before deploying.')
  }
}
```

- `run()` — runs once, when *your* facet is added
- `combine()` — runs on *every* `cds add` in the project, your own included, so you can
  react to `cds add hana` or `cds add mta` appearing later
- `cds.add.merge().into()` merges JSON and YAML semantically; for YAML it works on the AST
  and **preserves comments**
- hints go out via `console.log`, as the built-in facets do — `pushMessage()` exists on
  build plugins only

### The ESM factory pattern

Note it exports a **factory**, not a class. `cds.add` only exists while a `cds add`
command is running — it is `undefined` in the runtime. `class extends cds.add.Plugin`
at module scope would therefore throw on every server start.

The [docs' CommonJS pattern][cds-add] works because optional chaining short-circuits
argument evaluation:

```js
cds.add?.register?.('postgres', require('./lib/add'))   // require never runs
```

ESM `import` statements cannot be short-circuited — they are hoisted and evaluated
first. Deferring the class expression into a function is the ESM-correct equivalent.

[cds-add]: https://cap.cloud.sap/docs/tools/apis/cds-add

👉 Try it:

```bash
cds add --help | grep -A3 soft-delete
cds add soft-delete --entity clouddna.support.Incidents
```

It adds the dependency and scaffolds `srv/soft-delete.cds`, with the project's own
entities listed and the chosen one active. Reuse models like `@sap/cds/common` are
filtered out via `$location.file`.

---

## 8 — `cds build --for soft-delete`

`git checkout 07-tooling-build`

`cds add` touches sources you check in. `cds build` produces deployment artifacts. Our
task emits a housekeeping manifest so ops tooling doesn't have to parse the CDS model.

```js
export const buildPlugin = () => class extends cds.build.Plugin {
  static taskDefaults = { src: cds.env.folders.db }
  static hasTask () { return !!cds.env.requires?.['soft-delete'] }
  init () { this.task.dest = cds.utils.path.join(this.task.dest, 'soft-delete') }
  async build () {
    const model = await this.model()
    const entities = /* ...soft-deletable persistence entities... */
    if (!entities.length) this.pushMessage('...', cds.build.Plugin.WARNING)
    await this.write({ purgeAfter: cds.env.requires['soft-delete'].purgeAfter, entities })
      .to('manifest.json')
  }
}
```

`hasTask()` is how the build system **auto-detects** the task — no configuration in the
consumer project.

👉 Run it:

```bash
cds build
cat gen/db/soft-delete/manifest.json
```

```json
{ "purgeAfter": "P90D", "entities": ["clouddna.support.Incidents"] }
```

👉 A plugin can also contribute to the **configuration schema** (beta), so its settings
get code completion in `package.json` and `.cdsrc.json`:

```jsonc
"cds": {
  "schema": {
    "buildTaskType": {
      "name": "soft-delete",
      "description": "Emits a soft-delete housekeeping manifest to gen/soft-delete."
    }
  }
}
```

The contribution points are exactly `buildTaskType`, `databaseType` and `cds`.

---

## 9 — Testing the plugin

`git checkout 08-tests`

`cds.test` 1.0 (April 2026) is runner-agnostic: Node's built-in runner, **Vitest**, Mocha
and, for now, Jest. CAP's own suites moved to Vitest and the Node runner, and Jest support
is slated for removal — new CAP projects are ESM, which Jest never handled well. `cds test`
on the CLI wraps Node's runner; we use Vitest.

```bash
npm add -D @cap-js/cds-test vitest chai
npm test
```

> `chai` is what `cds.test`'s `expect` is built on. The model suite has no server and no
> `cds.test()` call, so it imports `chai` directly — declare it rather than leaning on a
> transitive dependency.

Two suites, and the split matters:

**`test/model.test.js`** — the model layer needs no server at all. Compile and read the
CSN. Milliseconds:

```js
const csn = await cds.load('*')
expect(csn.definitions['SupportService.Incidents'].actions).to.have.property('restore')
expect(csn.definitions['SupportService.Customers'].elements).to.not.have.property('deletedAt')
```

**`test/soft-delete.test.js`** — end to end, including the assertion that *is* the
feature:

```js
const { GET, POST, PATCH, DELETE, expect } = cds.test('.')

it('hides the row from OData but keeps it in the database', async () => {
  const { status } = await DELETE(`${SRV}/Incidents(${ID})`)
  expect(status).to.equal(204)
  await expect(GET(`${SRV}/Incidents(${ID})`)).to.be.rejectedWith(/404/)

  const row = await SELECT.one.from('clouddna.support.Incidents').where({ ID })
  expect(row, 'row must still exist in the table').to.exist
  expect(row.deletedAt).to.not.be.null
})
```

Reading straight from the table bypasses the service and its filters — which is exactly
what makes it a proof rather than a tautology.

The `$expand` leak described in step 6 was found by writing this suite. Worth saying out
loud: the tests are not decoration, they caught a real bug.

---

## 10 — Packaging and publishing

`git checkout 09-publish`

```jsonc
{
  "name": "@clouddna/cds-plugin-soft-delete",
  "type": "module",
  "main": "cds-plugin.js",
  "files": ["cds-plugin.js", "index.cds", "lib", "README.md"],
  "keywords": ["cap", "cds", "cds-plugin", "sap", "soft-delete"],
  "peerDependencies": { "@sap/cds": ">=10" }
}
```

- **`files`** — an allowlist. Ship the model and the code, not your tests.
- **`peerDependencies`, not `dependencies`** — use the consumer's runtime, never bundle
  a second copy of `@sap/cds`.
- **Zero runtime dependencies.** This plugin adds nothing to the consumer's tree.
- **`keywords: ["cds-plugin"]`** — the convention for discoverability.

👉 See exactly what ships:

```bash
cd plugins/soft-delete && npm pack --dry-run
```

```log
npm notice 2.5kB README.md
npm notice 685B  cds-plugin.js
npm notice 902B  index.cds
npm notice 3.3kB lib/add.js
npm notice 1.5kB lib/build.js
npm notice 2.0kB lib/model.js
npm notice 3.9kB lib/runtime.js
npm notice 941B  package.json
```

### The test that workspace development hides

A workspace symlink is *not* the same as an installed package. `files` mistakes, missing
`index.cds`, wrong `main` — none of it shows up until someone installs it for real.

👉 So install it for real:

```bash
cd plugins/soft-delete && npm pack --pack-destination /tmp
cds init /tmp/consumer-smoke --add nodejs,sqlite,sample
cd /tmp/consumer-smoke && npm install
npm add /tmp/clouddna-cds-plugin-soft-delete-1.0.0.tgz
cds add soft-delete
cds watch
```

The bookshop sample has a `db/` model with `Books`, `Authors` and `Genres` behind two
services, so `cds add soft-delete` lists all three and `srv/soft-delete.cds` is yours to
trim. A different project, a different model shape, a genuine `node_modules` install — and
`DELETE`/`restore()` behave identically. `cds build` produces the manifest there too.

That is the whole point of a plugin: `npm add`, and a feature appears. Once the package is
on a registry it is even one command, with the beta `--package` option of `cds add`:

```bash
cds add soft-delete -p @clouddna/cds-plugin-soft-delete
```

> Publishing to npm is one command further (`npm publish --access public` for a scoped
> package). `npm pack` plus this smoke test proves the same things without occupying a
> name on the registry.

---

## What this plugin deliberately does not do

Honest scope beats hidden bugs:

- **Fiori drafts.** Draft-enabled entities have their own delete flow.
- **Cascading soft delete** along compositions. Deleting a parent does not mark children.
- **Physical purging.** `purgeAfter` is reported in the build manifest; no job acts on it.
- **The right to erasure.** Soft delete is in direct tension with GDPR — for personal
  data use [`@cap-js/data-privacy`](https://cap.cloud.sap/docs/plugins/) instead.

## Further info

- [CDS Plugin Packages](https://cap.cloud.sap/docs/node.js/cds-plugins) — the `cds-plugin.js`
  contract, auto-configuration, configuration schema
- [Plugins for `cds add`](https://cap.cloud.sap/docs/tools/apis/cds-add) and
  [Build Plugins](https://cap.cloud.sap/docs/tools/apis/cds-build)
- [Lifecycle Events](https://cap.cloud.sap/docs/node.js/cds-server#lifecycle-events) ·
  [Hooks: on, before, after](https://cap.cloud.sap/docs/guides/services/custom-code#hooks-on-before-after) ·
  [`srv.prepend()`](https://cap.cloud.sap/docs/node.js/core-services#srv-prepend)
- [`cds.test`](https://cap.cloud.sap/docs/node.js/cds-test) ·
  [CDS 10 release notes](https://cap.cloud.sap/docs/releases/2026/jun26)
- Reference implementations worth reading:
  [`@cap-js/change-tracking`](https://github.com/cap-js/change-tracking) (model enhancement,
  `cds add` registration) and
  [`@cap-js/audit-logging`](https://github.com/cap-js/audit-logging) (`served` introspection)
- The original exercise: [04 - Creating a plugin][ex04] in
  [`SAP-samples/cap-tour-hands-on`](https://github.com/SAP-samples/cap-tour-hands-on)
