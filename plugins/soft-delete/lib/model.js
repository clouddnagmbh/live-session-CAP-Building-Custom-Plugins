import cds from '@sap/cds'

const LOG = cds.log('soft-delete')

const ANNOTATION = '@softDelete'
const TEMPLATE   = 'clouddna.softdelete.softDeleted'
const MARKER     = 'clouddna.softDelete.enhanced'

const isEntity     = def => def.kind === 'entity'
const isSoftDelete = def => !!def[ANNOTATION]
const isProjection = def => !!(def.query || def.projection)

/**
 * Runs on `cds.on('loaded')` — the last point at which the model can still be
 * changed, before it is compiled to EDMX, to the runtime model, and deployed.
 *
 * Two jobs:
 *  1. Copy the template aspect's elements onto entities that only carry a bare
 *     `@softDelete` annotation (for entities you cannot `extend`, e.g. from a
 *     reuse package).
 *  2. Add the `restore()` action to service projections — CDS propagates
 *     annotations and elements through `as projection on`, but *not* actions.
 *
 * Must be synchronous: `loaded` is not an async-capable lifecycle event.
 */
export function enhanceModel (csn) {
  if (csn.meta?.[MARKER]) return                 // `loaded` fires per cds.load()
  const template = csn.definitions?.[TEMPLATE]
  if (!template) return                          // our model is not in play

  let elements = 0, actions = 0
  for (const name in csn.definitions) {
    const def = csn.definitions[name]
    if (!isEntity(def) || !isSoftDelete(def) || !def.elements) continue

    // (1) elements — `??=` keeps anything the consumer defined themselves
    for (const [key, element] of Object.entries(template.elements)) {
      if (def.elements[key]) continue
      def.elements[key] = { ...element }
      elements++
    }

    // (2) actions — only needed on the projections, the base entity has them
    if (isProjection(def) && !def.actions?.restore) {
      def.actions = { ...def.actions, ...structuredClone(template.actions) }
      actions++
      LOG.debug(`added restore() to ${name}`)
    }
  }

  if (csn.meta) csn.meta[MARKER] = true
  LOG.debug(`model enhanced: +${elements} elements, +${actions} actions`)
}
