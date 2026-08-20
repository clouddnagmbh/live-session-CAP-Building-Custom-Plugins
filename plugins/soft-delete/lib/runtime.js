import cds from '@sap/cds'

const LOG = cds.log('soft-delete')

const ANNOTATION = '@softDelete'
const LIVE    = 'deletedAt is null'
const DELETED = 'deletedAt is not null'
/** CQN for `deletedAt is null`, used inside `$expand` sub-selects. */
const LIVE_CQN = [{ ref: ['deletedAt'] }, 'is', 'null']

const isSoftDeletable = def => !!def?.[ANNOTATION]

/**
 * Rows touched by a write, whatever shape the runtime hands back.
 *
 * App-service writes resolve to an array carrying `.affected` since cds 10.0
 * (`cds.env.features.legacy_srv_results` opts out). A db-level `UPDATE` like
 * ours still resolves to the plain number while `legacy_db_results` is true,
 * which is the default in cds 10.2 and marked for inversion. Reading both
 * shapes keeps the plugin correct on either side of that flip.
 */
const affected = result => result?.affected ?? result

/**
 * `$expand` is a different code path: the sub-select lives in the parent
 * query's `columns`, so a `before READ` on the expanded entity never sees it.
 * Walk the columns and filter every expand whose target is soft-deletable.
 */
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

/**
 * Runs on `cds.on('served')` — all services are bootstrapped, so we can
 * introspect them and register handlers only where they are needed.
 *
 * Note the `srv.prepend()`: by the time `served` fires, CAP's generic CRUD
 * handlers are already on the handler stack. `before`/`after` handlers are
 * listeners and can simply be added, but an `on` handler runs *instead of*
 * the generic one, so it has to be prepended or it never gets called.
 * `prepend()` must be synchronous.
 */
export function registerHandlers (services) {
  for (const srv of services) {
    if (!(srv instanceof cds.ApplicationService)) continue

    const targets = [...srv.entities].filter(isSoftDeletable)
    if (!targets.length) continue

    srv.prepend(() => {
      /** Any entity can expand into a soft-deletable one. */
      srv.before('READ', '*', req => filterExpands(req.query?.SELECT?.columns, req.target))

      for (const entity of targets) {
        LOG.info('soft delete active for', entity.name)

        /** Hide soft-deleted rows from direct reads. */
        srv.before('READ', entity, req => {
          if (req.query?.SELECT) req.query.where(LIVE)
        })

        /** Mark instead of delete. Replaces CAP's generic DELETE handler. */
        srv.on('DELETE', entity, async req => {
          const result = await UPDATE(req.subject)
            .set({ deletedAt: new Date().toISOString(), deletedBy: req.user.id })
            .where(LIVE)
          if (!affected(result)) return req.reject(404, 'Record does not exist or was already deleted.')
          LOG.info('soft-deleted', entity.name, req.data)
        })

        /**
         * Undo a soft delete. The `where` matters: without it the UPDATE also
         * matches live rows, so restoring something that was never deleted
         * would silently answer 204 instead of telling the caller it was a
         * no-op — and the 404 below would be unreachable.
         */
        srv.on('restore', entity, async req => {
          const result = await UPDATE(req.subject)
            .set({ deletedAt: null, deletedBy: null })
            .where(DELETED)
          if (!affected(result)) return req.reject(404, 'Record does not exist or is not deleted.')
          LOG.info('restored', entity.name, req.data)
        })
      }
    })
  }
}
