import cds from '@sap/cds'

const ANNOTATION = '@softDelete'

/**
 * Exported as a factory for the same reason as the `cds add` plugin:
 * `cds.build` is undefined unless a `cds build` command is running.
 *
 * The task emits a housekeeping manifest — which entities hold soft-deleted
 * rows and how long they are kept — so operations tooling does not have to
 * parse the CDS model to find out.
 */
export const buildPlugin = () => class extends cds.build.Plugin {

  static taskDefaults = { src: cds.env.folders.db }

  /**
   * The build system auto-detects tasks by asking every registered plugin.
   * Our own `cds` section always provides `requires.soft-delete` once the
   * plugin is installed, so this means "plugin present"; a plugin with
   * optional configuration would check for that configuration here.
   */
  static hasTask () {
    return !!cds.env.requires?.['soft-delete']
  }

  init () {
    this.task.dest = cds.utils.path.join(this.task.dest, 'soft-delete')
  }

  async build () {
    const model = await this.model()
    if (!model) return

    const entities = Object.entries(model.definitions)
      .filter(([, d]) => d.kind === 'entity' && d[ANNOTATION] && !d.query && !d.projection)
      .map(([name]) => name)
      .sort()

    if (!entities.length)
      this.pushMessage('No soft-deletable entities found — nothing to keep house on.', cds.build.Plugin.WARNING)

    await this.write({
      purgeAfter: cds.env.requires['soft-delete'].purgeAfter,
      entities
    }).to('manifest.json')
  }
}
