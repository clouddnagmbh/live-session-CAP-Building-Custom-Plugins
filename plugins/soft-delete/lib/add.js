import cds from '@sap/cds'

const PACKAGE = '@clouddna/cds-plugin-soft-delete'
const TARGET  = 'srv/soft-delete.cds'

/**
 * Exported as a *factory*, not a class.
 *
 * `cds.add` only exists while a `cds add` command is running — it is undefined
 * in the runtime. Declaring `class extends cds.add.Plugin` at module scope
 * would therefore throw on every server start. In CommonJS the docs' pattern
 * `cds.add?.register?.('x', require('./add'))` short-circuits the require;
 * ESM `import` statements cannot be short-circuited, so we defer the class
 * expression into a function instead.
 */
export const addPlugin = () => class extends cds.add.Plugin {

  options () {
    return {
      entity: {
        type: 'string',
        short: 'e',
        help: 'Entity to make soft-deletable, e.g. my.bookshop.Books. Default: all entities in the model.'
      }
    }
  }

  async run () {
    const { merge } = cds.add
    const { write, exists } = cds.utils

    await merge({ dependencies: { [PACKAGE]: '^1' } }).into('package.json')

    if (exists(TARGET)) return console.log(`${TARGET} already exists — left untouched.`)

    const entities = await softDeletableCandidates()
    const chosen = cds.cli?.options?.entity
    const lines = entities.map(name =>
      chosen ? (name === chosen ? extend(name) : `// ${extend(name)}`) : extend(name))

    await write(`\
using { clouddna.softdelete.softDeleted } from '${PACKAGE}';

// Every entity listed here marks rows on DELETE instead of removing them,
// hides them from READs, and gets a bound restore() action.
${lines.join('\n') || '// extend <your.Entity> with softDeleted;'}
`).to(TARGET)
  }

  /**
   * Runs on *every* `cds add` in the project, our own facet included, so the
   * plugin can react to `hana` or `multitenancy` arriving later. Unlike build
   * plugins, `cds.add.Plugin` has no `pushMessage()`; the built-in facets
   * print hints with `console.log`, so we do the same.
   */
  async combine () {
    const { hasHana, hasMultitenancy } = cds.add.readProject()
    if (hasHana) console.log(
      'soft delete adds deletedAt/deletedBy columns — review the HDI table migration before deploying.')
    if (hasMultitenancy) console.log(
      'soft delete adds columns to tenant models — run a tenant upgrade after deploying.')
  }
}

const extend = name => `extend ${name} with softDeleted;`

/**
 * Entities worth offering: the persistence entities actually exposed by a
 * service in this project. Anything a service does not serve cannot be
 * soft-deleted through the API anyway, and this keeps reuse models such as
 * `@sap/cds/common` out of the generated file.
 */
async function softDeletableCandidates () {
  try {
    const csn = await cds.load('*', { root: cds.root })
    const served = new Set()
    for (const def of Object.values(csn.definitions)) {
      const from = (def.projection ?? def.query?.SELECT)?.from?.ref?.[0]
      if (from && typeof from === 'string') served.add(from)
    }
    return [...served].filter(name => {
      const def = csn.definitions[name]
      return def?.kind === 'entity' && !def.query && !def.projection && !name.endsWith('.texts')
    }).sort()
  } catch {
    return []
  }
}
