# @clouddna/cds-plugin-soft-delete

Declarative soft delete for SAP CAP (Node.js, CDS 10).

`DELETE` marks a row instead of removing it, `READ` hides marked rows, and a bound
`restore()` action brings them back. Opt in per entity — everything else keeps
CAP's default behaviour.

## Install

```sh
npm add @clouddna/cds-plugin-soft-delete
```

Or let `cds add` wire it up and scaffold the opt-in file for you:

```sh
cds add soft-delete --entity my.bookshop.Books
```

Or install and wire up in one go (`--package` is beta in `@sap/cds-dk` 10):

```sh
cds add soft-delete -p @clouddna/cds-plugin-soft-delete
```

## Use

Include the `softDeleted` aspect on the entities that need it:

```cds
using { clouddna.softdelete.softDeleted } from '@clouddna/cds-plugin-soft-delete';

extend my.bookshop.Books with softDeleted;
```

That is all. The aspect contributes:

| | |
|---|---|
| `deletedAt : Timestamp` | `@readonly`, `@UI.Hidden` — `null` means the row is live |
| `deletedBy : String(255)` | `@readonly`, `@UI.Hidden` |
| `action restore()` | bound action, undoes a soft delete |
| `@softDelete` | the marker the runtime looks for; propagates to service projections |

For entities you cannot `extend` — say, from a reuse package — annotate instead;
the plugin then contributes the elements itself:

```cds
annotate my.reused.Orders with @softDelete;
```

## Behaviour

| Request | Result |
|---|---|
| `DELETE Books(1)` | `204`, row marked, still in the table |
| `DELETE Books(1)` again | `404` |
| `GET Books` / `GET Books(1)` / `$count` | marked rows hidden |
| `GET Authors?$expand=books` | marked rows hidden in the sub-select too |
| `POST Books(1)/restore` | `204`, row live again |
| `PATCH Books(1) {deletedAt}` | ignored, the element is `@readonly` |

## Configuration

```jsonc
{ "cds": { "requires": { "soft-delete": {
  "purgeAfter": "P90D"          // retention, reported in the build manifest
}}}}
```

Profiles work as usual — the plugin itself ships `P365D` for `[production]`.

`cds build` emits `gen/db/soft-delete/manifest.json` listing the soft-deletable
entities and the configured retention, for housekeeping jobs.

## Scope

Deliberately not covered: Fiori draft-enabled entities, cascading soft delete
along compositions, and physical purging. Soft delete is also in tension with
GDPR's right to erasure — for personal data, use
[`@cap-js/data-privacy`](https://cap.cloud.sap/docs/plugins/) instead.

## License

Apache-2.0
